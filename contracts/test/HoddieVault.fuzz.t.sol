// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./Base.t.sol";
import {HoddieVault} from "../src/HoddieVault.sol";

/// @dev Fuzz tests on amounts, limits, timestamps, caps, slippage bounds, callers and signatures.
contract HoddieVaultFuzzTest is Base {
    bytes32 internal constant REF = keccak256("bill");
    /// @dev secp256k1 group order, private keys must be below it.
    uint256 internal constant SECP256K1_N =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    /*//////////////////////////////////////////////////////////////
                           AMOUNTS AND LIMITS
    //////////////////////////////////////////////////////////////*/

    function testFuzz_deposit_respectsLimits(uint256 maxPerTx, uint256 limit24h, uint256 amount)
        public
    {
        maxPerTx = bound(maxPerTx, 0, 20_000e6);
        limit24h = bound(limit24h, 0, 20_000e6);
        amount = bound(amount, 0, 20_000e6);
        vm.prank(owner);
        vault.setLimits(maxPerTx, limit24h, MAX_TX, DAILY);

        bool shouldPass = amount != 0 && amount <= maxPerTx && amount <= limit24h && amount <= FUNDS;
        vm.prank(operator);
        try vault.depositToStrategy(address(strat), amount, 1) {
            assertTrue(shouldPass);
            assertEq(vault.depositSpentLast24h(), amount);
            assertEq(vault.paymentSpentLast24h(), 0);
            assertEq(usdc.balanceOf(address(vault)), FUNDS - amount);
        } catch (bytes memory reason) {
            assertFalse(shouldPass);
            assertEq(vault.depositSpentLast24h(), 0);
            assertEq(usdc.balanceOf(address(vault)), FUNDS);
            if (amount == 0) {
                assertEq(bytes4(reason), HoddieVault.ZeroAmount.selector);
            } else if (amount > maxPerTx) {
                assertEq(bytes4(reason), HoddieVault.ExceedsMaxDepositPerTx.selector);
            } else if (amount > limit24h) {
                assertEq(bytes4(reason), HoddieVault.ExceedsDepositLimit24h.selector);
            }
        }
    }

    function testFuzz_pay_respectsEveryCap(
        uint256 maxPerTx,
        uint256 limit24h,
        uint256 recipientCap,
        uint256 amount
    ) public {
        maxPerTx = bound(maxPerTx, 0, 20_000e6);
        limit24h = bound(limit24h, 0, 20_000e6);
        recipientCap = bound(recipientCap, 0, 20_000e6);
        amount = bound(amount, 1, 20_000e6);
        vm.startPrank(owner);
        vault.addRecipient(recipient, recipientCap);
        vault.setLimits(MAX_TX, DAILY, maxPerTx, limit24h);
        vm.stopPrank();

        bool shouldPass =
            amount <= recipientCap && amount <= maxPerTx && amount <= limit24h && amount <= FUNDS;
        vm.prank(operator);
        try vault.pay(recipient, amount, REF) {
            assertTrue(shouldPass);
            assertEq(usdc.balanceOf(recipient), amount);
            assertEq(vault.paymentSpentLast24h(), amount);
        } catch {
            assertFalse(shouldPass);
            assertEq(usdc.balanceOf(recipient), 0);
        }
    }

    function testFuzz_remainingAllowanceIsExact(
        uint256 maxPerTx,
        uint256 limit24h,
        uint256 spend,
        uint256 cap
    ) public {
        maxPerTx = bound(maxPerTx, 1, 5000e6);
        limit24h = bound(limit24h, 1, 5000e6);
        cap = bound(cap, 1, 5000e6);
        uint256 room = maxPerTx < limit24h ? maxPerTx : limit24h;
        spend = bound(spend, 1, room < cap ? room : cap);
        vm.startPrank(owner);
        vault.addRecipient(recipient, cap);
        vault.setLimits(MAX_TX, DAILY, maxPerTx, limit24h);
        vm.stopPrank();
        vm.prank(operator);
        vault.pay(recipient, spend, REF);

        uint256 left = limit24h - spend;
        uint256 expected = left < maxPerTx ? left : maxPerTx;
        assertEq(vault.remainingPaymentAllowance(), expected);
        _checkRemainingFor(expected < cap ? expected : cap, spend);
    }

    function _checkRemainingFor(uint256 expectedFor, uint256 spend) internal {
        assertEq(vault.remainingPaymentAllowanceFor(recipient), expectedFor);

        // one unit more than what is reported for this recipient always fails (and changes nothing)
        vm.prank(operator);
        vm.expectRevert();
        vault.pay(recipient, expectedFor + 1, REF);
        assertEq(vault.paymentSpentLast24h(), spend);

        // and exactly the reported amount always works
        if (expectedFor > 0) {
            vm.prank(operator);
            vault.pay(recipient, expectedFor, REF);
            assertEq(vault.paymentSpentLast24h(), spend + expectedFor);
        }
    }

    /*//////////////////////////////////////////////////////////////
                           ROLLING 24-HOUR WINDOW
    //////////////////////////////////////////////////////////////*/

    uint256[] internal _modelHour;
    uint256[] internal _modelTs;
    uint256[] internal _modelAmt;

    function _modelWindow(uint256 ts) internal view returns (uint256 total) {
        uint256 h = ts / 1 hours;
        for (uint256 i; i < _modelHour.length; ++i) {
            if (_modelHour[i] + 24 >= h) total += _modelAmt[i];
        }
    }

    function _modelLast24h(uint256 ts) internal view returns (uint256 total) {
        for (uint256 i; i < _modelTs.length; ++i) {
            if (_modelTs[i] + 24 hours >= ts) total += _modelAmt[i];
        }
    }

    /// @dev Replays a random schedule of payments and clock jumps against an hour-bucket model
    ///      and checks, at every accepted payment, the physical guarantee too: the real amount paid
    ///      in the trailing 24 hours never exceeds the limit.
    function testFuzz_rollingWindow_matchesModelAndNeverExceedsLimitIn24h(
        uint256[10] memory amounts,
        uint256[10] memory jumps,
        uint256 startOffset
    ) public {
        usdc.mint(address(vault), 1_000_000_000e6);
        _addRecipient(recipient);
        vm.warp(1_700_000_000 + bound(startOffset, 0, 3 * 365 days));

        for (uint256 i; i < 10; ++i) {
            _windowStep(jumps[i], amounts[i]);
        }
    }

    function _windowStep(uint256 jumpSeed, uint256 amountSeed) internal {
        // mostly short hops, now and then a long one (the window must also survive idleness)
        uint256 jump = jumpSeed % 4 == 0 ? bound(jumpSeed, 0, 3 days) : bound(jumpSeed, 0, 3 hours);
        vm.warp(block.timestamp + jump);
        uint256 amount = bound(amountSeed, 0, MAX_TX + 500e6);

        uint256 modelBefore = _modelWindow(block.timestamp);
        assertEq(vault.paymentSpentLast24h(), modelBefore, "view matches model");

        bool shouldPass = amount > 0 && amount <= MAX_TX && modelBefore + amount <= DAILY;
        vm.prank(operator);
        try vault.pay(recipient, amount, REF) {
            assertTrue(shouldPass, "paid although the model says it must revert");
            _modelHour.push(block.timestamp / 1 hours);
            _modelTs.push(block.timestamp);
            _modelAmt.push(amount);
            assertLe(_modelLast24h(block.timestamp), DAILY, "more than the limit in 24 hours");
        } catch {
            assertFalse(shouldPass, "reverted although the model says it must pass");
        }
        assertEq(vault.paymentSpentLast24h(), _modelWindow(block.timestamp));
    }

    /// @dev A spend at `t` blocks the budget at least until `t + 24h` and frees it by the first
    ///      second of the 25th hour after the spend.
    function testFuzz_rollingWindow_lockLastsBetween24And25Hours(uint256 t0, uint256 dt) public {
        t0 = bound(t0, 1 days, 4_000_000_000);
        dt = bound(dt, 0, 26 hours);
        vm.warp(t0);
        _addRecipient(recipient);
        vm.startPrank(operator);
        vault.pay(recipient, MAX_TX, REF);
        vault.pay(recipient, MAX_TX, REF);
        vault.pay(recipient, DAILY - 2 * MAX_TX, REF); // the whole budget, all at t0
        vm.stopPrank();

        vm.warp(t0 + dt);
        uint256 freedAt = (t0 / 1 hours + 25) * 1 hours; // first second of the 25th hour after
        bool freed = block.timestamp >= freedAt;
        if (dt <= 24 hours) assertFalse(freed, "never freed within 24 hours");
        if (dt >= 25 hours) assertTrue(freed, "always freed after 25 hours");

        vm.prank(operator);
        if (freed) {
            vault.pay(recipient, 1, REF);
        } else {
            assertEq(vault.paymentSpentLast24h(), DAILY);
            vm.expectRevert();
            vault.pay(recipient, 1, REF);
        }
    }

    /// @dev Large amounts near the packed 64-bit bound: no overflow, no wrong revert reason.
    function testFuzz_rollingWindow_packingNeverOverflows(uint256[6] memory amounts, uint256 hops)
        public
    {
        vm.prank(owner);
        vault.setLimits(UNLIMITED, UNLIMITED, UNLIMITED, UNLIMITED);
        _addRecipient(recipient);
        usdc.mint(address(vault), type(uint128).max);

        uint256 expected;
        for (uint256 i; i < 6; ++i) {
            vm.warp(block.timestamp + bound(uint256(keccak256(abi.encode(hops, i))), 0, 30 minutes));
            uint256 amount = bound(amounts[i], 1, UNLIMITED);
            vm.prank(operator);
            try vault.pay(recipient, amount, REF) {
                expected += amount;
                assertLe(expected, UNLIMITED);
                assertEq(vault.paymentSpentLast24h(), expected);
            } catch (bytes memory reason) {
                // the only acceptable failure is the budget, never an arithmetic panic
                assertEq(bytes4(reason), HoddieVault.ExceedsPaymentLimit24h.selector);
                assertGt(expected + amount, UNLIMITED);
            }
        }
    }

    function testFuzz_withdrawAndTransferToOwnerAreNeverLimited(uint256 amount) public {
        amount = bound(amount, 1, FUNDS);
        vm.prank(owner);
        vault.setLimits(0, 0, 0, 0); // every limited outflow is frozen
        vm.prank(operator);
        vault.transferToOwner(amount);
        assertEq(usdc.balanceOf(owner), amount);
    }

    /*//////////////////////////////////////////////////////////////
                              SLIPPAGE BOUNDS
    //////////////////////////////////////////////////////////////*/

    function testFuzz_slippage_depositMinShares(uint256 amount, uint256 yield_, uint256 minShares)
        public
    {
        amount = bound(amount, 1e6, MAX_TX);
        yield_ = bound(yield_, 0, 500e6);
        _depositAs(address(strat2), 100e6); // someone else's position, so a donation moves the price
        if (yield_ > 0) {
            usdc.mint(address(this), yield_);
            usdc.approve(address(strat), yield_);
            strat.donate(yield_);
        }
        uint256 expected = strat.previewDeposit(amount);
        minShares = bound(minShares, 1, expected * 2 + 1);

        vm.prank(operator);
        try vault.depositToStrategy(address(strat), amount, minShares) returns (uint256 shares) {
            assertGe(shares, minShares);
            assertEq(shares, expected);
            assertEq(strat.balanceOf(address(vault)), shares);
        } catch (bytes memory reason) {
            assertGt(minShares, expected);
            assertEq(bytes4(reason), HoddieVault.InsufficientShares.selector);
            assertEq(usdc.balanceOf(address(vault)), FUNDS - 100e6, "nothing moved");
        }
    }

    function testFuzz_slippage_withdrawMaxShares(uint256 assets, uint256 maxShares) public {
        _depositAs(address(strat), MAX_TX);
        assets = bound(assets, 1e6, 900e6);
        uint256 expected = strat.previewWithdraw(assets);
        maxShares = bound(maxShares, 1, expected * 2);

        vm.prank(operator);
        try vault.withdrawFromStrategy(address(strat), assets, maxShares) returns (uint256 burned) {
            assertLe(burned, maxShares);
            assertEq(burned, expected);
        } catch (bytes memory reason) {
            assertLt(maxShares, expected);
            assertEq(bytes4(reason), HoddieVault.SharesExceedMax.selector);
        }
    }

    function testFuzz_slippage_redeemMinAssets(uint256 shareSeed, uint256 minAssets) public {
        uint256 shares = _depositAs(address(strat), MAX_TX);
        uint256 toRedeem = bound(shareSeed, 1, shares);
        uint256 expected = strat.previewRedeem(toRedeem);
        minAssets = bound(minAssets, 1, expected * 2 + 1);

        vm.prank(operator);
        try vault.redeemFromStrategy(address(strat), toRedeem, minAssets) returns (uint256 got) {
            assertGe(got, minAssets);
            assertEq(got, expected);
        } catch (bytes memory reason) {
            assertGt(minAssets, expected);
            assertEq(bytes4(reason), HoddieVault.InsufficientAssets.selector);
        }
    }

    /*//////////////////////////////////////////////////////////////
                          WITHDRAW ALL / ROUNDING
    //////////////////////////////////////////////////////////////*/

    function testFuzz_withdrawAll_ownerGetsEverything(uint256 a1, uint256 a2) public {
        a1 = bound(a1, 1, MAX_TX);
        a2 = bound(a2, 1, MAX_TX);
        _depositAs(address(strat), a1);
        _depositAs(address(strat2), a2);

        vm.prank(owner);
        vault.withdrawAll();

        assertEq(usdc.balanceOf(owner), FUNDS, "no value lost to rounding");
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(strat.balanceOf(address(vault)), 0);
        assertEq(strat2.balanceOf(address(vault)), 0);
    }

    function testFuzz_redeemThenWithdraw_neverCreatesValue(uint256 deposit, uint256 redeemPct)
        public
    {
        deposit = bound(deposit, 1e6, MAX_TX);
        redeemPct = bound(redeemPct, 1, 100);
        uint256 shares = _depositAs(address(strat), deposit);
        uint256 toRedeem = (shares * redeemPct) / 100;
        if (toRedeem == 0) return;

        vm.prank(operator);
        uint256 got = vault.redeemFromStrategy(address(strat), toRedeem, 1);
        assertLe(got, deposit);
        assertEq(usdc.balanceOf(address(vault)), FUNDS - deposit + got);
        assertEq(usdc.balanceOf(operator), 0);
    }

    /*//////////////////////////////////////////////////////////////
                            SIGNATURES (FUZZ)
    //////////////////////////////////////////////////////////////*/

    function testFuzz_signature_validOwnerSignatureAlwaysWorksOnce(
        uint256 pk,
        address recipient_,
        uint256 cap
    ) public {
        pk = bound(pk, 1, SECP256K1_N - 1);
        vm.assume(recipient_ != address(0) && recipient_ != address(usdc));
        HoddieVault v = _newVault(vm.addr(pk), operator, new address[](0));
        vm.assume(recipient_ != address(v));
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig = _sign(pk, address(v), recipient_, cap, 0, deadline);
        vm.prank(stranger);
        v.addRecipientWithSig(recipient_, cap, deadline, sig);
        assertTrue(v.isRecipient(recipient_));
        assertEq(v.recipientCap(recipient_), cap, "the signed cap is the cap");

        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        v.addRecipientWithSig(recipient_, cap, deadline, sig);
    }

    function testFuzz_signature_aDifferentCapNeverWorks(uint256 signedCap, uint256 submittedCap)
        public
    {
        vm.assume(signedCap != submittedCap);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OWNER_PK, address(vault), recipient, signedCap, 0, deadline);
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, submittedCap, deadline, sig);
        assertFalse(vault.isRecipient(recipient));
    }

    function testFuzz_signature_wrongKeyNeverWorks(uint256 pk, uint256 otherPk, address recipient_)
        public
    {
        pk = bound(pk, 1, SECP256K1_N - 1);
        otherPk = bound(otherPk, 1, SECP256K1_N - 1);
        vm.assume(pk != otherPk);
        vm.assume(recipient_ != address(0) && recipient_ != address(usdc));
        HoddieVault v = _newVault(vm.addr(pk), operator, new address[](0));
        vm.assume(recipient_ != address(v));
        _expectWrongKeyRejected(v, otherPk, recipient_);
        assertFalse(v.isRecipient(recipient_));
    }

    function _expectWrongKeyRejected(HoddieVault v, uint256 otherPk, address r) internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(otherPk, address(v), r, NO_CAP, 0, deadline);
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        v.addRecipientWithSig(r, NO_CAP, deadline, sig);
    }

    function testFuzz_signature_expiredNeverWorks(uint256 deadline, uint256 lateBy) public {
        deadline = bound(deadline, 0, block.timestamp - 1);
        lateBy = bound(lateBy, 0, 1000 days);
        bytes memory sig = _sign(OWNER_PK, address(vault), recipient, NO_CAP, 0, deadline);
        vm.warp(deadline + 1 + lateBy);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.SignatureExpired.selector, deadline));
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, sig);
    }

    function testFuzz_signature_garbageNeverWorks(bytes calldata garbage) public {
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, NO_CAP, block.timestamp + 1 hours, garbage);
    }

    /*//////////////////////////////////////////////////////////////
                         STRANGERS (FUZZ)
    //////////////////////////////////////////////////////////////*/

    function testFuzz_stranger_cannotChangeAnything(
        address caller,
        address target,
        uint256 amount,
        uint256 selectorSeed
    ) public {
        vm.assume(caller != owner && caller != operator);
        vm.assume(caller != address(0));
        _depositAs(address(strat), 100e6);
        bytes32 before = _stateHash();

        bytes memory data = _privilegedCall(selectorSeed % 18, target, amount);
        vm.prank(caller);
        (bool ok,) = address(vault).call(data);
        assertFalse(ok);
        assertEq(_stateHash(), before);
    }

    function testFuzz_operator_cannotPayAnyUnapprovedAddress(address to, uint256 amount) public {
        amount = bound(amount, 1, MAX_TX);
        vm.assume(to != recipient); // the only approved address in this test
        _addRecipient(recipient);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.RecipientNotApproved.selector, to));
        vault.pay(to, amount, REF);
    }

    function testFuzz_operator_cannotTouchAnyUnlistedStrategy(address strategy, uint256 amount)
        public
    {
        vm.assume(strategy != address(strat) && strategy != address(strat2));
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, strategy));
        vault.depositToStrategy(strategy, amount, 1);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, strategy));
        vault.withdrawFromStrategy(strategy, amount, type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, strategy));
        vault.redeemFromStrategy(strategy, amount, 1);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                                 HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Calldata of one of the 18 operator/owner functions, to be sent by a stranger.
    function _privilegedCall(uint256 i, address target, uint256 amount)
        internal
        view
        returns (bytes memory)
    {
        if (i == 0) return abi.encodeCall(vault.depositToStrategy, (target, amount, 1));
        if (i == 1) {
            return abi.encodeCall(vault.withdrawFromStrategy, (target, amount, type(uint256).max));
        }
        if (i == 2) return abi.encodeCall(vault.redeemFromStrategy, (target, amount, 1));
        if (i == 3) return abi.encodeCall(vault.transferToOwner, (amount));
        if (i == 4) return abi.encodeCall(vault.pay, (target, amount, REF));
        if (i == 5) return abi.encodeCall(vault.pause, ());
        if (i == 6) return abi.encodeCall(vault.unpause, ());
        if (i == 7) return abi.encodeCall(vault.setLimits, (amount, amount, amount, amount));
        if (i == 8) return abi.encodeCall(vault.setOperator, (target));
        if (i == 9) return abi.encodeCall(vault.revokeOperator, ());
        if (i == 10) return abi.encodeCall(vault.allowStrategy, (target));
        if (i == 11) return abi.encodeCall(vault.disallowStrategy, (target));
        if (i == 12) return abi.encodeCall(vault.addRecipient, (target, amount));
        if (i == 13) return abi.encodeCall(vault.setRecipientCap, (target, amount));
        if (i == 14) return abi.encodeCall(vault.withdrawAll, ());
        if (i == 15) return abi.encodeCall(vault.rescueToken, (IERC20(address(usdc)), amount));
        if (i == 16) return abi.encodeCall(vault.redeemToOwner, (target, amount, 1));
        return abi.encodeCall(vault.transferOwnership, (target));
    }

    function _stateHash() internal view returns (bytes32) {
        bytes32 settings = keccak256(
            abi.encode(
                vault.owner(),
                vault.pendingOwner(),
                vault.operator(),
                vault.maxDepositPerTx(),
                vault.depositLimit24h(),
                vault.maxPaymentPerTx(),
                vault.paymentLimit24h()
            )
        );
        return keccak256(
            abi.encode(
                settings,
                vault.depositSpentLast24h(),
                vault.paymentSpentLast24h(),
                vault.paused(),
                vault.strategies(),
                vault.nonces(owner),
                vault.isRecipient(address(0xbeef)),
                usdc.balanceOf(address(vault)),
                usdc.balanceOf(owner),
                usdc.balanceOf(operator),
                strat.balanceOf(address(vault))
            )
        );
    }
}
