// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PoolBase} from "./PoolBase.sol";
import {HoddUSYCVault} from "../../src/HoddUSYCVault.sol";
import {ITeller} from "../../src/interfaces/ITeller.sol";
import {IRolesAuthority} from "../../src/interfaces/IRolesAuthority.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockRolesAuthority, MockUSYC, MockTeller} from "../mocks/MockTeller.sol";

/// @dev A token with 18 decimals, to test the constructor's decimals check.
contract Token18 is ERC20 {
    constructor() ERC20("Token18", "T18") {}
}

/// @dev A Teller stand-in that calls back into the pool while it is subscribing, to prove the
///      reentrancy guard. Everything else mirrors the mock closely enough for one deposit.
contract ReentrantTeller {
    address public immutable asset;
    address public immutable share;
    address public pool;
    bytes4 public lastRevert;
    bool public reentered;

    constructor(address asset_, address share_) {
        asset = asset_;
        share = share_;
    }

    function setPool(address pool_) external {
        pool = pool_;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        reentered = true;
        (bool ok, bytes memory ret) = pool.call(abi.encodeCall(HoddUSYCVault.reinvestIdle, ()));
        if (!ok && ret.length >= 4) lastRevert = bytes4(ret);
        IERC20(asset).transferFrom(msg.sender, address(this), assets);
        MockUSYC(share).mint(receiver, assets); // 1:1, enough for the test
        return assets;
    }
}

