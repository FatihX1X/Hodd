// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IRolesAuthority
/// @notice The slice of Circle's `RolesAuthority` that {HoddUSYCVault} reads to tell whether it is
///         currently allowed to use the Teller and the USYC token. Like the real contract,
///         `canCall` REVERTS (`NoAccess`) while the authority is paused.
interface IRolesAuthority {
    /// @notice Whether `user` may call `functionSig` on `target`.
    function canCall(address user, address target, bytes4 functionSig) external view returns (bool);
}
