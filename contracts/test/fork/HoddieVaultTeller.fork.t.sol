// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {HoddieVault} from "../../src/HoddieVault.sol";
import {ForkBase, IRolesAuthority, IRealTeller} from "./ForkBase.sol";

/// @notice The vault against Circle's REAL USYC Teller, USYC token and RolesAuthority on Arc
///         Testnet, next to the real Morpho Vault V2. The vault is allowlisted by impersonating
///         the RolesAuthority owner inside the fork. The owner of the "allowlisted" vaults is the
///         user's real wallet, which Circle has allowlisted on chain (its funds are only ever
///         touched inside this local fork). See {ForkBase}.
contract HoddieVaultTellerForkTest is ForkBase {
    bytes4 internal constant NOT_PERMISSIONED = bytes4(keccak256("NotPermissioned()"));
    bytes4 internal constant NO_ACCESS = bytes4(keccak256("NoAccess()"));

    IRealTeller internal teller = IRealTeller(TELLER);

    /// @dev Allowlisted vault, allowlisted owner (the user's real wallet).
    function _allowlistedVault() internal returns (HoddieVault v) {
        v = _newVault(ALLOWLISTED_WALLET);
        _allowlist(address(v), true);
    }

    /// @dev Allowlisted vault, owner that Circle does not know.
    function _vaultWithUnlistedOwner() internal returns (HoddieVault v, address unlistedOwner) {
        unlistedOwner = makeAddr("unlistedOwner");
        v = _newVault(unlistedOwner);
        _allowlist(address(v), true);
    }

    function _depositTeller(HoddieVault v, uint256 amount) internal returns (uint256 shares) {
        (uint256 expected,,) = teller.previewDepositData(address(v), amount);
        vm.prank(operator);
        shares = v.depositToStrategy(TELLER, amount, expected);
    }

    /*//////////////////////////////////////////////////////////////
                         DETECTION AND ENTITLEMENTS
    //////////////////////////////////////////////////////////////*/

    function test_fork_tellerIsTheRealThing() public view {
        assertEq(teller.asset(), USDC);
        assertEq(teller.share(), USYC);
        // the wallet the tests use as owner is allowlisted on chain, a random address is not
        assertEq(uint256(IRolesAuthority(AUTHORITY).getUserRoles(ALLOWLISTED_WALLET)), 1);
        assertTrue(
            IRolesAuthority(AUTHORITY).canCall(ALLOWLISTED_WALLET, TELLER, IERC4626.redeem.selector)
        );
        assertFalse(IRolesAuthority(AUTHORITY).canCall(address(0xdead), TELLER, IERC4626.redeem.selector));
    }

    function test_fork_vaultDetectsTheUsycShareToken() public {
        HoddieVault v = _newVault(ALLOWLISTED_WALLET);
        assertTrue(v.isStrategy(TELLER));
        assertEq(v.shareTokenOf(TELLER), USYC, "the position is the USYC balance");
        assertEq(v.shareTokenOf(MORPHO), MORPHO, "Morpho is its own share token");
    }

    function test_fork_tellerAcceptsOnlyAnAllowlistedVault() public {
        HoddieVault v = _newVault(ALLOWLISTED_WALLET); // not allowlisted yet
        uint256 spentBefore = v.depositSpentLast24h();

        vm.prank(operator);
        vm.expectRevert(NOT_PERMISSIONED);
        v.depositToStrategy(TELLER, 100e6, 1);
        assertEq(IERC20(USDC).allowance(address(v), TELLER), 0, "no allowance left behind");
        assertEq(_usdc(address(v)), FUNDS);
        assertEq(v.depositSpentLast24h(), spentBefore, "the revert gave the budget back");

        // Morpho keeps working for the same vault ...
        vm.prank(operator);
        v.depositToStrategy(MORPHO, 400e6, 1);
        assertGt(_morphoShares(address(v)), 0);

        // ... and every USDC is fully withdrawable by the owner
        vm.prank(ALLOWLISTED_WALLET);
        uint256 ownerBefore = _usdc(ALLOWLISTED_WALLET);
        vm.prank(ALLOWLISTED_WALLET);
        v.withdrawAll();
        assertApproxEqAbs(_usdc(ALLOWLISTED_WALLET) - ownerBefore, FUNDS, 3);
        assertEq(_usdc(address(v)), 0);
        assertEq(_morphoShares(address(v)), 0);
        assertEq(_usyc(address(v)), 0);
    }

    /*//////////////////////////////////////////////////////////////
                               OPERATOR CALLS
    //////////////////////////////////////////////////////////////*/

    function test_fork_operatorDepositsRedeemsAndWithdrawsWithTheRealTeller() public {
        HoddieVault v = _allowlistedVault();
        (uint256 expectedShares, uint256 fee,) = teller.previewDepositData(address(v), 100e6);
        assertEq(fee, 0, "no subscription fee today");

        uint256 shares = _depositTeller(v, 100e6);
        assertEq(shares, expectedShares);
        assertEq(_usyc(address(v)), shares, "USYC sits in the vault");
        assertEq(_usdc(address(v)), FUNDS - 100e6);
        assertEq(IERC20(USDC).allowance(address(v), TELLER), 0, "allowance reset");
        assertEq(v.depositSpentLast24h(), 100e6, "counts against the deposit budget");
        assertEq(_usyc(operator), 0);

        // redeem half back into the vault; the round trip may cost the next-price spread
        (uint256 expectedAssets,,) = teller.previewRedeemData(address(v), shares / 2);
        vm.prank(operator);
        uint256 got = v.redeemFromStrategy(TELLER, shares / 2, expectedAssets);
        assertEq(got, expectedAssets);
        assertEq(_usdc(address(v)), FUNDS - 100e6 + got);
        assertApproxEqRel(got, 50e6, 0.002e18, "within 0.2 % of the deposit (spread)");

        // an exact-assets withdrawal
        (uint256 burn,,) = teller.previewWithdrawData(address(v), 20e6);
        uint256 usycBefore = _usyc(address(v));
        vm.prank(operator);
        uint256 burned = v.withdrawFromStrategy(TELLER, 20e6, burn);
        assertEq(burned, burn);
        assertEq(usycBefore - _usyc(address(v)), burned);
        assertEq(v.depositSpentLast24h(), 100e6, "redemptions are not limited by the vault");
    }

    function test_fork_slippageBoundsAgainstTheRealTeller() public {
        HoddieVault v = _allowlistedVault();
        (uint256 expected,,) = teller.previewDepositData(address(v), 100e6);
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.InsufficientShares.selector, expected, expected + 1)
        );
        v.depositToStrategy(TELLER, 100e6, expected + 1);
        assertEq(_usyc(address(v)), 0, "the revert undid the subscription");

        uint256 shares = _depositTeller(v, 100e6);
        (uint256 worth,,) = teller.previewRedeemData(address(v), shares);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.InsufficientAssets.selector, worth, worth + 1));
        v.redeemFromStrategy(TELLER, shares, worth + 1);

        (uint256 burn,,) = teller.previewWithdrawData(address(v), 30e6);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.SharesExceedMax.selector, burn, burn - 1));
        v.withdrawFromStrategy(TELLER, 30e6, burn - 1);
        assertEq(_usyc(address(v)), shares);
    }

    /*//////////////////////////////////////////////////////////////
                           OWNER EXIT WITH THE TELLER
    //////////////////////////////////////////////////////////////*/

    function test_fork_withdrawAll_allowlistedOwner_usdcStraightToTheOwner() public {
        HoddieVault v = _allowlistedVault();
        vm.startPrank(operator);
        v.depositToStrategy(MORPHO, 600e6, 1);
        vm.stopPrank();
        uint256 shares = _depositTeller(v, 500e6);
        (uint256 expected,,) = teller.previewRedeemData(address(v), shares);

        uint256 ownerUsdcBefore = _usdc(ALLOWLISTED_WALLET);
        uint256 ownerUsycBefore = _usyc(ALLOWLISTED_WALLET);
        vm.prank(ALLOWLISTED_WALLET);
        v.withdrawAll();

        assertEq(_usdc(address(v)), 0);
        assertEq(_usyc(address(v)), 0);
        assertEq(_morphoShares(address(v)), 0);
        assertEq(_usyc(ALLOWLISTED_WALLET), ownerUsycBefore, "USDC, not USYC");
        uint256 gained = _usdc(ALLOWLISTED_WALLET) - ownerUsdcBefore;
        assertApproxEqAbs(gained, (FUNDS - 500e6) + expected, 3, "idle + Morpho + the Teller position");
    }

    function test_fork_withdrawAll_ownerUnknownToCircle_redeemsIntoTheVaultAndForwards() public {
        (HoddieVault v, address unlistedOwner) = _vaultWithUnlistedOwner();
        uint256 shares = _depositTeller(v, 500e6);
        (uint256 expected,,) = teller.previewRedeemData(address(v), shares);

        vm.prank(unlistedOwner);
        v.withdrawAll();

        assertEq(_usdc(address(v)), 0);
        assertEq(_usyc(address(v)), 0);
        assertEq(_usyc(unlistedOwner), 0);
        assertEq(_usdc(unlistedOwner), (FUNDS - 500e6) + expected);
    }

    function test_fork_withdrawAll_vaultRemovedFromTheAllowlist_everythingElseStillComesOut() public {
        HoddieVault v = _allowlistedVault();
        vm.prank(operator);
        v.depositToStrategy(MORPHO, 700e6, 1);
        uint256 shares = _depositTeller(v, 500e6);

        // Circle takes the vault off the allowlist: the USYC is frozen, Morpho and USDC are not
        _allowlist(address(v), false);
        uint256 ownerBefore = _usdc(ALLOWLISTED_WALLET);
        vm.expectEmit(true, false, false, true, address(v));
        emit HoddieVault.StrategyExitFailed(TELLER, shares);
        vm.prank(ALLOWLISTED_WALLET);
        v.withdrawAll();

        assertApproxEqAbs(_usdc(ALLOWLISTED_WALLET) - ownerBefore, FUNDS - 500e6, 3);
        assertEq(_usdc(address(v)), 0);
        assertEq(_morphoShares(address(v)), 0);
        assertEq(_usyc(address(v)), shares, "frozen until Circle allowlists the vault again");

        vm.prank(ALLOWLISTED_WALLET);
        vm.expectRevert(NOT_PERMISSIONED);
        v.rescueToken(IERC20(USYC), shares);

        // allowlisted again: the owner gets the rest
        _allowlist(address(v), true);
        (uint256 expected,,) = teller.previewRedeemData(address(v), shares);
        ownerBefore = _usdc(ALLOWLISTED_WALLET);
        vm.prank(ALLOWLISTED_WALLET);
        v.exitStrategy(TELLER);
        assertEq(_usyc(address(v)), 0);
        assertEq(_usdc(ALLOWLISTED_WALLET) - ownerBefore, expected);
    }

    function test_fork_withdrawAll_dailyRedemptionLimit_partRedeemedRestAsUsyc() public {
        HoddieVault v = _allowlistedVault();
        uint256 shares = _depositTeller(v, 500e6);

        // Circle's fund admin gives the vault a small daily redemption limit (30 USDC)
        vm.prank(IRolesAuthority(AUTHORITY).owner());
        teller.setLimits(address(v), 0, 30e6);
        uint256 maxNow = teller.maxRedeem(address(v));
        assertGt(maxNow, 0);
        assertLt(maxNow, shares);
        (uint256 expected,,) = teller.previewRedeemData(address(v), maxNow);

        uint256 usdcBefore = _usdc(ALLOWLISTED_WALLET);
        uint256 usycBefore = _usyc(ALLOWLISTED_WALLET);
        vm.prank(ALLOWLISTED_WALLET);
        v.withdrawAll();

        assertEq(_usdc(ALLOWLISTED_WALLET) - usdcBefore, (FUNDS - 500e6) + expected);
        assertEq(_usyc(ALLOWLISTED_WALLET) - usycBefore, shares - maxNow, "the rest arrives as USYC");
        assertEq(_usyc(address(v)), 0);
        assertEq(_usdc(address(v)), 0);
    }

    function test_fork_withdrawAll_dailyRedemptionLimit_ownerUnknown_restStaysInTheVault() public {
        (HoddieVault v, address unlistedOwner) = _vaultWithUnlistedOwner();
        uint256 shares = _depositTeller(v, 500e6);
        vm.prank(IRolesAuthority(AUTHORITY).owner());
        teller.setLimits(address(v), 0, 30e6);
        uint256 maxNow = teller.maxRedeem(address(v));
        (uint256 expected,,) = teller.previewRedeemData(address(v), maxNow);

        vm.expectEmit(true, false, false, true, address(v));
        emit HoddieVault.StrategyExitFailed(TELLER, shares - maxNow);
        vm.prank(unlistedOwner);
        v.withdrawAll();

        assertEq(_usdc(unlistedOwner), (FUNDS - 500e6) + expected);
        assertEq(_usyc(address(v)), shares - maxNow, "USYC can not go to a wallet Circle does not know");
        assertEq(_usyc(unlistedOwner), 0);

        // once Circle allowlists the owner the rest can be rescued as tokens
        _allowlist(unlistedOwner, true);
        vm.prank(unlistedOwner);
        v.rescueToken(IERC20(USYC), shares - maxNow);
        assertEq(_usyc(unlistedOwner), shares - maxNow);
    }

    function test_fork_withdrawAll_authorityPaused_doesNotRevert() public {
        HoddieVault v = _allowlistedVault();
        uint256 shares = _depositTeller(v, 300e6);

        // Circle can pause its RolesAuthority: every permission check then reverts with NoAccess
        vm.prank(IRolesAuthority(AUTHORITY).owner());
        IRolesAuthority(AUTHORITY).pause();
        assertTrue(IRolesAuthority(AUTHORITY).paused());

        vm.prank(operator);
        vm.expectRevert(NO_ACCESS);
        v.depositToStrategy(TELLER, 10e6, 1);

        uint256 ownerBefore = _usdc(ALLOWLISTED_WALLET);
        vm.prank(ALLOWLISTED_WALLET);
        v.withdrawAll(); // does not revert
        assertApproxEqAbs(_usdc(ALLOWLISTED_WALLET) - ownerBefore, FUNDS - 300e6, 3);
        assertEq(_usyc(address(v)), shares, "frozen while the authority is paused");
    }

    function test_fork_rescueUsycNeedsAnAllowlistedOwner() public {
        HoddieVault v = _allowlistedVault();
        uint256 shares = _depositTeller(v, 200e6);
        uint256 before = _usyc(ALLOWLISTED_WALLET);
        vm.prank(ALLOWLISTED_WALLET);
        v.rescueToken(IERC20(USYC), shares);
        assertEq(_usyc(ALLOWLISTED_WALLET) - before, shares);
        assertEq(_usyc(address(v)), 0);
    }

    function test_fork_usycPositionIsNeverReachableByTheOperator() public {
        HoddieVault v = _allowlistedVault();
        _depositTeller(v, 200e6);
        vm.startPrank(operator);
        v.redeemFromStrategy(TELLER, _usyc(address(v)) / 2, 1);
        vm.stopPrank();
        assertEq(_usyc(operator), 0);
        assertEq(_usdc(operator), 0);
    }
}
