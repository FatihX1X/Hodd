// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {HoddieVault} from "../src/HoddieVault.sol";
import {HoddieVaultFactory} from "../src/HoddieVaultFactory.sol";

/// @notice Creates a HoddieVault through the factory and prints its address. Anyone can send this
///         transaction (the vault address commits to every parameter), so the key is only a gas
///         payer.
///
///   PRIVATE_KEY=0x... FACTORY=0x... OWNER=0x... OPERATOR=0x... \
///   MAX_DEPOSIT_PER_TX=1000000000 DEPOSIT_LIMIT_24H=5000000000 \
///   MAX_PAYMENT_PER_TX=500000000 PAYMENT_LIMIT_24H=2000000000 \
///   forge script script/CreateVault.s.sol:CreateVault \
///     --rpc-url https://rpc.testnet.arc.network --broadcast
///
/// All amounts are USDC base units (6 decimals). Without `--broadcast` it only simulates and
/// prints the address the vault will get. Strategies default to Morpho and the USYC Teller on
/// Arc Testnet, `STRATEGIES=0xA,0xB` overrides them (comma separated).
///
/// Reminder: the USYC Teller only accepts the vault once Circle has allowlisted the vault's
/// address. The address printed here is final, so the allowlisting can be requested before the
/// transaction is broadcast.
contract CreateVault is Script {
    address internal constant MORPHO_VAULT = 0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88;
    address internal constant USYC_TELLER = 0x9fdF14c5B14173D74C08Af27AebFf39240dC105A;

    /// @dev Reads the environment, creates the vault, returns its address.
    function run() external returns (address vault) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address factory = vm.envAddress("FACTORY");
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

        return execute(key, factory, owner, operator, limits, strategies);
    }

    /// @dev Creation with explicit arguments (used by the tests).
    function execute(
        uint256 key,
        address factory,
        address owner,
        address operator,
        HoddieVault.Limits memory limits,
        address[] memory strategies
    ) public returns (address vault) {
        address predicted = HoddieVaultFactory(factory)
            .predictVault(owner, operator, limits, strategies);
        console.log("predicted vault", predicted);

        vm.startBroadcast(key);
        vault = HoddieVaultFactory(factory).createVault(owner, operator, limits, strategies);
        vm.stopBroadcast();

        console.log("vault created at", vault);
        console.log("  owner   ", owner);
        console.log("  operator", operator);
        console.log("  maxDepositPerTx", limits.maxDepositPerTx);
        console.log("  depositLimit24h", limits.depositLimit24h);
        console.log("  maxPaymentPerTx", limits.maxPaymentPerTx);
        console.log("  paymentLimit24h", limits.paymentLimit24h);
        require(vault == predicted, "vault address differs from the prediction");
    }
}
