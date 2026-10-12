// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "./Base.t.sol";
import {HoddieVault} from "../src/HoddieVault.sol";

/// @dev Fuzz tests on amounts, limits, timestamps, callers and signatures.
contract HoddieVaultFuzzTest is Base {
    bytes32 internal constant REF = keccak256("bill");
    /// @dev secp256k1 group order, private keys must be below it.
    uint256 internal constant SECP256K1_N =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function _approve(address who) internal {
        vm.prank(owner);
        vault.addRecipient(who);
    }

    /*//////////////////////////////////////////////////////////////
                           AMOUNTS AND LIMITS
    //////////////////////////////////////////////////////////////*/

    function testFuzz_deposit_respectsLimits(uint256 maxPerTx, uint256 dailyLimit, uint256 amount)
        public
    {
        maxPerTx = bound(maxPerTx, 0, 20_000e6);
        dailyLimit = bound(dailyLimit, 0, 20_000e6);
        amount = bound(amount, 0, 20_000e6);
        vm.prank(owner);
        vault.setLimits(maxPerTx, dailyLimit);

        bool shouldPass =
            amount != 0 && amount <= maxPerTx && amount <= dailyLimit && amount <= FUNDS;
        vm.prank(operator);
        try vault.depositToStrategy(address(strat), amount) {
            assertTrue(shouldPass);
            assertEq(vault.spentToday(), amount);
            assertEq(usdc.balanceOf(address(vault)), FUNDS - amount);
        } catch (bytes memory reason) {
            assertFalse(shouldPass);
            assertEq(vault.spentToday(), 0);
            assertEq(usdc.balanceOf(address(vault)), FUNDS);
            if (amount == 0) {
                assertEq(bytes4(reason), HoddieVault.ZeroAmount.selector);
            } else if (amount > maxPerTx) {
                assertEq(bytes4(reason), HoddieVault.ExceedsMaxPerTx.selector);
            } else if (amount > dailyLimit) {
                assertEq(bytes4(reason), HoddieVault.ExceedsDailyLimit.selector);
            }
        }
    }

    function testFuzz_pay_respectsLimits(uint256 maxPerTx, uint256 dailyLimit, uint256 amount)
        public
    {
        maxPerTx = bound(maxPerTx, 0, 20_000e6);
        dailyLimit = bound(dailyLimit, 0, 20_000e6);
        amount = bound(amount, 1, 20_000e6);
        _approve(recipient);
        vm.prank(owner);
        vault.setLimits(maxPerTx, dailyLimit);

        vm.prank(operator);
        try vault.pay(recipient, amount, REF) {
            assertLe(amount, maxPerTx);
            assertLe(amount, dailyLimit);
            assertLe(amount, FUNDS);
            assertEq(usdc.balanceOf(recipient), amount);
        } catch {
            assertEq(usdc.balanceOf(recipient), 0);
            assertTrue(amount > maxPerTx || amount > dailyLimit || amount > FUNDS);
        }
    }

    function testFuzz_remainingAllowanceIsExact(uint256 maxPerTx, uint256 dailyLimit, uint256 spend)
        public
    {
        maxPerTx = bound(maxPerTx, 1, 5000e6);
        dailyLimit = bound(dailyLimit, 1, 5000e6);
        uint256 cap = maxPerTx < dailyLimit ? maxPerTx : dailyLimit;
        spend = bound(spend, 1, cap);
        _approve(recipient);
        vm.prank(owner);
        vault.setLimits(maxPerTx, dailyLimit);
        vm.prank(operator);
        vault.pay(recipient, spend, REF);

        uint256 left = dailyLimit - spend;
        uint256 expected = left < maxPerTx ? left : maxPerTx;
        assertEq(vault.remainingAllowance(), expected);

        // one unit more than the reported allowance always fails (and changes nothing) ...
        vm.prank(operator);
        vm.expectRevert();
        vault.pay(recipient, expected + 1, REF);
        assertEq(vault.spentToday(), spend);

        // ... and exactly the reported allowance always works
        if (expected > 0) {
            vm.prank(operator);
            vault.pay(recipient, expected, REF);
            assertEq(vault.spentToday(), spend + expected);
        }
    }

    /// @dev Replays a random schedule of payments and clock jumps against a model of the rules.
    function testFuzz_dailyAccounting_matchesModel(
        uint256[8] memory amounts,
        uint256[8] memory jumps,
        uint256 startOffset
    ) public {
        usdc.mint(address(vault), 1_000_000_000e6);
        _approve(recipient);
        vm.warp(1_700_000_000 + bound(startOffset, 0, 3 * 365 days));

        uint256 modelDay = type(uint256).max;
        uint256 modelSpent;
        uint256 paid;

        for (uint256 i; i < 8; ++i) {
            vm.warp(block.timestamp + bound(jumps[i], 0, 2 days));
            uint256 amount = bound(amounts[i], 0, MAX_TX + 500e6);
            uint256 today = block.timestamp / 1 days;
            uint256 spentSoFar = modelDay == today ? modelSpent : 0;

            bool shouldPass = amount > 0 && amount <= MAX_TX && spentSoFar + amount <= DAILY;
            vm.prank(operator);
            try vault.pay(recipient, amount, REF) {
                assertTrue(shouldPass, "paid although the model says it must revert");
                modelDay = today;
                modelSpent = spentSoFar + amount;
                paid += amount;
            } catch {
                assertFalse(shouldPass, "reverted although the model says it must pass");
            }
            assertEq(vault.spentToday(), modelDay == today ? modelSpent : 0);
            assertLe(vault.spentToday(), DAILY);
        }
        assertEq(usdc.balanceOf(recipient), paid);
    }

    function testFuzz_dayRollover_exactlyAtUtcMidnight(uint256 t0, uint256 dt, uint256 amount)
        public
    {
        t0 = bound(t0, 1 days, 4_000_000_000);
        dt = bound(dt, 0, 3 days);
        amount = bound(amount, 1, MAX_TX);
        vm.warp(t0);
        _approve(recipient);
        vm.prank(operator);
        vault.pay(recipient, amount, REF);

        vm.warp(t0 + dt);
        bool sameDay = (t0 / 1 days) == ((t0 + dt) / 1 days);
        assertEq(vault.spentToday(), sameDay ? amount : 0);
        assertEq(vault.remainingAllowance(), sameDay ? _min(MAX_TX, DAILY - amount) : MAX_TX);
    }

    function testFuzz_withdrawAndTransferToOwnerAreNeverLimited(uint256 amount) public {
        amount = bound(amount, 1, FUNDS);
        vm.prank(owner);
        vault.setLimits(0, 0); // every limited outflow is frozen
        vm.prank(operator);
        vault.transferToOwner(amount);
        assertEq(usdc.balanceOf(owner), amount);
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
        uint256 got = vault.redeemFromStrategy(address(strat), toRedeem);
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
        uint256 deadlineOffset
    ) public {
        pk = bound(pk, 1, SECP256K1_N - 1);
        vm.assume(recipient_ != address(0) && recipient_ != address(usdc));
        HoddieVault v = _newVault(vm.addr(pk), operator, new address[](0));
        vm.assume(recipient_ != address(v));
        uint256 deadline = block.timestamp + bound(deadlineOffset, 0, 365 days);

        bytes memory sig = _sign(pk, address(v), recipient_, 0, deadline);
        vm.prank(stranger);
        v.addRecipientWithSig(recipient_, deadline, sig);
        assertTrue(v.isRecipient(recipient_));

        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        v.addRecipientWithSig(recipient_, deadline, sig);
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
        uint256 deadline = block.timestamp + 1 hours;

        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        v.addRecipientWithSig(
            recipient_, deadline, _sign(otherPk, address(v), recipient_, 0, deadline)
        );
        assertFalse(v.isRecipient(recipient_));
    }

    function testFuzz_signature_expiredNeverWorks(uint256 deadline, uint256 lateBy) public {
        deadline = bound(deadline, 0, block.timestamp - 1);
        lateBy = bound(lateBy, 0, 1000 days);
        bytes memory sig = _sign(OWNER_PK, address(vault), recipient, 0, deadline);
        vm.warp(deadline + 1 + lateBy);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.SignatureExpired.selector, deadline));
        vault.addRecipientWithSig(recipient, deadline, sig);
    }

    function testFuzz_signature_garbageNeverWorks(bytes calldata garbage) public {
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, block.timestamp + 1 hours, garbage);
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

        bytes[16] memory calls = [
            abi.encodeCall(vault.depositToStrategy, (target, amount)),
            abi.encodeCall(vault.withdrawFromStrategy, (target, amount)),
            abi.encodeCall(vault.redeemFromStrategy, (target, amount)),
            abi.encodeCall(vault.transferToOwner, (amount)),
            abi.encodeCall(vault.pay, (target, amount, REF)),
            abi.encodeCall(vault.pause, ()),
            abi.encodeCall(vault.unpause, ()),
            abi.encodeCall(vault.setLimits, (amount, amount)),
            abi.encodeCall(vault.setOperator, (target)),
            abi.encodeCall(vault.revokeOperator, ()),
            abi.encodeCall(vault.allowStrategy, (target)),
            abi.encodeCall(vault.disallowStrategy, (target)),
            abi.encodeCall(vault.addRecipient, (target)),
            abi.encodeCall(vault.withdrawAll, ()),
            abi.encodeCall(vault.rescueToken, (IERC20(address(usdc)), amount)),
            abi.encodeCall(vault.transferOwnership, (target))
        ];
        vm.prank(caller);
        (bool ok,) = address(vault).call(calls[selectorSeed % calls.length]);
        assertFalse(ok);
        assertEq(_stateHash(), before);
    }

    function testFuzz_operator_cannotPayAnyUnapprovedAddress(address to, uint256 amount) public {
        amount = bound(amount, 1, MAX_TX);
        vm.assume(to != recipient); // the only approved address in this test
        _approve(recipient);
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
        vault.depositToStrategy(strategy, amount);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, strategy));
        vault.withdrawFromStrategy(strategy, amount);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, strategy));
        vault.redeemFromStrategy(strategy, amount);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                                 HELPERS
    //////////////////////////////////////////////////////////////*/

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _stateHash() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                vault.owner(),
                vault.pendingOwner(),
                vault.operator(),
                vault.maxPerTx(),
                vault.dailyLimit(),
                vault.spentInDay(),
                vault.lastSpendDay(),
                vault.paused(),
                vault.strategies(),
                vault.nonces(owner),
                usdc.balanceOf(address(vault)),
                usdc.balanceOf(owner),
                usdc.balanceOf(operator),
                strat.balanceOf(address(vault))
            )
        );
    }
}
