// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ITeller
/// @notice The slice of Circle's USYC `Teller` that {HoddUSYCVault} uses. The real Teller is
///         ERC-4626-shaped but has a separate share token (`share()`, USYC), prices subscriptions
///         at a possibly different ("next") price than redemptions, and enforces an allowlist on
///         the caller and on the receiver of USYC.
interface ITeller {
    /// @notice The token subscribed with and redeemed into (USDC).
    function asset() external view returns (address);

    /// @notice The token received on subscription (USYC).
    function share() external view returns (address);

    /// @notice Subscribe `assets` USDC (pulled from the caller) and mint USYC to `receiver`.
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    /// @notice Burn `shares` USYC of `account` and pay USDC to `receiver`.
    function redeem(uint256 shares, address receiver, address account)
        external
        returns (uint256 assets);

    /// @notice Shares a subscription of `assets` by `account` would mint, with fee and price.
    function previewDepositData(address account, uint256 assets)
        external
        view
        returns (uint256 shares, uint256 fee, int256 price);

    /// @notice USDC a redemption of `shares` by `account` would pay (after fee), with fee, price.
    function previewRedeemData(address account, uint256 shares)
        external
        view
        returns (uint256 assets, uint256 fee, int256 price);

    /// @notice USDC value of `shares` at the current (latest) oracle price.
    function convertToAssets(uint256 shares) external view returns (uint256 assets);

    /// @notice Most USYC `account` can redeem now (daily limit, treasury liquidity, balance).
    function maxRedeem(address account) external view returns (uint256 maxShares);

    /// @notice USDC `account` may still subscribe on the UTC day starting at `date`.
    function subscriptionLimitRemaining(address account, uint256 date)
        external
        view
        returns (uint256 assets);

    /// @notice USDC `account` may still redeem on the UTC day starting at `date`.
    function redemptionLimitRemaining(address account, uint256 date)
        external
        view
        returns (uint256 assets);

    /// @notice Start of the current UTC day (the key of the daily limits).
    function todayTimestamp() external view returns (uint256);
}
