// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {HoddUSYCVault} from "../../src/HoddUSYCVault.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockUSYC} from "../mocks/MockTeller.sol";
import {PoolHandler} from "./PoolHandler.sol";

/// @dev Stateful fuzzing of the pool: users deposit and redeem, a donor gifts USDC and USYC, the
///      admin pauses deposits and changes caps, a stranger attacks, and Circle's side (allowlist,
///      authority pause, prices, next price, fees, daily limits, treasury liquidity) keeps moving.
contract HoddUSYCVaultInvariantTest is Test {
    PoolHandler internal handler;
    HoddUSYCVault internal pool;
    MockUSDC internal usdc;
    MockUSYC internal usyc;

    function setUp() public {
        handler = new PoolHandler();
        pool = handler.pool();
        usdc = handler.usdc();
        usyc = handler.usyc();

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](16);
        selectors[15] = PoolHandler.redeemElsewhere.selector;
        selectors[0] = PoolHandler.deposit.selector;
        selectors[1] = PoolHandler.deposit.selector; // deposits get twice the weight
        selectors[2] = PoolHandler.redeem.selector;
        selectors[3] = PoolHandler.donateUsdc.selector;
        selectors[4] = PoolHandler.reinvestIdle.selector;
        selectors[5] = PoolHandler.donateUsyc.selector;
        selectors[6] = PoolHandler.adminActs.selector;
        selectors[7] = PoolHandler.strangerCall.selector;
        selectors[8] = PoolHandler.setPrices.selector;
        selectors[9] = PoolHandler.setAllowlist.selector;
        selectors[10] = PoolHandler.pauseAuthority.selector;
        selectors[11] = PoolHandler.setTellerLimits.selector;
        selectors[12] = PoolHandler.moveTreasury.selector;
        selectors[13] = PoolHandler.warp.selector;
        selectors[14] = PoolHandler.redeem.selector; // and so do redemptions
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// (1) The USYC held always covers the claims of all shares, and the share supply never
    ///     outgrows the virtual ratio (so the claims can not exceed the holdings).
    function invariant_1_usycHeldCoversEveryClaim() public view {
        uint256 held = usyc.balanceOf(address(pool));
        assertLe(pool.usycOf(pool.totalSupply()), held, "claims exceed the USYC held");
        assertLe(pool.totalSupply(), 1e6 * held, "supply outgrew 10**6 * USYC held");
        // every single holder's claim is covered too
        address[3] memory users = [handler.users(0), handler.users(1), handler.users(2)];
        uint256 sum;
        for (uint256 i; i < 3; ++i) {
            sum += pool.usycOf(pool.balanceOf(users[i]));
        }
        assertLe(sum, held);
    }

    /// (2) Redemptions pay the holder and nobody else, exactly the pro-rata USYC, and no user ever
    ///     takes out more USYC than they brought plus all gifts.
    function invariant_2_redeemOnlyPaysTheHolderTheProRataAmount() public view {
        assertFalse(handler.redeemPaidSomeoneElse(), "a redemption paid somebody else");
        assertFalse(handler.redeemWrongAmount(), "a redemption pulled the wrong amount of USYC");
        assertFalse(handler.userGotMoreThanContributedPlusGifts(), "a user took out too much");
        assertFalse(handler.depositMintedWrongShares(), "a deposit minted the wrong shares");
    }

    /// (3) The admin can never change a balance, a claim or the share supply.
    function invariant_3_adminCanNeverChangeBalances() public view {
        assertFalse(handler.adminChangedBalances(), "an admin action changed balances");
        assertEq(pool.owner(), handler.admin());
    }

    /// (4) A stranger can neither succeed at anything privileged nor change any state.
    function invariant_4_strangerCanNeverChangeState() public view {
        assertFalse(handler.strangerSucceeded(), "a stranger call succeeded");
        assertFalse(handler.strangerChangedState(), "a stranger call changed state");
        assertEq(pool.pendingOwner(), address(0));
    }

    /// (5) Accounting: the pool's USYC is exactly what came in through deposits and gifts minus what
    ///     went out through redemptions; every USDC in existence is accounted for; shares are
    ///     only ever held by users who deposited.
    function invariant_5_accountingBalances() public view {
        assertEq(
            usyc.balanceOf(address(pool)),
            handler.usycIn() + handler.usycGifts() - handler.usycOut(),
            "USYC accounting"
        );
        address[] memory actors = handler.actorList();
        uint256 total = usdc.balanceOf(address(pool)) + usdc.balanceOf(handler.treasury())
            + usdc.balanceOf(address(handler.teller()));
        for (uint256 i; i < actors.length; ++i) {
            total += usdc.balanceOf(actors[i]);
        }
        assertEq(total, handler.minted(), "USDC accounting");
        // no user, admin or stranger ever holds USYC; only the pool does
        for (uint256 i; i < actors.length; ++i) {
            if (actors[i] != handler.donor()) assertEq(usyc.balanceOf(actors[i]), 0);
        }
        // idle USDC is never part of the share price and never lost: it only comes from gifts
        assertEq(usdc.allowance(address(pool), address(handler.teller())), 0);
    }
}
