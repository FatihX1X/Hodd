// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {RollingWindow} from "./RollingWindow.sol";

/// @title HoddieVault
/// @author Hodd
/// @notice A non-custodial, per-user vault that holds USDC for its `owner` and lets a limited
///         `operator` (Hodd's agent wallet) move it only to a small set of safe destinations.
/// @dev Trust model in one paragraph:
///      - The OWNER (the user's own wallet, EOA or ERC-1271 smart account) can always take every
///        asset out (`withdrawAll`, `exitStrategy`, `rescueToken`), also while the vault is paused
///        and also when the operator is gone. Nothing the operator does can block these calls.
///      - The OPERATOR can only (a) deposit idle USDC into an owner-allowlisted ERC-4626 strategy,
///        (b) withdraw/redeem from such a strategy back into this vault, or redeem and send the
///        USDC straight on to the owner, (c) send idle USDC to the owner, and (d) pay an
///        owner-approved recipient. (a) and (d) have separate budgets, each
///        capped per transaction and over a rolling 24 hours (see {RollingWindow} for the exact
///        guarantee), and (d) is capped per recipient as well. Every strategy call carries a
///        slippage bound that is checked against the vault's real balance changes. The operator
///        can never choose a receiver other than this vault, the owner or an approved recipient,
///        and cannot change any setting.
///      - Everyone else can only submit an owner-signed EIP-712 `AddRecipient` message.
///      The contract is not upgradeable, has no `receive`/`fallback` (native value reverts) and
///      ownership can not be renounced (that would lock the funds).
///
///      Strategies. Every strategy is an ERC-4626 vault over `asset` whose shares are its own
///      token: Morpho, and Hodd's USYC pool (HoddUSYCVault). The vault never holds USYC itself.
///      Redemptions always name this vault as receiver and holder, because the USYC pool only
///      redeems to its holder (its shares are not transferable and `withdraw` is not supported);
///      when the USDC is meant for the owner it is forwarded in the same transaction, exactly
///      the amount that arrived (measured by balance). Whether Circle lets the pool buy or
///      redeem USYC is the pool's matter: this vault needs no allowlisting of its own.
contract HoddieVault is Ownable2Step, ReentrancyGuard, Pausable, EIP712, Nonces {
    using SafeERC20 for IERC20;
    using RollingWindow for RollingWindow.Window;

    /// @notice The four operator limits (USDC base units). The two 24-hour limits must fit in
    ///         `uint64` (about 1.8e13 USDC); use that value for "effectively unlimited".
    struct Limits {
        uint256 maxDepositPerTx;
        uint256 depositLimit24h;
        uint256 maxPaymentPerTx;
        uint256 paymentLimit24h;
    }

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Maximum number of simultaneously allowlisted strategies.
    uint256 public constant MAX_STRATEGIES = 8;

    /// @notice EIP-712 type hash of the owner-signed "approve this payment recipient" message.
    bytes32 public constant ADD_RECIPIENT_TYPEHASH = keccak256(
        "AddRecipient(address recipient,uint256 maxPerPayment,uint256 nonce,uint256 deadline)"
    );

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The ERC-20 this vault holds and every strategy must use (USDC).
    IERC20 public immutable asset;

    /// @notice The only address that may call the operator functions. `address(0)` = revoked.
    address public operator;

    /// @notice Maximum USDC (base units) the operator may deposit into strategies in one call.
    uint256 public maxDepositPerTx;

    /// @notice Maximum USDC (base units) of strategy deposits over a rolling 24 hours.
    uint256 public depositLimit24h;

    /// @notice Maximum USDC (base units) of one payment, whoever the recipient is.
    uint256 public maxPaymentPerTx;

    /// @notice Maximum USDC (base units) of payments over a rolling 24 hours.
    uint256 public paymentLimit24h;

    RollingWindow.Window private _depositWindow;
    RollingWindow.Window private _paymentWindow;

    /// @notice Whether `strategy` is an allowlisted ERC-4626 strategy.
    mapping(address strategy => bool) public isStrategy;

    /// @notice Whether `recipient` is approved to receive operator payments.
    mapping(address recipient => bool) public isRecipient;

    /// @notice The most the operator may pay `recipient` in one payment (0 if not approved).
    mapping(address recipient => uint256) public recipientCap;

    address[] private _strategies;

    /*//////////////////////////////////////////////////////////////
                                  EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice The operator changed (also emitted once by the constructor).
    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);
    /// @notice The spending limits changed (also emitted once by the constructor).
    event LimitsUpdated(
        uint256 maxDepositPerTx,
        uint256 depositLimit24h,
        uint256 maxPaymentPerTx,
        uint256 paymentLimit24h
    );
    /// @notice A strategy was added to the allowlist.
    event StrategyAllowed(address indexed strategy);
    /// @notice A strategy was removed from the allowlist. Shares already held stay in the vault.
    event StrategyDisallowed(address indexed strategy);
    /// @notice A payment recipient was approved with a cap per payment.
    event RecipientAdded(address indexed recipient, uint256 maxPerPayment);
    /// @notice The cap per payment of an already approved recipient changed.
    event RecipientCapUpdated(address indexed recipient, uint256 maxPerPayment);
    /// @notice A payment recipient was removed.
    event RecipientRemoved(address indexed recipient);
    /// @notice The operator deposited idle USDC into a strategy.
    event DepositedToStrategy(address indexed strategy, uint256 assets, uint256 shares);
    /// @notice The operator withdrew an exact USDC amount from a strategy into the vault.
    event WithdrawnFromStrategy(address indexed strategy, uint256 assets, uint256 shares);
    /// @notice The operator redeemed an exact share amount from a strategy into the vault.
    event RedeemedFromStrategy(address indexed strategy, uint256 shares, uint256 assets);
    /// @notice The operator redeemed shares and the USDC that arrived went straight on to the owner.
    event RedeemedToOwner(
        address indexed strategy, address indexed owner, uint256 shares, uint256 assets
    );
    /// @notice The operator sent idle USDC to the owner.
    event TransferredToOwner(address indexed owner, uint256 amount);
    /// @notice The operator paid an approved recipient. `ref` lets Hodd match the payment to a bill.
    event Payment(address indexed recipient, uint256 amount, bytes32 indexed ref);
    /// @notice The owner ran `withdrawAll` (or `exitStrategy`) for one strategy.
    /// @dev `assetsReceived` is the USDC that arrived in the vault from the redemption (measured
    ///      by balance) and was forwarded to the owner.
    event StrategyExited(
        address indexed strategy,
        uint256 sharesRedeemed,
        uint256 assetsReceived,
        uint256 sharesSentToOwner
    );
    /// @notice A strategy could not be fully exited. `sharesLeft` is what remains in the vault
    ///         (0 if even the share balance could not be read). Recover it with `rescueToken`.
    event StrategyExitFailed(address indexed strategy, uint256 sharesLeft);
    /// @notice The owner ran `withdrawAll`; `idleAssets` is the idle USDC sent to the owner.
    event WithdrawnAll(address indexed owner, uint256 idleAssets);
    /// @notice The owner rescued a token to itself.
    event TokenRescued(address indexed token, address indexed to, uint256 amount);
    /// @notice The owner skipped its current signature nonce, cancelling unsubmitted signatures.
    event NonceInvalidated(address indexed signer, uint256 newNonce);

    /*//////////////////////////////////////////////////////////////
                                  ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotOperator();
    error ZeroAddress();
    error ZeroAmount();
    error ZeroShares();
    error RenounceDisabled();
    error InvalidStrategy(address strategy);
    error StrategyNotAllowed(address strategy);
    error StrategyAlreadyAllowed(address strategy);
    error TooManyStrategies();
    error InvalidRecipient(address recipient);
    error RecipientNotApproved(address recipient);
    error ZeroSlippageBound();
    error InsufficientShares(uint256 received, uint256 minShares);
    error SharesExceedMax(uint256 burned, uint256 maxShares);
    error InsufficientAssets(uint256 received, uint256 minAssets);
    error LimitTooLarge(uint256 limit);
    error ExceedsMaxDepositPerTx(uint256 amount, uint256 maxPerTx);
    error ExceedsDepositLimit24h(uint256 attemptedTotal, uint256 limit);
    error ExceedsMaxPaymentPerTx(uint256 amount, uint256 maxPerTx);
    error ExceedsPaymentLimit24h(uint256 attemptedTotal, uint256 limit);
    error ExceedsRecipientCap(uint256 amount, uint256 cap);
    error SignatureExpired(uint256 deadline);
    error InvalidSignature();

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOperator() {
        // `operator == address(0)` means "revoked": never let that match a caller.
        address op = operator;
        if (op == address(0) || msg.sender != op) revert NotOperator();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @param asset_ The ERC-20 held by the vault (USDC).
    /// @param owner_ The user's wallet (EOA or ERC-1271 smart account). Must not be zero.
    /// @param operator_ Hodd's agent wallet, or `address(0)` for none.
    /// @param limits_ Deposit and payment limits (USDC base units), see {Limits}.
    /// @param strategies_ Initial strategy allowlist (each must be an ERC-4626 vault over
    ///        `asset_`). No recipients are approved initially.
    constructor(
        IERC20 asset_,
        address owner_,
        address operator_,
        Limits memory limits_,
        address[] memory strategies_
    ) Ownable(owner_) EIP712("HoddieVault", "1") {
        if (address(asset_) == address(0)) revert ZeroAddress();
        asset = asset_;

        operator = operator_;
        emit OperatorUpdated(address(0), operator_);

        _setLimits(limits_);

        for (uint256 i; i < strategies_.length; ++i) {
            _allowStrategy(strategies_[i]);
        }
    }

    /// @dev Native value is never accepted: there is no `receive`/`fallback`, and every function
    ///      is non-payable.

    /*//////////////////////////////////////////////////////////////
                           OPERATOR FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Deposit idle USDC into an allowlisted ERC-4626 strategy. Shares go to this vault.
    /// @dev Counts against `maxDepositPerTx` and `depositLimit24h`. Approves exactly `assets`, then
    ///      resets the allowance to zero. The shares received are MEASURED as the change of the
    ///      vault's balance of the strategy's share token (not taken from the return value) and
    ///      must be at least `minShares`; `minShares` must not be zero, the caller has to state
    ///      what it expects. The USYC pool prices a deposit with Circle's next price when the
    ///      oracle is stale or after its cut-off, so an immediate redemption can return slightly
    ///      less than was deposited.
    /// @param strategy The allowlisted strategy.
    /// @param assets USDC amount (base units) to deposit.
    /// @param minShares Minimum share tokens the vault must end up with (> 0).
    /// @return shares Share tokens the vault received.
    function depositToStrategy(address strategy, uint256 assets, uint256 minShares)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        if (!isStrategy[strategy]) revert StrategyNotAllowed(strategy);
        if (assets == 0) revert ZeroAmount();
        if (minShares == 0) revert ZeroSlippageBound();
        _spendDeposit(assets);

        IERC20 shareToken = IERC20(strategy);
        uint256 sharesBefore = shareToken.balanceOf(address(this));

        asset.forceApprove(strategy, assets);
        IERC4626(strategy).deposit(assets, address(this));
        asset.forceApprove(strategy, 0);

        uint256 sharesAfter = shareToken.balanceOf(address(this));
        shares = sharesAfter > sharesBefore ? sharesAfter - sharesBefore : 0;
        if (shares == 0) revert ZeroShares();
        if (shares < minShares) revert InsufficientShares(shares, minShares);
        emit DepositedToStrategy(strategy, assets, shares);
    }

    /// @notice Withdraw an exact USDC amount from a strategy back into this vault.
    /// @dev Receiver and share owner are always this vault. Not subject to the spending limits
    ///      because the funds stay in custody. Strategies without `withdraw` (the USYC pool)
    ///      revert here; use {redeemFromStrategy} or {redeemToOwner}. The shares burned and the USDC
    ///      received are MEASURED from balance changes: the vault must receive at least `assets`
    ///      and burn at most `maxShares`.
    /// @param strategy The allowlisted strategy.
    /// @param assets USDC amount (base units) to withdraw.
    /// @param maxShares Maximum share tokens the vault is willing to burn (> 0).
    /// @return shares Share tokens burned.
    function withdrawFromStrategy(address strategy, uint256 assets, uint256 maxShares)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        if (!isStrategy[strategy]) revert StrategyNotAllowed(strategy);
        if (assets == 0) revert ZeroAmount();
        if (maxShares == 0) revert ZeroSlippageBound();

        IERC20 shareToken = IERC20(strategy);
        uint256 sharesBefore = shareToken.balanceOf(address(this));
        uint256 assetsBefore = asset.balanceOf(address(this));

        IERC4626(strategy).withdraw(assets, address(this), address(this));

        uint256 sharesAfter = shareToken.balanceOf(address(this));
        shares = sharesBefore > sharesAfter ? sharesBefore - sharesAfter : 0;
        uint256 received = asset.balanceOf(address(this)) - assetsBefore;
        if (received < assets) revert InsufficientAssets(received, assets);
        if (shares > maxShares) revert SharesExceedMax(shares, maxShares);
        emit WithdrawnFromStrategy(strategy, assets, shares);
    }

    /// @notice Redeem an exact share amount from a strategy back into this vault.
    /// @dev Receiver and share owner are always this vault. Not subject to the spending limits.
    ///      The USDC received is MEASURED as the change of the vault's balance and must be at least
    ///      `minAssets`; `minAssets` must not be zero.
    /// @param strategy The allowlisted strategy.
    /// @param shares Strategy shares to burn.
    /// @param minAssets Minimum USDC (base units) the vault must receive (> 0).
    /// @return assets USDC received by this vault.
    function redeemFromStrategy(address strategy, uint256 shares, uint256 minAssets)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        if (!isStrategy[strategy]) revert StrategyNotAllowed(strategy);
        if (shares == 0) revert ZeroAmount();
        if (minAssets == 0) revert ZeroSlippageBound();

        uint256 assetsBefore = asset.balanceOf(address(this));
        IERC4626(strategy).redeem(shares, address(this), address(this));
        assets = asset.balanceOf(address(this)) - assetsBefore;

        if (assets < minAssets) revert InsufficientAssets(assets, minAssets);
        emit RedeemedFromStrategy(strategy, shares, assets);
    }

    /// @notice Redeem an exact share amount from a strategy and send the USDC straight on to the
    ///         owner in the same transaction (for example out of Hodd's USYC pool, which only
    ///         pays its holder).
    /// @dev Not subject to the spending limits: the USDC can only go to the owner. The USDC is
    ///      MEASURED as the change of the vault's balance, must be at least `minAssets` (> 0) and
    ///      exactly that amount is forwarded; USDC that was already idle in the vault stays.
    /// @param strategy The allowlisted strategy.
    /// @param shares Strategy shares to burn.
    /// @param minAssets Minimum USDC (base units) the owner must receive (> 0).
    /// @return assets USDC sent to the owner.
    function redeemToOwner(address strategy, uint256 shares, uint256 minAssets)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        if (!isStrategy[strategy]) revert StrategyNotAllowed(strategy);
        if (shares == 0) revert ZeroAmount();
        if (minAssets == 0) revert ZeroSlippageBound();

        uint256 assetsBefore = asset.balanceOf(address(this));
        IERC4626(strategy).redeem(shares, address(this), address(this));
        assets = asset.balanceOf(address(this)) - assetsBefore;
        if (assets < minAssets) revert InsufficientAssets(assets, minAssets);

        address to = owner();
        asset.safeTransfer(to, assets);
        emit RedeemedToOwner(strategy, to, shares, assets);
    }

    /// @notice Send idle USDC to the owner. Not subject to the spending limits.
    /// @param amount USDC amount (base units).
    function transferToOwner(uint256 amount) external onlyOperator whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        address to = owner();
        asset.safeTransfer(to, amount);
        emit TransferredToOwner(to, amount);
    }

    /// @notice Pay an owner-approved recipient from idle USDC.
    /// @dev The amount must be within the recipient's own cap, `maxPaymentPerTx`, and the rolling
    ///      24-hour payment budget `paymentLimit24h` (which deposits do not share).
    /// @param recipient Must have been approved by the owner.
    /// @param amount USDC amount (base units).
    /// @param ref Free-form reference (e.g. a bill id hash) echoed in the {Payment} event.
    function pay(address recipient, uint256 amount, bytes32 ref)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
    {
        if (!isRecipient[recipient]) revert RecipientNotApproved(recipient);
        if (amount == 0) revert ZeroAmount();
        uint256 cap = recipientCap[recipient];
        if (amount > cap) revert ExceedsRecipientCap(amount, cap);
        _spendPayment(amount);

        asset.safeTransfer(recipient, amount);
        emit Payment(recipient, amount, ref);
    }

    /*//////////////////////////////////////////////////////////////
                             OWNER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Pause every operator function. Owner functions keep working.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the operator functions.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Set the per-transaction and rolling-24-hour limits of strategy deposits and payments.
    /// @dev Does not reset what was already spent in the last 24 hours: lowering a limit below
    ///      the amount already counted simply blocks further spending until it is released. The
    ///      effective per-call cap is the lower of the per-transaction cap and the 24-hour
    ///      limit. Setting a limit to 0 freezes that budget. Both 24-hour limits must fit in
    ///      `uint64`.
    /// @param maxDepositPerTx_ New per-call cap of strategy deposits.
    /// @param depositLimit24h_ New rolling-24-hour limit of strategy deposits.
    /// @param maxPaymentPerTx_ New per-payment cap.
    /// @param paymentLimit24h_ New rolling-24-hour limit of payments.
    function setLimits(
        uint256 maxDepositPerTx_,
        uint256 depositLimit24h_,
        uint256 maxPaymentPerTx_,
        uint256 paymentLimit24h_
    ) external onlyOwner {
        _setLimits(Limits(maxDepositPerTx_, depositLimit24h_, maxPaymentPerTx_, paymentLimit24h_));
    }

    /// @notice Replace the operator. `address(0)` revokes it.
    /// @param newOperator The new operator, or `address(0)`.
    function setOperator(address newOperator) external onlyOwner {
        _setOperator(newOperator);
    }

    /// @notice Revoke the operator. The vault then only answers to its owner.
    function revokeOperator() external onlyOwner {
        _setOperator(address(0));
    }

    /// @notice Allow the operator to use an ERC-4626 strategy.
    /// @dev The strategy must report `asset() == asset`. At most {MAX_STRATEGIES} at a time.
    /// @param strategy The strategy to allowlist.
    function allowStrategy(address strategy) external onlyOwner {
        _allowStrategy(strategy);
    }

    /// @notice Remove a strategy from the allowlist.
    /// @dev Removal never reverts because of the strategy's behaviour and never moves funds. Shares
    ///      the vault still holds stay in the vault and remain reachable by the owner through
    ///      {exitStrategy} (works for any address, allowlisted or not) or {rescueToken}. The
    ///      operator can no longer touch the strategy, and {withdrawAll} no longer visits it.
    /// @param strategy The strategy to remove.
    function disallowStrategy(address strategy) external onlyOwner {
        if (!isStrategy[strategy]) revert StrategyNotAllowed(strategy);
        isStrategy[strategy] = false;

        uint256 length = _strategies.length;
        for (uint256 i; i < length; ++i) {
            if (_strategies[i] == strategy) {
                _strategies[i] = _strategies[length - 1];
                _strategies.pop();
                break;
            }
        }
        emit StrategyDisallowed(strategy);
    }

    /// @notice Approve a recipient for operator payments with a cap per payment. If the
    ///         recipient is already approved only its cap changes.
    /// @param recipient The recipient to approve.
    /// @param maxPerPayment The most the operator may pay this recipient in one payment.
    function addRecipient(address recipient, uint256 maxPerPayment) external onlyOwner {
        _addRecipient(recipient, maxPerPayment);
    }

    /// @notice Change the cap per payment of an approved recipient.
    /// @param recipient The approved recipient.
    /// @param maxPerPayment The new cap. 0 means "approved but nothing can be paid".
    function setRecipientCap(address recipient, uint256 maxPerPayment) external onlyOwner {
        if (!isRecipient[recipient]) revert RecipientNotApproved(recipient);
        _addRecipient(recipient, maxPerPayment);
    }

    /// @notice Remove a payment recipient. Idempotent.
    /// @param recipient The recipient to remove.
    function removeRecipient(address recipient) external onlyOwner {
        if (isRecipient[recipient]) {
            isRecipient[recipient] = false;
            recipientCap[recipient] = 0;
            emit RecipientRemoved(recipient);
        }
    }

    /// @notice Approve a recipient (with a cap) using the owner's EIP-712 signature. Anyone may
    ///         submit it (Hodd's server pays the gas).
    /// @dev The owner signs `AddRecipient(address recipient,uint256 maxPerPayment,uint256
    ///      nonce,uint256 deadline)` in the domain `("HoddieVault", "1", chainId, thisVault)`,
    ///      where `nonce` is `nonces(owner())`. Valid for EOAs (ECDSA) and smart accounts
    ///      (ERC-1271 `isValidSignature(digest, sig)`). The nonce is consumed on success, so a
    ///      signature works once. Signatures only count for the owner at submission time, an
    ///      ownership change voids older signatures.
    /// @param recipient The recipient to approve.
    /// @param maxPerPayment The signed cap per payment.
    /// @param deadline Last second (inclusive) at which the signature may be submitted.
    /// @param signature The owner's signature over the EIP-712 digest.
    function addRecipientWithSig(
        address recipient,
        uint256 maxPerPayment,
        uint256 deadline,
        bytes calldata signature
    ) external {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert SignatureExpired(deadline);

        address signer = owner();
        bytes32 digest = _addRecipientDigest(recipient, maxPerPayment, nonces(signer), deadline);
        if (!SignatureChecker.isValidSignatureNowCalldata(signer, digest, signature)) {
            revert InvalidSignature();
        }

        _useNonce(signer);
        _addRecipient(recipient, maxPerPayment);
    }

    /// @notice Cancel the owner's currently unsubmitted signature(s) by consuming the current nonce.
    /// @dev Each call bumps the nonce by one, so a signature made for the old nonce stops working.
    /// @return newNonce The nonce the next valid signature must use.
    function invalidateNonce() external onlyOwner returns (uint256 newNonce) {
        address signer = owner();
        _useNonce(signer);
        newNonce = nonces(signer);
        emit NonceInvalidated(signer, newNonce);
    }

    /// @notice Take everything out to the owner. Works when paused and without an operator.
    /// @dev For every allowlisted strategy holding shares it (1) tries to redeem all shares into
    ///      the vault, (2) if that fails, redeems `maxRedeem` shares, forwarding exactly the USDC
    ///      that arrived to the owner, and (3) sends any shares still left to the owner as share
    ///      tokens so they can redeem later (not possible for the USYC pool, whose shares can not
    ///      be transferred: those stay in the vault for a later `exitStrategy`). Each step uses
    ///      guarded low-level calls: a strategy that reverts, returns garbage or has no code is
    ///      skipped (`StrategyExitFailed`) and can not block the others. Finally all idle USDC
    ///      goes to the owner. (Morpho Vault V2 reports `maxRedeem == 0`, hence step 1 first.)
    ///      If a strategy burns all gas, call {disallowStrategy} for it first (constant gas) or
    ///      use {exitStrategy} per strategy.
    function withdrawAll() external onlyOwner nonReentrant {
        address to = owner();
        uint256 length = _strategies.length;
        for (uint256 i; i < length; ++i) {
            _exitStrategy(_strategies[i], to);
        }

        uint256 idle = asset.balanceOf(address(this));
        if (idle != 0) asset.safeTransfer(to, idle);
        emit WithdrawnAll(to, idle);
    }

    /// @notice Exit a single strategy to the owner, with the same logic as {withdrawAll}.
    /// @dev Works for any address (also strategies that were removed from the allowlist) and
    ///      never sends anything but the redeemed USDC (exactly what arrived) or the share tokens
    ///      to the owner. Does not touch USDC that was already idle in the vault.
    /// @param strategy The strategy to exit.
    function exitStrategy(address strategy) external onlyOwner nonReentrant {
        _exitStrategy(strategy, owner());
    }

    /// @notice Send any token held by the vault to the owner.
    /// @dev Always to `owner()`. Also recovers strategy shares and tokens sent here by mistake.
    /// @param token The ERC-20 to rescue.
    /// @param amount The amount to send.
    function rescueToken(IERC20 token, uint256 amount) external onlyOwner nonReentrant {
        address to = owner();
        token.safeTransfer(to, amount);
        emit TokenRescued(address(token), to, amount);
    }

    /// @dev Ownership can not be renounced: the owner is the only address that can exit the vault.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice The allowlisted strategies.
    /// @return The strategy addresses (order may change when one is removed).
    function strategies() external view returns (address[] memory) {
        return _strategies;
    }

    /// @notice Number of allowlisted strategies.
    /// @return The count.
    function strategyCount() external view returns (uint256) {
        return _strategies.length;
    }

    /// @notice USDC of strategy deposits counted against the rolling 24-hour limit right now.
    /// @dev Hour-granular: a deposit counts from its hour until the start of the 25th hour after
    ///      it, see {RollingWindow}.
    /// @return Amount (base units).
    function depositSpentLast24h() public view returns (uint256) {
        return _depositWindow.spent(block.timestamp);
    }

    /// @notice USDC of payments counted against the rolling 24-hour limit right now.
    /// @return Amount (base units).
    function paymentSpentLast24h() public view returns (uint256) {
        return _paymentWindow.spent(block.timestamp);
    }

    /// @notice The most the operator could deposit into a strategy in one call right now.
    /// @return Amount (base units): the lower of `maxDepositPerTx` and the 24-hour room left.
    function remainingDepositAllowance() external view returns (uint256) {
        return _min(maxDepositPerTx, _room(depositLimit24h, depositSpentLast24h()));
    }

    /// @notice The most the operator could pay out in one payment right now (any recipient).
    /// @return Amount (base units): the lower of `maxPaymentPerTx` and the 24-hour room left.
    function remainingPaymentAllowance() public view returns (uint256) {
        return _min(maxPaymentPerTx, _room(paymentLimit24h, paymentSpentLast24h()));
    }

    /// @notice The most the operator could pay `recipient` in one payment right now.
    /// @param recipient The recipient.
    /// @return Amount (base units), 0 if the recipient is not approved.
    function remainingPaymentAllowanceFor(address recipient) external view returns (uint256) {
        if (!isRecipient[recipient]) return 0;
        return _min(recipientCap[recipient], remainingPaymentAllowance());
    }

    /// @notice The EIP-712 digest the owner must sign to approve `recipient` with the current nonce.
    /// @param recipient The recipient to approve.
    /// @param maxPerPayment The cap per payment being signed.
    /// @param deadline Signature expiry (unix seconds).
    /// @return The digest passed to ECDSA / ERC-1271 verification.
    function addRecipientDigest(address recipient, uint256 maxPerPayment, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _addRecipientDigest(recipient, maxPerPayment, nonces(owner()), deadline);
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    function _room(uint256 limit, uint256 spent) private pure returns (uint256) {
        return spent >= limit ? 0 : limit - spent;
    }

    function _addRecipientDigest(
        address recipient,
        uint256 maxPerPayment,
        uint256 nonce,
        uint256 deadline
    ) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(ADD_RECIPIENT_TYPEHASH, recipient, maxPerPayment, nonce, deadline))
        );
    }

    function _setOperator(address newOperator) private {
        address previous = operator;
        operator = newOperator;
        emit OperatorUpdated(previous, newOperator);
    }

    function _setLimits(Limits memory l) private {
        if (l.depositLimit24h > type(uint64).max) revert LimitTooLarge(l.depositLimit24h);
        if (l.paymentLimit24h > type(uint64).max) revert LimitTooLarge(l.paymentLimit24h);
        maxDepositPerTx = l.maxDepositPerTx;
        depositLimit24h = l.depositLimit24h;
        maxPaymentPerTx = l.maxPaymentPerTx;
        paymentLimit24h = l.paymentLimit24h;
        emit LimitsUpdated(
            l.maxDepositPerTx, l.depositLimit24h, l.maxPaymentPerTx, l.paymentLimit24h
        );
    }

    function _addRecipient(address recipient, uint256 maxPerPayment) private {
        if (recipient == address(0) || recipient == address(this) || recipient == address(asset)) {
            revert InvalidRecipient(recipient);
        }
        if (!isRecipient[recipient]) {
            isRecipient[recipient] = true;
            recipientCap[recipient] = maxPerPayment;
            emit RecipientAdded(recipient, maxPerPayment);
        } else if (recipientCap[recipient] != maxPerPayment) {
            recipientCap[recipient] = maxPerPayment;
            emit RecipientCapUpdated(recipient, maxPerPayment);
        }
    }

    function _allowStrategy(address strategy) private {
        if (isStrategy[strategy]) revert StrategyAlreadyAllowed(strategy);
        if (_strategies.length >= MAX_STRATEGIES) revert TooManyStrategies();
        // The vault itself exposes `asset()` too, so it must be excluded explicitly.
        if (strategy == address(this) || strategy.code.length == 0) {
            revert InvalidStrategy(strategy);
        }

        try IERC4626(strategy).asset() returns (address strategyAsset) {
            if (strategyAsset != address(asset)) revert InvalidStrategy(strategy);
        } catch {
            revert InvalidStrategy(strategy);
        }

        isStrategy[strategy] = true;
        _strategies.push(strategy);
        emit StrategyAllowed(strategy);
    }

    /// @dev Counts a strategy deposit against `maxDepositPerTx` and the rolling 24-hour limit.
    function _spendDeposit(uint256 amount) private {
        if (amount > maxDepositPerTx) revert ExceedsMaxDepositPerTx(amount, maxDepositPerTx);
        (bool ok, uint256 total) = _depositWindow.tryAdd(block.timestamp, amount, depositLimit24h);
        if (!ok) revert ExceedsDepositLimit24h(total, depositLimit24h);
    }

    /// @dev Counts a payment against `maxPaymentPerTx` and the rolling 24-hour limit.
    function _spendPayment(uint256 amount) private {
        if (amount > maxPaymentPerTx) revert ExceedsMaxPaymentPerTx(amount, maxPaymentPerTx);
        (bool ok, uint256 total) = _paymentWindow.tryAdd(block.timestamp, amount, paymentLimit24h);
        if (!ok) revert ExceedsPaymentLimit24h(total, paymentLimit24h);
    }

    /// @dev Best-effort exit of `strategy` to `to`. Never reverts because of the strategy.
    function _exitStrategy(address strategy, address to) private {
        (bool ok, uint256 shares) =
            _staticUint(strategy, abi.encodeCall(IERC20.balanceOf, (address(this))));
        if (!ok) {
            emit StrategyExitFailed(strategy, 0);
            return;
        }
        if (shares == 0) return;

        // 1) + 2) Redeem everything into the vault, else what the strategy says it can serve
        //    now, and forward exactly the USDC that arrived. (Best effort: if the transfer fails
        //    the USDC stays idle and the sweep of `withdrawAll` or `rescueToken` picks it up.)
        uint256 received = _redeemBestEffort(strategy, shares);
        if (received != 0) {
            _callUint(address(asset), abi.encodeCall(IERC20.transfer, (to, received)));
        }

        // 3) Whatever is still in the vault goes to the owner as share tokens, where possible.
        (uint256 redeemed, uint256 sent, uint256 left) = _returnShares(strategy, shares, to);

        emit StrategyExited(strategy, redeemed, received, sent);
        if (left != 0) emit StrategyExitFailed(strategy, left);
    }

    /// @dev Redeem all `shares`; if that fails redeem `maxRedeem` shares if it is a proper
    ///      partial. Returns the USDC that arrived in the vault.
    function _redeemBestEffort(address strategy, uint256 shares) private returns (uint256) {
        (bool ok, uint256 received) = _tryRedeem(strategy, shares);
        if (ok) return received;

        (bool okMax, uint256 maxShares) =
            _staticUint(strategy, abi.encodeCall(IERC4626.maxRedeem, (address(this))));
        if (okMax && maxShares != 0 && maxShares < shares) {
            (ok, received) = _tryRedeem(strategy, maxShares);
            if (ok) return received;
        }
        return 0;
    }

    /// @dev Guarded `redeem(shares, this, this)`: this vault is always receiver and holder.
    ///      `received` is the USDC that arrived, measured by balance (never the reported value).
    function _tryRedeem(address strategy, uint256 shares)
        private
        returns (bool ok, uint256 received)
    {
        uint256 before = asset.balanceOf(address(this));
        (ok,) = _callUint(
            strategy, abi.encodeCall(IERC4626.redeem, (shares, address(this), address(this)))
        );
        if (!ok) return (false, 0);
        uint256 afterRedeem = asset.balanceOf(address(this));
        received = afterRedeem > before ? afterRedeem - before : 0;
    }

    /// @dev Moves the share tokens that are still in the vault to `to`. Returns how many shares
    ///      were redeemed (out of `sharesBefore`), how many were sent, how many are left.
    function _returnShares(address shareToken, uint256 sharesBefore, address to)
        private
        returns (uint256 redeemed, uint256 sent, uint256 left)
    {
        bool ok;
        (ok, left) = _staticUint(shareToken, abi.encodeCall(IERC20.balanceOf, (address(this))));
        if (!ok) left = sharesBefore; // unknown: assume nothing was redeemed
        redeemed = sharesBefore > left ? sharesBefore - left : 0;

        if (ok && left != 0) {
            uint256 leftBefore = left;
            _callUint(shareToken, abi.encodeCall(IERC20.transfer, (to, leftBefore)));
            (ok, left) = _staticUint(shareToken, abi.encodeCall(IERC20.balanceOf, (address(this))));
            if (ok && left < leftBefore) sent = leftBefore - left;
            if (!ok) left = leftBefore;
        }
    }

    /// @dev `staticcall` that reads a single word and never copies more than 32 bytes of
    ///      returndata, so a hostile target can not burn gas with huge return data.
    ///      `ok` is false on revert, no code or less than 32 bytes returned.
    function _staticUint(address target, bytes memory data)
        private
        view
        returns (bool ok, uint256 value)
    {
        assembly ("memory-safe") {
            let out := mload(0x40)
            ok := staticcall(gas(), target, add(data, 0x20), mload(data), out, 0x20)
            if lt(returndatasize(), 0x20) { ok := 0 }
            if ok { value := mload(out) }
        }
    }

    /// @dev Same as {_staticUint} for state-changing calls.
    function _callUint(address target, bytes memory data) private returns (bool ok, uint256 value) {
        assembly ("memory-safe") {
            let out := mload(0x40)
            ok := call(gas(), target, 0, add(data, 0x20), mload(data), out, 0x20)
            if lt(returndatasize(), 0x20) { ok := 0 }
            if ok { value := mload(out) }
        }
    }
}
