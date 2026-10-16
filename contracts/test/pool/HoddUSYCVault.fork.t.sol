// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddUSYCVault} from "../../src/HoddUSYCVault.sol";
import {ITeller} from "../../src/interfaces/ITeller.sol";
import {IRolesAuthority} from "../../src/interfaces/IRolesAuthority.sol";
import {PoolForkBase, IAuthorityAdmin, ITellerAdmin} from "./PoolForkBase.sol";

/// @notice HoddUSYCVault against Circle's REAL Teller, USYC token and RolesAuthority on Arc
///         Testnet. The pool is allowlisted by impersonating the RolesAuthority owner inside the
///         fork; the users are wallets Circle has never heard of. See {PoolForkBase}.
contract HoddUSYCVaultForkTest is PoolForkBase {
    ITeller internal teller = ITeller(TELLER);

    /*//////////////////////////////////////////////////////////////
                               THE PREMISE
    //////////////////////////////////////////////////////////////*/

    function test_fork_constructorAcceptsTheRealContractsAndUsersAreNotAllowlisted() public view {
        assertEq(address(pool.teller()), TELLER);
        assertEq(teller.asset(), USDC);
        assertEq(teller.share(), USYC);
        assertEq(pool.decimals(), 12);
        // Circle knows neither the pool (yet) nor the plain user
        assertEq(uint256(IAuthorityAdmin(AUTHORITY).getUserRoles(PLAIN_USER)), 0);
        assertEq(uint256(IAuthorityAdmin(AUTHORITY).getUserRoles(address(pool))), 0);
    }

    function test_fork_constructorRejectsATellerForAnotherAsset() public {
        IRolesAuthority authority = pool.authority();
        vm.expectRevert(
            abi.encodeWithSelector(HoddUSYCVault.WrongTellerAsset.selector, MORPHO, USDC)
        );
        new HoddUSYCVault(
            IERC20(MORPHO), // not USDC
            ITeller(TELLER),
            IERC20(USYC),
            authority,
            admin
        );
    }

    /*//////////////////////////////////////////////////////////////
                          POOL NOT ALLOWLISTED (YET)
    //////////////////////////////////////////////////////////////*/

    function test_fork_poolNotAllowlisted_maxDepositIsZeroAndDepositRevertsCleanly() public {
        uint256 startUsdc = _usdc(PLAIN_USER);
        _readyUser(PLAIN_USER, 1000e6);
        startUsdc += 1000e6;

        assertEq(pool.maxDeposit(PLAIN_USER), 0);
        assertEq(pool.maxRedeem(PLAIN_USER), 0);
        // the views never revert, whatever Circle's contracts say
        pool.totalAssets();
        pool.previewDeposit(100e6);
        pool.previewRedeem(1e12);
        pool.convertToAssets(1e12);
        pool.convertToShares(1e6);

        vm.prank(PLAIN_USER);
        vm.expectRevert(HoddUSYCVault.NotPermittedByCircle.selector);
        pool.deposit(100e6, PLAIN_USER);
        assertEq(_usdc(PLAIN_USER), startUsdc, "the failed deposit moved nothing");
        assertEq(pool.totalSupply(), 0);

        // and it is the pool that has to be allowlisted, not the user: once Circle does that, the
        // very same call works for the very same plain wallet
        _allowlist(address(pool), true);
        assertGt(pool.maxDeposit(PLAIN_USER), 0);
        vm.prank(PLAIN_USER);
        assertGt(pool.deposit(100e6, PLAIN_USER), 0);
    }

    /*//////////////////////////////////////////////////////////////
                  A NON-ALLOWLISTED USER, ROUND TRIP, REAL TELLER
    //////////////////////////////////////////////////////////////*/

    function test_fork_plainUserDepositsUsdcAndRedeemsUsdcThroughTheRealTeller() public {
        _allowlist(address(pool), true);
        uint256 start = _usdc(PLAIN_USER); // the real wallet holds some USDC already
        _readyUser(PLAIN_USER, 1000e6);
        start += 1000e6;

        uint256 maxIn = pool.maxDeposit(PLAIN_USER);
        assertGt(maxIn, 100e6);
        uint256 previewShares = pool.previewDeposit(100e6);
        assertGt(previewShares, 0);

        vm.prank(PLAIN_USER);
        uint256 shares = pool.deposit(100e6, PLAIN_USER, previewShares);
        assertEq(shares, previewShares, "preview == actual on the real Teller");
        assertEq(pool.balanceOf(PLAIN_USER), shares);
        assertEq(_usdc(PLAIN_USER), start - 100e6);
        assertEq(_usyc(PLAIN_USER), 0, "the user never holds USYC");
        assertGt(_usyc(address(pool)), 0, "the pool does");
        assertEq(IERC20(USDC).allowance(address(pool), TELLER), 0, "allowance reset");
        assertEq(shares, _usyc(address(pool)) * 1e6, "first deposit: shares = USYC * 10**6");

        // redeem everything: USDC arrives at the user's own address, in the same transaction
        uint256 expected = pool.previewRedeem(shares);
        uint256 before = _usdc(PLAIN_USER);
        vm.prank(PLAIN_USER);
        uint256 assets = pool.redeem(shares, PLAIN_USER, PLAIN_USER);

        assertEq(assets, expected, "preview == actual");
        assertEq(_usdc(PLAIN_USER) - before, assets, "the return value is the exact delta");
        assertEq(_usdc(address(pool)), 0);
        assertEq(_usyc(address(pool)), 0);
        assertEq(pool.totalSupply(), 0);
        assertEq(_usyc(PLAIN_USER), 0);
        // the round trip costs at most the Teller's next-price spread (today about 0.04 %)
        assertGe(assets, 99.8e6);
        assertLe(assets, 100e6);
    }

    function test_fork_twoUsersShareThePoolProRata() public {
        _allowlist(address(pool), true);
        _readyUser(PLAIN_USER, 5000e6);
        _readyUser(otherUser, 5000e6);

        vm.prank(PLAIN_USER);
        uint256 a = pool.deposit(1000e6, PLAIN_USER);
        vm.prank(otherUser);
        uint256 b = pool.deposit(3000e6, otherUser);
        assertApproxEqRel(b, 3 * a, 0.0005e18);
        assertEq(pool.totalSupply(), a + b);

        vm.prank(PLAIN_USER);
        uint256 outA = pool.redeem(a, PLAIN_USER, PLAIN_USER);
        vm.prank(otherUser);
        uint256 outB = pool.redeem(b, otherUser, otherUser);
        assertApproxEqRel(outB, 3 * outA, 0.0005e18);
        assertLe(_usyc(address(pool)), 3, "only rounding dust is left");
    }

    function test_fork_onlyTheHolderCanRedeemAndOnlyToThemselves() public {
        _allowlist(address(pool), true);
        _readyUser(PLAIN_USER, 500e6);
        vm.prank(PLAIN_USER);
        uint256 shares = pool.deposit(500e6, PLAIN_USER);

        vm.prank(otherUser);
        vm.expectRevert(HoddUSYCVault.RedeemOnlyByAndToTheHolder.selector);
        pool.redeem(shares, otherUser, PLAIN_USER);
        vm.prank(PLAIN_USER);
        vm.expectRevert(HoddUSYCVault.RedeemOnlyByAndToTheHolder.selector);
        pool.redeem(shares, otherUser, PLAIN_USER);
        vm.prank(PLAIN_USER);
        vm.expectRevert(HoddUSYCVault.SharesNotTransferable.selector);
        pool.transfer(otherUser, shares);
    }

    function test_fork_reinvestIdleSharesAGiftWithEveryone() public {
        _allowlist(address(pool), true);
        _readyUser(PLAIN_USER, 1000e6);
        vm.prank(PLAIN_USER);
        uint256 shares = pool.deposit(500e6, PLAIN_USER);
        uint256 before = pool.previewRedeem(shares);

        _fund(otherUser, 100e6);
        vm.prank(otherUser);
        assertTrue(IERC20(USDC).transfer(address(pool), 50e6)); // a stranger's gift of idle USDC
        assertEq(_usdc(address(pool)), 50e6);
        assertApproxEqAbs(
            pool.previewRedeem(shares), before, 1, "idle USDC is not in the share price"
        );

        vm.prank(otherUser);
        pool.reinvestIdle();
        assertEq(_usdc(address(pool)), 0);
        // The gift is worth its USDC minus the Teller's subscription spread (it is priced at the
        // next price, redemptions at the latest one: about 0.04 % today).
        uint256 after_ = pool.previewRedeem(shares);
        assertLe(after_, before + 50e6 + 3);
        assertGe(after_, before + 49.9e6);
        assertEq(pool.totalSupply(), shares, "no shares minted");
    }

    /*//////////////////////////////////////////////////////////////
                            CIRCLE'S SIDE MISBEHAVES
    //////////////////////////////////////////////////////////////*/

    function test_fork_circleRemovesThePoolFromTheAllowlist_sharesSurviveAndRedeemAfterwards()
        public
    {
        _allowlist(address(pool), true);
        _readyUser(PLAIN_USER, 500e6);
        vm.prank(PLAIN_USER);
        uint256 shares = pool.deposit(500e6, PLAIN_USER);

        _allowlist(address(pool), false);
        assertEq(pool.maxDeposit(PLAIN_USER), 0);
        assertEq(pool.maxRedeem(PLAIN_USER), 0);
        vm.prank(PLAIN_USER);
        vm.expectRevert(NOT_PERMISSIONED);
        pool.redeem(shares, PLAIN_USER, PLAIN_USER);
        assertEq(pool.balanceOf(PLAIN_USER), shares, "still a valid claim");

        _allowlist(address(pool), true);
        vm.prank(PLAIN_USER);
        assertApproxEqAbs(pool.redeem(shares, PLAIN_USER, PLAIN_USER), 500e6, 0.5e6);
    }

    function test_fork_circlePausesItsAuthority_everythingReadsAsBlockedAndRecovers() public {
        _allowlist(address(pool), true);
        _readyUser(PLAIN_USER, 500e6);
        vm.prank(PLAIN_USER);
        uint256 shares = pool.deposit(300e6, PLAIN_USER);

        vm.prank(IAuthorityAdmin(AUTHORITY).owner());
        IAuthorityAdmin(AUTHORITY).pause();
        assertTrue(IAuthorityAdmin(AUTHORITY).paused());

        assertEq(pool.maxDeposit(PLAIN_USER), 0);
        assertEq(pool.maxRedeem(PLAIN_USER), 0);
        pool.totalAssets(); // views still work
        pool.previewRedeem(shares);

        vm.prank(PLAIN_USER);
        vm.expectRevert(HoddUSYCVault.NotPermittedByCircle.selector);
        pool.deposit(100e6, PLAIN_USER);
        vm.prank(PLAIN_USER);
        vm.expectRevert(NO_ACCESS);
        pool.redeem(shares, PLAIN_USER, PLAIN_USER);
        assertEq(pool.balanceOf(PLAIN_USER), shares);

        vm.prank(IAuthorityAdmin(AUTHORITY).owner());
        IAuthorityAdmin(AUTHORITY).unpause();
        vm.prank(PLAIN_USER);
        assertGt(pool.redeem(shares, PLAIN_USER, PLAIN_USER), 0);
    }

    function test_fork_dailyRedemptionLimitIsSharedByThePool() public {
        _allowlist(address(pool), true);
        _readyUser(PLAIN_USER, 2000e6);
        _readyUser(otherUser, 2000e6);
        vm.prank(PLAIN_USER);
        uint256 a = pool.deposit(400e6, PLAIN_USER);
        vm.prank(otherUser);
        uint256 b = pool.deposit(400e6, otherUser);

        // Circle's fund admin gives the pool a 100 USDC redemption limit per day
        vm.prank(IAuthorityAdmin(AUTHORITY).owner());
        ITellerAdmin(TELLER).setLimits(address(pool), 0, 100e6);

        uint256 maxA = pool.maxRedeem(PLAIN_USER);
        assertGt(maxA, 0);
        assertLt(maxA, a);
        vm.prank(PLAIN_USER);
        vm.expectRevert(LIMIT_EXCEEDED);
        pool.redeem(a, PLAIN_USER, PLAIN_USER);

        vm.prank(PLAIN_USER);
        uint256 got = pool.redeem(maxA, PLAIN_USER, PLAIN_USER);
        assertLe(got, 100e6);
        assertGt(got, 99e6);

        // the limit is now used up for the OTHER user as well
        assertLt(pool.maxRedeem(otherUser), b / 100);
        vm.prank(otherUser);
        vm.expectRevert(LIMIT_EXCEEDED);
        pool.redeem(b, otherUser, otherUser);

        // next UTC day
        vm.warp(block.timestamp + 1 days);
        assertGt(pool.maxRedeem(otherUser), 0);
        uint256 maxB = pool.maxRedeem(otherUser);
        vm.prank(otherUser);
        pool.redeem(maxB, otherUser, otherUser);
    }

    function test_fork_subscriptionLimitCapsMaxDeposit() public {
        _allowlist(address(pool), true);
        vm.prank(IAuthorityAdmin(AUTHORITY).owner());
        ITellerAdmin(TELLER).setLimits(address(pool), 150e6, 0);
        assertEq(pool.maxDeposit(PLAIN_USER), 150e6);

        _readyUser(PLAIN_USER, 1000e6);
        vm.prank(PLAIN_USER);
        pool.deposit(150e6, PLAIN_USER);
        assertEq(pool.maxDeposit(PLAIN_USER), 0);
        vm.prank(PLAIN_USER);
        vm.expectRevert(LIMIT_EXCEEDED);
        pool.deposit(1e6, PLAIN_USER);
    }

    /*//////////////////////////////////////////////////////////////
                                  ADMIN
    //////////////////////////////////////////////////////////////*/

    function test_fork_adminPausesDepositsButNeverRedemptions() public {
        _allowlist(address(pool), true);
        _readyUser(PLAIN_USER, 500e6);
        vm.prank(PLAIN_USER);
        uint256 shares = pool.deposit(300e6, PLAIN_USER);

        vm.prank(admin);
        pool.pauseDeposits();
        assertEq(pool.maxDeposit(PLAIN_USER), 0);
        vm.prank(PLAIN_USER);
        vm.expectRevert(HoddUSYCVault.DepositsArePaused.selector);
        pool.deposit(100e6, PLAIN_USER);

        vm.prank(PLAIN_USER);
        assertApproxEqAbs(pool.redeem(shares, PLAIN_USER, PLAIN_USER), 300e6, 0.5e6);
    }
}
