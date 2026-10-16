// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {HoddieVault} from "../../src/HoddieVault.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockStrategy} from "../mocks/MockStrategy.sol";
import {HostileStrategy} from "../mocks/HostileStrategy.sol";
import {MockUSYC, MockTeller} from "../mocks/MockTeller.sol";
import {HoddUSYCVault} from "../../src/HoddUSYCVault.sol";
import {VaultHandler} from "./VaultHandler.sol";

/// @dev Stateful fuzzing: a handler lets the operator, the owner and a stranger call random
///      functions with random arguments against OZ ERC-4626 mocks (one of which can be set to
///      Morpho-V2 behaviour, capped, blocked or share-locked), a hostile strategy and Hodd's USYC
///      pool (the real HoddUSYCVault over a permissioned mock Teller) whose Circle allowlist,
///      price, fees, limits and liquidity change at random.
contract HoddieVaultInvariantTest is Test {
    VaultHandler internal handler;
    HoddieVault internal vault;
    MockUSDC internal usdc;
    MockStrategy internal good1;
    MockStrategy internal good2;
    MockStrategy internal never;
    HostileStrategy internal hostile;
    MockUSYC internal usyc;
    MockTeller internal teller;
    HoddUSYCVault internal usycPool;

    function setUp() public {
        handler = new VaultHandler();
        vault = handler.vault();
        usdc = handler.usdc();
        good1 = handler.good1();
        good2 = handler.good2();
        never = handler.never();
        hostile = handler.hostile();
        usyc = handler.usyc();
        teller = handler.teller();
        usycPool = handler.usycPool();

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](33);
        selectors[0] = VaultHandler.opDeposit.selector;
        selectors[1] = VaultHandler.opWithdraw.selector;
        selectors[2] = VaultHandler.opRedeem.selector;
        selectors[3] = VaultHandler.opTransferToOwner.selector;
        selectors[4] = VaultHandler.opPay.selector;
        selectors[5] = VaultHandler.ownerSetLimits.selector;
        selectors[6] = VaultHandler.ownerPause.selector;
        selectors[7] = VaultHandler.ownerAddRecipient.selector;
        selectors[8] = VaultHandler.ownerSetRecipientCap.selector;
        selectors[9] = VaultHandler.ownerRemoveRecipient.selector;
        selectors[10] = VaultHandler.fundVault.selector;
        selectors[11] = VaultHandler.ownerAllowStrategy.selector;
        selectors[12] = VaultHandler.ownerDisallowStrategy.selector;
        selectors[13] = VaultHandler.ownerAllowHostile.selector;
        selectors[14] = VaultHandler.ownerSetOperator.selector;
        selectors[15] = VaultHandler.ownerRescueUsdc.selector;
        selectors[16] = VaultHandler.ownerExitStrategy.selector;
        selectors[17] = VaultHandler.ownerInvalidateNonce.selector;
        selectors[18] = VaultHandler.ownerWithdrawAll.selector;
        selectors[19] = VaultHandler.signedAddRecipient.selector;
        selectors[20] = VaultHandler.strangerCall.selector;
        selectors[21] = VaultHandler.warp.selector;
        selectors[22] = VaultHandler.setStrategyMode.selector;
        selectors[23] = VaultHandler.setSharesLocked.selector;
        selectors[24] = VaultHandler.setHostileMode.selector;
        selectors[25] = VaultHandler.donateYield.selector;
        selectors[26] = VaultHandler.setTellerAccess.selector;
        selectors[27] = VaultHandler.setTellerEconomics.selector;
        selectors[28] = VaultHandler.setTellerLimits.selector;
        selectors[29] = VaultHandler.moveTreasury.selector;
        selectors[30] = VaultHandler.pauseAuthority.selector;
        selectors[31] = VaultHandler.opDeposit.selector; // deposits get twice the weight
        selectors[32] = VaultHandler.opRedeemToOwner.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// (1) USDC and strategy shares only ever leave the vault to the owner, an approved
    ///     recipient (USDC only) or an allowlisted strategy. Nobody else ever holds anything,
    ///     USYC only ever sits in the pool, and nothing is created or lost on the way.
    function invariant_1_fundsOnlyReachOwnerApprovedRecipientsOrStrategies() public view {
        address operator = handler.operator();
        address stranger = handler.stranger();
        address[] memory pool = handler.poolAddresses();
        address[] memory outsiders = handler.outsiderAddresses();

        // parties that are never authorised hold nothing, neither USDC nor shares
        address[] memory nobody = new address[](outsiders.length + 3);
        for (uint256 i; i < outsiders.length; ++i) {
            nobody[i] = outsiders[i];
        }
        nobody[outsiders.length] = operator;
        nobody[outsiders.length + 1] = stranger;
        nobody[outsiders.length + 2] = address(never);
        for (uint256 i; i < nobody.length; ++i) {
            assertEq(usdc.balanceOf(nobody[i]), 0, "USDC reached an unauthorised address");
            assertEq(good1.balanceOf(nobody[i]), 0, "shares reached an unauthorised address");
            assertEq(good2.balanceOf(nobody[i]), 0, "shares reached an unauthorised address");
            assertEq(usyc.balanceOf(nobody[i]), 0, "USYC reached an unauthorised address");
            assertEq(
                usycPool.balanceOf(nobody[i]), 0, "pool shares reached an unauthorised address"
            );
        }
        assertEq(usdc.balanceOf(address(hostile)), 0, "USDC reached the hostile strategy");
        assertEq(usdc.balanceOf(address(teller)), 0, "the teller keeps no USDC");

        // recipients only ever hold USDC if the owner approved them at some point, never shares
        uint256 poolTotal;
        for (uint256 i; i < pool.length; ++i) {
            uint256 bal = usdc.balanceOf(pool[i]);
            if (bal != 0) {
                assertTrue(handler.everApproved(pool[i]), "paid a never-approved address");
            }
            assertEq(good1.balanceOf(pool[i]), 0);
            assertEq(good2.balanceOf(pool[i]), 0);
            assertEq(usyc.balanceOf(pool[i]), 0);
            assertEq(usycPool.balanceOf(pool[i]), 0);
            poolTotal += bal;
        }

        // shares only live in the vault or with the owner
        assertEq(
            good1.totalSupply(), good1.balanceOf(address(vault)) + good1.balanceOf(handler.owner())
        );
        assertEq(
            good2.totalSupply(), good2.balanceOf(address(vault)) + good2.balanceOf(handler.owner())
        );
        // the vault never holds USYC itself: it all sits in the pool, whose shares only the vault holds
        assertEq(usyc.totalSupply(), usyc.balanceOf(address(usycPool)), "USYC outside the pool");
        assertEq(usycPool.totalSupply(), usycPool.balanceOf(address(vault)), "pool shares moved");

        // conservation: every USDC in existence sits with an authorised holder
        uint256 authorised = usdc.balanceOf(address(vault)) + usdc.balanceOf(handler.owner())
            + poolTotal + usdc.balanceOf(address(good1)) + usdc.balanceOf(address(good2))
            + usdc.balanceOf(handler.donor()) + usdc.balanceOf(handler.treasury())
            + usdc.balanceOf(handler.feeRecipient()) + usdc.balanceOf(address(usycPool));
        assertEq(usdc.totalSupply(), authorised, "USDC is missing or sits somewhere unexpected");
        assertEq(usdc.totalSupply(), handler.minted());

        // allowances to strategies are always reset, and the vault never holds native value
        assertEq(usdc.allowance(address(vault), address(good1)), 0);
        assertEq(usdc.allowance(address(vault), address(good2)), 0);
        assertEq(usdc.allowance(address(vault), address(never)), 0);
        assertEq(usdc.allowance(address(vault), address(hostile)), 0);
        assertEq(usdc.allowance(address(vault), address(teller)), 0);
        assertEq(usdc.allowance(address(vault), address(usycPool)), 0);
        assertEq(address(vault).balance, 0);
    }

    /// (2) Over any 24 hours the operator moves at most `depositLimit24h` into strategies and
    ///     `paymentLimit24h` to recipients, no call exceeds its per-call cap, no payment exceeds
    ///     the recipient's cap, and the contract's windows equal an independent model.
    function invariant_2_operatorOutflowRespectsLimits() public view {
        assertFalse(handler.limitViolation(), "a limit was exceeded");
        assertFalse(handler.recipientCapViolation(), "a recipient cap was exceeded");
        assertFalse(handler.unlimitedOpChangedBudget(), "an unlimited op changed the budget");
        assertFalse(handler.paidUnapproved(), "operator paid an unapproved recipient");
        assertEq(vault.depositSpentLast24h(), handler.bucketedDeposits(block.timestamp));
        assertEq(vault.paymentSpentLast24h(), handler.bucketedPayments(block.timestamp));
    }

    /// (3) `withdrawAll()` never reverts, leaves no USDC in the vault, and the owner receives all
    ///     idle USDC plus everything redeemable (plus the rest as share tokens where they can be
    ///     transferred). The USYC pool pays exactly its own preview for the shares it burns; while
    ///     Circle does not permit the pool its shares stay put and everything else still leaves.
    function invariant_3_withdrawAllDeliversEverything() public view {
        assertFalse(handler.withdrawAllReverted(), "withdrawAll reverted");
        assertFalse(handler.withdrawAllViolation(), "withdrawAll postcondition violated");
    }

    /// (4) A stranger never changes state or succeeds at anything privileged, and signatures are
    ///     only honoured when they are valid, fresh, from the owner and for the signed cap.
    ///     Ownership never moves.
    function invariant_4_strangerCanNeverChangeState() public view {
        assertFalse(handler.strangerSucceeded(), "a stranger call succeeded");
        assertFalse(handler.strangerChangedState(), "a stranger call changed state");
        assertFalse(handler.badSignatureAccepted(), "an invalid signature was accepted");
        assertFalse(handler.goodSignatureRejected(), "a valid signature was rejected");
        assertEq(vault.owner(), handler.owner());
        assertEq(vault.pendingOwner(), address(0));
    }

    /// (5) A strategy call that succeeded always met the bound the operator stated, measured on
    ///     the vault's real balances.
    function invariant_5_slippageBoundsAreHonoured() public view {
        assertFalse(handler.slippageViolation(), "a slippage bound was not honoured");
    }

    /// (6) `redeemToOwner` sends exactly the redeemed USDC to the owner and never touches the
    ///     vault's idle USDC or the budgets.
    function invariant_6_redeemToOwnerForwardsExactly() public view {
        assertFalse(handler.redeemToOwnerViolation(), "redeemToOwner moved the wrong amount");
    }
}
