// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockStrategy} from "./MockStrategy.sol";

/// @dev A contract operator that tries to call the vault again from inside a strategy callback.
contract ReentrantOperator {
    address public vault;
    bytes public payload;
    bool public reentered;
    bool public reenterOk;
    bytes public reenterRevertData;

    function setTarget(address vault_, bytes calldata payload_) external {
        vault = vault_;
        payload = payload_;
    }

    function call(bytes calldata data) external returns (bool ok, bytes memory ret) {
        (ok, ret) = vault.call(data);
    }

    function reenter() external {
        reentered = true;
        bytes memory data = payload;
        (bool ok, bytes memory ret) = vault.call(data);
        reenterOk = ok;
        reenterRevertData = ret;
    }
}

/// @dev ERC-4626 whose deposit and withdraw paths call back into `hook` before doing their work.
contract ReentrantStrategy is MockStrategy {
    address public hook;

    constructor(IERC20 asset_) MockStrategy(asset_) {}

    function setHook(address hook_) external {
        hook = hook_;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
    {
        if (hook != address(0)) ReentrantOperator(hook).reenter();
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner_,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (hook != address(0)) ReentrantOperator(hook).reenter();
        super._withdraw(caller, receiver, owner_, assets, shares);
    }
}