contract HoddUSYCVaultTest is PoolBase {
    bytes32 internal constant NA = bytes32(0);

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    function test_constructor_setsEverything() public view {
        assertEq(address(pool.usdc()), address(usdc));
        assertEq(address(pool.teller()), address(teller));
        assertEq(address(pool.usyc()), address(usyc));
        assertEq(address(pool.authority()), address(auth));
        assertEq(pool.owner(), admin);
        assertEq(pool.asset(), address(usdc));
        assertEq(pool.name(), "Hodd USYC Pool Share");
        assertEq(pool.symbol(), "hUSYC");
        assertEq(pool.decimals(), 12);
        assertEq(pool.OFFSET(), 6);
        assertEq(pool.totalSupply(), 0);
        assertFalse(pool.depositsPaused());
    }

    function test_constructor_startsWithConservativeCaps() public {
        HoddUSYCVault fresh = new HoddUSYCVault(
            IERC20(address(usdc)),
            ITeller(address(teller)),
            IERC20(address(usyc)),
            IRolesAuthority(address(auth)),
            admin
        );
        assertEq(fresh.maxDepositPerTx(), 1000e6);
        assertEq(fresh.maxTotalAssets(), 100_000e6);
    }

    function test_constructor_revertsOnZeroAddresses() public {
        IERC20 u = IERC20(address(usdc));
        ITeller t = ITeller(address(teller));
        IERC20 y = IERC20(address(usyc));
        IRolesAuthority a = IRolesAuthority(address(auth));
        vm.expectRevert(HoddUSYCVault.ZeroAddress.selector);
        new HoddUSYCVault(IERC20(address(0)), t, y, a, admin);
        vm.expectRevert(HoddUSYCVault.ZeroAddress.selector);
        new HoddUSYCVault(u, ITeller(address(0)), y, a, admin);
        vm.expectRevert(HoddUSYCVault.ZeroAddress.selector);
        new HoddUSYCVault(u, t, IERC20(address(0)), a, admin);
        vm.expectRevert(HoddUSYCVault.ZeroAddress.selector);
        new HoddUSYCVault(u, t, y, IRolesAuthority(address(0)), admin);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new HoddUSYCVault(u, t, y, a, address(0));
    }

    function test_constructor_tellerMustMatchTheTokens() public {
        MockUSDC other = new MockUSDC();
        vm.expectRevert(
            abi.encodeWithSelector(
                HoddUSYCVault.WrongTellerAsset.selector, address(other), address(usdc)
            )
        );
        new HoddUSYCVault(
            IERC20(address(other)),
            ITeller(address(teller)),
            IERC20(address(usyc)),
            IRolesAuthority(address(auth)),
            admin
        );

        MockUSYC otherUsyc = new MockUSYC(auth);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoddUSYCVault.WrongTellerShare.selector, address(otherUsyc), address(usyc)
            )
        );
        new HoddUSYCVault(
            IERC20(address(usdc)),
            ITeller(address(teller)),
            IERC20(address(otherUsyc)),
            IRolesAuthority(address(auth)),
            admin
        );
    }

    function test_constructor_tokensMustHaveSixDecimals() public {
        Token18 wide = new Token18();
        MockTeller wideTeller =
            new MockTeller(IERC20(address(wide)), usyc, auth, treasury, feeRecipient);
        vm.expectRevert(
            abi.encodeWithSelector(HoddUSYCVault.UnexpectedDecimals.selector, address(wide), 18)
        );
        new HoddUSYCVault(
            IERC20(address(wide)),
            ITeller(address(wideTeller)),
            IERC20(address(usyc)),
            IRolesAuthority(address(auth)),
            admin
        );
    }

    /*//////////////////////////////////////////////////////////////
                                 DEPOSIT
    //////////////////////////////////////////////////////////////*/

    function test_deposit_firstDepositMintsUsycTimesTenToTheSixth() public {
        (uint256 expectedUsyc,,) = teller.previewDepositData(address(pool), 100e6);
        assertEq(expectedUsyc, 87_719_298);

        vm.expectEmit(true, true, false, true, address(pool));
        emit IERC4626.Deposit(alice, alice, 100e6, expectedUsyc * 1e6);
        vm.expectEmit(true, true, false, true, address(pool));
        emit HoddUSYCVault.UsycSubscribed(alice, alice, 100e6, expectedUsyc, expectedUsyc * 1e6);
        uint256 shares = _deposit(alice, 100e6);

        assertEq(shares, expectedUsyc * 1e6);
        assertEq(pool.balanceOf(alice), shares);
        assertEq(pool.totalSupply(), shares);
        assertEq(usyc.balanceOf(address(pool)), expectedUsyc, "the pool holds the USYC");
        assertEq(usyc.balanceOf(alice), 0, "the user never holds USYC");
        assertEq(usdc.balanceOf(alice), USER_FUNDS - 100e6);
        assertEq(
            usdc.balanceOf(treasury), 50_000_000e6 + 100e6, "USDC went to the Teller's treasury"
        );
        assertEq(usdc.balanceOf(address(pool)), 0);
        assertEq(usdc.allowance(address(pool), address(teller)), 0, "allowance reset");
    }

    function test_deposit_andReinvest_leaveNoApprovalToTheTeller() public {
        vm.expectCall(address(usdc), abi.encodeCall(IERC20.approve, (address(teller), 100e6)));
        vm.expectCall(address(usdc), abi.encodeCall(IERC20.approve, (address(teller), 0)));
        _deposit(alice, 100e6);

        _donateUsdc(10e6);
        vm.expectCall(address(usdc), abi.encodeCall(IERC20.approve, (address(teller), 10e6)));
        vm.expectCall(address(usdc), abi.encodeCall(IERC20.approve, (address(teller), 0)));
        pool.reinvestIdle();
        assertEq(usdc.allowance(address(pool), address(teller)), 0);
    }

    function test_deposit_sharesGoToTheReceiver() public {
        vm.prank(alice);
        uint256 shares = pool.deposit(100e6, bob);
        assertEq(pool.balanceOf(bob), shares);
        assertEq(pool.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(alice), USER_FUNDS - 100e6, "the payer paid");

        // only the receiver can redeem them, and only to themselves
        vm.prank(alice);
        vm.expectRevert(HoddUSYCVault.RedeemOnlyByAndToTheHolder.selector);
        pool.redeem(shares, alice, bob);
        assertGt(_redeemAll(bob), 0);
    }

    function test_deposit_secondDepositorIsPricedOnTheUsycRatio() public {
        uint256 a = _deposit(alice, 100e6);
        uint256 usycBefore = usyc.balanceOf(address(pool));
        uint256 b = _deposit(bob, 300e6);
        // 3x the money at the same price: 3x the shares (up to rounding)
        assertApproxEqAbs(b, 3 * a, 3e6);
        assertEq(pool.totalSupply(), a + b);
        assertGt(usyc.balanceOf(address(pool)), usycBefore);
    }

    function test_deposit_afterAPriceMoveAUsdcBuysLessUsycButTheSameValue() public {
        _deposit(alice, 100e6);
        teller.configure(1.2e18, 1.2e18, false, 0, 0); // USYC up 5.3 %
        uint256 bobShares = _deposit(bob, 100e6);
        uint256 aliceValue = pool.previewRedeem(pool.balanceOf(alice));
        uint256 bobValue = pool.previewRedeem(bobShares);
        // alice's USYC gained value, bob paid the new price: his value is what he put in
        assertGt(aliceValue, 105e6);
        assertApproxEqAbs(bobValue, 100e6, 2);
    }

    function test_deposit_nextPriceSubscriptionDoesNotDiluteHolders() public {
        // Alice joins at the normal price. After the cut-off the Teller prices subscriptions at
        // the next (higher) price, so Bob gets fewer USYC for the same USDC.
        _deposit(alice, 100e6);
        uint256 aliceClaimBefore = pool.usycOf(pool.balanceOf(alice));
        uint256 aliceValueBefore = pool.previewRedeem(pool.balanceOf(alice));

        teller.configure(1.14e18, 1.16e18, true, 0, 0);
        (uint256 bobUsyc,,) = teller.previewDepositData(address(pool), 100e6);
        uint256 supplyBefore = pool.totalSupply();
        uint256 heldBefore = usyc.balanceOf(address(pool));
        uint256 bobShares = _deposit(bob, 100e6);

        assertEq(
            bobShares,
            (bobUsyc * (supplyBefore + 1e6)) / (heldBefore + 1),
            "shares follow the USYC received"
        );
        // at the next price Bob got fewer USYC than Alice did for the same USDC
        assertLt(bobUsyc, heldBefore);
        // Alice's claim did not move: Bob paid for the spread, not Alice.
        assertApproxEqAbs(pool.usycOf(pool.balanceOf(alice)), aliceClaimBefore, 1);
        assertApproxEqAbs(pool.previewRedeem(pool.balanceOf(alice)), aliceValueBefore, 2);
        // Bob's position, valued at the latest price, is worth less than his deposit
        assertLt(pool.previewRedeem(bobShares), 100e6);
    }

    function test_deposit_slippageOverload() public {
        uint256 expected = pool.previewDeposit(100e6);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoddUSYCVault.InsufficientShares.selector, expected, expected + 1
            )
        );
        pool.deposit(100e6, alice, expected + 1);
        assertEq(usdc.balanceOf(alice), USER_FUNDS, "the revert moved nothing");

        vm.prank(alice);
        uint256 shares = pool.deposit(100e6, alice, expected);
        assertEq(shares, expected);
    }

    function test_deposit_revertsWhenPaused() public {
        vm.prank(admin);
        pool.pauseDeposits();
        vm.prank(alice);
        vm.expectRevert(HoddUSYCVault.DepositsArePaused.selector);
        pool.deposit(100e6, alice);
    }

    function test_deposit_revertsOnZeroAndOnCaps() public {
        vm.startPrank(alice);
        vm.expectRevert(HoddUSYCVault.ZeroAmount.selector);
        pool.deposit(0, alice);
        vm.stopPrank();

        vm.prank(admin);
        pool.setDepositCaps(500e6, 700e6);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HoddUSYCVault.ExceedsMaxDepositPerTx.selector, 500e6 + 1, 500e6)
        );
        pool.deposit(500e6 + 1, alice);

        _deposit(alice, 500e6);
        assertGt(pool.totalAssets(), 499e6);
        vm.prank(bob);
        vm.expectRevert(); // 500 + 300 > 700 in total
        pool.deposit(300e6, bob);
        _deposit(bob, 150e6); // still fits (about 650 of 700)
    }

    function test_deposit_revertsWhenCircleDoesNotPermitThePool() public {
        auth.setUserRole(address(pool), 0, false);
        vm.prank(alice);
        vm.expectRevert(HoddUSYCVault.NotPermittedByCircle.selector);
        pool.deposit(100e6, alice);
        assertEq(usdc.balanceOf(alice), USER_FUNDS);

        auth.setUserRole(address(pool), 0, true);
        auth.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(HoddUSYCVault.NotPermittedByCircle.selector);
        pool.deposit(100e6, alice);

        auth.setPaused(false);
        _deposit(alice, 100e6); // and it works again once Circle restores it
    }

    function test_deposit_tinyAmountThatBuysNoUsycReverts() public {
        vm.prank(alice);
        vm.expectRevert(MockTeller.ZeroShares.selector);
        pool.deposit(1, alice);
    }

    function test_deposit_needsTheUsersApproval() public {
        vm.prank(alice);
        usdc.approve(address(pool), 0);
        vm.prank(alice);
        vm.expectRevert();
        pool.deposit(100e6, alice);
    }

    function test_deposit_subscriptionFeeIsBornByTheDepositor() public {
        teller.configure(1.14e18, 1.14e18, false, 50, 0); // 0.5 % subscription fee
        uint256 shares = _deposit(alice, 1000e6);
        assertEq(usdc.balanceOf(feeRecipient), 5e6);
        assertEq(shares, (uint256(995e6) * 1e18 / 1.14e18) * 1e6);
        assertEq(usdc.allowance(address(pool), address(teller)), 0);
    }

    /*//////////////////////////////////////////////////////////////
                                 REDEEM
    //////////////////////////////////////////////////////////////*/

    function test_redeem_paysUsdcToTheHolderOnly() public {
        uint256 shares = _deposit(alice, 100e6);
        uint256 usycOut = pool.usycOf(shares);
        (uint256 expected,,) = teller.previewRedeemData(address(pool), usycOut);

        vm.expectEmit(true, true, true, true, address(pool));
        emit IERC4626.Withdraw(alice, alice, alice, expected, shares);
        vm.expectEmit(true, false, false, true, address(pool));
        emit HoddUSYCVault.UsycRedeemed(alice, shares, usycOut, expected);
        vm.prank(alice);
        uint256 assets = pool.redeem(shares, alice, alice);

        assertEq(assets, expected);
        assertEq(usdc.balanceOf(alice), USER_FUNDS - 100e6 + assets);
        assertEq(pool.balanceOf(alice), 0);
        assertEq(pool.totalSupply(), 0);
        assertEq(usyc.balanceOf(address(pool)), 0);
        assertEq(usyc.balanceOf(alice), 0, "never USYC");
        assertEq(usdc.balanceOf(address(pool)), 0, "nothing left behind");
        assertApproxEqAbs(assets, 100e6, 2);
    }

    function test_redeem_partialRedeemKeepsTheRestAsAClaim() public {
        uint256 shares = _deposit(alice, 100e6);
        vm.prank(alice);
        uint256 got = pool.redeem(shares / 4, alice, alice);
        assertApproxEqAbs(got, 25e6, 2);
        assertEq(pool.balanceOf(alice), shares - shares / 4);
        assertApproxEqAbs(_redeemAll(alice), 75e6, 2);
    }

    function test_redeem_onlyTheHolderToTheHolder() public {
        uint256 shares = _deposit(alice, 100e6);

        // somebody else can not redeem Alice's shares, not even to Alice
        vm.prank(bob);
        vm.expectRevert(HoddUSYCVault.RedeemOnlyByAndToTheHolder.selector);
        pool.redeem(shares, alice, alice);
        // the admin neither
        vm.prank(admin);
        vm.expectRevert(HoddUSYCVault.RedeemOnlyByAndToTheHolder.selector);
        pool.redeem(shares, alice, alice);
        // Alice can not send the USDC anywhere else
        vm.prank(alice);
        vm.expectRevert(HoddUSYCVault.RedeemOnlyByAndToTheHolder.selector);
        pool.redeem(shares, bob, alice);
        vm.prank(alice);
        vm.expectRevert(HoddUSYCVault.RedeemOnlyByAndToTheHolder.selector);
        pool.redeem(shares, bob, bob);
        vm.prank(alice);
        vm.expectRevert(HoddUSYCVault.RedeemOnlyByAndToTheHolder.selector);
        pool.redeem(shares, bob, alice, 1);
        assertEq(pool.balanceOf(alice), shares);
    }

    function test_redeem_slippageOverload() public {
        uint256 shares = _deposit(alice, 100e6);
        uint256 expected = pool.previewRedeem(shares);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoddUSYCVault.InsufficientAssets.selector, expected, expected + 1
            )
        );
        pool.redeem(shares, alice, alice, expected + 1);
        assertEq(pool.balanceOf(alice), shares, "the revert burned nothing");

        vm.prank(alice);
        assertEq(pool.redeem(shares, alice, alice, expected), expected);
    }

    function test_redeem_zeroAndTooManyShares() public {
        uint256 shares = _deposit(alice, 100e6);
        vm.startPrank(alice);
        vm.expectRevert(HoddUSYCVault.ZeroAmount.selector);
        pool.redeem(0, alice, alice);
        vm.expectRevert(); // ERC20InsufficientBalance
        pool.redeem(shares + 1, alice, alice);
        vm.stopPrank();
        // dust that is worth no USYC reverts instead of burning shares for nothing
        vm.prank(alice);
        vm.expectRevert(HoddUSYCVault.ZeroAssets.selector);
        pool.redeem(1, alice, alice);
        assertEq(pool.balanceOf(alice), shares);
    }

    function test_redeem_neverPausedByTheAdmin() public {
        uint256 shares = _deposit(alice, 100e6);
        vm.startPrank(admin);
        pool.pauseDeposits();
        pool.setDepositCaps(0, 0);
        vm.stopPrank();
        vm.prank(alice);
        assertApproxEqAbs(pool.redeem(shares, alice, alice), 100e6, 2);
    }

    function test_redeem_leavesDonatedIdleUsdcAlone() public {
        uint256 shares = _deposit(alice, 100e6);
        _donateUsdc(40e6);
        vm.prank(alice);
        uint256 got = pool.redeem(shares, alice, alice);
        assertApproxEqAbs(got, 100e6, 2, "the holder gets what the USYC is worth, not the gift");
        assertEq(usdc.balanceOf(address(pool)), 40e6, "the gift stays for the pool");
    }

    function test_redeem_redemptionFeeIsBornByTheHolder() public {
        uint256 shares = _deposit(alice, 100e6);
        teller.configure(1.14e18, 1.14e18, false, 0, 100); // 1 % redemption fee
        vm.prank(alice);
        uint256 got = pool.redeem(shares, alice, alice);
        assertApproxEqAbs(got, 99e6, 2);
        assertGt(usdc.balanceOf(feeRecipient), 0);
        assertEq(usdc.balanceOf(address(pool)), 0);
    }

    function test_redeem_revertsWhileCircleDoesNotPermitThePoolButSharesSurvive() public {
        uint256 shares = _deposit(alice, 100e6);

        auth.setUserRole(address(pool), 0, false);
        vm.prank(alice);
        vm.expectRevert(MockTeller.NotPermissioned.selector);
        pool.redeem(shares, alice, alice);
        assertEq(pool.balanceOf(alice), shares, "still a valid claim");
        assertEq(pool.maxRedeem(alice), 0);

        auth.setUserRole(address(pool), 0, true);
        auth.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(MockRolesAuthority.NoAccess.selector);
        pool.redeem(shares, alice, alice);
        assertEq(pool.balanceOf(alice), shares);

        auth.setPaused(false);
        assertApproxEqAbs(_redeemAll(alice), 100e6, 2);
    }

    function test_redeem_tellerDailyLimitIsSharedAndPartialRedeemWorks() public {
        _deposit(alice, 600e6);
        _deposit(bob, 400e6);
        teller.setLimits(type(uint256).max, 300e6); // 300 USDC per day for the whole pool

        uint256 aliceShares = pool.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(MockTeller.LimitExceeded.selector);
        pool.redeem(aliceShares, alice, alice);

        uint256 max = pool.maxRedeem(alice);
        assertGt(max, 0);
        assertLt(max, aliceShares);
        vm.prank(alice);
        uint256 got = pool.redeem(max, alice, alice);
        assertLe(got, 300e6);

        // the limit is used up for everybody, Bob included
        uint256 bobShares = pool.balanceOf(bob);
        vm.prank(bob);
        vm.expectRevert(MockTeller.LimitExceeded.selector);
        pool.redeem(bobShares, bob, bob);

        vm.warp(block.timestamp + 1 days); // next UTC day: a fresh 300 USDC for the pool
        uint256 bobMax = pool.maxRedeem(bob);
        assertGt(bobMax, 0);
        vm.prank(bob);
        pool.redeem(bobMax, bob, bob);
        teller.setLimits(type(uint256).max, type(uint256).max);
        assertGt(_redeemAll(bob), 0); // the rest
        assertEq(pool.balanceOf(bob), 0);
    }

    function test_redeem_treasuryIlliquidityLimitsMaxRedeem() public {
        _deposit(alice, 500e6);
        uint256 bal = usdc.balanceOf(treasury);
        vm.prank(treasury);
        usdc.transfer(address(0xdead), bal - 200e6);
        uint256 max = pool.maxRedeem(alice);
        assertLt(max, pool.balanceOf(alice));
        vm.prank(alice);
        pool.redeem(max, alice, alice);
    }

    /*//////////////////////////////////////////////////////////////
                          SHARES ARE NOT TRANSFERABLE
    //////////////////////////////////////////////////////////////*/

    function test_shares_cannotBeTransferredOrApproved() public {
        uint256 shares = _deposit(alice, 100e6);
        vm.startPrank(alice);
        vm.expectRevert(HoddUSYCVault.SharesNotTransferable.selector);
        pool.transfer(bob, shares);
        vm.expectRevert(HoddUSYCVault.SharesNotTransferable.selector);
        pool.approve(bob, shares);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(HoddUSYCVault.SharesNotTransferable.selector);
        pool.transferFrom(alice, bob, shares);
        assertEq(pool.allowance(alice, bob), 0);
        assertEq(pool.balanceOf(alice), shares);
    }

    /*//////////////////////////////////////////////////////////////
                         UNSUPPORTED ERC-4626 PARTS
    //////////////////////////////////////////////////////////////*/

    function test_unsupported_mintAndWithdraw() public {
        vm.startPrank(alice);
        vm.expectRevert(HoddUSYCVault.NotSupported.selector);
        pool.mint(1e6, alice);
        vm.expectRevert(HoddUSYCVault.NotSupported.selector);
        pool.withdraw(1e6, alice, alice);
        vm.stopPrank();
        vm.expectRevert(HoddUSYCVault.NotSupported.selector);
        pool.previewMint(1e6);
        vm.expectRevert(HoddUSYCVault.NotSupported.selector);
        pool.previewWithdraw(1e6);
        assertEq(pool.maxMint(alice), 0);
        assertEq(pool.maxWithdraw(alice), 0);
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    function test_views_totalAssetsIsNavPlusIdle() public {
        assertEq(pool.totalAssets(), 0);
        _deposit(alice, 100e6);
        uint256 held = usyc.balanceOf(address(pool));
        assertEq(pool.totalAssets(), teller.convertToAssets(held));
        _donateUsdc(7e6);
        assertEq(pool.totalAssets(), teller.convertToAssets(held) + 7e6);
    }

    function test_views_conversionsFollowTheNav() public {
        _deposit(alice, 100e6);
        uint256 shares = pool.balanceOf(alice);
        assertApproxEqAbs(pool.convertToAssets(shares), 100e6, 2);
        assertApproxEqAbs(pool.convertToShares(100e6), shares, 2e6);
    }

    function test_views_previewDepositNeverOverestimates() public {
        _deposit(alice, 123e6);
        teller.configure(1.17e18, 1.18e18, true, 25, 0);
        uint256 preview = pool.previewDeposit(321e6);
        uint256 actual = _deposit(bob, 321e6);
        assertLe(preview, actual);
        assertApproxEqAbs(preview, actual, 0, "same price, same rounding");
    }

    function test_views_previewRedeemMatchesWhatIsPaid() public {
        uint256 shares = _deposit(alice, 321e6);
        teller.configure(1.19e18, 1.2e18, false, 0, 30);
        uint256 preview = pool.previewRedeem(shares);
        assertEq(_redeemAll(alice), preview);
    }

    function test_views_maxDeposit() public {
        assertEq(pool.maxDeposit(alice), 1_000_000e6); // the per-deposit cap of the fixture

        vm.prank(admin);
        pool.setDepositCaps(1000e6, 1500e6);
        assertEq(pool.maxDeposit(alice), 1000e6);
        _deposit(alice, 800e6);
        assertApproxEqAbs(pool.maxDeposit(alice), 700e6, 5); // room under the pool cap

        teller.setLimits(300e6, type(uint256).max); // 300 USDC subscribed per day (800 already used)
        assertEq(pool.maxDeposit(alice), 0);
        vm.warp(block.timestamp + 1 days);
        assertEq(pool.maxDeposit(alice), 300e6);

        vm.prank(admin);
        pool.pauseDeposits();
        assertEq(pool.maxDeposit(alice), 0);
        vm.prank(admin);
        pool.unpauseDeposits();

        auth.setUserRole(address(pool), 0, false);
        assertEq(pool.maxDeposit(alice), 0, "not allowlisted");
        auth.setUserRole(address(pool), 0, true);
        auth.setPaused(true);
        assertEq(pool.maxDeposit(alice), 0, "authority paused");
        auth.setPaused(false);
        assertEq(pool.maxDeposit(alice), 300e6);
    }

    function test_views_maxRedeem() public {
        assertEq(pool.maxRedeem(alice), 0);
        uint256 shares = _deposit(alice, 100e6);
        assertEq(pool.maxRedeem(alice), shares);
        assertEq(pool.maxRedeem(bob), 0, "bob holds nothing");

        teller.setLimits(type(uint256).max, 40e6);
        uint256 limited = pool.maxRedeem(alice);
        assertGt(limited, 0);
        assertLt(limited, shares);
        assertLe(pool.previewRedeem(limited), 40e6);
    }

    function test_views_neverRevertEvenIfCircleContractsFail() public {
        _deposit(alice, 100e6);
        // the Teller's and the authority's views revert: ours must not
        vm.mockCallRevert(
            address(teller), abi.encodeWithSelector(ITeller.convertToAssets.selector), "x"
        );
        vm.mockCallRevert(
            address(teller), abi.encodeWithSelector(ITeller.previewDepositData.selector), "x"
        );
        vm.mockCallRevert(
            address(teller), abi.encodeWithSelector(ITeller.previewRedeemData.selector), "x"
        );
        vm.mockCallRevert(address(teller), abi.encodeWithSelector(ITeller.maxRedeem.selector), "x");
        vm.mockCallRevert(
            address(teller), abi.encodeWithSelector(ITeller.todayTimestamp.selector), "x"
        );
        vm.mockCallRevert(
            address(teller),
            abi.encodeWithSelector(ITeller.subscriptionLimitRemaining.selector),
            "x"
        );
        vm.mockCallRevert(
            address(auth), abi.encodeWithSelector(IRolesAuthority.canCall.selector), "x"
        );

        assertEq(pool.maxDeposit(alice), 0);
        assertEq(pool.maxRedeem(alice), 0);
        assertEq(pool.previewDeposit(1e6), 0);
        assertEq(pool.previewRedeem(1e6), 0);
        pool.totalAssets();
        pool.convertToAssets(1e18);
        pool.convertToShares(1e6);
        pool.usycOf(1e18);
    }

    /*//////////////////////////////////////////////////////////////
                            IDLE USDC / DONATIONS
    //////////////////////////////////////////////////////////////*/

    function test_reinvestIdle_putsDonatedUsdcToWorkForEveryone() public {
        _deposit(alice, 100e6);
        _deposit(bob, 300e6);
        uint256 supply = pool.totalSupply();
        uint256 aliceBefore = pool.previewRedeem(pool.balanceOf(alice));
        uint256 bobBefore = pool.previewRedeem(pool.balanceOf(bob));

        _donateUsdc(40e6);
        assertEq(usdc.balanceOf(address(pool)), 40e6);
        assertApproxEqAbs(
            pool.previewRedeem(pool.balanceOf(alice)),
            aliceBefore,
            1,
            "idle USDC is not in the share price"
        );

        vm.expectEmit(true, false, false, false, address(pool));
        emit HoddUSYCVault.IdleReinvested(stranger, 40e6, 0);
        vm.prank(stranger); // permissionless
        uint256 usycIn = pool.reinvestIdle();

        assertGt(usycIn, 0);
        assertEq(usdc.balanceOf(address(pool)), 0);
        assertEq(pool.totalSupply(), supply, "no shares are minted");
        // 40 USDC spread pro-rata: alice has 25 %, bob 75 %
        assertApproxEqAbs(pool.previewRedeem(pool.balanceOf(alice)), aliceBefore + 10e6, 3);
        assertApproxEqAbs(pool.previewRedeem(pool.balanceOf(bob)), bobBefore + 30e6, 5);
    }

    function test_reinvestIdle_revertsWithNothingAndWhenTheTellerRefuses() public {
        vm.expectRevert(HoddUSYCVault.NothingToReinvest.selector);
        pool.reinvestIdle();

        _donateUsdc(10e6);
        auth.setUserRole(address(pool), 0, false);
        vm.expectRevert(MockTeller.NotPermissioned.selector);
        pool.reinvestIdle();
        assertEq(usdc.balanceOf(address(pool)), 10e6, "the gift is still there");

        auth.setUserRole(address(pool), 0, true);
        pool.reinvestIdle();
    }

    function test_reinvestIdle_worksWhileDepositsArePaused() public {
        _donateUsdc(10e6);
        vm.prank(admin);
        pool.pauseDeposits();
        assertGt(pool.reinvestIdle(), 0);
    }

    function test_donation_cannotBeStolenByTheNextDepositor() public {
        _deposit(alice, 100e6);
        _donateUsdc(50e6);
        // Bob deposits right after: his shares are priced on the USYC ratio, the idle USDC is not
        // part of it, so he gains nothing from the gift ...
        uint256 bobShares = _deposit(bob, 100e6);
        assertApproxEqAbs(pool.previewRedeem(bobShares), 100e6, 2);
        // ... and when the gift is reinvested it goes to both pro-rata
        pool.reinvestIdle();
        assertApproxEqAbs(pool.previewRedeem(pool.balanceOf(alice)), 125e6, 4);
        assertApproxEqAbs(pool.previewRedeem(pool.balanceOf(bob)), 125e6, 4);
    }

    function test_donation_usycInflationAttackFailsForTheAttacker() public {
        // Attacker (allowlisted) is first in with a minimal deposit, then donates USYC to inflate
        // the share price before a victim deposits.
        usdc.mint(address(this), 10_000e6);
        usdc.approve(address(pool), type(uint256).max);
        auth.setUserRole(address(this), 0, true);
        uint256 attackerShares = pool.deposit(2, address(this)); // buys 1 USYC base unit
        assertGt(attackerShares, 0);
        usdc.approve(address(teller), type(uint256).max);
        uint256 donated = teller.deposit(5000e6, address(this));
        usyc.transfer(address(pool), donated);

        // victim deposits 1,000 USDC
        uint256 victimShares = _deposit(alice, 1000e6);
        assertGt(victimShares, 0, "the virtual shares keep the victim from being rounded to zero");
        // the victim keeps (almost) all of their money ...
        assertApproxEqAbs(pool.previewRedeem(victimShares), 1000e6, 3e6);
        // ... and the attacker's claim is worth no more than the donation + his deposit
        uint256 attackerValue = pool.previewRedeem(attackerShares);
        assertLt(attackerValue, 5001e6);
    }

    /*//////////////////////////////////////////////////////////////
                                    ADMIN
    //////////////////////////////////////////////////////////////*/

    function test_admin_pauseAndCaps_onlyTheAdmin() public {
        vm.startPrank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        pool.pauseDeposits();
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        pool.unpauseDeposits();
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        pool.setDepositCaps(1, 2);
        vm.stopPrank();

        vm.expectEmit(true, false, false, true, address(pool));
        emit HoddUSYCVault.DepositsPaused(admin);
        vm.prank(admin);
        pool.pauseDeposits();
        assertTrue(pool.depositsPaused());

        vm.expectEmit(true, false, false, true, address(pool));
        emit HoddUSYCVault.DepositsUnpaused(admin);
        vm.prank(admin);
        pool.unpauseDeposits();

        vm.expectEmit(false, false, false, true, address(pool));
        emit HoddUSYCVault.DepositCapsUpdated(10e6, 20e6);
        vm.prank(admin);
        pool.setDepositCaps(10e6, 20e6);
        assertEq(pool.maxDepositPerTx(), 10e6);
        assertEq(pool.maxTotalAssets(), 20e6);
    }

    function test_admin_cannotTouchAnyonesFunds() public {
        uint256 shares = _deposit(alice, 100e6);
        uint256 held = usyc.balanceOf(address(pool));
        vm.startPrank(admin);
        pool.pauseDeposits();
        pool.setDepositCaps(0, 0);
        pool.unpauseDeposits();
        vm.stopPrank();

        // nothing the admin can call changes a balance or a claim
        assertEq(usyc.balanceOf(address(pool)), held);
        assertEq(pool.balanceOf(alice), shares);
        assertEq(usdc.balanceOf(admin), 0);
        assertEq(usyc.balanceOf(admin), 0);
        // and it can not redeem or transfer them
        vm.startPrank(admin);
        vm.expectRevert(HoddUSYCVault.RedeemOnlyByAndToTheHolder.selector);
        pool.redeem(shares, admin, alice);
        vm.expectRevert(HoddUSYCVault.SharesNotTransferable.selector);
        pool.transferFrom(alice, admin, shares);
        vm.stopPrank();
    }

    function test_admin_twoStepOwnershipAndNoRenounce() public {
        address next = makeAddr("next");
        vm.prank(admin);
        pool.transferOwnership(next);
        assertEq(pool.owner(), admin);
        vm.prank(next);
        pool.acceptOwnership();
        assertEq(pool.owner(), next);

        vm.prank(next);
        vm.expectRevert(HoddUSYCVault.RenounceDisabled.selector);
        pool.renounceOwnership();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, admin));
        pool.pauseDeposits();
    }

    function test_admin_capsOnlyLimitNewDepositsNeverRedemptions() public {
        uint256 shares = _deposit(alice, 500e6);
        vm.prank(admin);
        pool.setDepositCaps(1, 1); // far below the pool's size
        vm.prank(alice);
        vm.expectRevert();
        pool.deposit(1e6, alice);
        vm.prank(alice);
        assertApproxEqAbs(pool.redeem(shares, alice, alice), 500e6, 2);
    }

    /*//////////////////////////////////////////////////////////////
                                REENTRANCY
    //////////////////////////////////////////////////////////////*/

    function test_reentrancy_theTellerCanNotCallBackIntoThePool() public {
        ReentrantTeller evil = new ReentrantTeller(address(usdc), address(usyc));
        usyc.setMinter(address(evil), true);
        auth.setUserRole(address(evil), 0, true);
        HoddUSYCVault p = new HoddUSYCVault(
            IERC20(address(usdc)),
            ITeller(address(evil)),
            IERC20(address(usyc)),
            IRolesAuthority(address(auth)),
            admin
        );
        evil.setPool(address(p));
        auth.setUserRole(address(p), 0, true);
        vm.prank(admin);
        p.setDepositCaps(1_000_000e6, 1_000_000e6);
        usdc.mint(address(p), 5e6); // idle USDC, so reinvestIdle has something to do
        vm.prank(alice);
        usdc.approve(address(p), type(uint256).max);

        vm.prank(alice);
        p.deposit(100e6, alice);

        assertTrue(evil.reentered());
        assertEq(evil.lastRevert(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    /*//////////////////////////////////////////////////////////////
                              ERC-4626 SHAPE
    //////////////////////////////////////////////////////////////*/

    function test_erc4626_interfaceIsComplete() public view {
        IERC4626 asVault = IERC4626(address(pool));
        assertEq(asVault.asset(), address(usdc));
        asVault.totalAssets();
        asVault.convertToShares(1);
        asVault.convertToAssets(1);
        asVault.maxDeposit(alice);
        asVault.maxRedeem(alice);
        asVault.previewDeposit(1e6);
        asVault.previewRedeem(1);
    }

    function test_bytecodeStaysBelowEip170() public view {
        assertLt(address(pool).code.length, 24_576);
    }
}
