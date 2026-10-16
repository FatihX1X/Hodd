// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddUSYCVault} from "../src/HoddUSYCVault.sol";
import {ITeller} from "../src/interfaces/ITeller.sol";
import {IRolesAuthority} from "../src/interfaces/IRolesAuthority.sol";

/// @notice Deploys the pooled HoddUSYCVault on Arc Testnet against Circle's USDC, USYC Teller,
///         USYC token and RolesAuthority.
///
/// The deployer key and the admin are read from the environment at run time:
///
///   PRIVATE_KEY=0x... ADMIN=0x... forge script script/DeployHoddUSYCVault.s.sol:DeployHoddUSYCVault \
///     --rpc-url https://rpc.testnet.arc.network --broadcast --with-gas-price 25gwei
///
/// Without `--broadcast` the script only simulates. `ADMIN` is Hodd's ops key (it can only pause
/// deposits and set deposit caps, it can not touch anyone's funds). The deployer does not need to
/// be the admin. Optional: `ALLOW_OTHER_CHAIN=true` to run elsewhere (together with the address
/// overrides USDC_ADDRESS, TELLER_ADDRESS, USYC_ADDRESS, AUTHORITY_ADDRESS).
///
/// After deployment Circle must allowlist the printed address (role 0, "investor"): see the README.
contract DeployHoddUSYCVault is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant TELLER = 0x9fdF14c5B14173D74C08Af27AebFf39240dC105A;
    address internal constant USYC = 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C;
    address internal constant AUTHORITY = 0xCC205224862C7641930c87679E98999d23C26113;

    error WrongChain(uint256 actual, uint256 expected);

    /// @dev Reads the environment and deploys.
    function run() external returns (HoddUSYCVault vault) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address admin = vm.envAddress("ADMIN");
        bool allowOtherChain = vm.envOr("ALLOW_OTHER_CHAIN", false);
        return execute(
            key,
            admin,
            vm.envOr("USDC_ADDRESS", USDC),
            vm.envOr("TELLER_ADDRESS", TELLER),
            vm.envOr("USYC_ADDRESS", USYC),
            vm.envOr("AUTHORITY_ADDRESS", AUTHORITY),
            allowOtherChain
        );
    }

    /// @dev The deployment with explicit arguments (used by the tests).
    function execute(
        uint256 key,
        address admin,
        address usdc,
        address teller,
        address usyc,
        address authority,
        bool allowOtherChain
    ) public returns (HoddUSYCVault vault) {
        if (block.chainid != ARC_TESTNET_CHAIN_ID && !allowOtherChain) {
            revert WrongChain(block.chainid, ARC_TESTNET_CHAIN_ID);
        }
        address deployer = vm.addr(key);
        console.log("deployer", deployer);
        console.log("deployer nonce", vm.getNonce(deployer));

        vm.startBroadcast(key);
        vault = new HoddUSYCVault(
            IERC20(usdc), ITeller(teller), IERC20(usyc), IRolesAuthority(authority), admin
        );
        vm.stopBroadcast();

        console.log("HoddUSYCVault deployed at", address(vault));
        console.log("  admin    ", admin);
        console.log("  teller   ", teller);
        console.log("  usyc     ", usyc);
        console.log("  authority", authority);
        console.log("  chainid  ", block.chainid);
        console.log("Next: ask Circle to allowlist (role 0) the address above.");
    }
}
