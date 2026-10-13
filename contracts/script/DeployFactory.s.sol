// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {HoddieVaultFactory} from "../src/HoddieVaultFactory.sol";

/// @notice Deploys the HoddieVaultFactory for USDC.
///
/// The deployer key is read from the environment at run time and is never written anywhere:
///
///   PRIVATE_KEY=0x... forge script script/DeployFactory.s.sol:DeployFactory \
///     --rpc-url https://rpc.testnet.arc.network --broadcast
///
/// Without `--broadcast` the script only simulates. Optional environment variables:
///   USDC_ADDRESS      override the asset (default: Arc Testnet USDC)
///   ALLOW_OTHER_CHAIN set to `true` to run on a chain other than Arc Testnet (e.g. a local anvil)
contract DeployFactory is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    address internal constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    error WrongChain(uint256 actual, uint256 expected);
    error AssetNotSixDecimals(address asset, uint8 decimals);

    /// @dev Reads the environment and deploys.
    function run() external returns (HoddieVaultFactory factory) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address asset = vm.envOr("USDC_ADDRESS", ARC_TESTNET_USDC);
        bool allowOtherChain = vm.envOr("ALLOW_OTHER_CHAIN", false);
        return execute(deployerKey, asset, allowOtherChain);
    }

    /// @dev The deployment itself, callable with explicit arguments (used by the tests).
    function execute(uint256 deployerKey, address asset, bool allowOtherChain)
        public
        returns (HoddieVaultFactory factory)
    {
        if (block.chainid != ARC_TESTNET_CHAIN_ID && !allowOtherChain) {
            revert WrongChain(block.chainid, ARC_TESTNET_CHAIN_ID);
        }
        uint8 decimals = IERC20Metadata(asset).decimals();
        if (decimals != 6) revert AssetNotSixDecimals(asset, decimals);

        address deployer = vm.addr(deployerKey);
        console.log("deployer", deployer);
        console.log("deployer nonce", vm.getNonce(deployer));

        vm.startBroadcast(deployerKey);
        factory = new HoddieVaultFactory(IERC20(asset));
        vm.stopBroadcast();

        console.log("HoddieVaultFactory deployed at", address(factory));
        console.log("  asset   ", asset);
        console.log("  chainid ", block.chainid);
    }
}
