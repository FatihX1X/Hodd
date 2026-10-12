// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {HoddieVault} from "../../src/HoddieVault.sol";
import {HoddieVaultFactory} from "../../src/HoddieVaultFactory.sol";
import {ArcNativeCoinMock, ArcBlocklistMock} from "./ArcNativeCoinMock.sol";

/// @notice Runs the vault against the REAL Arc Testnet USDC token and the REAL allowlisted Morpho
///         Vault V2. Skipped unless a fork is active:
///
///         forge test --fork-url https://rpc.testnet.arc.network --match-contract Fork
///
/// @dev Stock Foundry runs a plain EVM. The real USDC delegates its balance bookkeeping to Arc's
///      native-coin precompile (0x1800...0000) and consults the blocklist precompile
///      (0x1800...0001), which the plain EVM does not have, so the test installs small stand-ins
///      there (`ArcNativeCoinMock`, `ArcBlocklistMock`). Everything else (USDC proxy and implementation,
///      Morpho vault, adapter, markets) is the live on-chain code and state. USDC "balance" on Arc
///      is the native balance / 1e12, so funding is done with `vm.deal` (Foundry's ERC-20 `deal`
///      can not find a storage slot for a token without balance storage).
contract HoddieVaultForkTest is Test {
    uint256 internal constant ARC_TESTNET = 5_042_002;
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant MORPHO = 0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88;
    address internal constant NATIVE_COIN_PRECOMPILE = 0x1800000000000000000000000000000000000000;
    address internal constant BLOCKLIST_PRECOMPILE = 0x1800000000000000000000000000000000000001;

    uint256 internal constant OWNER_PK = 0xA11CE;
    uint256 internal constant MAX_TX = 1000e6;
    uint256 internal constant DAILY = 2500e6;
    uint256 internal constant FUNDS = 3000e6;
    bytes32 internal constant REF = keccak256("invoice-2026-10-001");

    HoddieVaultFactory internal factory;
    HoddieVault internal vault;
    address internal owner;
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");
    address internal recipient = makeAddr("recipient");

    function setUp() public {
        if (block.chainid != ARC_TESTNET) {
            vm.skip(true); // no fork given: skip cleanly
            return;
        }
        vm.etch(NATIVE_COIN_PRECOMPILE, address(new ArcNativeCoinMock()).code);
        vm.allowCheatcodes(NATIVE_COIN_PRECOMPILE);
        vm.etch(BLOCKLIST_PRECOMPILE, address(new ArcBlocklistMock()).code);

        owner = vm.addr(OWNER_PK);
        factory = new HoddieVaultFactory(IERC20(USDC));
        address[] memory strategies = new address[](1);
        strategies[0] = MORPHO;
        vault = HoddieVault(factory.createVault(owner, operator, MAX_TX, DAILY, strategies));
        _fund(address(vault), FUNDS);
    }

    /*//////////////////////////////////////////////////////////////
                                 HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev USDC (6 decimals) is the native coin (18 decimals) on Arc.
    function _fund(address who, uint256 usdc6) internal {
        vm.deal(who, who.balance + usdc6 * 1e12);
    }

    function _usdc(address who) internal view returns (uint256) {
        return IERC20(USDC).balanceOf(who);
    }

    function _shares(address who) internal view returns (uint256) {
        return IERC4626(MORPHO).balanceOf(who);
    }

    function _signAddRecipient(address r, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = vault.addRecipientDigest(r, deadline);
        assertEq(nonce, vault.nonces(owner));
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
    }

    function test_fork_factoryAndVaultConfiguration() public view {
        assertEq(address(vault.asset()), USDC);
        assertEq(vault.owner(), owner);
        assertEq(vault.operator(), operator);
        assertTrue(vault.isStrategy(MORPHO));
        assertTrue(factory.isVault(address(vault)));
        address[] memory strategies = new address[](1);
        strategies[0] = MORPHO;
        assertEq(factory.predictVault(owner, operator, MAX_TX, DAILY, strategies), address(vault));
    }

    function test_fork_operatorDepositWithdrawRedeem() public {
        // deposit
        vm.prank(operator);
        uint256 shares = vault.depositToStrategy(MORPHO, 600e6);
        assertGt(shares, 0);
        assertEq(_usdc(address(vault)), FUNDS - 600e6);
        assertEq(_shares(address(vault)), shares);
        assertApproxEqAbs(IERC4626(MORPHO).convertToAssets(shares), 600e6, 2);
        assertEq(IERC20(USDC).allowance(address(vault), MORPHO), 0, "allowance reset");
        assertEq(vault.spentToday(), 600e6);

        // withdraw an exact amount back into the vault
        vm.prank(operator);
        vault.withdrawFromStrategy(MORPHO, 200e6);
        assertEq(_usdc(address(vault)), FUNDS - 600e6 + 200e6);

        // redeem half of the remaining shares back into the vault
        uint256 remaining = _shares(address(vault));
        uint256 before = _usdc(address(vault));
        vm.prank(operator);
        uint256 got = vault.redeemFromStrategy(MORPHO, remaining / 2);
        assertEq(_usdc(address(vault)), before + got);
        assertApproxEqAbs(got, 200e6, 3);

        // neither of the two counted against the limits, and nothing went to the operator
        assertEq(vault.spentToday(), 600e6);
        assertEq(_usdc(operator), 0);
        assertEq(_shares(operator), 0);
    }

    function test_fork_payRecipientApprovedByOwnerSignature() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAddRecipient(recipient, 0, deadline);

        // not yet approved
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.RecipientNotApproved.selector, recipient)
        );
        vault.pay(recipient, 100e6, REF);

        vm.prank(stranger); // Hodd's server pays the gas
        vault.addRecipientWithSig(recipient, deadline, sig);

        vm.expectEmit(true, true, false, true, address(vault));
        emit HoddieVault.Payment(recipient, 100e6, REF);
        vm.prank(operator);
        vault.pay(recipient, 100e6, REF);

        assertEq(_usdc(recipient), 100e6);
        assertEq(_usdc(address(vault)), FUNDS - 100e6);
        assertEq(vault.spentToday(), 100e6);

        // replay
        vm.expectRevert(HoddieVault.InvalidSignature.selector);
        vault.addRecipientWithSig(recipient, deadline, sig);
    }

    function test_fork_limitsAndDayRollover() public {
        vm.startPrank(operator);
        vault.depositToStrategy(MORPHO, MAX_TX);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.ExceedsMaxPerTx.selector, MAX_TX + 1, MAX_TX)
        );
        vault.depositToStrategy(MORPHO, MAX_TX + 1);
        vault.depositToStrategy(MORPHO, MAX_TX);
        vault.depositToStrategy(MORPHO, 500e6);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.ExceedsDailyLimit.selector, DAILY + 1, DAILY)
        );
        vault.depositToStrategy(MORPHO, 1);

        // next UTC day: fresh budget
        vm.warp((block.timestamp / 1 days + 1) * 1 days);
        assertEq(vault.spentToday(), 0);
        vault.withdrawFromStrategy(MORPHO, 100e6);
        vm.stopPrank();
    }

    function test_fork_pauseBlocksOperatorButOwnerStillExits() public {
        vm.prank(operator);
        vault.depositToStrategy(MORPHO, 800e6);

        vm.prank(owner);
        vault.pause();

        vm.startPrank(operator);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.depositToStrategy(MORPHO, 1e6);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.withdrawFromStrategy(MORPHO, 1e6);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vault.transferToOwner(1e6);
        vm.stopPrank();

        vm.prank(owner);
        vault.withdrawAll();
        assertApproxEqAbs(_usdc(owner), FUNDS, 3);
        assertEq(_usdc(address(vault)), 0);
        assertEq(_shares(address(vault)), 0);
    }

    /// The headline test: Morpho Vault V2 reports maxRedeem == 0, yet withdrawAll must hand the
    /// owner USDC (not share tokens), with the operator revoked and the vault paused.
    function test_fork_withdrawAllReturnsUsdcFromRealMorphoVault() public {
        vm.startPrank(operator);
        vault.depositToStrategy(MORPHO, 1000e6);
        vault.depositToStrategy(MORPHO, 800e6);
        vm.stopPrank();
        uint256 shares = _shares(address(vault));
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
        assertEq(_shares(address(vault)), 0, "no shares left behind");
        assertEq(_shares(owner), 0, "owner got USDC, not share tokens");
        assertGe(_usdc(owner) + 3, FUNDS, "owner got everything back (plus any interest)");
        assertEq(address(vault).balance, 0);
    }

    function test_fork_exitStrategyAfterDisallowAndRescueShares() public {
        vm.prank(operator);
        vault.depositToStrategy(MORPHO, 500e6);
        uint256 shares = _shares(address(vault));

        vm.startPrank(owner);
        vault.disallowStrategy(MORPHO);
        // the operator can no longer touch it ...
        vm.stopPrank();
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.StrategyNotAllowed.selector, MORPHO));
        vault.withdrawFromStrategy(MORPHO, 1e6);

        // ... shares are not stranded: the owner can rescue them as tokens ...
        vm.prank(owner);
        vault.rescueToken(IERC20(MORPHO), shares / 2);
        assertEq(_shares(owner), shares / 2);

        // ... or exit the rest in one call
        vm.prank(owner);
        vault.exitStrategy(MORPHO);
        assertEq(_shares(address(vault)), 0);
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
        vault.depositToStrategy(MORPHO, 1e6);
        vm.expectRevert(HoddieVault.NotOperator.selector);
        vault.pay(recipient, 1e6, REF);
        vm.expectRevert();
        vault.withdrawAll();
        vm.stopPrank();
        assertEq(_usdc(address(vault)), FUNDS);
    }
}
