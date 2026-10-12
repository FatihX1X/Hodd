// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Minimal ERC-1271 smart account controlled by one EOA key, standing in for a passkey MSCA.
contract MockSmartAccount is IERC1271 {
    address public immutable controller;
    bool public rejectAll;

    constructor(address controller_) {
        controller = controller_;
    }

    function setRejectAll(bool value) external {
        rejectAll = value;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        if (rejectAll) return 0xffffffff;
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == controller) {
            return IERC1271.isValidSignature.selector;
        }
        return 0xffffffff;
    }

    /// @dev Lets the controller act as the smart account (owner calls, ownership acceptance...).
    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        require(msg.sender == controller, "not controller");
        bool ok;
        (ok, result) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(result, 0x20), mload(result))
            }
        }
    }
}
