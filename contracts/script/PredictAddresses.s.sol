// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddieVault} from "../src/HoddieVault.sol";
import {HoddieVaultAddress} from "../src/HoddieVaultAddress.sol";

/// @notice Predicts the factory address (from the deployer and its nonce) and the address of a
///         vault that factory will create, before anything is deployed. Needs no key and sends
///         nothing, so the vault address can be given to Circle for allowlisting first.
///
///   DEPLOYER=0x... NONCE=0 OWNER=0x... OPERATOR=0x... \
///   MAX_DEPOSIT_PER_TX=1000000000 DEPOSIT_LIMIT_24H=5000000000 \
///   MAX_PAYMENT_PER_TX=500000000 PAYMENT_LIMIT_24H=2000000000 \
///   forge script script/PredictAddresses.s.sol:PredictAddresses
///
/// `NONCE` is the deployer's transaction count when the factory is deployed (`cast nonce <addr>
/// --rpc-url ...`). The vault address depends on every parameter below, including the strategies
/// (default: Morpho and the USYC Teller; `STRATEGIES=0xA,0xB` overrides) and the asset
/// (`USDC_ADDRESS`, default Arc Testnet USDC): change one and the address changes.
contract PredictAddresses is Script {
    address internal constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant MORPHO_VAULT = 0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88;
    address internal constant USYC_TELLER = 0x9fdF14c5B14173D74C08Af27AebFf39240dC105A;

    function run() external view returns (address factory, address vault) {
        address deployer = vm.envAddress("DEPLOYER");
        uint256 nonce = vm.envUint("NONCE");
        address asset = vm.envOr("USDC_ADDRESS", ARC_TESTNET_USDC);
        address owner = vm.envAddress("OWNER");
        address operator = vm.envAddress("OPERATOR");
        HoddieVault.Limits memory limits = HoddieVault.Limits({
            maxDepositPerTx: vm.envUint("MAX_DEPOSIT_PER_TX"),
            depositLimit24h: vm.envUint("DEPOSIT_LIMIT_24H"),
            maxPaymentPerTx: vm.envUint("MAX_PAYMENT_PER_TX"),
            paymentLimit24h: vm.envUint("PAYMENT_LIMIT_24H")
        });
        address[] memory defaults = new address[](2);
        defaults[0] = MORPHO_VAULT;
        defaults[1] = USYC_TELLER;
        address[] memory strategies = vm.envOr("STRATEGIES", ",", defaults);

        return predict(deployer, nonce, asset, owner, operator, limits, strategies);
    }

    /// @dev The computation with explicit arguments (used by the tests).
    function predict(
        address deployer,
        uint256 nonce,
        address asset,
        address owner,
        address operator,
        HoddieVault.Limits memory limits,
        address[] memory strategies
    ) public view returns (address factory, address vault) {
        factory = vm.computeCreateAddress(deployer, nonce);
        vault = HoddieVaultAddress.predict(factory, IERC20(asset), owner, operator, limits, strategies);

        console.log("deployer", deployer);
        console.log("factory nonce", nonce);
        console.log("predicted factory", factory);
        console.log("predicted vault  ", vault);
    }
}
