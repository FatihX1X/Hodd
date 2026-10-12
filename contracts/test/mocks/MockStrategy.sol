// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev OZ ERC-4626 over the mock USDC with switchable behaviours, so the tests can reproduce
///      the real Morpho Vault V2 (`max*` return 0) and the failure modes `withdrawAll` must survive.
contract MockStrategy is ERC4626 {
    enum Mode {
        NORMAL, // plain OZ behaviour
        V2, // max* return 0 but deposit/withdraw/redeem work (Morpho Vault V2)
        CAPPED, // maxRedeem/maxWithdraw limited to `redeemCap` shares
        BLOCKED // withdraw/redeem revert, maxRedeem reverts
    }

    error Blocked();
    error SharesNotTransferable();

    Mode public mode;
    uint256 public redeemCap;
    bool public sharesLocked;

    constructor(IERC20 asset_) ERC4626(asset_) ERC20("Mock Strategy", "mSTRAT") {}

    /// @dev 18-decimal shares over a 6-decimal asset, like the real vault.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 12;
    }

    function setMode(Mode newMode, uint256 cap) external {
        mode = newMode;
        redeemCap = cap;
    }

    function setSharesLocked(bool locked) external {
        sharesLocked = locked;
    }

    /// @dev Simulates a lending-market illiquidity: assets leave the strategy.
    function drain(address to, uint256 amount) external {
        SafeERC20.safeTransfer(IERC20(asset()), to, amount);
    }

    /// @dev Simulates yield: anyone can donate assets (raises the share price).
    function donate(uint256 amount) external {
        SafeERC20.safeTransferFrom(IERC20(asset()), msg.sender, address(this), amount);
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        if (mode == Mode.V2) return 0;
        return super.maxDeposit(receiver);
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        if (mode == Mode.V2) return 0;
        if (mode == Mode.BLOCKED) revert Blocked();
        uint256 base = super.maxWithdraw(owner_);
        if (mode == Mode.CAPPED) {
            uint256 cap = convertToAssets(redeemCap);
            return base < cap ? base : cap;
        }
        return base;
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        if (mode == Mode.V2) return 0;
        if (mode == Mode.BLOCKED) revert Blocked();
        uint256 base = super.maxRedeem(owner_);
        if (mode == Mode.CAPPED) return base < redeemCap ? base : redeemCap;
        return base;
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        if (mode != Mode.V2) return super.deposit(assets, receiver);
        uint256 shares = previewDeposit(assets);
        _deposit(_msgSender(), receiver, assets, shares);
        return shares;
    }

    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        returns (uint256)
    {
        if (mode == Mode.BLOCKED) revert Blocked();
        if (mode != Mode.V2) return super.withdraw(assets, receiver, owner_);
        uint256 shares = previewWithdraw(assets);
        _withdraw(_msgSender(), receiver, owner_, assets, shares);
        return shares;
    }

    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        returns (uint256)
    {
        if (mode == Mode.BLOCKED) revert Blocked();
        if (mode != Mode.V2) return super.redeem(shares, receiver, owner_);
        uint256 assets = previewRedeem(shares);
        _withdraw(_msgSender(), receiver, owner_, assets, shares);
        return assets;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (sharesLocked && from != address(0) && to != address(0)) revert SharesNotTransferable();
        super._update(from, to, value);
    }
}
