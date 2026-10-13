// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddieVault} from "../../src/HoddieVault.sol";
import {HoddieVaultFactory} from "../../src/HoddieVaultFactory.sol";
import {HoddUSYCVault} from "../../src/HoddUSYCVault.sol";
import {PoolForkBase} from "./PoolForkBase.sol";

/// @notice A user's HoddieVault using Hodd's pooled HoddUSYCVault as an ordinary ERC-4626
///         strategy next to Morpho, on the real Arc Testnet Teller. Neither the HoddieVault nor
///         its owner is allowlisted by Circle: only the pool is. The HoddieVault never holds USYC.
///
///         The pool pays only the share holder and its shares can not be transferred, so the
///         HoddieVault always redeems to itself and forwards the USDC that arrived: the operator's
///         `redeemToOwner` and the owner's `withdrawAll` / `exitStrategy` do it in one transaction,
///         without the operator in the owner's case.
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
        hv = HoddieVault(
            factory.createVault(
                owner, operator, HoddieVault.Limits(1000e6, 2500e6, 1000e6, 2500e6), strategies
            )
        );
        _fund(address(hv), FUNDS);
    }

    function _depositToPool(uint256 assets) internal returns (uint256 shares) {
        uint256 minShares = pool.previewDeposit(assets) * 995 / 1000;
        vm.prank(operator);
        shares = hv.depositToStrategy(address(pool), assets, minShares);
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
        uint256 shares = _depositToPool(500e6);

        assertEq(pool.balanceOf(address(hv)), shares, "the HoddieVault holds the pool shares");
        assertEq(_usdc(address(hv)), FUNDS - 500e6);
        assertEq(_usyc(address(hv)), 0, "the HoddieVault never holds USYC");
        assertGt(_usyc(address(pool)), 0);
        assertEq(IERC20(USDC).allowance(address(hv), address(pool)), 0, "allowance reset");
        assertEq(hv.depositSpentLast24h(), 500e6, "counted against the deposit budget");

        // redeem half into the vault: the HoddieVault is the holder AND the receiver
        uint256 before = _usdc(address(hv));
        uint256 expected = pool.previewRedeem(shares / 2);
        vm.prank(operator);
        uint256 assets = hv.redeemFromStrategy(address(pool), shares / 2, expected);
        assertEq(assets, expected);
        assertEq(_usdc(address(hv)) - before, assets, "the returned figure is the exact USDC delta");
        assertApproxEqAbs(assets, 250e6, 0.5e6);
        assertEq(pool.balanceOf(address(hv)), shares - shares / 2);
    }

    function test_fork_redeemToOwnerForwardsThePoolsUsdcInTheSameTransaction() public {
        uint256 shares = _depositToPool(800e6);
        uint256 idle = _usdc(address(hv));
        uint256 ownerBefore = _usdc(owner);
        uint256 expected = pool.previewRedeem(shares);

        vm.prank(operator);
        uint256 assets = hv.redeemToOwner(address(pool), shares, expected * 995 / 1000);

        assertEq(assets, expected, "the pool's own preview");
        assertEq(_usdc(owner) - ownerBefore, assets, "straight to the owner");
        assertEq(_usdc(address(hv)), idle, "idle USDC untouched");
        assertEq(pool.balanceOf(address(hv)), 0);
        assertApproxEqAbs(assets, 800e6, 0.5e6);
        assertEq(hv.paymentSpentLast24h(), 0, "not a payment");
    }

    function test_fork_redeemToOwnerHonoursTheMinimum() public {
        uint256 shares = _depositToPool(500e6);
        uint256 expected = pool.previewRedeem(shares);
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.InsufficientAssets.selector, expected, expected + 1)
        );
        hv.redeemToOwner(address(pool), shares, expected + 1);
    }

    function test_fork_exactAssetWithdrawalsAreNotSupportedByThePool() public {
        _depositToPool(500e6);
        vm.prank(operator);
        vm.expectRevert(HoddUSYCVault.NotSupported.selector);
        hv.withdrawFromStrategy(address(pool), 10e6, type(uint256).max);
    }

    /// @dev The owner gets everything back without the operator: pool shares are redeemed to the
    ///      vault and the USDC forwarded, Morpho is redeemed, the idle USDC swept.
    function test_fork_withdrawAllPullsThePoolOutWithoutTheOperator() public {
        uint256 poolShares = _depositToPool(600e6);
        vm.prank(operator);
        hv.depositToStrategy(MORPHO, 700e6, 1);
        uint256 fromPool = pool.previewRedeem(poolShares);

        vm.prank(owner);
        hv.revokeOperator();
        vm.prank(owner);
        hv.pause();

        uint256 ownerBefore = _usdc(owner);
        vm.expectEmit(true, false, false, true, address(hv));
        emit HoddieVault.StrategyExited(address(pool), poolShares, fromPool, 0);
        vm.prank(owner);
        hv.withdrawAll();

        assertApproxEqAbs(_usdc(owner) - ownerBefore, FUNDS, 0.5e6, "everything reaches the owner");
        assertEq(pool.balanceOf(address(hv)), 0);
        assertEq(IERC20(MORPHO).balanceOf(address(hv)), 0);
        assertEq(_usdc(address(hv)), 0);
        assertEq(_usyc(address(hv)), 0);
    }

    function test_fork_exitStrategyForwardsOnlyThePoolsUsdc() public {
        uint256 poolShares = _depositToPool(600e6);
        uint256 idle = _usdc(address(hv));
        uint256 fromPool = pool.previewRedeem(poolShares);
        uint256 ownerBefore = _usdc(owner);

        vm.prank(owner);
        hv.exitStrategy(address(pool));

        assertEq(_usdc(owner) - ownerBefore, fromPool);
        assertEq(_usdc(address(hv)), idle, "idle USDC stays");
        assertEq(pool.balanceOf(address(hv)), 0);
    }

    /// @dev While Circle does not permit the pool the shares stay put, but nothing else is blocked.
    function test_fork_withdrawAllStillReturnsEverythingElseWhenThePoolIsBlocked() public {
        uint256 poolShares = _depositToPool(600e6);
        _allowlist(address(pool), false);

        uint256 ownerBefore = _usdc(owner);
        vm.expectEmit(true, false, false, true, address(hv));
        emit HoddieVault.StrategyExitFailed(address(pool), poolShares);
        vm.prank(owner);
        hv.withdrawAll();
        assertEq(_usdc(owner) - ownerBefore, FUNDS - 600e6);
        assertEq(pool.balanceOf(address(hv)), poolShares, "kept for later");

        // Circle restores the pool: the owner exits the rest
        _allowlist(address(pool), true);
        vm.prank(owner);
        hv.exitStrategy(address(pool));
        assertEq(pool.balanceOf(address(hv)), 0);
        assertApproxEqAbs(_usdc(owner) - ownerBefore, FUNDS, 0.5e6);
    }

    /// @dev The pool's views the operator uses to size a redemption.
    function test_fork_poolViewsGuideTheOperator() public {
        uint256 shares = _depositToPool(800e6);
        assertEq(pool.maxRedeem(address(hv)), shares);
        uint256 expected = pool.previewRedeem(shares);
        vm.prank(operator);
        uint256 assets = hv.redeemFromStrategy(address(pool), shares, expected);
        assertEq(assets, expected);
    }
}

interface IAuthorityRoles {
    function getUserRoles(address user) external view returns (bytes32);
}
