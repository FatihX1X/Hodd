// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddieVault} from "./HoddieVault.sol";

/// @title HoddieVaultFactory
/// @author Hodd
/// @notice Deploys one {HoddieVault} per user at a deterministic (CREATE2) address.
/// @dev Creation is permissionless on purpose. The vault address commits to every parameter
///      (owner, operator, limits, strategies, asset and this factory), so nobody can occupy the
///      address Hodd predicts with different parameters: a different parameter set can only
///      produce a different address. Because anyone can create vaults for any `owner`, clients
///      must never treat "created by the factory" as trusted. They must read the vault's
///      `owner`, `operator`, limits and strategies and compare them with what the user agreed to
///      before the user sends funds.
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
    /// @param maxPerTx Per-transaction cap of limited operator outflows (USDC base units).
    /// @param dailyLimit Per-UTC-day cap of limited operator outflows (USDC base units).
    /// @param strategies Initial strategy allowlist (ERC-4626 vaults over `asset`).
    /// @return vault The vault address (equal to {predictVault} for the same parameters).
    function createVault(
        address owner,
        address operator,
        uint256 maxPerTx,
        uint256 dailyLimit,
        address[] calldata strategies
    ) external returns (address vault) {
        bytes32 salt = _salt(owner, operator, maxPerTx, dailyLimit, strategies);
        address predicted = _predict(salt, owner, operator, maxPerTx, dailyLimit, strategies);
        if (predicted.code.length != 0) revert VaultAlreadyDeployed(predicted);

        vault = address(
            new HoddieVault{salt: salt}(asset, owner, operator, maxPerTx, dailyLimit, strategies)
        );
        isVault[vault] = true;
        emit VaultCreated(owner, operator, vault);
    }

    /// @notice The address {createVault} will deploy to for these parameters.
    /// @param owner The user's wallet.
    /// @param operator Hodd's agent wallet, or `address(0)`.
    /// @param maxPerTx Per-transaction cap (USDC base units).
    /// @param dailyLimit Per-UTC-day cap (USDC base units).
    /// @param strategies Initial strategy allowlist.
    /// @return The predicted vault address (whether or not it is deployed yet).
    function predictVault(
        address owner,
        address operator,
        uint256 maxPerTx,
        uint256 dailyLimit,
        address[] calldata strategies
    ) external view returns (address) {
        bytes32 salt = _salt(owner, operator, maxPerTx, dailyLimit, strategies);
        return _predict(salt, owner, operator, maxPerTx, dailyLimit, strategies);
    }

    function _salt(
        address owner,
        address operator,
        uint256 maxPerTx,
        uint256 dailyLimit,
        address[] calldata strategies
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(owner, operator, maxPerTx, dailyLimit, strategies));
    }

    function _predict(
        bytes32 salt,
        address owner,
        address operator,
        uint256 maxPerTx,
        uint256 dailyLimit,
        address[] calldata strategies
    ) private view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(HoddieVault).creationCode,
                abi.encode(asset, owner, operator, maxPerTx, dailyLimit, strategies)
            )
        );
        return address(
            uint160(
                uint256(
                    keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))
                )
            )
        );
    }
}
