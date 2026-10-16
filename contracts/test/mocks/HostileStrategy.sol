// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Reports the right `asset()` so it can be allowlisted, then misbehaves on every other
///      call according to `mode`.
contract HostileStrategy {
    enum Mode {
        REVERT, // reverts with a message
        EMPTY, // succeeds with no return data
        SHORT, // succeeds with a single byte of return data
        HUGE, // succeeds returning 1 MiB of data
        BURN, // consumes all forwarded gas
        ZERO // succeeds returning a zero word (e.g. deposit() minting 0 shares)
    }

    address public immutable usdc;
    Mode public mode;

    constructor(address usdc_, Mode mode_) {
        usdc = usdc_;
        mode = mode_;
    }

    function setMode(Mode newMode) external {
        mode = newMode;
    }

    function asset() external view returns (address) {
        return usdc;
    }

    fallback() external {
        Mode m = mode;
        if (m == Mode.REVERT) revert("hostile");
        if (m == Mode.EMPTY) return;
        if (m == Mode.SHORT) {
            assembly {
                mstore(0, 0x01)
                return(31, 1)
            }
        }
        if (m == Mode.HUGE) {
            assembly {
                return(0, 0x100000)
            }
        }
        if (m == Mode.BURN) {
            assembly {
                invalid()
            }
        }
        // ZERO
        assembly {
            mstore(0, 0)
            return(0, 32)
        }
    }
}
