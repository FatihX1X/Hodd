// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Stand-in for Circle's `RolesAuthority`. Role 0 ("investor") is the allowlist; every
///      capability is granted to it. Like the real one, `canCall` REVERTS with `NoAccess` while
///      the authority is paused.
contract MockRolesAuthority {
    error NoAccess();

    bool public paused;
    mapping(address => bool) public investor; // role 0
    mapping(address => bool) public fundAdmin; // role 255

    function setUserRole(address user, uint8 role, bool enabled) external {
        if (role == 0) investor[user] = enabled;
        else if (role == type(uint8).max) fundAdmin[user] = enabled;
    }

    function setPaused(bool value) external {
        paused = value;
    }

    function doesUserHaveRole(address user, uint8 role) external view returns (bool) {
        if (paused) revert NoAccess();
        return role == type(uint8).max ? fundAdmin[user] : investor[user];
    }

    function canCall(address user, address, bytes4) public view returns (bool) {
        if (paused) revert NoAccess();
        return investor[user];
    }

    function canCall(address user1, address user2, address target, bytes4 sig)
        external
        view
        returns (bool)
    {
        return canCall(user1, target, sig) && canCall(user2, target, sig);
    }
}

/// @dev Stand-in for the permissioned USYC token (`YieldCoinSatellite`): 6 decimals,
///      `transfer` needs the sender AND the recipient allowlisted, `transferFrom` needs the caller
///      and both parties, `mint`/`burn` only for minters (the Teller) and an allowlisted account.
contract MockUSYC is ERC20 {
    error NotPermissioned();

    bytes4 internal constant TRANSFER_SELECTOR = bytes4(keccak256("transfer(address,uint256)"));

    MockRolesAuthority public immutable authority;
    mapping(address => bool) public minter;

    constructor(MockRolesAuthority authority_) ERC20("Mock USYC", "mUSYC") {
        authority = authority_;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function setMinter(address who, bool enabled) external {
        minter[who] = enabled;
    }

    function _can(address who) internal view returns (bool) {
        return authority.canCall(who, address(this), TRANSFER_SELECTOR);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (!_can(msg.sender) || !_can(to)) revert NotPermissioned();
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (!_can(msg.sender) || !_can(from) || !_can(to)) revert NotPermissioned();
        return super.transferFrom(from, to, amount);
    }

    function mint(address to, uint256 amount) external returns (bool) {
        if (!minter[msg.sender] || !_can(to)) revert NotPermissioned();
        _mint(to, amount);
        return true;
    }

    function burn(address from, uint256 amount) external {
        if (!minter[msg.sender] || !_can(from)) revert NotPermissioned();
        _burn(from, amount);
    }
}

/// @dev Stand-in for Circle's `Teller` (USYC for USDC), reproducing the behaviour the vault has
///      to live with: `deposit/withdraw/redeem` with ERC-4626 selectors but a SEPARATE share
///      token, permission checks exactly like the real `Access` (caller allowlisted for the
///      function, receiver allowlisted for the token, both `account` and `receiver` on
///      redeem/withdraw), a per-account daily redemption/subscription limit counted in USDC,
///      redemptions paid from a separate treasury, an oracle price with a "next price" used for
///      subscriptions, and optional fees.
contract MockTeller {
    error NotPermissioned();
    error LimitExceeded();
    error ZeroShares();
    error ZeroAssets();

    bytes4 internal constant TRANSFER_SELECTOR = bytes4(keccak256("transfer(address,uint256)"));
    uint256 internal constant SCALE = 1e18;

    IERC20 public immutable asset;
    MockUSYC public immutable share;
    MockRolesAuthority public immutable authority;
    address public treasury;
    address public feeRecipient;

    /// @dev Price of one share in assets, scaled by 1e18 (the "latest" oracle price).
    uint256 public price = 1.14e18;
    /// @dev Price used for subscriptions when `useNextPrice` is on (stale price / after cut-off).
    uint256 public nextPrice = 1.1405e18;
    bool public useNextPrice;
    uint256 public depositFeeBps;
    uint256 public redeemFeeBps;
    uint256 public subscribeLimit = type(uint256).max;
    uint256 public redeemLimit = type(uint256).max;

    mapping(address => mapping(uint256 => uint256)) public subscription;
    mapping(address => mapping(uint256 => uint256)) public redemption;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(
        IERC20 asset_,
        MockUSYC share_,
        MockRolesAuthority authority_,
        address treasury_,
        address feeRecipient_
    ) {
        asset = asset_;
        share = share_;
        authority = authority_;
        treasury = treasury_;
        feeRecipient = feeRecipient_;
    }

    /*//////////////////////////////////////////////////////////////
                               CONFIGURATION
    //////////////////////////////////////////////////////////////*/

    function configure(
        uint256 price_,
        uint256 nextPrice_,
        bool useNextPrice_,
        uint256 depositFeeBps_,
        uint256 redeemFeeBps_
    ) external {
        price = price_;
        nextPrice = nextPrice_;
        useNextPrice = useNextPrice_;
        depositFeeBps = depositFeeBps_;
        redeemFeeBps = redeemFeeBps_;
    }

    function setLimits(uint256 subscribeLimit_, uint256 redeemLimit_) external {
        subscribeLimit = subscribeLimit_;
        redeemLimit = redeemLimit_;
    }

    /*//////////////////////////////////////////////////////////////
                                  ACCESS
    //////////////////////////////////////////////////////////////*/

    function _assertPermission(address who) internal view {
        if (!authority.canCall(who, address(this), msg.sig)) revert NotPermissioned();
    }

    function _assertCanReceive(address who) internal view {
        if (!authority.canCall(who, address(share), TRANSFER_SELECTOR)) revert NotPermissioned();
    }

    function _assertCanReceive(address a, address b) internal view {
        if (!authority.canCall(a, b, address(share), TRANSFER_SELECTOR)) revert NotPermissioned();
    }

    /*//////////////////////////////////////////////////////////////
                                   VIEWS
    //////////////////////////////////////////////////////////////*/

    function todayTimestamp() public view returns (uint256) {
        return (block.timestamp / 1 days) * 1 days;
    }

    /// @dev USDC value of `shares` at the latest price (what the real Teller's `convertToAssets` does).
    function convertToAssets(uint256 shares) external view returns (uint256) {
        return (shares * price) / SCALE;
    }

    function mintPrice() public view returns (uint256) {
        return useNextPrice ? nextPrice : price;
    }

    function subscriptionLimitRemaining(address account, uint256 date)
        public
        view
        returns (uint256)
    {
        uint256 used = subscription[account][date];
        return used > subscribeLimit ? 0 : subscribeLimit - used;
    }

    function redemptionLimitRemaining(address account, uint256 date) public view returns (uint256) {
        uint256 used = redemption[account][date];
        return used > redeemLimit ? 0 : redeemLimit - used;
    }

    function totalAssets(address) public view returns (uint256) {
        uint256 bal = asset.balanceOf(treasury);
        uint256 alw = asset.allowance(treasury, address(this));
        return bal < alw ? bal : alw;
    }

    function previewDepositData(address, uint256 assets)
        public
        view
        returns (uint256 shares, uint256 fee, uint256 price_)
    {
        fee = (assets * depositFeeBps) / 10_000;
        price_ = mintPrice();
        shares = ((assets - fee) * SCALE) / price_;
    }

    function previewRedeemData(address, uint256 shares)
        public
        view
        returns (uint256 assets, uint256 fee, uint256 price_)
    {
        price_ = price;
        assets = (shares * price_) / SCALE;
        fee = (assets * redeemFeeBps) / 10_000;
        assets -= fee;
    }

    function previewWithdrawData(address, uint256 assets)
        public
        view
        returns (uint256 shares, uint256 fee, uint256 price_)
    {
        fee = (assets * redeemFeeBps) / 10_000;
        price_ = price;
        shares = ((assets + fee) * SCALE + price_ - 1) / price_;
    }

    function maxRedeem(address account) public view returns (uint256 maxShares) {
        uint256 avail = totalAssets(account);
        uint256 remaining = redemptionLimitRemaining(account, todayTimestamp());
        if (remaining < avail) avail = remaining;
        maxShares = (avail * SCALE) / price;
        uint256 held = share.balanceOf(account);
        if (maxShares > held) maxShares = held;
    }

    /*//////////////////////////////////////////////////////////////
                                  ACTIONS
    //////////////////////////////////////////////////////////////*/

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        uint256 fee;
        (shares, fee,) = previewDepositData(msg.sender, assets);
        if (shares == 0) revert ZeroShares();

        _assertPermission(msg.sender);
        _assertCanReceive(receiver);

        uint256 today = todayTimestamp();
        uint256 net = assets - fee;
        if (subscriptionLimitRemaining(msg.sender, today) < net) revert LimitExceeded();
        subscription[msg.sender][today] += net;

        require(asset.transferFrom(msg.sender, treasury, net), "pull");
        if (fee > 0) require(asset.transferFrom(msg.sender, feeRecipient, fee), "pull fee");
        share.mint(receiver, shares);
    }

    function _spendAllowance(address account, uint256 shares) internal {
        if (msg.sender != account) {
            uint256 allowed = allowance[account][msg.sender];
            if (allowed != type(uint256).max) allowance[account][msg.sender] = allowed - shares;
        }
    }

    function _outbound(
        address account,
        uint256 assets,
        uint256 shares,
        uint256 fee,
        address receiver
    ) internal {
        uint256 today = todayTimestamp();
        if (redemptionLimitRemaining(account, today) < assets) revert LimitExceeded();
        redemption[account][today] += assets;

        share.burn(account, shares);
        require(asset.transferFrom(treasury, receiver, assets), "pay");
        if (fee > 0) require(asset.transferFrom(treasury, feeRecipient, fee), "pay fee");
    }

    function withdraw(uint256 assets, address receiver, address account)
        external
        returns (uint256 shares)
    {
        uint256 fee;
        (shares, fee,) = previewWithdrawData(account, assets);
        if (shares == 0) revert ZeroShares();

        _spendAllowance(account, shares);
        _assertPermission(msg.sender);
        _assertCanReceive(account, receiver);
        _outbound(account, assets, shares, fee, receiver);
    }

    function redeem(uint256 shares, address receiver, address account)
        external
        returns (uint256 assets)
    {
        _spendAllowance(account, shares);

        uint256 fee;
        (assets, fee,) = previewRedeemData(account, shares);
        if (assets == 0) revert ZeroAssets();

        _assertPermission(msg.sender);
        _assertCanReceive(account, receiver);
        _outbound(account, assets, shares, fee, receiver);
    }
}
