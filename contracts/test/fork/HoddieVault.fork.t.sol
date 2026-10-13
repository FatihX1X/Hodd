// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {HoddieVault} from "../../src/HoddieVault.sol";
import {ForkBase} from "./ForkBase.sol";

/// @notice The vault against the REAL Arc Testnet USDC and the REAL allowlisted Morpho Vault V2
///         (the Teller has its own suite in `HoddieVaultTeller.fork.t.sol`). See {ForkBase}.
contract HoddieVaultForkTest is ForkBase {
    HoddieVault internal vault;
    address internal owner;

    function setUp() public override {
        super.setUp();
        if (block.chainid != ARC_TESTNET) return;
        owner = vm.addr(OWNER_PK);
        vault = HoddieVault(factory.createVault(owner, operator, _limits(), _strategies(false)));
        _fund(address(vault), FUNDS);
    }

    function _signAddRecipient(address r, uint256 cap, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = vault.addRecipientDigest(r, cap, deadline);
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(OWNER_PK, digest);
        return abi.encodePacked(rr, s, v);
    }

    /*//////////////////////////////////////////////////////////////
                                   TESTS
    //////////////////////////////////////////////////////////////*/

    function test_fork_environmentIsTheRealThing() public view {
        assertEq(block.chainid, ARC_TESTNET);
        assertEq(IERC4626(MORPHO).asset(), USDC);
        assertEq(IERC4626(MORPHO).decimals(), 18);
        assertGt(IERC4626(MORPHO).totalAssets(), 0);
        // the quirk the contract has to live with: Morpho Vault V2 reports zero for every max*()
        assertEq(IERC4626(MORPHO).maxRedeem(address(vault)), 0);
        assertEq(IERC4626(MORPHO).maxDeposit(address(vault)), 0);
        assertEq(_usdc(address(vault)), FUNDS);
        // Morpho has no separate share token, so the vault's position is its own share balance
        assertEq(vault.shareTokenOf(MORPHO), MORPHO);
    }

    function test_fork_factoryAndVaultConfiguration() public view {
        assertEq(address(vault.asset()), USDC);
        assertEq(vault.owner(), owner);
        assertEq(vault.operator(), operator);
        assertTrue(vault.isStrategy(MORPHO));
        assertTrue(factory.isVault(address(vault)));
        assertEq(
            factory.predictVault(owner, operator, _limits(), _strategies(false)), address(vault)
        );
    }

    function test_fork_operatorDepositWithdrawRedeem() public {
        // deposit, with a slippage bound taken from the vault's own preview
        uint256 minShares = IERC4626(MORPHO).previewDeposit(600e6);
        vm.prank(operator);
        uint256 shares = vault.depositToStrategy(MORPHO, 600e6, minShares);
        assertGe(shares, minShares);
        assertEq(_usdc(address(vault)), FUNDS - 600e6);
        assertEq(_morphoShares(address(vault)), shares);
        assertApproxEqAbs(IERC4626(MORPHO).convertToAssets(shares), 600e6, 2);
        assertEq(IERC20(USDC).allowance(address(vault), MORPHO), 0, "allowance reset");
        assertEq(vault.depositSpentLast24h(), 600e6);

        // withdraw an exact amount back into the vault
        vm.prank(operator);
        vault.withdrawFromStrategy(MORPHO, 200e6, shares);
        assertEq(_usdc(address(vault)), FUNDS - 600e6 + 200e6);

        // redeem half of the remaining shares back into the vault
        uint256 remaining = _morphoShares(address(vault));
        uint256 before = _usdc(address(vault));
        vm.prank(operator);
        uint256 got = vault.redeemFromStrategy(MORPHO, remaining / 2, 190e6);
        assertEq(_usdc(address(vault)), before + got);
        assertApproxEqAbs(got, 200e6, 3);

        // neither of the two counted against the limits, and nothing went to the operator
        assertEq(vault.depositSpentLast24h(), 600e6);
        assertEq(_usdc(operator), 0);
        assertEq(_morphoShares(operator), 0);
    }

    function test_fork_slippageBoundsAreEnforcedAgainstTheRealVault() public {
        uint256 expected = IERC4626(MORPHO).previewDeposit(500e6);
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.InsufficientShares.selector, expected, expected + 1)
        );
        vault.depositToStrategy(MORPHO, 500e6, expected + 1);

        vm.prank(operator);
        vm.expectRevert(HoddieVault.ZeroSlippageBound.selector);
        vault.depositToStrategy(MORPHO, 500e6, 0);

        vm.prank(operator);
        uint256 shares = vault.depositToStrategy(MORPHO, 500e6, expected);

        // asking for more USDC than the shares are worth reverts and moves nothing
        uint256 worth = IERC4626(MORPHO).previewRedeem(shares);
        vm.prank(operator);
        vm.expectRevert();
        vault.redeemFromStrategy(MORPHO, shares, worth + 10e6);
        assertEq(_morphoShares(address(vault)), shares);

        // a maximum on the shares burned by an exact withdrawal
        vm.prank(operator);
        vm.expectRevert();
        vault.withdrawFromStrategy(MORPHO, 100e6, 1);
        assertEq(_morphoShares(address(vault)), shares);
    }

    function test_fork_payRecipientApprovedByOwnerSignature() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAddRecipient(recipient, 150e6, deadline);

        // not yet approved
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.RecipientNotApproved.selector, recipient));
        vault.pay(recipient, 100e6, REF);

        vm.prank(stranger); // Hodd's server pays the gas
        vault.addRecipientWithSig(recipient, 150e6, deadline, sig);
        assertEq(vault.recipientCap(recipient), 150e6);

        vm.expectEmit(true, true, false, true, address(vault));
        emit HoddieVault.Payment(recipient, 100e6, REF);
        vm.prank(operator);
        vault.pay(recipient, 100e6, REF);

        assertEq(_usdc(recipient), 100e6);
        assertEq(_usdc(address(vault)), FUNDS - 100e6);
        assertEq(vault.paymentSpentLast24h(), 100e6);

        // above the recipient's signed cap
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.ExceedsRecipientCap.selector, 151e6, 150e6));
        vault.pay(recipient, 151e6, REF);

        // replay
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, 150e6, deadline, sig);
    }

    function test_fork_rollingWindowOnTheRealChain() public {
        vm.startPrank(operator);
        vault.depositToStrategy(MORPHO, MAX_TX, 1);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.ExceedsMaxDepositPerTx.selector, MAX_TX + 1, MAX_TX)
        );
        vault.depositToStrategy(MORPHO, MAX_TX + 1, 1);
        vault.depositToStrategy(MORPHO, MAX_TX, 1);
        vault.depositToStrategy(MORPHO, 500e6, 1);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.ExceedsDepositLimit24h.selector, DAILY + 1, DAILY)
        );
        vault.depositToStrategy(MORPHO, 1, 1);

        // 24 hours later the first deposit still counts, 25 hours later everything is free
        vm.warp(block.timestamp + 24 hours);
        assertEq(vault.depositSpentLast24h(), DAILY);
        vm.warp(block.timestamp + 1 hours + 1);
        assertEq(vault.depositSpentLast24h(), 0);
        vault.withdrawFromStrategy(MORPHO, 100e6, type(uint256).max);
        vm.stopPrank();
    }

    function test_fork_pauseBlocksOperatorButOwnerStillExits() public {
        vm.prank(operator);
        vault.depositToStrategy(MORPHO, 800e6, 1);

        vm.prank(owner);
        vault.pause();

        vm.startPrank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.depositToStrategy(MORPHO, 1e6, 1);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.withdrawFromStrategy(MORPHO, 1e6, type(uint256).max);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.transferToOwner(1e6);
        vm.stopPrank();

        vm.prank(owner);
        vault.withdrawAll();
        assertApproxEqAbs(_usdc(owner), FUNDS, 3);
        assertEq(_usdc(address(vault)), 0);
        assertEq(_morphoShares(address(vault)), 0);
    }

    /// The headline test: Morpho Vault V2 reports maxRedeem == 0, yet withdrawAll must hand the
    /// owner USDC (not share tokens), with the operator revoked and the vault paused.
    function test_fork_withdrawAllReturnsUsdcFromRealMorphoVault() public {
        vm.startPrank(operator);
        vault.depositToStrategy(MORPHO, 1_000e6, 1);
        vault.depositToStrategy(MORPHO, 800e6, 1);
        vm.stopPrank();
        uint256 shares = _morphoShares(address(vault));
        assertGt(shares, 0);
        assertEq(IERC4626(MORPHO).maxRedeem(address(vault)), 0);

        // a month of interest, then the owner leaves: Hodd is gone and the vault is paused
        vm.warp(block.timestamp + 30 days);
        vm.startPrank(owner);
        vault.pause();
        vault.revokeOperator();
        vault.withdrawAll();
        vm.stopPrank();

        assertEq(_usdc(address(vault)), 0, "vault is empty");
        assertEq(_morphoShares(address(vault)), 0, "no shares left behind");
        assertEq(_morphoShares(owner), 0, "owner got USDC, not share tokens");
        assertGe(_usdc(owner) + 3, FUNDS, "owner got everything back (plus any interest)");
        assertEq(address(vault).balance, 0);
    }

    function test_fork_exitStrategyAfterDisallowAndRescueShares() public {
        vm.prank(operator);
        vault.depositToStrategy(MORPHO, 500e6, 1);
        uint256 shares = _morphoShares(address(vault));

        vm.prank(owner);
        vault.disallowStrategy(MORPHO);
        // the operator can no longer touch it ...
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, MORPHO));
        vault.withdrawFromStrategy(MORPHO, 1e6, type(uint256).max);

        // ... shares are not stranded: the owner can rescue them as tokens ...
        vm.prank(owner);
        vault.rescueToken(IERC20(MORPHO), shares / 2);
        assertEq(_morphoShares(owner), shares / 2);

        // ... or exit the rest in one call
        vm.prank(owner);
        vault.exitStrategy(MORPHO);
        assertEq(_morphoShares(address(vault)), 0);
        assertApproxEqAbs(_usdc(owner), 250e6, 3);
    }

    function test_fork_nativeValueRejectedButErc20TransfersAccepted() public {
        vm.deal(address(this), 10 ether);
        (bool ok,) = address(vault).call{value: 1e12}("");
        assertFalse(ok, "native value must be rejected");

        // USDC arrives through the ERC-20 interface, which needs no receive() on Arc
        _fund(stranger, 50e6);
        vm.prank(stranger);
        assertTrue(IERC20(USDC).transfer(address(vault), 50e6));
        assertEq(_usdc(address(vault)), FUNDS + 50e6);

        // and it is part of what the owner can sweep
        vm.prank(owner);
        vault.withdrawAll();
        assertEq(_usdc(owner), FUNDS + 50e6);
    }

    function test_fork_strangerCanNotMoveAnything() public {
        vm.startPrank(stranger);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.depositToStrategy(MORPHO, 1e6, 1);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.pay(recipient, 1e6, REF);
        vm.expectRevert();
        vault.withdrawAll();
        vm.stopPrank();
        assertEq(_usdc(address(vault)), FUNDS);
    }
}
