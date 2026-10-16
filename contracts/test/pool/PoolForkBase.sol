// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddUSYCVault} from "../../src/HoddUSYCVault.sol";
import {ITeller} from "../../src/interfaces/ITeller.sol";
import {IRolesAuthority} from "../../src/interfaces/IRolesAuthority.sol";
import {ArcNativeCoinMock, ArcBlocklistMock} from "../fork/ArcNativeCoinMock.sol";

/// @dev The admin side of Circle's RolesAuthority (proxy 0xCC20...6113) the tests touch.
interface IAuthorityAdmin {
    function owner() external view returns (address);
    function paused() external view returns (bool);
    function pause() external;
    function unpause() external;
    function setUserRole(address user, uint8 role, bool enabled) external;
    function getUserRoles(address user) external view returns (bytes32);
}

/// @dev Circle's fund-admin function on the Teller (callable by role 255, e.g. the authority owner).
interface ITellerAdmin {
    function setLimits(address account, uint56 subscribe, uint56 redeem) external;
}

/// @notice Shared setup of the HoddUSYCVault Arc Testnet fork tests. Run with:
///
///         forge test --fork-url https://rpc.testnet.arc.network --match-contract Fork
///
/// @dev Stock Foundry runs a plain EVM. The real USDC delegates its balance bookkeeping to Arc's
///      native-coin precompile (0x1800...0000) and consults the blocklist precompile
///      (0x1800...0001), which the plain EVM does not have, so the tests install small stand-ins
///      there (`ArcNativeCoinMock`, `ArcBlocklistMock`). Everything else (USDC proxy and
///      implementation, Morpho Vault V2, Circle's Teller, USYC token and RolesAuthority) is the
///      live on-chain code and state. USDC "balance" on Arc is the native balance / 1e12, so users
///      are funded with `vm.deal`. Without a fork URL every test skips.
abstract contract PoolForkBase is Test {
    uint256 internal constant ARC_TESTNET = 5_042_002;
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant MORPHO = 0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88;
    address internal constant TELLER = 0x9fdF14c5B14173D74C08Af27AebFf39240dC105A;
    address internal constant USYC = 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C;
    address internal constant AUTHORITY = 0xCC205224862C7641930c87679E98999d23C26113;
    /// @dev A wallet Circle has NOT allowlisted: an ordinary Hodd user.
    address internal constant PLAIN_USER = 0xDEf09d06764EE3cA611Ce186f47dBd3f546d2e7C;
    address internal constant NATIVE_COIN_PRECOMPILE = 0x1800000000000000000000000000000000000000;
    address internal constant BLOCKLIST_PRECOMPILE = 0x1800000000000000000000000000000000000001;

    bytes4 internal constant NOT_PERMISSIONED = bytes4(keccak256("NotPermissioned()"));
    bytes4 internal constant NO_ACCESS = bytes4(keccak256("NoAccess()"));
    bytes4 internal constant LIMIT_EXCEEDED = bytes4(keccak256("LimitExceeded()"));

    HoddUSYCVault internal pool;
    address internal admin = makeAddr("poolAdmin");
    address internal otherUser = makeAddr("otherUser");

    function setUp() public virtual {
        if (block.chainid != ARC_TESTNET) {
            vm.skip(true); // no fork given: skip cleanly
            return;
        }
        vm.etch(NATIVE_COIN_PRECOMPILE, address(new ArcNativeCoinMock()).code);
        vm.allowCheatcodes(NATIVE_COIN_PRECOMPILE);
        vm.etch(BLOCKLIST_PRECOMPILE, address(new ArcBlocklistMock()).code);

        pool = new HoddUSYCVault(
            IERC20(USDC), ITeller(TELLER), IERC20(USYC), IRolesAuthority(AUTHORITY), admin
        );
        vm.startPrank(admin);
        pool.setDepositCaps(100_000e6, 10_000_000e6);
        vm.stopPrank();
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

    /// @dev Circle allowlists `who` (role 0), by impersonating the RolesAuthority owner (role 255).
    function _allowlist(address who, bool enabled) internal {
        vm.prank(IAuthorityAdmin(AUTHORITY).owner());
        IAuthorityAdmin(AUTHORITY).setUserRole(who, 0, enabled);
    }

    /// @dev The pool is allowlisted; a funded user with an unlimited approval to the pool.
    function _readyUser(address who, uint256 usdc6) internal {
        _fund(who, usdc6);
        vm.prank(who);
        IERC20(USDC).approve(address(pool), type(uint256).max);
    }
}
