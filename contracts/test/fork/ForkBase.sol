// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {HoddieVault} from "../../src/HoddieVault.sol";
import {HoddieVaultFactory} from "../../src/HoddieVaultFactory.sol";
import {ArcNativeCoinMock, ArcBlocklistMock} from "./ArcNativeCoinMock.sol";

/// @dev The slice of Circle's RolesAuthority (proxy 0xCC20...6113) the tests touch.
interface IRolesAuthority {
    function owner() external view returns (address);
    function paused() external view returns (bool);
    function pause() external;
    function unpause() external;
    function setUserRole(address user, uint8 role, bool enabled) external;
    function getUserRoles(address user) external view returns (bytes32);
    function canCall(address user, address target, bytes4 sig) external view returns (bool);
}

/// @dev The slice of Circle's Teller (proxy 0x9fdF...105A) the tests touch.
interface IRealTeller {
    function asset() external view returns (address);
    function share() external view returns (address);
    function todayTimestamp() external view returns (uint256);
    function previewDepositData(address account, uint256 assets)
        external
        view
        returns (uint256 shares, uint256 fee, int256 price);
    function previewRedeemData(address account, uint256 shares)
        external
        view
        returns (uint256 assets, uint256 fee, int256 price);
    function previewWithdrawData(address account, uint256 assets)
        external
        view
        returns (uint256 shares, uint256 fee, int256 price);
    function maxRedeem(address account) external view returns (uint256);
    function redemptionLimitRemaining(address account, uint256 date) external view returns (uint256);
    function setLimits(address account, uint56 subscribe, uint56 redeem) external;
    function treasury(address account) external view returns (address);
}

/// @notice Shared setup of the Arc Testnet fork tests. Run with:
///
///         forge test --fork-url https://rpc.testnet.arc.network --match-contract Fork
///
/// @dev Stock Foundry runs a plain EVM. The real USDC delegates its balance bookkeeping to Arc's
///      native-coin precompile (0x1800...0000) and consults the blocklist precompile
///      (0x1800...0001), which the plain EVM does not have, so the tests install small stand-ins
///      there (`ArcNativeCoinMock`, `ArcBlocklistMock`). Everything else (USDC proxy and
///      implementation, Morpho Vault V2, its adapter and markets, Circle's Teller, USYC token and
///      RolesAuthority) is the live on-chain code and state. USDC "balance" on Arc is the native
///      balance / 1e12, so funding is done with `vm.deal` (Foundry's ERC-20 `deal` can not find a
///      storage slot for a token without balance storage). Without a fork URL every test skips.
abstract contract ForkBase is Test {
    uint256 internal constant ARC_TESTNET = 5_042_002;
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant MORPHO = 0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88;
    address internal constant TELLER = 0x9fdF14c5B14173D74C08Af27AebFf39240dC105A;
    address internal constant USYC = 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C;
    address internal constant AUTHORITY = 0xCC205224862C7641930c87679E98999d23C26113;
    /// @dev The user's real wallet, allowlisted by Circle on chain (role 0). Only ever impersonated
    ///      inside the local fork.
    address internal constant ALLOWLISTED_WALLET = 0x93A7F9a958171303DE74Ab7f6778D25F96316564;
    address internal constant NATIVE_COIN_PRECOMPILE = 0x1800000000000000000000000000000000000000;
    address internal constant BLOCKLIST_PRECOMPILE = 0x1800000000000000000000000000000000000001;

    uint256 internal constant OWNER_PK = 0xA11CE;
    uint256 internal constant MAX_TX = 1000e6;
    uint256 internal constant DAILY = 2500e6;
    uint256 internal constant FUNDS = 3000e6;
    uint256 internal constant NO_CAP = type(uint256).max;
    bytes32 internal constant REF = keccak256("invoice-2026-10-001");

    HoddieVaultFactory internal factory;
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");
    address internal recipient = makeAddr("recipient");

    function setUp() public virtual {
        if (block.chainid != ARC_TESTNET) {
            vm.skip(true); // no fork given: skip cleanly
            return;
        }
        vm.etch(NATIVE_COIN_PRECOMPILE, address(new ArcNativeCoinMock()).code);
        vm.allowCheatcodes(NATIVE_COIN_PRECOMPILE);
        vm.etch(BLOCKLIST_PRECOMPILE, address(new ArcBlocklistMock()).code);
        factory = new HoddieVaultFactory(IERC20(USDC));
    }

    /*//////////////////////////////////////////////////////////////
                                 HELPERS
    //////////////////////////////////////////////////////////////*/

    function _limits() internal pure returns (HoddieVault.Limits memory) {
        return HoddieVault.Limits(MAX_TX, DAILY, MAX_TX, DAILY);
    }

    function _strategies(bool withTeller) internal pure returns (address[] memory list) {
        list = new address[](withTeller ? 2 : 1);
        list[0] = MORPHO;
        if (withTeller) list[1] = TELLER;
    }

    /// @dev A funded vault for `owner_` created through the factory (Morpho and the Teller).
    function _newVault(address owner_) internal returns (HoddieVault v) {
        v = HoddieVault(factory.createVault(owner_, operator, _limits(), _strategies(true)));
        _fund(address(v), FUNDS);
    }

    /// @dev USDC (6 decimals) is the native coin (18 decimals) on Arc.
    function _fund(address who, uint256 usdc6) internal {
        vm.deal(who, who.balance + usdc6 * 1e12);
    }

    function _usdc(address who) internal view returns (uint256) {
        return IERC20(USDC).balanceOf(who);
    }

    function _usyc(address who) internal view returns (uint256) {
        return IERC20(USYC).balanceOf(who);
    }

    function _morphoShares(address who) internal view returns (uint256) {
        return IERC4626(MORPHO).balanceOf(who);
    }

    /// @dev Circle allowlists `who` (role 0). Impersonates the RolesAuthority owner, which holds
    ///      role 255 and may call `setUserRole`.
    function _allowlist(address who, bool enabled) internal {
        vm.prank(IRolesAuthority(AUTHORITY).owner());
        IRolesAuthority(AUTHORITY).setUserRole(who, 0, enabled);
    }
}
