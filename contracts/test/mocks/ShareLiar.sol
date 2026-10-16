// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev A strategy-looking contract with a configurable answer for `share()`, to test how the
///      vault treats odd share-token answers (no code, the asset, the vault itself, zero).
contract ShareLiar {
    address public immutable usdc;
    address public answer;

    constructor(address usdc_, address answer_) {
        usdc = usdc_;
        answer = answer_;
    }

    function setAnswer(address answer_) external {
        answer = answer_;
    }

    function asset() external view returns (address) {
        return usdc;
    }

    function share() external view returns (address) {
        return answer;
    }
}
