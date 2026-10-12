// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Base} from "./Base.t.sol";
import {HoddieVault} from "../src/HoddieVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockStrategy} from "./mocks/MockStrategy.sol";
import {HostileStrategy} from "./mocks/HostileStrategy.sol";
import {ShareLiar} from "./mocks/ShareLiar.sol";
import {MockRolesAuthority, MockUSYC, MockTeller} from "./mocks/MockTeller.sol";

/// @dev The vault against a permissioned "teller" strategy: a separate share token (USYC), an
///      allowlist that must contain the vault (and the owner), a daily redemption limit and a
///      treasury that pays redemptions. The mock reproduces the checks of Circle's real contracts.
contract HoddieVaultTellerTest is Base {
    MockRolesAuthority internal auth;
    MockUSYC internal usyc;
    MockTeller internal teller;
    address internal treasury = makeAddr("treasury");
    address internal feeRecipient = makeAddr("feeRecipient");

    function setUp() public override {
        super.setUp();
        auth = new MockRolesAuthority();
        usyc = new MockUSYC(auth);
        teller = new MockTeller(IERC20(address(usdc)), usyc, auth, treasury, feeRecipient);
        usyc.setMinter(address(teller), true);
        usdc.mint(treasury, 5_000_000e6);
        vm.prank(treasury);
        usdc.approve(address(teller), type(uint256).max);

        address[] memory list = new address[](2);
        list[0] = address(strat);
        list[1] = address(teller);
        vault = _newVault(owner, operator, list);
        usdc.mint(address(vault), FUNDS);

        // Circle has allowlisted the vault and the owner
        auth.setUserRole(address(vault), 0, true);
        auth.setUserRole(owner, 0, true);
    }

    /*//////////////////////////////////////////////////////////////
                                 HELPERS
    //////////////////////////////////////////////////////////////*/

    function _deposit(uint256 amount) internal returns (uint256 shares) {
        vm.prank(operator);
        shares = vault.depositToStrategy(address(teller), amount);
    }

    function _previewAssets(uint256 shares) internal view returns (uint256 assets) {
        (assets,,) = teller.previewRedeemData(address(vault), shares);
    }

    function _vaultUsyc() internal view returns (uint256) {
        return usyc.balanceOf(address(vault));
    }

    /*//////////////////////////////////////////////////////////////
                           SHARE TOKEN DETECTION
    //////////////////////////////////////////////////////////////*/

    function test_detect_tellerHasSeparateShareToken_plainVaultIsItsOwn() public view {
        assertEq(vault.shareTokenOf(address(teller)), address(usyc));
        assertEq(vault.shareTokenOf(address(strat)), address(strat));
        // an address that was never allowlisted is probed live
        assertEq(vault.shareTokenOf(address(strat2)), address(strat2));
    }

    function test_detect_allowStrategyStoresAndEmitsTheShareToken() public {
        MockTeller second =
            new MockTeller(IERC20(address(usdc)), usyc, auth, treasury, feeRecipient);
        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.StrategyAllowed(address(second));
        vm.expectEmit(true, true, false, true, address(vault));
        emit HoddieVault.ShareTokenSet(address(second), address(usyc));
        vm.prank(owner);
        vault.allowStrategy(address(second));
        assertEq(vault.shareTokenOf(address(second)), address(usyc));

        vm.expectEmit(true, true, false, true, address(vault));
        emit HoddieVault.ShareTokenSet(address(strat2), address(strat2));
        vm.prank(owner);
        vault.allowStrategy(address(strat2));
    }

    function test_detect_constructorAlsoDetects() public {
        address[] memory list = new address[](2);
        list[0] = address(teller);
        list[1] = address(strat);
        HoddieVault v = _newVault(owner, operator, list);
        assertEq(v.shareTokenOf(address(teller)), address(usyc));
        assertEq(v.shareTokenOf(address(strat)), address(strat));
    }

    function test_detect_tellerOverAnotherAssetIsRejected() public {
        MockUSDC other = new MockUSDC();
        MockTeller foreign = new MockTeller(
            IERC20(address(other)), new MockUSYC(auth), auth, treasury, feeRecipient
        );
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.InvalidStrategy.selector, address(foreign))
        );
        vault.allowStrategy(address(foreign));
    }

    function test_detect_oddShareAnswersFallBackToTheStrategyItself() public {
        ShareLiar liar = new ShareLiar(address(usdc), address(0));
        address[] memory answers = new address[](4);
        answers[0] = address(0); // nothing
        answers[1] = makeAddr("eoa"); // no code
        answers[2] = address(usdc); // the vault's own asset
        answers[3] = address(vault); // the vault itself
        for (uint256 i; i < answers.length; ++i) {
            ShareLiar l = new ShareLiar(address(usdc), answers[i]);
            vm.prank(owner);
            vault.allowStrategy(address(l));
            assertEq(vault.shareTokenOf(address(l)), address(l), "falls back to the strategy");
        }
        // a real contract is accepted
        liar.setAnswer(address(usyc));
        vm.prank(owner);
        vault.allowStrategy(address(liar));
        assertEq(vault.shareTokenOf(address(liar)), address(usyc));
    }

    function test_detect_probeIsGasCapped() public {
        HostileStrategy burner = new HostileStrategy(address(usdc), HostileStrategy.Mode.BURN);
        uint256 before = gasleft();
        vm.prank(owner);
        vault.allowStrategy(address(burner));
        uint256 used = before - gasleft();
        // the burner swallows everything it is given: the cap (50k) keeps allowStrategy cheap
        assertLt(used, 200_000);
        assertEq(vault.shareTokenOf(address(burner)), address(burner));
    }

    function test_detect_otherHostileAnswersAreHarmless() public {
        HostileStrategy.Mode[5] memory modes = [
            HostileStrategy.Mode.REVERT,
            HostileStrategy.Mode.EMPTY,
            HostileStrategy.Mode.SHORT,
            HostileStrategy.Mode.HUGE,
            HostileStrategy.Mode.ZERO
        ];
        for (uint256 i; i < modes.length; ++i) {
            HostileStrategy h = new HostileStrategy(address(usdc), modes[i]);
            vm.prank(owner);
            vault.allowStrategy(address(h));
            assertEq(vault.shareTokenOf(address(h)), address(h));
            vm.prank(owner);
            vault.disallowStrategy(address(h));
        }
    }

    function test_detect_removedTellerKeepsItsShareToken() public {
        vm.prank(owner);
        vault.disallowStrategy(address(teller));
        assertEq(vault.shareTokenOf(address(teller)), address(usyc));
    }

    /*//////////////////////////////////////////////////////////////
                        OPERATOR: DEPOSIT / WITHDRAW / REDEEM
    //////////////////////////////////////////////////////////////*/

    function test_deposit_buysUsycForTheVault() public {
        (uint256 expected,,) = teller.previewDepositData(address(vault), 600e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.DepositedToStrategy(address(teller), 600e6, expected);
        uint256 shares = _deposit(600e6);

        assertEq(shares, expected);
        assertEq(_vaultUsyc(), shares, "USYC sits in the vault");
        assertEq(usyc.balanceOf(operator), 0);
        assertEq(usdc.balanceOf(address(vault)), FUNDS - 600e6);
        assertEq(
            usdc.balanceOf(treasury), 5_000_000e6 + 600e6, "USDC went to the Teller's treasury"
        );
        assertEq(usdc.allowance(address(vault), address(teller)), 0, "allowance reset");
        assertEq(vault.spentToday(), 600e6, "counts against the limits");
    }

    function test_deposit_chargesTheFeeInsideTheApprovedAmount() public {
        teller.configure(1.14e18, 1.14e18, false, 50, 0); // 0.5 % subscription fee
        uint256 shares = _deposit(1000e6);
        assertEq(usdc.balanceOf(feeRecipient), 5e6);
        assertEq(usdc.balanceOf(address(vault)), FUNDS - 1000e6, "exactly the approved amount left");
        assertEq(shares, (uint256(995e6) * 1e18) / 1.14e18);
        assertEq(usdc.allowance(address(vault), address(teller)), 0);
    }

    function test_deposit_revertsWhenTheVaultIsNotAllowlisted() public {
        auth.setUserRole(address(vault), 0, false);
        vm.prank(operator);
        vm.expectRevert(MockTeller.NotPermissioned.selector);
        vault.depositToStrategy(address(teller), 100e6);

        assertEq(usdc.allowance(address(vault), address(teller)), 0, "nothing left approved");
        assertEq(usdc.balanceOf(address(vault)), FUNDS);
        assertEq(vault.spentToday(), 0, "the budget was not consumed");

        // once Circle allowlists the vault the same call works
        auth.setUserRole(address(vault), 0, true);
        _deposit(100e6);
    }

    function test_deposit_revertsWhenTheAuthorityIsPaused() public {
        auth.setPaused(true);
        vm.prank(operator);
        vm.expectRevert(MockRolesAuthority.NoAccess.selector);
        vault.depositToStrategy(address(teller), 100e6);
    }

    function test_deposit_respectsTheVaultLimitsAndAccess() public {
        vm.startPrank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.ExceedsMaxPerTx.selector, MAX_TX + 1, MAX_TX)
        );
        vault.depositToStrategy(address(teller), MAX_TX + 1);
        vault.depositToStrategy(address(teller), MAX_TX);
        vault.depositToStrategy(address(teller), MAX_TX);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.ExceedsDailyLimit.selector, 3000e6, DAILY)
        );
        vault.depositToStrategy(address(teller), MAX_TX);
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.depositToStrategy(address(teller), 1e6);
        vm.prank(owner);
        vault.pause();
        vm.prank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.depositToStrategy(address(teller), 1e6);
    }

    function test_withdraw_exactAssetsBackIntoTheVault() public {
        uint256 shares = _deposit(800e6);
        (uint256 burn,,) = teller.previewWithdrawData(address(vault), 300e6);

        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.WithdrawnFromStrategy(address(teller), 300e6, burn);
        vm.prank(operator);
        uint256 burned = vault.withdrawFromStrategy(address(teller), 300e6);

        assertEq(burned, burn);
        assertEq(_vaultUsyc(), shares - burn);
        assertEq(usdc.balanceOf(address(vault)), FUNDS - 800e6 + 300e6);
        assertEq(usdc.balanceOf(operator), 0);
        assertEq(usdc.balanceOf(owner), 0);
    }

    function test_redeem_backIntoTheVault_withAFee() public {
        teller.configure(1.14e18, 1.14e18, false, 0, 100); // 1 % redemption fee
        uint256 shares = _deposit(900e6);
        (uint256 expected, uint256 fee,) = teller.previewRedeemData(address(vault), shares / 2);

        vm.prank(operator);
        uint256 got = vault.redeemFromStrategy(address(teller), shares / 2);

        assertEq(got, expected);
        assertGt(fee, 0);
        assertEq(usdc.balanceOf(feeRecipient), fee);
        assertEq(usdc.balanceOf(address(vault)), FUNDS - 900e6 + expected);
        assertEq(_vaultUsyc(), shares - shares / 2);
    }

    function test_redeem_needsTheVaultToBeAllowlisted() public {
        uint256 shares = _deposit(500e6);
        auth.setUserRole(address(vault), 0, false);
        vm.prank(operator);
        vm.expectRevert(MockTeller.NotPermissioned.selector);
        vault.redeemFromStrategy(address(teller), shares);
        vm.prank(operator);
        vm.expectRevert(MockTeller.NotPermissioned.selector);
        vault.withdrawFromStrategy(address(teller), 1e6);
        assertEq(_vaultUsyc(), shares);
    }

    function test_redeem_isNotLimitedByTheVaultButByTheTellersDailyLimit() public {
        uint256 shares = _deposit(MAX_TX);
        _deposit(MAX_TX);
        shares = _vaultUsyc();
        // the vault's own budget is used up, yet redemptions are unlimited ...
        teller.setLimits(type(uint256).max, 500e6);
        // ... but the Teller only lets 500 USDC per day through
        vm.startPrank(operator);
        vault.withdrawFromStrategy(address(teller), 400e6);
        vm.expectRevert(MockTeller.LimitExceeded.selector);
        vault.withdrawFromStrategy(address(teller), 200e6);
        vault.withdrawFromStrategy(address(teller), 100e6);
        vm.expectRevert(MockTeller.LimitExceeded.selector);
        vault.redeemFromStrategy(address(teller), shares / 4);
        vm.stopPrank();

        // the next UTC day has a fresh allowance
        vm.warp(block.timestamp + 1 days);
        vm.prank(operator);
        vault.withdrawFromStrategy(address(teller), 500e6);
    }

    function test_roundTrip_costsTheNextPriceSpread() public {
        // Subscriptions are priced at the next price when the oracle price is stale (or after the
        // cut-off): an immediate redemption at the latest price returns slightly less.
        teller.configure(1.139744e18, 1.140213e18, true, 0, 0);
        uint256 shares = _deposit(100e6);
        vm.prank(operator);
        uint256 back = vault.redeemFromStrategy(address(teller), shares);
        assertLt(back, 100e6);
        assertGt(back, 99_900_000, "a few basis points, not more");
        assertEq(usdc.balanceOf(address(vault)), FUNDS - 100e6 + back);
    }

    /*//////////////////////////////////////////////////////////////
                           withdrawAll / exitStrategy
    //////////////////////////////////////////////////////////////*/

    function test_withdrawAll_ownerAllowlisted_usdcGoesStraightToTheOwner() public {
        uint256 shares = _deposit(900e6);
        uint256 expected = _previewAssets(shares);

        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.StrategyExited(address(teller), shares, expected, 0);
        vm.prank(owner);
        vault.withdrawAll();

        assertEq(usdc.balanceOf(owner), FUNDS - 900e6 + expected);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(_vaultUsyc(), 0);
        assertEq(usyc.balanceOf(owner), 0, "USDC, not USYC");
    }

    function test_withdrawAll_ownerNotAllowlisted_redeemsToTheVaultAndForwards() public {
        auth.setUserRole(owner, 0, false);
        uint256 shares = _deposit(900e6);
        uint256 expected = _previewAssets(shares);

        vm.prank(owner);
        vault.withdrawAll();

        assertEq(usdc.balanceOf(owner), FUNDS - 900e6 + expected, "owner still gets all USDC");
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(_vaultUsyc(), 0);
    }

    function test_exitStrategy_ownerNotAllowlisted_forwardsOnlyWhatWasRedeemed() public {
        auth.setUserRole(owner, 0, false);
        uint256 shares = _deposit(900e6);
        uint256 expected = _previewAssets(shares);

        vm.prank(owner);
        vault.exitStrategy(address(teller));

        assertEq(usdc.balanceOf(owner), expected, "only the redeemed USDC, not the idle USDC");
        assertEq(usdc.balanceOf(address(vault)), FUNDS - 900e6, "idle USDC untouched");
        assertEq(_vaultUsyc(), 0);
    }

    function test_withdrawAll_vaultNotAllowlisted_everythingElseStillComesOut() public {
        _depositAs(address(strat), 700e6);
        uint256 shares = _deposit(500e6);
        // Circle takes the vault off the allowlist: the USYC is frozen
        auth.setUserRole(address(vault), 0, false);

        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.StrategyExitFailed(address(teller), shares);
        vm.prank(owner);
        vault.withdrawAll();

        assertEq(usdc.balanceOf(owner), FUNDS - 500e6, "idle USDC and the Morpho-style position");
        assertEq(strat.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(_vaultUsyc(), shares, "USYC frozen in the vault");

        // the owner can not move it either ...
        vm.prank(owner);
        vm.expectRevert(MockUSYC.NotPermissioned.selector);
        vault.rescueToken(IERC20(address(usyc)), shares);

        // ... until Circle allowlists the vault again
        auth.setUserRole(address(vault), 0, true);
        vm.prank(owner);
        vault.exitStrategy(address(teller));
        assertEq(_vaultUsyc(), 0);
        assertEq(usdc.balanceOf(owner), FUNDS - 500e6 + _previewAssetsAfter(shares));
    }

    function _previewAssetsAfter(uint256 shares) internal view returns (uint256) {
        (uint256 assets,,) = teller.previewRedeemData(address(vault), shares);
        return assets;
    }

    function test_withdrawAll_authorityPaused_doesNotRevertAndReturnsTheRest() public {
        uint256 shares = _deposit(500e6);
        auth.setPaused(true);
        vm.prank(owner);
        vault.withdrawAll();
        assertEq(usdc.balanceOf(owner), FUNDS - 500e6);
        assertEq(_vaultUsyc(), shares);
    }

    function test_withdrawAll_dailyLimit_redeemsPartAndSendsTheRestAsUsyc() public {
        uint256 shares = _deposit(MAX_TX);
        teller.setLimits(type(uint256).max, 400e6);
        uint256 maxNow = teller.maxRedeem(address(vault));
        assertGt(maxNow, 0);
        assertLt(maxNow, shares);
        uint256 expected = _previewAssets(maxNow);

        vm.prank(owner);
        vault.withdrawAll();

        assertEq(usdc.balanceOf(owner), FUNDS - MAX_TX + expected);
        assertEq(usyc.balanceOf(owner), shares - maxNow, "the rest arrives as USYC tokens");
        assertEq(_vaultUsyc(), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);

        // the owner finishes the job from their own (allowlisted) wallet the next day
        vm.warp(block.timestamp + 1 days);
        teller.setLimits(type(uint256).max, type(uint256).max);
        vm.prank(owner);
        teller.redeem(shares - maxNow, owner, owner);
        assertApproxEqAbs(usdc.balanceOf(owner), FUNDS, 2);
    }

    function test_withdrawAll_dailyLimit_ownerNotAllowlisted_restStaysUntilTheyAre() public {
        auth.setUserRole(owner, 0, false);
        uint256 shares = _deposit(MAX_TX);
        teller.setLimits(type(uint256).max, 400e6);
        uint256 maxNow = teller.maxRedeem(address(vault));
        uint256 expected = _previewAssets(maxNow);

        vm.expectEmit(true, false, false, true, address(vault));
        emit HoddieVault.StrategyExitFailed(address(teller), shares - maxNow);
        vm.prank(owner);
        vault.withdrawAll();

        assertEq(usdc.balanceOf(owner), FUNDS - MAX_TX + expected, "partial USDC via the vault");
        assertEq(_vaultUsyc(), shares - maxNow, "USYC can not go to a non-allowlisted owner");
        assertEq(usyc.balanceOf(owner), 0);

        // next day, owner still not allowlisted: the rest is redeemed into the vault and forwarded
        vm.warp(block.timestamp + 1 days);
        teller.setLimits(type(uint256).max, type(uint256).max);
        vm.prank(owner);
        vault.exitStrategy(address(teller));
        assertEq(_vaultUsyc(), 0);
        assertApproxEqAbs(usdc.balanceOf(owner), FUNDS, 2);
    }

    function test_withdrawAll_treasuryIlliquid_partial() public {
        uint256 shares = _deposit(MAX_TX);
        // the treasury only holds 300 USDC right now
        uint256 bal = usdc.balanceOf(treasury);
        vm.prank(treasury);
        usdc.transfer(address(0xdead), bal - 300e6);
        uint256 maxNow = teller.maxRedeem(address(vault));
        assertLt(maxNow, shares);

        vm.prank(owner);
        vault.withdrawAll();

        assertEq(usdc.balanceOf(owner), FUNDS - MAX_TX + _previewAssetsAfter(maxNow));
        assertEq(usyc.balanceOf(owner), shares - maxNow);
        assertEq(_vaultUsyc(), 0);
    }

    function test_withdrawAll_tellerWithFees() public {
        teller.configure(1.14e18, 1.14e18, false, 25, 40);
        uint256 shares = _deposit(MAX_TX);
        uint256 expected = _previewAssets(shares);
        vm.prank(owner);
        vault.withdrawAll();
        assertEq(usdc.balanceOf(owner), FUNDS - MAX_TX + expected);
        assertEq(_vaultUsyc(), 0);
    }

    function test_withdrawAll_tellerWithNothingHeldIsANoop() public {
        vm.prank(owner);
        vault.withdrawAll();
        assertEq(usdc.balanceOf(owner), FUNDS);
    }

    function test_exitStrategy_afterDisallow_usesTheStoredShareToken() public {
        uint256 shares = _deposit(600e6);
        vm.startPrank(owner);
        vault.disallowStrategy(address(teller));
        // withdrawAll no longer visits it ...
        vault.withdrawAll();
        assertEq(_vaultUsyc(), shares);
        // ... but exitStrategy still reaches the USYC through the stored share token
        vault.exitStrategy(address(teller));
        vm.stopPrank();
        assertEq(_vaultUsyc(), 0);
        assertEq(usdc.balanceOf(owner), FUNDS - 600e6 + _previewAssetsAfter(shares));
    }

    function test_rescueToken_usyc_needsBothPartiesAllowlisted() public {
        uint256 shares = _deposit(300e6);
        auth.setUserRole(owner, 0, false);
        vm.prank(owner);
        vm.expectRevert(MockUSYC.NotPermissioned.selector);
        vault.rescueToken(IERC20(address(usyc)), shares);

        auth.setUserRole(owner, 0, true);
        vm.prank(owner);
        vault.rescueToken(IERC20(address(usyc)), shares);
        assertEq(usyc.balanceOf(owner), shares);
    }

    function test_withdrawAll_tellerNextToAPlainVault() public {
        _depositAs(address(strat), 400e6);
        _deposit(600e6);
        uint256 usycShares = _vaultUsyc();
        uint256 expected = _previewAssets(usycShares);
        vm.prank(owner);
        vault.withdrawAll();
        assertEq(usdc.balanceOf(owner), FUNDS - 600e6 + expected);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertEq(strat.balanceOf(address(vault)), 0);
        assertEq(_vaultUsyc(), 0);
    }

    function test_operatorCanNeverSteerUsycOrUsdcToItself() public {
        _deposit(500e6);
        vm.startPrank(operator);
        vault.redeemFromStrategy(address(teller), _vaultUsyc() / 2);
        vault.withdrawFromStrategy(address(teller), 50e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(operator), 0);
        assertEq(usyc.balanceOf(operator), 0);
    }

    /*//////////////////////////////////////////////////////////////
                                    FUZZ
    //////////////////////////////////////////////////////////////*/

    function testFuzz_roundTrip_neverCreatesValue(
        uint256 amount,
        uint256 priceBps,
        uint256 nextBps,
        uint256 depositFee,
        uint256 redeemFee
    ) public {
        amount = bound(amount, 1e6, MAX_TX);
        uint256 p = 1e18 + bound(priceBps, 0, 3000) * 1e14; // 1.00 .. 1.30
        uint256 np = p + bound(nextBps, 0, 50) * 1e14; // next price at most 0.5 % higher
        teller.configure(p, np, true, bound(depositFee, 0, 100), bound(redeemFee, 0, 100));

        uint256 totalBefore = usdc.balanceOf(address(vault)) + usdc.balanceOf(treasury)
            + usdc.balanceOf(feeRecipient);
        uint256 shares = _deposit(amount);
        vm.prank(operator);
        uint256 back = vault.redeemFromStrategy(address(teller), shares);

        assertLe(back, amount, "a round trip never returns more than was put in");
        uint256 totalAfter = usdc.balanceOf(address(vault)) + usdc.balanceOf(treasury)
            + usdc.balanceOf(feeRecipient);
        assertEq(totalAfter, totalBefore, "USDC is only moved around");
    }

    /// Whatever the allowlist, the limits, the treasury and the authority look like, the owner's
    /// withdrawAll never reverts, empties the vault of USDC and only ever pays the owner.
    function testFuzz_withdrawAll_neverRevertsAndPaysOnlyTheOwner(
        bool vaultAllowed,
        bool ownerAllowed,
        bool authorityPaused,
        uint256 limitSeed,
        uint256 treasurySeed,
        uint256 depositSeed,
        uint256 feeSeed
    ) public {
        teller.configure(1.14e18, 1.1405e18, false, 0, bound(feeSeed, 0, 100));
        uint256 shares = _deposit(bound(depositSeed, 1e6, MAX_TX));
        _depositAs(address(strat), 100e6);
        uint256 idleBefore = usdc.balanceOf(address(vault));

        auth.setUserRole(address(vault), 0, vaultAllowed);
        auth.setUserRole(owner, 0, ownerAllowed);
        teller.setLimits(type(uint256).max, bound(limitSeed, 0, 1500e6));
        uint256 bal = usdc.balanceOf(treasury);
        uint256 keep = bound(treasurySeed, 0, 2000e6);
        if (bal > keep) {
            vm.prank(treasury);
            usdc.transfer(address(0xdead), bal - keep);
        }
        auth.setPaused(authorityPaused);

        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 supplyBefore = usdc.totalSupply();
        vm.prank(owner);
        vault.withdrawAll(); // must not revert

        assertEq(usdc.balanceOf(address(vault)), 0, "no USDC left in the vault");
        assertEq(strat.balanceOf(address(vault)), 0, "the plain vault is always fully exited");
        assertEq(usdc.totalSupply(), supplyBefore);
        uint256 gained = usdc.balanceOf(owner) - ownerBefore;
        // idle USDC and the plain position (100 USDC, exact) always arrive
        assertGe(gained, idleBefore + 100e6);

        uint256 vaultLeft = _vaultUsyc();
        uint256 ownerShares = usyc.balanceOf(owner);
        assertLe(vaultLeft + ownerShares, shares, "USYC is only ever burned or moved to the owner");
        if (!vaultAllowed || authorityPaused) {
            assertEq(vaultLeft, shares, "frozen USYC does not move");
            assertEq(ownerShares, 0);
            assertEq(gained, idleBefore + 100e6, "and pays nothing from the Teller");
        }
        if (vaultAllowed && !authorityPaused && ownerAllowed) {
            assertEq(vaultLeft, 0, "with both allowlisted nothing is left in the vault");
        }
        if (vaultAllowed && !authorityPaused && !ownerAllowed) {
            assertEq(ownerShares, 0, "USYC never goes to a non-allowlisted owner");
        }
    }
}
