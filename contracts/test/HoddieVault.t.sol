// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Base} from "./Base.t.sol";
import {HoddieVault} from "../src/HoddieVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockStrategy} from "./mocks/MockStrategy.sol";
import {HostileStrategy} from "./mocks/HostileStrategy.sol";
import {MockSmartAccount} from "./mocks/MockSmartAccount.sol";
import {ReentrantOperator, ReentrantStrategy} from "./mocks/ReentrancyMocks.sol";

contract HoddieVaultTest is Base {
    bytes32 internal constant REF = keccak256("bill-42");

    /*//////////////////////////////////////////////////////////////
                               HELPERS
    //////////////////////////////////////////////////////////////*/

    function _unauthorized(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who);
    }

    function _approveRecipient() internal {
        vm.prank(owner);
        vault.addRecipient(recipient, type(uint256).max);
    }

    function _vaultWith(address[] memory list) internal returns (HoddieVault v) {
        v = _newVault(owner, operator, list);
        usdc.mint(address(v), FUNDS);
    }

    function _one(address a) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = a;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    function test_constructor_setsState() public view {
        assertEq(address(vault.asset()), address(usdc));
        assertEq(vault.owner(), owner);
        assertEq(vault.pendingOwner(), address(0));
        assertEq(vault.operator(), operator);
        assertEq(vault.maxDepositPerTx(), MAX_TX);
        assertEq(vault.depositLimit24h(), DAILY);
        assertEq(vault.maxPaymentPerTx(), MAX_TX);
        assertEq(vault.paymentLimit24h(), DAILY);
        assertEq(vault.depositSpentLast24h(), 0);
        assertEq(vault.paymentSpentLast24h(), 0);
        assertEq(vault.strategyCount(), 2);
        assertTrue(vault.isStrategy(address(strat)));
        assertTrue(vault.isStrategy(address(strat2)));
        assertEq(vault.strategies()[0], address(strat));
        assertEq(vault.strategies()[1], address(strat2));
        assertFalse(vault.paused());
        assertEq(vault.MAX_STRATEGIES(), 8);
    }

    function test_constructor_emitsEvents() public {
        address[] memory list = _one(address(strat));
        vm.expectEmit(true, true, false, true);
        emit HoddieVault.OperatorUpdated(address(0), operator);
        vm.expectEmit(false, false, false, true);
        emit HoddieVault.LimitsUpdated(MAX_TX, DAILY, MAX_TX, DAILY);
        vm.expectEmit(true, false, false, true);
        emit HoddieVault.StrategyAllowed(address(strat));
        _newVault(owner, operator, list);
    }

    function test_constructor_revertsWhenA24hLimitDoesNotFitUint64() public {
        HoddieVault.Limits memory l = _limits();
        l.depositLimit24h = uint256(type(uint64).max) + 1;
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.LimitTooLarge.selector, l.depositLimit24h)
        );
        new HoddieVault(IERC20(address(usdc)), owner, operator, l, new address[](0));

        l = _limits();
        l.paymentLimit24h = uint256(type(uint64).max) + 1;
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.LimitTooLarge.selector, l.paymentLimit24h)
        );
        new HoddieVault(IERC20(address(usdc)), owner, operator, l, new address[](0));

        // exactly uint64 max is fine ("effectively unlimited")
        l = HoddieVault.Limits(UNLIMITED, UNLIMITED, UNLIMITED, UNLIMITED);
        new HoddieVault(IERC20(address(usdc)), owner, operator, l, new address[](0));
    }

    function test_constructor_allowsNoOperatorAndNoStrategies() public {
        HoddieVault v = _newVault(owner, address(0), new address[](0));
        assertEq(v.operator(), address(0));
        assertEq(v.strategyCount(), 0);
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        _newVault(address(0), operator, new address[](0));
    }

    function test_constructor_revertsOnZeroAsset() public {
        vm.expectRevert(HoddieVault.ZeroAddress.selector);
        new HoddieVault(IERC20(address(0)), owner, operator, _limits(), new address[](0));
    }

    function test_constructor_revertsOnInvalidStrategies() public {
        // an EOA
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.InvalidStrategy.selector, stranger));
        _newVault(owner, operator, _one(stranger));

        // the asset itself (no asset() function)
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.InvalidStrategy.selector, address(usdc)));
        _newVault(owner, operator, _one(address(usdc)));

        // an ERC-4626 over another asset
        MockStrategy other = new MockStrategy(IERC20(address(new MockUSDC())));
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.InvalidStrategy.selector, address(other))
        );
        _newVault(owner, operator, _one(address(other)));

        // duplicates
        address[] memory dup = new address[](2);
        dup[0] = address(strat);
        dup[1] = address(strat);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.StrategyAlreadyAllowed.selector, address(strat))
        );
        _newVault(owner, operator, dup);
    }

    function test_constructor_revertsOnTooManyStrategies() public {
        address[] memory list = new address[](9);
        for (uint256 i; i < 9; ++i) {
            list[i] = address(new MockStrategy(IERC20(address(usdc))));
        }
        vm.expectRevert(HoddieVault.TooManyStrategies.selector);
        _newVault(owner, operator, list);

        address[] memory eight = new address[](8);
        for (uint256 i; i < 8; ++i) {
            eight[i] = list[i];
        }
        assertEq(_newVault(owner, operator, eight).strategyCount(), 8);
    }

    /*//////////////////////////////////////////////////////////////
                           NATIVE VALUE REJECTED
    //////////////////////////////////////////////////////////////*/

    function test_nativeValue_plainTransferReverts() public {
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(vault).call{value: 1}("");
        assertFalse(ok);
        (ok,) = address(vault).call{value: 1}(hex"deadbeef");
        assertFalse(ok);
        (ok,) = address(vault).call(hex"deadbeef");
        assertFalse(ok);
        assertEq(address(vault).balance, 0);
    }

    function test_nativeValue_everyFunctionIsNonPayable() public {
        vm.deal(operator, 10 ether);
        vm.deal(owner, 10 ether);
        _approveRecipient();
        bytes[5] memory operatorCalls = [
            abi.encodeCall(vault.depositToStrategy, (address(strat), 1e6, 1)),
            abi.encodeCall(vault.withdrawFromStrategy, (address(strat), 1e6, type(uint256).max)),
            abi.encodeCall(vault.redeemFromStrategy, (address(strat), 1e6, 1)),
            abi.encodeCall(vault.transferToOwner, (1e6)),
            abi.encodeCall(vault.pay, (recipient, 1e6, REF))
        ];
        for (uint256 i; i < operatorCalls.length; ++i) {
            vm.prank(operator);
            (bool ok,) = address(vault).call{value: 1}(operatorCalls[i]);
            assertFalse(ok);
        }

        bytes[12] memory ownerCalls = [
            abi.encodeCall(vault.pause, ()),
            abi.encodeCall(vault.unpause, ()),
            abi.encodeCall(vault.setLimits, (1, 2, 1, 2)),
            abi.encodeCall(vault.setOperator, (stranger)),
            abi.encodeCall(vault.revokeOperator, ()),
            abi.encodeCall(vault.allowStrategy, (address(strat))),
            abi.encodeCall(vault.disallowStrategy, (address(strat))),
            abi.encodeCall(vault.addRecipient, (recipient2, type(uint256).max)),
            abi.encodeCall(vault.removeRecipient, (recipient)),
            abi.encodeCall(vault.withdrawAll, ()),
            abi.encodeCall(vault.exitStrategy, (address(strat))),
            abi.encodeCall(vault.invalidateNonce, ())
        ];
        for (uint256 i; i < ownerCalls.length; ++i) {
            vm.prank(owner);
            (bool ok,) = address(vault).call{value: 1}(ownerCalls[i]);
            assertFalse(ok);
        }
        assertEq(address(vault).balance, 0);
    }

    /*//////////////////////////////////////////////////////////////
                         OPERATOR: DEPOSIT TO STRATEGY
    //////////////////////////////////////////////////////////////*/

    function test_deposit_movesFundsAndEmits() public {
        uint256 expectedShares = strat.previewDeposit(400e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.DepositedToStrategy(address(strat), 400e6, expectedShares);
        uint256 shares = _depositAs(address(strat), 400e6);

        assertEq(shares, expectedShares);
        assertEq(usdc.balanceOf(address(vault)), FUNDS - 400e6);
        assertEq(usdc.balanceOf(address(strat)), 400e6);
        assertEq(strat.balanceOf(address(vault)), shares, "shares go to the vault");
        assertEq(strat.balanceOf(operator), 0);
        assertEq(usdc.allowance(address(vault), address(strat)), 0, "allowance reset");
        assertEq(vault.depositSpentLast24h(), 400e6);
        assertEq(vault.paymentSpentLast24h(), 0, "payments have their own budget");
    }

    function test_deposit_approvesExactlyTheAmountThenZero() public {
        vm.expectCall(address(usdc), abi.encodeCall(IERC20.approve, (address(strat), 400e6)));
        vm.expectCall(address(usdc), abi.encodeCall(IERC20.approve, (address(strat), 0)));
        _depositAs(address(strat), 400e6);
    }

    function test_deposit_revertsForNonOperator() public {
        vm.prank(owner);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.depositToStrategy(address(strat), 1e6, 1);

        vm.prank(stranger);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.depositToStrategy(address(strat), 1e6, 1);
    }

    function test_deposit_revertsWhenPaused() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.depositToStrategy(address(strat), 1e6, 1);
    }

    function test_deposit_revertsForUnknownStrategy() public {
        MockStrategy unknown = new MockStrategy(IERC20(address(usdc)));
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, address(unknown))
        );
        vault.depositToStrategy(address(unknown), 1e6, 1);

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, address(0)));
        vault.depositToStrategy(address(0), 1e6, 1);
    }

    function test_deposit_revertsOnZeroAmount() public {
        vm.prank(operator);
        vm.expectRevert(HoddieVault.ZeroAmount.selector);
        vault.depositToStrategy(address(strat), 0, 1);
    }

    function test_deposit_revertsWhenStrategyMintsZeroShares() public {
        HostileStrategy zero = new HostileStrategy(address(usdc), HostileStrategy.Mode.ZERO);
        HoddieVault v = _vaultWith(_one(address(zero)));
        vm.prank(operator);
        vm.expectRevert(HoddieVault.ZeroShares.selector);
        v.depositToStrategy(address(zero), 1e6, 1);
    }

    function test_deposit_revertsWhenIdleBalanceIsTooLow() public {
        vm.prank(owner);
        vault.setLimits(UNLIMITED, UNLIMITED, UNLIMITED, UNLIMITED);
        vm.prank(operator);
        vm.expectRevert(); // ERC20InsufficientBalance bubbled up from the token
        vault.depositToStrategy(address(strat), FUNDS + 1, 1);
    }

    function test_deposit_countsAgainstLimits_perTx() public {
        vm.startPrank(operator);
        vault.depositToStrategy(address(strat), MAX_TX, 1); // exactly at the cap is fine
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.ExceedsMaxDepositPerTx.selector, MAX_TX + 1, MAX_TX)
        );
        vault.depositToStrategy(address(strat), MAX_TX + 1, 1);
        vm.stopPrank();
    }

    function test_deposit_countsAgainstLimits_rolling24h() public {
        vm.startPrank(operator);
        vault.depositToStrategy(address(strat), 1000e6, 1);
        vault.depositToStrategy(address(strat), 1000e6, 1);
        vault.depositToStrategy(address(strat2), 500e6, 1); // exactly 2_500 = the 24h limit
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.ExceedsDepositLimit24h.selector, DAILY + 1, DAILY)
        );
        vault.depositToStrategy(address(strat), 1, 1);
        vm.stopPrank();
        assertEq(vault.depositSpentLast24h(), DAILY);
        assertEq(vault.remainingDepositAllowance(), 0);
    }

    function test_depositsAndPayments_haveSeparateBudgets() public {
        _approveRecipient();
        vm.startPrank(operator);
        vault.pay(recipient, 1000e6, REF);
        vault.pay(recipient, 1000e6, REF);
        vault.pay(recipient, 500e6, REF); // payment budget used up ...
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.ExceedsPaymentLimit24h.selector, DAILY + 1, DAILY)
        );
        vault.pay(recipient, 1, REF);
        // ... deposits are untouched
        vault.depositToStrategy(address(strat), 1000e6, 1);
        vault.depositToStrategy(address(strat), 1000e6, 1);
        vault.depositToStrategy(address(strat), 500e6, 1);
        vm.stopPrank();
        assertEq(vault.depositSpentLast24h(), DAILY);
        assertEq(vault.paymentSpentLast24h(), DAILY);
    }

    /*//////////////////////////////////////////////////////////////
                  OPERATOR: WITHDRAW / REDEEM FROM STRATEGY
    //////////////////////////////////////////////////////////////*/

    function test_withdraw_returnsFundsToTheVaultAndEmits() public {
        uint256 shares = _depositAs(address(strat), 800e6);
        uint256 burned = strat.previewWithdraw(300e6);

        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.WithdrawnFromStrategy(address(strat), 300e6, burned);
        vm.prank(operator);
        uint256 returned = vault.withdrawFromStrategy(address(strat), 300e6, type(uint256).max);

        assertEq(returned, burned);
        assertEq(usdc.balanceOf(address(vault)), FUNDS - 800e6 + 300e6);
        assertEq(strat.balanceOf(address(vault)), shares - burned);
        assertEq(usdc.balanceOf(operator), 0);
        assertEq(usdc.balanceOf(owner), 0);
    }

    function test_redeem_returnsFundsToTheVaultAndEmits() public {
        uint256 shares = _depositAs(address(strat), 800e6);
        uint256 half = shares / 2;
        uint256 out = strat.previewRedeem(half);

        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.RedeemedFromStrategy(address(strat), half, out);
        vm.prank(operator);
        uint256 assets = vault.redeemFromStrategy(address(strat), half, 1);

        assertEq(assets, out);
        assertEq(usdc.balanceOf(address(vault)), FUNDS - 800e6 + out);
        assertEq(strat.balanceOf(address(vault)), shares - half);
        assertEq(usdc.balanceOf(operator), 0);
    }

    function test_withdrawAndRedeem_areNotLimited() public {
        _depositAs(address(strat), 1000e6);
        _depositAs(address(strat), 1000e6);
        _depositAs(address(strat), 500e6); // daily budget used up
        vm.startPrank(operator);
        vault.withdrawFromStrategy(address(strat), 2500e6, type(uint256).max);
        assertEq(usdc.balanceOf(address(vault)), FUNDS);
        // spends nothing against the budget, and they can be bigger than maxPerTx
        assertEq(vault.depositSpentLast24h(), DAILY);
        vm.stopPrank();

        vm.prank(owner);
        vault.setLimits(UNLIMITED, UNLIMITED, UNLIMITED, UNLIMITED);
        vm.startPrank(operator);
        uint256 shares = vault.depositToStrategy(address(strat), 5000e6, 1);
        vault.redeemFromStrategy(address(strat), shares, 1);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(vault)), FUNDS);
    }

    function test_withdrawAndRedeem_permissionsAndGuards() public {
        _depositAs(address(strat), 100e6);

        vm.startPrank(stranger);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.withdrawFromStrategy(address(strat), 1e6, type(uint256).max);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.redeemFromStrategy(address(strat), 1, 1);
        vm.stopPrank();

        vm.startPrank(owner);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.withdrawFromStrategy(address(strat), 1e6, type(uint256).max);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.redeemFromStrategy(address(strat), 1, 1);
        vm.stopPrank();

        MockStrategy unknown = new MockStrategy(IERC20(address(usdc)));
        vm.startPrank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, address(unknown))
        );
        vault.withdrawFromStrategy(address(unknown), 1e6, type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, address(unknown))
        );
        vault.redeemFromStrategy(address(unknown), 1, 1);
        vm.expectRevert(HoddieVault.ZeroAmount.selector);
        vault.withdrawFromStrategy(address(strat), 0, type(uint256).max);
        vm.expectRevert(HoddieVault.ZeroAmount.selector);
        vault.redeemFromStrategy(address(strat), 0, 1);
        vm.stopPrank();

        vm.prank(owner);
        vault.pause();
        vm.startPrank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.withdrawFromStrategy(address(strat), 1e6, type(uint256).max);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.redeemFromStrategy(address(strat), 1, 1);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                         OPERATOR: TRANSFER TO OWNER
    //////////////////////////////////////////////////////////////*/

    function test_transferToOwner_sendsToTheOwnerAndEmits() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.TransferredToOwner(owner, 7000e6);
        vm.prank(operator);
        vault.transferToOwner(7000e6); // above maxPerTx and above dailyLimit: not limited

        assertEq(usdc.balanceOf(owner), 7000e6);
        assertEq(usdc.balanceOf(address(vault)), FUNDS - 7000e6);
        assertEq(vault.depositSpentLast24h(), 0);
        assertEq(vault.paymentSpentLast24h(), 0);
    }

    function test_transferToOwner_guards() public {
        vm.prank(stranger);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.transferToOwner(1e6);

        vm.prank(owner);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.transferToOwner(1e6);

        vm.prank(operator);
        vm.expectRevert(HoddieVault.ZeroAmount.selector);
        vault.transferToOwner(0);

        vm.prank(operator);
        vm.expectRevert(); // insufficient balance
        vault.transferToOwner(FUNDS + 1);

        vm.prank(owner);
        vault.pause();
        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.transferToOwner(1e6);
    }

    /*//////////////////////////////////////////////////////////////
                                OPERATOR: PAY
    //////////////////////////////////////////////////////////////*/

    function test_pay_sendsToApprovedRecipientAndEmitsRef() public {
        _approveRecipient();
        vm.expectEmit(true, true, false, true, address(vault));
        emit HoddieVault.Payment(recipient, 400e6, REF);
        vm.prank(operator);
        vault.pay(recipient, 400e6, REF);

        assertEq(usdc.balanceOf(recipient), 400e6);
        assertEq(usdc.balanceOf(address(vault)), FUNDS - 400e6);
        assertEq(vault.paymentSpentLast24h(), 400e6);
        assertEq(vault.depositSpentLast24h(), 0, "deposits have their own budget");
    }

    function test_pay_revertsForUnapprovedRecipient() public {
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.RecipientNotApproved.selector, recipient)
        );
        vault.pay(recipient, 1e6, REF);

        // the operator itself and the owner are not implicitly approved either
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.RecipientNotApproved.selector, operator));
        vault.pay(operator, 1e6, REF);
    }

    function test_pay_revertsAfterRecipientRemoved() public {
        _approveRecipient();
        vm.prank(owner);
        vault.removeRecipient(recipient);
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.RecipientNotApproved.selector, recipient)
        );
        vault.pay(recipient, 1e6, REF);
    }

    function test_pay_guards() public {
        _approveRecipient();
        vm.prank(stranger);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.pay(recipient, 1e6, REF);

        vm.prank(owner);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.pay(recipient, 1e6, REF);

        vm.prank(operator);
        vm.expectRevert(HoddieVault.ZeroAmount.selector);
        vault.pay(recipient, 0, REF);

        vm.prank(owner);
        vault.pause();
        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.pay(recipient, 1e6, REF);
    }

    /*//////////////////////////////////////////////////////////////
                              PAUSE / UNPAUSE
    //////////////////////////////////////////////////////////////*/

    function test_pause_onlyOwnerAndEmits() public {
        vm.prank(operator);
        vm.expectRevert(_unauthorized(operator));
        vault.pause();
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        vault.pause();

        vm.expectEmit(false, false, false, true, address(vault));
        emit Pausable.Paused(owner);
        vm.prank(owner);
        vault.pause();
        assertTrue(vault.paused());

        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.pause();

        vm.prank(operator);
        vm.expectRevert(_unauthorized(operator));
        vault.unpause();

        vm.expectEmit(false, false, false, true, address(vault));
        emit Pausable.Unpaused(owner);
        vm.prank(owner);
        vault.unpause();
        assertFalse(vault.paused());

        vm.prank(owner);
        vm.expectRevert(Pausable.ExpectedPause.selector);
        vault.unpause();
    }

    function test_paused_ownerFunctionsStillWork() public {
        _approveRecipient();
        _depositAs(address(strat), 500e6);
        vm.startPrank(owner);
        vault.pause();

        vault.setLimits(1, 2, 1, 2);
        vault.setOperator(stranger);
        vault.setOperator(operator);
        vault.addRecipient(recipient2, type(uint256).max);
        vault.removeRecipient(recipient2);
        vault.allowStrategy(address(new MockStrategy(IERC20(address(usdc)))));
        vault.invalidateNonce();
        vault.rescueToken(IERC20(address(usdc)), 1e6);
        vault.exitStrategy(address(strat));
        vault.withdrawAll();
        vm.stopPrank();

        assertEq(usdc.balanceOf(owner), FUNDS);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_paused_operatorBlockedThenResumes() public {
        vm.prank(owner);
        vault.pause();
        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.depositToStrategy(address(strat), 1e6, 1);
        vm.prank(owner);
        vault.unpause();
        _depositAs(address(strat), 1e6);
    }

    /*//////////////////////////////////////////////////////////////
                                OPERATOR ADMIN
    //////////////////////////////////////////////////////////////*/

    function test_setOperator_onlyOwnerAndEmits() public {
        vm.prank(operator);
        vm.expectRevert(_unauthorized(operator));
        vault.setOperator(stranger);
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        vault.setOperator(stranger);

        address next = makeAddr("next");
        vm.expectEmit(true, true, false, true, address(vault));
        emit HoddieVault.OperatorUpdated(operator, next);
        vm.prank(owner);
        vault.setOperator(next);
        assertEq(vault.operator(), next);

        // the old operator is out, the new one is in
        vm.prank(operator);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.transferToOwner(1e6);
        vm.prank(next);
        vault.transferToOwner(1e6);
    }

    function test_revokeOperator_blocksEveryOperatorFunction() public {
        _approveRecipient();
        vm.prank(operator);
        vm.expectRevert(_unauthorized(operator)); // the operator can not revoke itself either
        vault.revokeOperator();

        vm.expectEmit(true, true, false, true, address(vault));
        emit HoddieVault.OperatorUpdated(operator, address(0));
        vm.prank(owner);
        vault.revokeOperator();
        assertEq(vault.operator(), address(0));

        vm.startPrank(operator);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.depositToStrategy(address(strat), 1e6, 1);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.pay(recipient, 1e6, REF);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.transferToOwner(1e6);
        vm.stopPrank();
    }

    function test_noOperator_zeroAddressCanNotCallOperatorFunctions() public {
        vm.prank(owner);
        vault.setOperator(address(0));
        // msg.sender == address(0) can not be spoofed in a transaction, but make sure the check
        // does not treat "no operator" as "anyone".
        vm.prank(stranger);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.transferToOwner(1e6);
        vm.prank(address(0));
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.transferToOwner(1e6);
    }

    /*//////////////////////////////////////////////////////////////
                          STRATEGY ALLOWLIST ADMIN
    //////////////////////////////////////////////////////////////*/

    function test_allowStrategy_happyPathAndEvent() public {
        MockStrategy next = new MockStrategy(IERC20(address(usdc)));
        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.StrategyAllowed(address(next));
        vm.prank(owner);
        vault.allowStrategy(address(next));
        assertTrue(vault.isStrategy(address(next)));
        assertEq(vault.strategyCount(), 3);
        _depositAs(address(next), 1e6);
    }

    function test_allowStrategy_permissionsAndValidation() public {
        MockStrategy next = new MockStrategy(IERC20(address(usdc)));
        vm.prank(operator);
        vm.expectRevert(_unauthorized(operator));
        vault.allowStrategy(address(next));
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        vault.allowStrategy(address(next));

        vm.startPrank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.StrategyAlreadyAllowed.selector, address(strat))
        );
        vault.allowStrategy(address(strat));
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.InvalidStrategy.selector, address(0)));
        vault.allowStrategy(address(0));
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.InvalidStrategy.selector, stranger));
        vault.allowStrategy(stranger);
        // the vault itself reports asset() == USDC but is not a strategy
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.InvalidStrategy.selector, address(vault))
        );
        vault.allowStrategy(address(vault));
        MockStrategy foreign = new MockStrategy(IERC20(address(new MockUSDC())));
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.InvalidStrategy.selector, address(foreign))
        );
        vault.allowStrategy(address(foreign));
        // a contract that reverts on asset()
        HostileStrategy bad = new HostileStrategy(address(usdc), HostileStrategy.Mode.REVERT);
        // asset() is implemented, so this one is accepted; the revert only shows on other calls
        vault.allowStrategy(address(bad));
        vm.stopPrank();
    }

    function test_allowStrategy_isBoundedToEight() public {
        vm.startPrank(owner);
        for (uint256 i; i < 6; ++i) {
            vault.allowStrategy(address(new MockStrategy(IERC20(address(usdc)))));
        }
        assertEq(vault.strategyCount(), 8);
        MockStrategy ninth = new MockStrategy(IERC20(address(usdc)));
        vm.expectRevert(HoddieVault.TooManyStrategies.selector);
        vault.allowStrategy(address(ninth));

        // freeing a slot works
        vault.disallowStrategy(address(strat));
        vault.allowStrategy(address(ninth));
        vm.stopPrank();
        assertEq(vault.strategyCount(), 8);
    }

    function test_disallowStrategy_removesFromListAndBlocksOperator() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.StrategyDisallowed(address(strat));
        vm.prank(owner);
        vault.disallowStrategy(address(strat));

        assertFalse(vault.isStrategy(address(strat)));
        assertEq(vault.strategyCount(), 1);
        assertEq(vault.strategies()[0], address(strat2));

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, address(strat))
        );
        vault.depositToStrategy(address(strat), 1e6, 1);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, address(strat))
        );
        vault.disallowStrategy(address(strat));
    }

    function test_disallowStrategy_permissions() public {
        vm.prank(operator);
        vm.expectRevert(_unauthorized(operator));
        vault.disallowStrategy(address(strat));
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        vault.disallowStrategy(address(strat));
    }

    function test_disallowStrategy_neverStrandsShares() public {
        uint256 shares = _depositAs(address(strat), 900e6);
        vm.prank(owner);
        vault.disallowStrategy(address(strat));
        assertEq(strat.balanceOf(address(vault)), shares, "shares stay in the vault");

        // withdrawAll no longer visits it ...
        vm.prank(owner);
        vault.withdrawAll();
        assertEq(strat.balanceOf(address(vault)), shares);

        // ... but the owner can still exit it explicitly
        vm.prank(owner);
        vault.exitStrategy(address(strat));
        assertEq(strat.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(owner), FUNDS);
    }

    function test_disallowStrategy_shareRescueAlsoWorks() public {
        uint256 shares = _depositAs(address(strat), 900e6);
        vm.startPrank(owner);
        vault.disallowStrategy(address(strat));
        vault.rescueToken(IERC20(address(strat)), shares);
        vm.stopPrank();
        assertEq(strat.balanceOf(owner), shares);
        vm.prank(owner);
        strat.redeem(shares, owner, owner);
        assertEq(usdc.balanceOf(owner), 900e6);
    }

    function test_disallowStrategy_removalKeepsOtherEntriesIntact() public {
        MockStrategy s3 = new MockStrategy(IERC20(address(usdc)));
        vm.startPrank(owner);
        vault.allowStrategy(address(s3));
        vault.disallowStrategy(address(strat)); // first of three: last one is swapped in
        vm.stopPrank();
        address[] memory list = vault.strategies();
        assertEq(list.length, 2);
        assertEq(list[0], address(s3));
        assertEq(list[1], address(strat2));
        assertTrue(vault.isStrategy(address(s3)));
        assertTrue(vault.isStrategy(address(strat2)));
    }

    /*//////////////////////////////////////////////////////////////
                              RECIPIENT ADMIN
    //////////////////////////////////////////////////////////////*/

    function test_addRecipient_happyPathAndEvent() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.RecipientAdded(recipient, 300e6);
        vm.prank(owner);
        vault.addRecipient(recipient, 300e6);
        assertTrue(vault.isRecipient(recipient));
        assertEq(vault.recipientCap(recipient), 300e6);

        // same values again: idempotent, no second event
        vm.recordLogs();
        vm.prank(owner);
        vault.addRecipient(recipient, 300e6);
        assertEq(vm.getRecordedLogs().length, 0);

        // a different cap on an approved recipient updates the cap
        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.RecipientCapUpdated(recipient, 50e6);
        vm.prank(owner);
        vault.addRecipient(recipient, 50e6);
        assertEq(vault.recipientCap(recipient), 50e6);
    }

    function test_addRecipient_permissionsAndValidation() public {
        vm.prank(operator);
        vm.expectRevert(_unauthorized(operator));
        vault.addRecipient(recipient, type(uint256).max);
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        vault.addRecipient(recipient, type(uint256).max);

        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.InvalidRecipient.selector, address(0)));
        vault.addRecipient(address(0), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.InvalidRecipient.selector, address(vault))
        );
        vault.addRecipient(address(vault), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.InvalidRecipient.selector, address(usdc))
        );
        vault.addRecipient(address(usdc), type(uint256).max);
        vm.stopPrank();
    }

    function test_removeRecipient_happyPathAndPermissions() public {
        _approveRecipient();
        vm.prank(operator);
        vm.expectRevert(_unauthorized(operator));
        vault.removeRecipient(recipient);
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        vault.removeRecipient(recipient);

        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.RecipientRemoved(recipient);
        vm.prank(owner);
        vault.removeRecipient(recipient);
        assertFalse(vault.isRecipient(recipient));

        assertEq(vault.recipientCap(recipient), 0, "the cap goes with the approval");

        vm.recordLogs();
        vm.prank(owner);
        vault.removeRecipient(recipient); // idempotent
        assertEq(vm.getRecordedLogs().length, 0);
    }

    /*//////////////////////////////////////////////////////////////
                           addRecipientWithSig
    //////////////////////////////////////////////////////////////*/

    function test_sig_validEoaSignatureAddsRecipient() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OWNER_PK, address(vault), recipient, NO_CAP, 0, deadline);

        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.RecipientAdded(recipient, NO_CAP);
        vm.prank(stranger); // anyone (Hodd's server) can submit it
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, sig);

        assertTrue(vault.isRecipient(recipient));
        assertEq(vault.nonces(owner), 1);

        vm.prank(operator);
        vault.pay(recipient, 1e6, REF);
    }

    function test_sig_digestViewMatchesIndependentComputation() public view {
        uint256 deadline = block.timestamp + 1 hours;
        assertEq(
            vault.addRecipientDigest(recipient, NO_CAP, deadline),
            _typedDigest(address(vault), recipient, NO_CAP, 0, deadline)
        );
    }

    function test_sig_deadlineIsInclusiveAndExpiredReverts() public {
        uint256 deadline = block.timestamp + 100;
        bytes memory sig = _sign(OWNER_PK, address(vault), recipient, NO_CAP, 0, deadline);

        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.SignatureExpired.selector, deadline));
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, sig);

        vm.warp(deadline); // the deadline second itself is still valid
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, sig);
        assertTrue(vault.isRecipient(recipient));
    }

    function test_sig_replayReverts() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OWNER_PK, address(vault), recipient, NO_CAP, 0, deadline);
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, sig);

        vm.prank(owner);
        vault.removeRecipient(recipient);

        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, sig);
        assertFalse(vault.isRecipient(recipient));
    }

    function test_sig_nonceMustMatchAndIncrementsInOrder() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig0 = _sign(OWNER_PK, address(vault), recipient, NO_CAP, 0, deadline);
        bytes memory sig1 = _sign(OWNER_PK, address(vault), recipient2, NO_CAP, 1, deadline);

        // nonce 1 does not work first
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient2, NO_CAP, deadline, sig1);

        vault.addRecipientWithSig(recipient, NO_CAP, deadline, sig0);
        vault.addRecipientWithSig(recipient2, NO_CAP, deadline, sig1);
        assertEq(vault.nonces(owner), 2);
        assertTrue(vault.isRecipient(recipient2));
    }

    function test_sig_wrongSignerReverts() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(0xBEEF, address(vault), recipient, NO_CAP, 0, deadline);
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, sig);
        assertFalse(vault.isRecipient(recipient));
        assertEq(vault.nonces(owner), 0);
    }

    function test_sig_tamperedFieldsRevert() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OWNER_PK, address(vault), recipient, NO_CAP, 0, deadline);

        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient2, NO_CAP, deadline, sig); // other recipient

        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, NO_CAP, deadline + 1, sig); // other deadline
    }

    function test_sig_malformedSignatureReverts() public {
        uint256 deadline = block.timestamp + 1 hours;
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, "");
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, hex"1234");
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, new bytes(65));
    }

    function test_sig_otherVaultDomainReverts() public {
        // same owner, same everything, other vault: a signature for one can not be used on the other
        HoddieVault other = _vaultWith(_one(address(strat)));
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OWNER_PK, address(vault), recipient, NO_CAP, 0, deadline);
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        other.addRecipientWithSig(recipient, NO_CAP, deadline, sig);
    }

    function test_sig_otherChainDomainReverts() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OWNER_PK, address(vault), recipient, NO_CAP, 0, deadline);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, sig);
    }

    function test_sig_invalidateNonceCancelsOutstandingSignature() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OWNER_PK, address(vault), recipient, NO_CAP, 0, deadline);

        vm.prank(operator);
        vm.expectRevert(_unauthorized(operator));
        vault.invalidateNonce();

        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.NonceInvalidated(owner, 1);
        vm.prank(owner);
        uint256 next = vault.invalidateNonce();
        assertEq(next, 1);

        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, sig);
    }

    function test_sig_worksWhilePaused() public {
        vm.prank(owner);
        vault.pause();
        uint256 deadline = block.timestamp + 1 hours;
        vault.addRecipientWithSig(
            recipient,
            NO_CAP,
            deadline,
            _sign(OWNER_PK, address(vault), recipient, NO_CAP, 0, deadline)
        );
        assertTrue(vault.isRecipient(recipient));
    }

    function test_sig_rejectsInvalidRecipientButKeepsNonceUnused() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OWNER_PK, address(vault), address(0), NO_CAP, 0, deadline);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.InvalidRecipient.selector, address(0)));
        vault.addRecipientWithSig(address(0), NO_CAP, deadline, sig);
        assertEq(vault.nonces(owner), 0);
    }

    function test_sig_alreadyApprovedStillConsumesNonce() public {
        _approveRecipient();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OWNER_PK, address(vault), recipient, NO_CAP, 0, deadline);
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, sig);
        assertEq(vault.nonces(owner), 1);
        // so a later removal can not be undone with the same signature
        vm.prank(owner);
        vault.removeRecipient(recipient);
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, sig);
    }

    function test_sig_erc1271SmartAccountOwner() public {
        uint256 controllerPk = 0xC0DE;
        MockSmartAccount account = new MockSmartAccount(vm.addr(controllerPk));
        HoddieVault v = _newVault(address(account), operator, _one(address(strat)));

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(controllerPk, address(v), recipient, NO_CAP, 0, deadline);
        vm.prank(stranger);
        v.addRecipientWithSig(recipient, NO_CAP, deadline, sig);
        assertTrue(v.isRecipient(recipient));
        assertEq(v.nonces(address(account)), 1);

        // replay
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        v.addRecipientWithSig(recipient, NO_CAP, deadline, sig);
    }

    function test_sig_erc1271WrongSignerAndRejectingAccount() public {
        uint256 controllerPk = 0xC0DE;
        MockSmartAccount account = new MockSmartAccount(vm.addr(controllerPk));
        HoddieVault v = _newVault(address(account), operator, _one(address(strat)));
        uint256 deadline = block.timestamp + 1 hours;

        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        v.addRecipientWithSig(
            recipient, NO_CAP, deadline, _sign(0xBAD, address(v), recipient, NO_CAP, 0, deadline)
        );

        bytes memory good = _sign(controllerPk, address(v), recipient, NO_CAP, 0, deadline);
        account.setRejectAll(true);
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        v.addRecipientWithSig(recipient, NO_CAP, deadline, good);
        account.setRejectAll(false);
        v.addRecipientWithSig(recipient, NO_CAP, deadline, good);
        assertTrue(v.isRecipient(recipient));
    }

    function test_sig_eoaSignatureDoesNotWorkForSmartAccountOwnerAndViceVersa() public {
        MockSmartAccount account = new MockSmartAccount(vm.addr(0xC0DE));
        HoddieVault v = _newVault(address(account), operator, _one(address(strat)));
        uint256 deadline = block.timestamp + 1 hours;
        // signed by the unrelated EOA owner of the main fixture
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        v.addRecipientWithSig(
            recipient, NO_CAP, deadline, _sign(OWNER_PK, address(v), recipient, NO_CAP, 0, deadline)
        );
    }

    function test_sig_ownershipChangeVoidsOldSignatures() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(OWNER_PK, address(vault), recipient, NO_CAP, 0, deadline);
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        vault.transferOwnership(newOwner);
        vm.prank(newOwner);
        vault.acceptOwnership();
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, NO_CAP, deadline, sig);
    }

    /*//////////////////////////////////////////////////////////////
                            OWNERSHIP (2-STEP)
    //////////////////////////////////////////////////////////////*/

    function test_ownership_twoStepMigration() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        vault.transferOwnership(newOwner);
        vm.prank(operator);
        vm.expectRevert(_unauthorized(operator));
        vault.transferOwnership(newOwner);

        vm.expectEmit(true, true, false, true, address(vault));
        emit Ownable2Step.OwnershipTransferStarted(owner, newOwner);
        vm.prank(owner);
        vault.transferOwnership(newOwner);
        assertEq(vault.owner(), owner, "still the old owner until accepted");
        assertEq(vault.pendingOwner(), newOwner);

        // the pending owner has no powers yet
        vm.prank(newOwner);
        vm.expectRevert(_unauthorized(newOwner));
        vault.pause();
        // nobody else can accept
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        vault.acceptOwnership();

        vm.expectEmit(true, true, false, true, address(vault));
        emit Ownable.OwnershipTransferred(owner, newOwner);
        vm.prank(newOwner);
        vault.acceptOwnership();
        assertEq(vault.owner(), newOwner);
        assertEq(vault.pendingOwner(), address(0));

        // old owner is out
        vm.prank(owner);
        vm.expectRevert(_unauthorized(owner));
        vault.pause();
        vm.prank(owner);
        vm.expectRevert(_unauthorized(owner));
        vault.withdrawAll();

        // new owner receives everything
        vm.prank(newOwner);
        vault.withdrawAll();
        assertEq(usdc.balanceOf(newOwner), FUNDS);
        assertEq(usdc.balanceOf(owner), 0);
    }

    function test_ownership_operatorTransferGoesToTheNewOwner() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        vault.transferOwnership(newOwner);
        vm.prank(newOwner);
        vault.acceptOwnership();
        vm.prank(operator);
        vault.transferToOwner(1e6);
        assertEq(usdc.balanceOf(newOwner), 1e6);
        assertEq(usdc.balanceOf(owner), 0);
    }

    function test_ownership_pendingTransferCanBeCancelled() public {
        address newOwner = makeAddr("newOwner");
        vm.startPrank(owner);
        vault.transferOwnership(newOwner);
        vault.transferOwnership(address(0));
        vm.stopPrank();
        vm.prank(newOwner);
        vm.expectRevert(_unauthorized(newOwner));
        vault.acceptOwnership();
    }

    function test_ownership_renounceIsDisabled() public {
        vm.prank(owner);
        vm.expectRevert(HoddieVault.RenounceDisabled.selector);
        vault.renounceOwnership();
        assertEq(vault.owner(), owner);

        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        vault.renounceOwnership();
    }

    function test_ownership_eoaCanMigrateToSmartAccount() public {
        MockSmartAccount account = new MockSmartAccount(vm.addr(0xC0DE));
        vm.prank(owner);
        vault.transferOwnership(address(account));
        vm.prank(vm.addr(0xC0DE));
        account.execute(address(vault), abi.encodeCall(vault.acceptOwnership, ()));
        assertEq(vault.owner(), address(account));

        vm.prank(vm.addr(0xC0DE));
        account.execute(address(vault), abi.encodeCall(vault.withdrawAll, ()));
        assertEq(usdc.balanceOf(address(account)), FUNDS);
    }

    function test_ownership_smartAccountCanOwn() public {
        uint256 controllerPk = 0xC0DE;
        MockSmartAccount account = new MockSmartAccount(vm.addr(controllerPk));
        HoddieVault v = _newVault(address(account), operator, _one(address(strat)));
        usdc.mint(address(v), 100e6);

        vm.startPrank(vm.addr(controllerPk));
        account.execute(address(v), abi.encodeCall(v.addRecipient, (recipient, type(uint256).max)));
        account.execute(address(v), abi.encodeCall(v.pause, ()));
        account.execute(address(v), abi.encodeCall(v.withdrawAll, ()));
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(account)), 100e6);
        assertTrue(v.isRecipient(recipient));
    }

    /*//////////////////////////////////////////////////////////////
                               withdrawAll
    //////////////////////////////////////////////////////////////*/

    function test_withdrawAll_sweepsIdleAndStrategies() public {
        _depositAs(address(strat), 900e6);
        _depositAs(address(strat2), 300e6);

        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.WithdrawnAll(owner, FUNDS - 1200e6);
        vm.prank(owner);
        vault.withdrawAll();

        assertEq(usdc.balanceOf(owner), FUNDS);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(strat.balanceOf(address(vault)), 0);
        assertEq(strat2.balanceOf(address(vault)), 0);
        assertEq(strat.balanceOf(owner), 0, "fully redeemed: no share tokens left over");
    }

    function test_withdrawAll_includesYield() public {
        _depositAs(address(strat), 900e6);
        usdc.mint(address(this), 90e6);
        usdc.approve(address(strat), 90e6);
        strat.donate(90e6);

        vm.prank(owner);
        vault.withdrawAll();
        assertApproxEqAbs(usdc.balanceOf(owner), FUNDS + 90e6, 1);
        assertEq(strat.balanceOf(address(vault)), 0);
    }

    function test_withdrawAll_permissions() public {
        vm.prank(operator);
        vm.expectRevert(_unauthorized(operator));
        vault.withdrawAll();
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        vault.withdrawAll();
    }

    function test_withdrawAll_withNothingToDoStillSucceeds() public {
        vm.startPrank(owner);
        vault.withdrawAll();
        vault.withdrawAll();
        vm.stopPrank();
        assertEq(usdc.balanceOf(owner), FUNDS);
    }

    function test_withdrawAll_worksPausedAndWithoutOperator() public {
        _depositAs(address(strat), 500e6);
        vm.startPrank(owner);
        vault.pause();
        vault.revokeOperator();
        vault.withdrawAll();
        vm.stopPrank();
        assertEq(usdc.balanceOf(owner), FUNDS);
    }

    function test_withdrawAll_worksWithMorphoVaultV2Behaviour() public {
        // Morpho Vault V2 returns 0 from every max*() function but serves real redemptions.
        strat.setMode(MockStrategy.Mode.V2, 0);
        _depositAs(address(strat), 900e6);
        assertEq(strat.maxRedeem(address(vault)), 0);

        vm.prank(owner);
        vault.withdrawAll();
        assertEq(usdc.balanceOf(owner), FUNDS, "USDC, not share tokens");
        assertEq(strat.balanceOf(owner), 0);
        assertEq(strat.balanceOf(address(vault)), 0);
    }

    function test_withdrawAll_cappedStrategyRedeemsWhatItCanAndSendsTheRestAsShares() public {
        uint256 shares = _depositAs(address(strat), 900e6);
        uint256 redeemed = shares / 3;
        strat.setMode(MockStrategy.Mode.CAPPED, redeemed);
        uint256 expectedOut = strat.previewRedeem(redeemed);

        vm.prank(owner);
        vault.withdrawAll();

        assertEq(usdc.balanceOf(owner), FUNDS - 900e6 + expectedOut);
        assertEq(strat.balanceOf(owner), shares - redeemed, "the rest arrives as share tokens");
        assertEq(strat.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);

        // the owner can finish the job later
        strat.setMode(MockStrategy.Mode.NORMAL, 0);
        vm.prank(owner);
        strat.redeem(shares - redeemed, owner, owner);
        assertEq(usdc.balanceOf(owner), FUNDS);
    }

    function test_withdrawAll_blockedStrategySendsAllSharesToOwner() public {
        uint256 shares = _depositAs(address(strat), 900e6);
        strat.setMode(MockStrategy.Mode.BLOCKED, 0);

        vm.prank(owner);
        vault.withdrawAll();

        assertEq(usdc.balanceOf(owner), FUNDS - 900e6, "idle USDC still arrives");
        assertEq(strat.balanceOf(owner), shares);
        assertEq(strat.balanceOf(address(vault)), 0);

        strat.setMode(MockStrategy.Mode.NORMAL, 0);
        vm.prank(owner);
        strat.redeem(shares, owner, owner);
        assertEq(usdc.balanceOf(owner), FUNDS);
    }

    function test_withdrawAll_untransferableSharesStayAndCanBeRescuedLater() public {
        uint256 shares = _depositAs(address(strat), 900e6);
        _depositAs(address(strat2), 100e6);
        strat.setMode(MockStrategy.Mode.BLOCKED, 0);
        strat.setSharesLocked(true);

        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.StrategyExitFailed(address(strat), shares);
        vm.prank(owner);
        vault.withdrawAll();

        // everything else still went through
        assertEq(usdc.balanceOf(owner), FUNDS - 900e6);
        assertEq(strat.balanceOf(address(vault)), shares);
        assertEq(strat2.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);

        // later, when the strategy recovers, the owner gets the rest
        strat.setMode(MockStrategy.Mode.NORMAL, 0);
        strat.setSharesLocked(false);
        vm.prank(owner);
        vault.withdrawAll();
        assertEq(usdc.balanceOf(owner), FUNDS);
    }

    function test_withdrawAll_hostileStrategiesNeverBlockOthers() public {
        HostileStrategy.Mode[5] memory modes = [
            HostileStrategy.Mode.REVERT,
            HostileStrategy.Mode.EMPTY,
            HostileStrategy.Mode.SHORT,
            HostileStrategy.Mode.HUGE,
            HostileStrategy.Mode.ZERO
        ];
        for (uint256 i; i < modes.length; ++i) {
            HostileStrategy evil = new HostileStrategy(address(usdc), modes[i]);
            address[] memory list = new address[](2);
            list[0] = address(evil); // visited first
            list[1] = address(strat);
            HoddieVault v = _vaultWith(list);
            vm.prank(operator);
            v.depositToStrategy(address(strat), 400e6, 1);
            uint256 before = usdc.balanceOf(owner);

            vm.prank(owner);
            v.withdrawAll();

            assertEq(
                usdc.balanceOf(owner) - before, FUNDS, "all idle + redeemed funds reached owner"
            );
            assertEq(usdc.balanceOf(address(v)), 0);
            assertEq(strat.balanceOf(address(v)), 0);
        }
    }

    function test_withdrawAll_strategyThatBurnsAllGasDoesNotBlockTheOwner() public {
        HostileStrategy burner = new HostileStrategy(address(usdc), HostileStrategy.Mode.BURN);
        address[] memory list = new address[](2);
        list[0] = address(strat);
        list[1] = address(burner);
        HoddieVault v = _vaultWith(list);
        vm.prank(operator);
        v.depositToStrategy(address(strat), 400e6, 1);

        // With a realistic block gas limit the 63/64 rule leaves enough for the final transfer.
        vm.prank(owner);
        v.withdrawAll{gas: 30_000_000}();
        assertEq(usdc.balanceOf(owner), FUNDS);

        // And the owner can always remove the bad strategy (constant gas) and exit the others.
        vm.prank(owner);
        v.disallowStrategy(address(burner));
        assertEq(v.strategyCount(), 1);
    }

    function test_withdrawAll_burnerFirstThenDisallowRestoresFullSweep() public {
        HostileStrategy burner = new HostileStrategy(address(usdc), HostileStrategy.Mode.BURN);
        address[] memory list = new address[](3);
        list[0] = address(burner);
        list[1] = address(strat);
        list[2] = address(strat2);
        HoddieVault v = _vaultWith(list);
        vm.startPrank(operator);
        v.depositToStrategy(address(strat), 400e6, 1);
        v.depositToStrategy(address(strat2), 400e6, 1);
        vm.stopPrank();

        vm.startPrank(owner);
        v.disallowStrategy(address(burner));
        v.withdrawAll{gas: 30_000_000}();
        vm.stopPrank();
        assertEq(usdc.balanceOf(owner), FUNDS);
        assertEq(usdc.balanceOf(address(v)), 0);
    }

    function test_exitStrategy_oneStrategyOnly() public {
        _depositAs(address(strat), 900e6);
        _depositAs(address(strat2), 100e6);

        vm.prank(operator);
        vm.expectRevert(_unauthorized(operator));
        vault.exitStrategy(address(strat));
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        vault.exitStrategy(address(strat));

        vm.prank(owner);
        vault.exitStrategy(address(strat));
        assertEq(usdc.balanceOf(owner), 900e6, "only that strategy's assets, no idle USDC");
        assertEq(strat.balanceOf(address(vault)), 0);
        assertGt(strat2.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(address(vault)), FUNDS - 1000e6);
    }

    function test_exitStrategy_garbageTargetsDoNotRevert() public {
        vm.startPrank(owner);
        vault.exitStrategy(address(0)); // no code
        vault.exitStrategy(stranger); // EOA
        vault.exitStrategy(address(usdc)); // not a strategy: its balance is idle USDC, treated as shares
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                               rescueToken
    //////////////////////////////////////////////////////////////*/

    function test_rescueToken_sendsToOwnerOnly() public {
        MockUSDC other = new MockUSDC();
        other.mint(address(vault), 55e6);

        vm.prank(operator);
        vm.expectRevert(_unauthorized(operator));
        vault.rescueToken(IERC20(address(other)), 55e6);
        vm.prank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        vault.rescueToken(IERC20(address(other)), 55e6);

        vm.expectEmit(true, true, false, true, address(vault));
        emit HoddieVault.TokenRescued(address(other), owner, 55e6);
        vm.prank(owner);
        vault.rescueToken(IERC20(address(other)), 55e6);
        assertEq(other.balanceOf(owner), 55e6);
        assertEq(other.balanceOf(address(vault)), 0);
    }

    function test_rescueToken_canRescueTheAssetToo() public {
        vm.prank(owner);
        vault.rescueToken(IERC20(address(usdc)), 123e6);
        assertEq(usdc.balanceOf(owner), 123e6);
    }

    function test_rescueToken_revertsWhenAmountExceedsBalance() public {
        vm.prank(owner);
        vm.expectRevert();
        vault.rescueToken(IERC20(address(usdc)), FUNDS + 1);
    }

    /*//////////////////////////////////////////////////////////////
                              REENTRANCY
    //////////////////////////////////////////////////////////////*/

    function _reentrancyFixture(bytes memory payloadSeed)
        internal
        returns (HoddieVault v, ReentrantOperator op, ReentrantStrategy rs)
    {
        op = new ReentrantOperator();
        rs = new ReentrantStrategy(IERC20(address(usdc)));
        v = _newVault(owner, address(op), _one(address(rs)));
        usdc.mint(address(v), FUNDS);
        vm.prank(owner);
        v.addRecipient(recipient, type(uint256).max);
        op.setTarget(address(v), payloadSeed);
        rs.setHook(address(op));
    }

    function test_reentrancy_payInsideDeposit() public {
        (HoddieVault v, ReentrantOperator op, ReentrantStrategy rs) =
            _reentrancyFixture(abi.encodeCall(HoddieVault.pay, (recipient, 1e6, REF)));
        (bool ok,) = op.call(abi.encodeCall(HoddieVault.depositToStrategy, (address(rs), 100e6, 1)));
        assertTrue(ok, "outer call itself succeeds");
        assertTrue(op.reentered());
        assertFalse(op.reenterOk(), "reentrant call must fail");
        assertEq(
            bytes4(op.reenterRevertData()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(usdc.balanceOf(address(v)), FUNDS - 100e6);
    }

    function test_reentrancy_depositInsideWithdraw() public {
        (HoddieVault v, ReentrantOperator op, ReentrantStrategy rs) =
            _reentrancyFixture(abi.encodeCall(HoddieVault.transferToOwner, (1e6)));
        // deposit first with the hook disabled, then arm it
        rs.setHook(address(0));
        (bool ok,) = op.call(abi.encodeCall(HoddieVault.depositToStrategy, (address(rs), 100e6, 1)));
        assertTrue(ok);
        rs.setHook(address(op));

        (ok,) = op.call(
            abi.encodeCall(HoddieVault.withdrawFromStrategy, (address(rs), 50e6, type(uint256).max))
        );
        assertTrue(ok);
        assertTrue(op.reentered());
        assertFalse(op.reenterOk());
        assertEq(
            bytes4(op.reenterRevertData()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
        assertEq(usdc.balanceOf(owner), 0);
        assertEq(usdc.balanceOf(address(v)), FUNDS - 50e6);
    }

    /*//////////////////////////////////////////////////////////////
                  STRANGER CAN NOT DO ANYTHING (SMOKE)
    //////////////////////////////////////////////////////////////*/

    function test_stranger_cannotCallAnyPrivilegedFunction() public {
        bytes[19] memory calls = [
            abi.encodeCall(vault.depositToStrategy, (address(strat), 1e6, 1)),
            abi.encodeCall(vault.withdrawFromStrategy, (address(strat), 1e6, type(uint256).max)),
            abi.encodeCall(vault.redeemFromStrategy, (address(strat), 1, 1)),
            abi.encodeCall(vault.transferToOwner, (1e6)),
            abi.encodeCall(vault.pay, (recipient, 1e6, REF)),
            abi.encodeCall(vault.pause, ()),
            abi.encodeCall(vault.unpause, ()),
            abi.encodeCall(vault.setLimits, (UNLIMITED, UNLIMITED, UNLIMITED, UNLIMITED)),
            abi.encodeCall(vault.setOperator, (stranger)),
            abi.encodeCall(vault.revokeOperator, ()),
            abi.encodeCall(vault.allowStrategy, (address(strat))),
            abi.encodeCall(vault.disallowStrategy, (address(strat))),
            abi.encodeCall(vault.addRecipient, (stranger, type(uint256).max)),
            abi.encodeCall(vault.removeRecipient, (recipient)),
            abi.encodeCall(vault.invalidateNonce, ()),
            abi.encodeCall(vault.withdrawAll, ()),
            abi.encodeCall(vault.exitStrategy, (address(strat))),
            abi.encodeCall(vault.rescueToken, (IERC20(address(usdc)), 1e6)),
            abi.encodeCall(vault.transferOwnership, (stranger))
        ];
        for (uint256 i; i < calls.length; ++i) {
            vm.prank(stranger);
            (bool ok,) = address(vault).call(calls[i]);
            assertFalse(ok);
        }
        vm.prank(stranger);
        (bool ok2,) = address(vault).call(abi.encodeCall(vault.acceptOwnership, ()));
        assertFalse(ok2);
        assertEq(vault.owner(), owner);
        assertEq(usdc.balanceOf(address(vault)), FUNDS);
    }

    /*//////////////////////////////////////////////////////////////
                              GAS SNAPSHOTS
    //////////////////////////////////////////////////////////////*/

    function test_bytecodeStaysBelowEip170() public view {
        // EIP-170: deployed runtime must stay below 24_576 bytes
        assertLt(address(vault).code.length, 24_576);
    }
}

