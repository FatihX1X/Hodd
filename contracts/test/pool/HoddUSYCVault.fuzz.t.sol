// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PoolBase} from "./PoolBase.sol";

/// @dev Fuzz tests on rounding, pro-rata fairness, price moves (including next-price subscriptions),
///      donations and previews. USDC and USYC both have 6 decimals; prices are scaled by 1e18.
contract HoddUSYCVaultFuzzTest is PoolBase {
    uint256 internal constant PRICE_FLOOR = 1.0e18;

    /// @dev Prices between 1.00 and 1.30; the next price is at most 1 % above the latest.
    function _setPrice(uint256 priceBps, uint256 nextBps, bool useNext) internal {
        uint256 p = PRICE_FLOOR + bound(priceBps, 0, 3000) * 1e14;
        uint256 np = p + bound(nextBps, 0, 100) * 1e14;
        teller.configure(p, np, useNext, 0, 0);
    }

    function _held() internal view returns (uint256) {
        return usyc.balanceOf(address(pool));
    }

    /// @dev USYC the pool lost during a redemption by `who` (what the holder's shares fetched).
    function _redeemAllMeasured(address who) internal returns (uint256 usycOut, uint256 usdcOut) {
        uint256 heldBefore = _held();
        usdcOut = _redeemAll(who);
        usycOut = heldBefore - _held();
    }

    /*//////////////////////////////////////////////////////////////
                              SINGLE HOLDER
    //////////////////////////////////////////////////////////////*/

    function testFuzz_singleHolder_roundTripNeverProfits(
        uint256 amount,
        uint256 p1,
        uint256 n1,
        bool useNext,
        uint256 p2
    ) public {
        amount = bound(amount, 1e6, 1_000_000e6);
        _setPrice(p1, n1, useNext);
        uint256 shares = _deposit(alice, amount);
        uint256 usycIn = _held();

        _setPrice(p2, 0, false);
        (uint256 usycOut, uint256 usdcOut) = _redeemAllMeasured(alice);

        assertLe(usycOut, usycIn, "never more USYC than contributed");
        assertEq(usycOut, usycIn, "the only holder gets exactly their USYC back");
        (uint256 worth,,) = teller.previewRedeemData(address(pool), 0);
        worth; // silence
        assertEq(pool.balanceOf(alice), 0);
        assertEq(pool.totalSupply(), 0);
        assertEq(_held(), 0);
        assertEq(shares, usycIn * 1e6);
        assertEq(usdc.balanceOf(address(pool)), 0);
        // at an unchanged price the round trip can only lose (spread + rounding)
        if (!useNext && p1 == p2) assertLe(usdcOut, amount);
    }

    /*//////////////////////////////////////////////////////////////
                            SEVERAL HOLDERS
    //////////////////////////////////////////////////////////////*/

    struct Join {
        uint256 amount;
        uint256 usycIn;
    }

    /// @dev Three users join at random prices (some at the "next" price), nobody donates; then each
    ///      redeems everything in a random order. Nobody gets more USYC than they brought, and
    ///      nobody loses more than the rounding of the share math.
    function testFuzz_threeHolders_noOneRedeemsMoreUsycThanContributed(
        uint256[3] memory amounts,
        uint256[3] memory prices,
        uint256[3] memory nexts,
        uint256 order
    ) public {
        address[3] memory users = [alice, bob, carol];
        Join[3] memory joins;
        for (uint256 i; i < 3; ++i) {
            _setPrice(prices[i], nexts[i], nexts[i] % 2 == 0);
            joins[i].amount = bound(amounts[i], 1e6, 100_000e6);
            uint256 before = _held();
            _deposit(users[i], joins[i].amount);
            joins[i].usycIn = _held() - before;
        }

        uint256 start = order % 3;
        uint256 totalOut;
        for (uint256 k; k < 3; ++k) {
            uint256 i = (start + k) % 3;
            (uint256 usycOut,) = _redeemAllMeasured(users[i]);
            totalOut += usycOut;
            assertLe(usycOut, joins[i].usycIn, "no one redeems more than contributed");
            assertGe(usycOut + 2, joins[i].usycIn, "and loses at most rounding");
        }
        uint256 totalIn = joins[0].usycIn + joins[1].usycIn + joins[2].usycIn;
        assertLe(totalOut, totalIn);
        assertLe(_held(), 3, "only dust is left behind");
        assertEq(pool.totalSupply(), 0);
    }

    /// @dev The same with gifts in between (a USYC donation by an allowlisted party and idle USDC
    ///      that is reinvested): the gifts are shared pro-rata and nobody loses anything.
    function testFuzz_threeHolders_giftsAreSharedProRata(
        uint256 a,
        uint256 b,
        uint256 usycGift,
        uint256 usdcGift
    ) public {
        a = bound(a, 10e6, 50_000e6);
        b = bound(b, 10e6, 50_000e6);
        usycGift = bound(usycGift, 0, 10_000e6);
        usdcGift = bound(usdcGift, 0, 10_000e6);

        _deposit(alice, a);
        uint256 aliceIn = _held();
        _deposit(bob, b);
        uint256 bobIn = _held() - aliceIn;
        uint256 aliceShares = pool.balanceOf(alice);
        uint256 bobShares = pool.balanceOf(bob);

        if (usycGift > 1e6) _donateUsyc(usycGift);
        if (usdcGift > 1e6) {
            _donateUsdc(usdcGift);
            pool.reinvestIdle();
        }
        uint256 heldNow = _held();

        (uint256 aliceOut,) = _redeemAllMeasured(alice);
        (uint256 bobOut,) = _redeemAllMeasured(bob);

        assertGe(aliceOut + 2, aliceIn, "gifts never hurt");
        assertGe(bobOut + 2, bobIn, "gifts never hurt");
        assertLe(aliceOut + bobOut, heldNow);
        // pro-rata by shares: out_i ~ shares_i / (shares_a + shares_b) of the pool (within rounding)
        uint256 total = aliceShares + bobShares;
        assertApproxEqAbs(aliceOut, (heldNow * aliceShares) / total, heldNow / 1e5 + 3);
        assertApproxEqAbs(bobOut, (heldNow * bobShares) / total, heldNow / 1e5 + 3);
    }

    /// @dev A subscription priced at the next price costs the late joiner, not the holders.
    function testFuzz_nextPriceSubscriptionNeverDilutesAnExistingHolder(
        uint256 a,
        uint256 b,
        uint256 nextBps
    ) public {
        a = bound(a, 10e6, 100_000e6);
        b = bound(b, 10e6, 100_000e6);
        uint256 np = 1.14e18 + bound(nextBps, 1, 300) * 1e14;
        _deposit(alice, a);
        uint256 claimBefore = pool.usycOf(pool.balanceOf(alice));
        uint256 valueBefore = pool.previewRedeem(pool.balanceOf(alice));

        teller.configure(1.14e18, np, true, 0, 0);
        uint256 bobShares = _deposit(bob, b);

        assertGe(
            pool.usycOf(pool.balanceOf(alice)) + 1, claimBefore, "alice's USYC claim did not shrink"
        );
        assertGe(pool.previewRedeem(pool.balanceOf(alice)) + 2, valueBefore, "nor its value");
        assertLe(pool.previewRedeem(bobShares), b, "the spread is bob's cost");
    }

    /*//////////////////////////////////////////////////////////////
                         IDLE USDC / REINVEST
    //////////////////////////////////////////////////////////////*/

    function testFuzz_reinvestIdle_onlyEverHelpsHolders(uint256 a, uint256 b, uint256 gift) public {
        a = bound(a, 10e6, 50_000e6);
        b = bound(b, 10e6, 50_000e6);
        gift = bound(gift, 2e6, 20_000e6);
        _deposit(alice, a);
        _deposit(bob, b);
        uint256 supply = pool.totalSupply();
        uint256 aliceBefore = pool.previewRedeem(pool.balanceOf(alice));
        uint256 bobBefore = pool.previewRedeem(pool.balanceOf(bob));

        _donateUsdc(gift);
        vm.prank(stranger);
        pool.reinvestIdle();

        assertEq(pool.totalSupply(), supply, "no shares minted");
        assertEq(usdc.balanceOf(address(pool)), 0);
        assertGe(pool.previewRedeem(pool.balanceOf(alice)) + 1, aliceBefore);
        assertGe(pool.previewRedeem(pool.balanceOf(bob)) + 1, bobBefore);
        // The gift (less the Teller's rounding) is now in the pool's NAV. The 10**6 virtual shares
        // keep a tiny part of any gain, 10**6 / (supply + 10**6) of it, which is what the extra
        // tolerance covers.
        uint256 holders =
            pool.previewRedeem(pool.balanceOf(alice)) + pool.previewRedeem(pool.balanceOf(bob));
        assertApproxEqAbs(holders, aliceBefore + bobBefore + gift, 5 + (holders * 1e6) / supply);
    }

    /*//////////////////////////////////////////////////////////////
                               PREVIEWS
    //////////////////////////////////////////////////////////////*/

    function testFuzz_previewsMatchTheRealThing(
        uint256 amount,
        uint256 priceBps,
        uint256 nextBps,
        bool useNext,
        uint256 depFee,
        uint256 redFee
    ) public {
        amount = bound(amount, 1e6, 100_000e6);
        _setPrice(priceBps, nextBps, useNext);
        (uint256 p, uint256 np,,,) = (teller.price(), teller.nextPrice(), false, 0, 0);
        teller.configure(p, np, useNext, bound(depFee, 0, 100), bound(redFee, 0, 100));

        _deposit(bob, 1000e6); // some existing position, so the ratio is not the initial one
        uint256 previewShares = pool.previewDeposit(amount);
        uint256 shares = _deposit(alice, amount);
        assertLe(previewShares, shares, "the preview never overestimates");
        assertEq(previewShares, shares, "and with an unchanged price it is exact");

        uint256 previewAssets = pool.previewRedeem(shares);
        assertEq(_redeemAll(alice), previewAssets);
    }

    /*//////////////////////////////////////////////////////////////
                               ROUNDING
    //////////////////////////////////////////////////////////////*/

    /// @dev Cutting a redemption into many small ones never pays more than redeeming at once.
    function testFuzz_splitRedemptionsNeverPayMore(uint256 amount, uint256 parts, uint256 seed)
        public
    {
        amount = bound(amount, 10e6, 10_000e6);
        parts = bound(parts, 2, 8);
        _deposit(bob, 500e6); // someone else, so rounding happens against a non-trivial ratio
        uint256 shares = _deposit(alice, amount);
        uint256 usycIn = pool.usycOf(shares);

        uint256 chunk = shares / parts;
        uint256 usycOutTotal;
        for (uint256 i; i < parts; ++i) {
            uint256 s = i == parts - 1 ? pool.balanceOf(alice) : chunk;
            if (s == 0) continue;
            uint256 heldBefore = _held();
            vm.prank(alice);
            try pool.redeem(s, alice, alice) {
                usycOutTotal += heldBefore - _held();
            } catch {}
            seed;
        }
        assertLe(usycOutTotal, usycIn + 1, "slicing never beats redeeming in one go");
    }

    /*//////////////////////////////////////////////////////////////
                         DONATION / INFLATION ATTACK
    //////////////////////////////////////////////////////////////*/

    /// @dev The classic attack: be first with a dust deposit, donate to inflate the share price, let
    ///      a victim deposit, redeem. The attacker never profits and the victim loses at most one
    ///      share's worth of USYC (rounding), which is paid for by the donation.
    function testFuzz_inflationAttackNeverPays(uint256 dust, uint256 donation, uint256 victimAmount)
        public
    {
        dust = bound(dust, 2, 1000);
        donation = bound(donation, 2e6, 50_000e6);
        victimAmount = bound(victimAmount, 10e6, 100_000e6);

        // the attacker is allowlisted (only allowlisted parties can send USYC at all)
        address attacker = donor;
        vm.startPrank(attacker);
        usdc.approve(address(pool), type(uint256).max);
        usdc.approve(address(teller), type(uint256).max);
        uint256 attackerShares = pool.deposit(dust, attacker);
        uint256 dustUsyc = _held();
        uint256 gift = teller.deposit(donation, attacker);
        usyc.transfer(address(pool), gift);
        vm.stopPrank();

        uint256 heldBeforeVictim = _held();
        uint256 supplyBeforeVictim = pool.totalSupply();
        uint256 victimShares = _deposit(alice, victimAmount);
        uint256 victimIn = _held() - heldBeforeVictim;

        // attacker value never exceeds what he put in (deposit + donation)
        assertLe(pool.usycOf(attackerShares), dustUsyc + gift);
        // the victim's claim is at least what they brought minus one share's worth + rounding
        uint256 oneShare = (heldBeforeVictim + 1) / (supplyBeforeVictim + 1e6) + 1;
        assertGe(pool.usycOf(victimShares) + oneShare + 2, victimIn);
    }

    /*//////////////////////////////////////////////////////////////
                               CONSERVATION
    //////////////////////////////////////////////////////////////*/

    /// @dev After any mix of deposits and redemptions the USYC claimed by all shares is covered.
    function testFuzz_claimsAreAlwaysCovered(uint256[6] memory amounts, uint256[6] memory actions)
        public
    {
        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < 6; ++i) {
            address u = users[actions[i] % 3];
            if (actions[i] % 5 < 3) {
                _setPrice(actions[i] / 5, actions[i] / 7, actions[i] % 2 == 0);
                _deposit(u, bound(amounts[i], 1e6, 50_000e6));
            } else if (pool.balanceOf(u) > 0) {
                uint256 s = bound(amounts[i], 1, pool.balanceOf(u));
                vm.prank(u);
                try pool.redeem(s, u, u) {} catch {}
            }
            assertLe(pool.usycOf(pool.totalSupply()), _held(), "claims exceed the pool");
            assertLe(pool.totalSupply(), 1e6 * _held(), "supply outgrew the virtual ratio");
        }
    }
}
