// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IVmDeal {
    function deal(address account, uint256 newBalance) external;
}

/// @dev Stand-in for Arc's native-coin precompile at 0x1800...0000, so that stock `forge` (which
///      runs a plain EVM) can execute the real Arc USDC token at 0x3600...0000 on a fork.
///
///      The real USDC (a Circle FiatToken proxy) keeps no balances of its own: `balanceOf` is
///      `account.balance / 1e12` and every movement is delegated to this precompile with the
///      selectors below (found by disassembling the token implementation). The precompile's
///      amounts are in the 18-decimal native unit. This mock reproduces only what the token
///      needs: moving native balances with the `deal` cheatcode. It does not model the Arc
///      blocklist, gas or EIP-7708 logs. Arc's own `arc-forge` is the faithful alternative.
contract ArcNativeCoinMock {
    IVmDeal internal constant VM = IVmDeal(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @dev Any plausible number: only used by `totalSupply()` readers.
    uint256 internal constant TOTAL = 317_497_006_446_111_134_000_000_000_000;

    error InsufficientNativeBalance();

    /// @dev selector 0x18160ddd
    function totalSupply() external pure returns (uint256) {
        return TOTAL;
    }

    /// @dev selector 0xbeabacc8
    function transfer(address from, address to, uint256 amount) external returns (bool) {
        uint256 fromBal = from.balance;
        if (fromBal < amount) revert InsufficientNativeBalance();
        VM.deal(from, fromBal - amount);
        VM.deal(to, to.balance + amount); // read after the first deal, so from == to is a no-op
        return true;
    }

    /// @dev selector 0x40c10f19
    function mint(address to, uint256 amount) external returns (bool) {
        VM.deal(to, to.balance + amount);
        return true;
    }

    /// @dev selector 0x9dc29fac
    function burn(address from, uint256 amount) external returns (bool) {
        uint256 fromBal = from.balance;
        if (fromBal < amount) revert InsufficientNativeBalance();
        VM.deal(from, fromBal - amount);
        return true;
    }
}

/// @dev Stand-in for Arc's blocklist precompile at 0x1800...0001, which the USDC token consults in
///      `transferFrom`. Nobody is blocklisted in the simulation.
contract ArcBlocklistMock {
    function isBlocklisted(address) external pure returns (bool) {
        return false;
    }
}
