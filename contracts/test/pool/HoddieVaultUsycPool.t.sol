// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {HoddieVault} from "../../src/HoddieVault.sol";
import {HoddUSYCVault} from "../../src/HoddUSYCVault.sol";
import {MockStrategy} from "../mocks/MockStrategy.sol";
import {PoolBase} from "./PoolBase.sol";

/// @notice A user's HoddieVault with Hodd's USYC pool (the real HoddUSYCVault over the mock
///         Teller) and a plain ERC-4626 strategy. Only the pool is allowlisted by Circle.
contract HoddieVaultUsycPoolTest is PoolBase {
    HoddieVault internal hv;
    MockStrategy internal morpho;
    address internal owner = makeAddr("hvOwner");
    address internal operator = makeAddr("hvOperator");
    uint256 internal constant FUNDS = 10_000e6;

    function setUp() public override {
        super.setUp();
        morpho = new MockStrategy(IERC20(address(usdc)));
        address[] memory list = new address[](2);
        list[0] = address(pool);
        list[1] = address(morpho);
        hv = new HoddieVault(
            IERC20(address(usdc)),
            owner,
            operator,
            HoddieVault.Limits(5000e6, 9000e6, 1000e6, 2500e6),
            list
        );
        usdc.mint(address(hv), FUNDS);
    }

    function _deposit(uint256 assets) internal returns (uint256 shares) {
        uint256 minShares = pool.previewDeposit(assets);
        vm.prank(operator);
        shares = hv.depositToStrategy(address(pool), assets, minShares);
    }

    /*//////////////////////////////////////////////////////////////
                               OPERATOR
    //////////////////////////////////////////////////////////////*/

    function test_depositHoldsPoolSharesNeverUsyc() public {
        uint256 shares = _deposit(2000e6);
        assertEq(pool.balanceOf(address(hv)), shares);
        assertEq(usyc.balanceOf(address(hv)), 0, "the vault never holds USYC");
        assertGt(usyc.balanceOf(address(pool)), 0);
        assertEq(usdc.allowance(address(hv), address(pool)), 0);
        assertEq(hv.depositSpentLast24h(), 2000e6);
        assertFalse(auth.investor(address(hv)), "the vault needs no allowlisting");
    }

    function test_depositHonoursMinShares() public {
        uint256 expected = pool.previewDeposit(1000e6);
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.InsufficientShares.selector, expected, expected + 1)
        );
        hv.depositToStrategy(address(pool), 1000e6, expected + 1);
    }

    function test_redeemToOwnerForwardsExactlyTheRedeemedUsdc() public {
        uint256 shares = _deposit(3000e6);
        uint256 idle = usdc.balanceOf(address(hv));
        uint256 expected = pool.previewRedeem(shares / 3);

        vm.expectEmit(true, true, false, true, address(hv));
        emit HoddieVault.RedeemedToOwner(address(pool), owner, shares / 3, expected);
        vm.prank(operator);
        uint256 assets = hv.redeemToOwner(address(pool), shares / 3, expected);

        assertEq(assets, expected);
        assertEq(usdc.balanceOf(owner), expected, "straight to the owner");
        assertEq(usdc.balanceOf(address(hv)), idle, "idle USDC untouched");
        assertEq(pool.balanceOf(address(hv)), shares - shares / 3);
        assertEq(hv.paymentSpentLast24h(), 0, "not a payment");
        assertEq(hv.depositSpentLast24h(), 3000e6, "deposit budget unchanged");
    }

    function test_redeemToOwnerChecksTheMinimumOnTheRealDelta() public {
        uint256 shares = _deposit(1000e6);
        uint256 expected = pool.previewRedeem(shares);
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.InsufficientAssets.selector, expected, expected + 1)
        );
        hv.redeemToOwner(address(pool), shares, expected + 1);
    }

    function test_redeemToOwnerGuards() public {
        uint256 shares = _deposit(1000e6);
        vm.startPrank(operator);
        vm.expectRevert(HoddieVault.ZeroAmount.selector);
        hv.redeemToOwner(address(pool), 0, 1);
        vm.expectRevert(HoddieVault.ZeroSlippageBound.selector);
        hv.redeemToOwner(address(pool), shares, 0);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, stranger));
        hv.redeemToOwner(stranger, shares, 1);
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        hv.redeemToOwner(address(pool), shares, 1);

        vm.prank(owner);
        hv.pause();
        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        hv.redeemToOwner(address(pool), shares, 1);
    }

    function test_redeemFromStrategyKeepsTheUsdcInTheVault() public {
        uint256 shares = _deposit(1000e6);
        uint256 idle = usdc.balanceOf(address(hv));
        uint256 expected = pool.previewRedeem(shares);
        vm.prank(operator);
        assertEq(hv.redeemFromStrategy(address(pool), shares, expected), expected);
        assertEq(usdc.balanceOf(address(hv)), idle + expected);
        assertEq(usdc.balanceOf(owner), 0);
    }

    function test_exactAssetWithdrawalsAreNotSupportedByThePool() public {
        _deposit(1000e6);
        vm.prank(operator);
        vm.expectRevert(HoddUSYCVault.NotSupported.selector);
        hv.withdrawFromStrategy(address(pool), 10e6, type(uint256).max);
    }

    /*//////////////////////////////////////////////////////////////
                                 OWNER
    //////////////////////////////////////////////////////////////*/

    function test_withdrawAllRedeemsThePoolWithoutTheOperatorAndWhilePaused() public {
        uint256 shares = _deposit(2000e6);
        vm.prank(operator);
        hv.depositToStrategy(address(morpho), 1500e6, 1);
        uint256 fromPool = pool.previewRedeem(shares);

        vm.startPrank(owner);
        hv.revokeOperator();
        hv.pause();
        vm.expectEmit(true, false, false, true, address(hv));
        emit HoddieVault.StrategyExited(address(pool), shares, fromPool, 0);
        hv.withdrawAll();
        vm.stopPrank();

        assertEq(usdc.balanceOf(owner), FUNDS - 2000e6 + fromPool, "everything reaches the owner");
        assertEq(pool.balanceOf(address(hv)), 0);
        assertEq(morpho.balanceOf(address(hv)), 0);
        assertEq(usdc.balanceOf(address(hv)), 0);
        assertEq(pool.totalSupply(), 0);
    }

    function test_exitStrategyForwardsOnlyWhatThePoolPaid() public {
        uint256 shares = _deposit(2000e6);
        uint256 idle = usdc.balanceOf(address(hv));
        uint256 fromPool = pool.previewRedeem(shares);

        vm.prank(owner);
        hv.exitStrategy(address(pool));
        assertEq(usdc.balanceOf(owner), fromPool);
        assertEq(usdc.balanceOf(address(hv)), idle, "idle USDC stays");
    }

    function test_blockedPoolKeepsItsSharesButBlocksNothingElse() public {
        uint256 shares = _deposit(2000e6);
        auth.setUserRole(address(pool), 0, false); // Circle removes the pool

        vm.expectEmit(true, false, false, true, address(hv));
        emit HoddieVault.StrategyExitFailed(address(pool), shares);
        vm.prank(owner);
        hv.withdrawAll();
        assertEq(usdc.balanceOf(owner), FUNDS - 2000e6, "the rest arrives");
        assertEq(pool.balanceOf(address(hv)), shares, "kept for later: pool shares can not move");

        auth.setUserRole(address(pool), 0, true); // restored
        uint256 fromPool = pool.previewRedeem(shares);
        vm.prank(owner);
        hv.exitStrategy(address(pool));
        assertEq(usdc.balanceOf(owner), FUNDS - 2000e6 + fromPool);
        assertEq(pool.balanceOf(address(hv)), 0);
    }

    function test_pausedAuthorityKeepsThePoolPutAndTheRestFlows() public {
        _deposit(2000e6);
        auth.setPaused(true);
        vm.prank(owner);
        hv.withdrawAll();
        assertEq(usdc.balanceOf(owner), FUNDS - 2000e6);
        assertGt(pool.balanceOf(address(hv)), 0);
    }

    /// @dev Circle's daily redemption limit allows only part: the pool's `maxRedeem` is taken,
    ///      forwarded, and the rest stays for later.
    function test_partialExitTakesThePoolsMaxRedeem() public {
        uint256 shares = _deposit(4000e6);
        teller.setLimits(type(uint256).max, 1000e6);
        uint256 most = pool.maxRedeem(address(hv));
        assertGt(most, 0);
        assertLt(most, shares);
        uint256 fromPool = pool.previewRedeem(most);

        vm.expectEmit(true, false, false, true, address(hv));
        emit HoddieVault.StrategyExitFailed(address(pool), shares - most);
        vm.prank(owner);
        hv.exitStrategy(address(pool));
        assertEq(usdc.balanceOf(owner), fromPool);
        assertLe(fromPool, 1000e6);
        assertEq(pool.balanceOf(address(hv)), shares - most);
    }

    function test_strangersCanNotRedeemTheVaultsPoolShares() public {
        uint256 shares = _deposit(1000e6);
        vm.prank(stranger);
        vm.expectRevert(HoddUSYCVault.RedeemOnlyByAndToTheHolder.selector);
        pool.redeem(shares, stranger, address(hv));
        vm.prank(stranger);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        hv.redeemFromStrategy(address(pool), shares, 1);
        vm.prank(stranger);
        vm.expectRevert();
        hv.exitStrategy(address(pool));
    }
}
