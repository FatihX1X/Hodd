// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddieVault} from "../../src/HoddieVault.sol";
import {HoddieVaultFactory} from "../../src/HoddieVaultFactory.sol";
import {HoddUSYCVault} from "../../src/HoddUSYCVault.sol";
import {PoolForkBase} from "./PoolForkBase.sol";

/// @notice The CLEAN, Morpho-only HoddieVault (commit fa2be29) using the pooled HoddUSYCVault as an
///         ordinary ERC-4626 strategy, on the real Arc Testnet Teller. Neither the HoddieVault nor
///         its owner is allowlisted by Circle: only the pool is.
///
///         What this documents: the pool pays only the share holder and its shares can not be
///         transferred, so the HoddieVault can only exit it by redeeming to ITSELF. The operator
///         functions already do that (`redeemFromStrategy` redeems to the vault), but
///         `withdrawAll`/`exitStrategy` of fa2be29 try `redeem(shares, owner, vault)` and then a
///         share transfer, both of which the pool refuses: the pool shares stay in the HoddieVault
///         and the owner can not get them out without the operator. See the last tests.
contract HoddUSYCVaultHoddieForkTest is PoolForkBase {
    HoddieVaultFactory internal factory;
    HoddieVault internal hv;
    address internal owner = makeAddr("hoddieOwner");
    address internal operator = makeAddr("hoddieOperator");

    uint256 internal constant FUNDS = 3000e6;

    function setUp() public override {
        super.setUp();
        if (block.chainid != ARC_TESTNET) return;

        _allowlist(address(pool), true); // Circle allowlists the pool (and only the pool)
        factory = new HoddieVaultFactory(IERC20(USDC));
        address[] memory strategies = new address[](2);
        strategies[0] = address(pool);
        strategies[1] = MORPHO;
        hv = HoddieVault(factory.createVault(owner, operator, 1000e6, 2500e6, strategies));
        _fund(address(hv), FUNDS);
    }

    function test_fork_hoddieVaultAcceptsThePoolAsAStrategy() public view {
        assertTrue(hv.isStrategy(address(pool)));
        assertTrue(hv.isStrategy(MORPHO));
        assertEq(
            uint256(IAuthorityRoles(AUTHORITY).getUserRoles(address(hv))), 0, "not allowlisted"
        );
        assertEq(
            uint256(IAuthorityRoles(AUTHORITY).getUserRoles(owner)), 0, "owner not allowlisted"
        );
    }

    function test_fork_operatorDepositsIntoThePoolAndRedeemsBackIntoTheVault() public {
        vm.prank(operator);
        uint256 shares = hv.depositToStrategy(address(pool), 500e6);

        assertEq(pool.balanceOf(address(hv)), shares, "the HoddieVault holds the pool shares");
        assertEq(_usdc(address(hv)), FUNDS - 500e6);
        assertEq(_usyc(address(hv)), 0, "the HoddieVault never holds USYC");
        assertGt(_usyc(address(pool)), 0);
        assertEq(IERC20(USDC).allowance(address(hv), address(pool)), 0, "allowance reset");

        // redeem half: the HoddieVault is the holder AND the receiver, which the pool allows
        uint256 before = _usdc(address(hv));
        vm.prank(operator);
        uint256 assets = hv.redeemFromStrategy(address(pool), shares / 2);
        assertEq(_usdc(address(hv)) - before, assets, "the returned figure is the exact USDC delta");
        assertApproxEqAbs(assets, 250e6, 0.5e6);
        assertEq(pool.balanceOf(address(hv)), shares - shares / 2);
    }

    function test_fork_exactAssetWithdrawalsAreNotSupportedByThePool() public {
        vm.prank(operator);
        hv.depositToStrategy(address(pool), 500e6);
        vm.prank(operator);
        vm.expectRevert(HoddUSYCVault.NotSupported.selector);
        hv.withdrawFromStrategy(address(pool), 10e6);
    }

    /// @dev THE FINDING: fa2be29's withdrawAll can not pull the pool shares out.
    function test_fork_fa2be29_withdrawAllLeavesThePoolSharesBehind() public {
        vm.startPrank(operator);
        uint256 poolShares = hv.depositToStrategy(address(pool), 600e6);
        hv.depositToStrategy(MORPHO, 700e6);
        vm.stopPrank();

        uint256 ownerBefore = _usdc(owner);
        vm.expectEmit(true, false, false, true, address(hv));
        emit HoddieVault.StrategyExitFailed(address(pool), poolShares);
        vm.prank(owner);
        hv.withdrawAll();

        // the idle USDC and the Morpho position arrive ...
        assertApproxEqAbs(_usdc(owner) - ownerBefore, FUNDS - 600e6, 3);
        assertEq(_usdc(address(hv)), 0);
        // ... the pool shares do not: redeem(shares, owner, vault) is refused (receiver != holder)
        // and the pool shares are not transferable, so they stay in the HoddieVault
        assertEq(pool.balanceOf(address(hv)), poolShares, "stuck without the operator");
        assertEq(pool.balanceOf(owner), 0);

        vm.prank(owner);
        hv.exitStrategy(address(pool)); // same story
        assertEq(pool.balanceOf(address(hv)), poolShares);
    }

    /// @dev With the operator alive the owner is not stuck: redeem to the vault, then sweep.
    function test_fork_operatorAssistedExitWorksWithTheCleanVault() public {
        vm.startPrank(operator);
        uint256 poolShares = hv.depositToStrategy(address(pool), 600e6);
        vm.stopPrank();

        vm.prank(operator);
        uint256 assets = hv.redeemFromStrategy(address(pool), poolShares);
        assertGt(assets, 0);

        uint256 ownerBefore = _usdc(owner);
        vm.prank(owner);
        hv.withdrawAll();
        assertApproxEqAbs(_usdc(owner) - ownerBefore, FUNDS, 0.5e6, "everything reaches the owner");
        assertEq(pool.balanceOf(address(hv)), 0);
    }

    /// @dev WHAT THE EXIT PATH NEEDS: "redeem to the vault itself, then sweep the idle USDC". The
    ///      pool supports exactly that (holder == receiver == the HoddieVault), without the
    ///      operator and without anybody being allowlisted besides the pool. This test plays the
    ///      fallback by hand, as the HoddieVault would execute it.
    function test_fork_redeemToSelfThenSweepIsAllTheExitPathNeeds() public {
        vm.startPrank(operator);
        uint256 poolShares = hv.depositToStrategy(address(pool), 600e6);
        hv.depositToStrategy(MORPHO, 700e6);
        vm.stopPrank();

        // 1) the fallback: the vault redeems its own shares to itself (what an owner-only
        //    `withdrawAll` would do after the owner-receiver attempt was refused) ...
        uint256 idleBefore = _usdc(address(hv));
        vm.prank(address(hv));
        uint256 got = pool.redeem(poolShares, address(hv), address(hv));
        assertEq(_usdc(address(hv)) - idleBefore, got, "exact delta, atomic");

        // 2) ... and the normal exit then sweeps all idle USDC and the Morpho position
        uint256 ownerBefore = _usdc(owner);
        vm.prank(owner);
        hv.withdrawAll();
        assertApproxEqAbs(_usdc(owner) - ownerBefore, FUNDS, 0.5e6);
        assertEq(pool.balanceOf(address(hv)), 0);
        assertEq(_usdc(address(hv)), 0);
    }

    /// @dev The pool's views the HoddieVault (or its operator) can use to size a redemption.
    function test_fork_poolViewsGuideTheOperator() public {
        vm.prank(operator);
        uint256 shares = hv.depositToStrategy(address(pool), 800e6);
        assertEq(pool.maxRedeem(address(hv)), shares);
        uint256 expected = pool.previewRedeem(shares);
        vm.prank(operator);
        uint256 assets = hv.redeemFromStrategy(address(pool), shares);
        assertEq(assets, expected);
    }
}

interface IAuthorityRoles {
    function getUserRoles(address user) external view returns (bytes32);
}
