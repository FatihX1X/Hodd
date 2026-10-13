// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddieVault} from "./HoddieVault.sol";

/// @title HoddieVaultAddress
/// @author Hodd
/// @notice The one place that knows how a vault's CREATE2 address is derived. The factory and the
///         off-chain prediction script both use it, so they can not drift apart.
library HoddieVaultAddress {
    /// @dev Commits to every constructor argument of the vault.
    function salt(
        IERC20 asset,
        address owner,
        address operator,
        HoddieVault.Limits memory limits,
        address[] memory strategies
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(asset, owner, operator, limits, strategies));
    }

    /// @dev The address `new HoddieVault{salt: salt(...)}(asset, owner, operator, limits,
    ///      strategies)` gets when it is deployed by `factory`.
    function predict(
        address factory,
        IERC20 asset,
        address owner,
        address operator,
        HoddieVault.Limits memory limits,
        address[] memory strategies
    ) internal pure returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(HoddieVault).creationCode,
                abi.encode(asset, owner, operator, limits, strategies)
            )
        );
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                factory,
                salt(asset, owner, operator, limits, strategies),
                initCodeHash
            )
        );
        return address(uint160(uint256(hash)));
    }
}
