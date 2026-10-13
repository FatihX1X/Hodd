// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddieVault} from "./HoddieVault.sol";
import {HoddieVaultAddress} from "./HoddieVaultAddress.sol";

/// @title HoddieVaultFactory
/// @author Hodd
/// @notice Deploys one {HoddieVault} per user at a deterministic (CREATE2) address.
/// @dev Creation is permissionless on purpose. The vault address commits to every parameter
///      (asset, owner, operator, limits, strategies and this factory), so nobody can occupy the
///      address Hodd predicts with different parameters: a different parameter set can only
///      produce a different address. Because anyone can create vaults for any `owner`, clients
///      must never treat "created by the factory" as trusted. They must read the vault's
///      `owner`, `operator`, limits and strategies and compare them with what the user agreed to
///      before the user sends funds. The address is also known before deployment.
contract HoddieVaultFactory {
    /// @notice The ERC-20 every vault of this factory holds (USDC).
    IERC20 public immutable asset;

    /// @notice Whether `vault` was deployed by this factory.
    mapping(address vault => bool) public isVault;

    /// @notice A vault was deployed.
    event VaultCreated(address indexed owner, address indexed operator, address indexed vault);

    error ZeroAsset();
    error VaultAlreadyDeployed(address vault);

    /// @param asset_ The ERC-20 the vaults will hold (USDC).
    constructor(IERC20 asset_) {
        if (address(asset_) == address(0)) revert ZeroAsset();
        asset = asset_;
    }

    /// @notice Deploy a vault. Reverts if the exact same parameter set was already deployed.
    /// @param owner The user's wallet (EOA or ERC-1271 smart account).
    /// @param operator Hodd's agent wallet, or `address(0)` for none.
    /// @param limits Deposit and payment limits, see {HoddieVault.Limits}.
    /// @param strategies Initial strategy allowlist (ERC-4626 vaults over `asset`).
    /// @return vault The vault address (equal to {predictVault} for the same parameters).
    function createVault(
        address owner,
        address operator,
        HoddieVault.Limits calldata limits,
        address[] calldata strategies
    ) external returns (address vault) {
        address predicted = HoddieVaultAddress.predict(
            address(this), asset, owner, operator, limits, strategies
        );
        if (predicted.code.length != 0) revert VaultAlreadyDeployed(predicted);

        bytes32 salt = HoddieVaultAddress.salt(asset, owner, operator, limits, strategies);
        vault = address(new HoddieVault{salt: salt}(asset, owner, operator, limits, strategies));
        isVault[vault] = true;
        emit VaultCreated(owner, operator, vault);
    }

    /// @notice The address {createVault} will deploy to for these parameters.
    /// @param owner The user's wallet.
    /// @param operator Hodd's agent wallet, or `address(0)`.
    /// @param limits Deposit and payment limits.
    /// @param strategies Initial strategy allowlist.
    /// @return The predicted vault address (whether or not it is deployed yet).
    function predictVault(
        address owner,
        address operator,
        HoddieVault.Limits calldata limits,
        address[] calldata strategies
    ) external view returns (address) {
        return HoddieVaultAddress.predict(address(this), asset, owner, operator, limits, strategies);
    }
}
