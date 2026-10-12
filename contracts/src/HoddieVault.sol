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

/// @title HoddieVault
/// @author Hodd
/// @notice A non-custodial, per-user vault that holds USDC for its `owner` and lets a limited
///         `operator` (Hodd's agent wallet) move it only to a small set of safe destinations.
/// @dev Trust model in one paragraph:
///      - The OWNER (the user's own wallet, EOA or ERC-1271 smart account) can always take every
///        asset out (`withdrawAll`, `exitStrategy`, `rescueToken`), also while the vault is paused
///        and also when the operator is gone. Nothing the operator does can block these calls.
///      - The OPERATOR can only (a) deposit idle USDC into an owner-allowlisted ERC-4626 strategy,
///        (b) withdraw/redeem from such a strategy back into this vault, (c) send idle USDC to the
///        owner, and (d) pay an owner-approved recipient. (a) and (d) are capped per transaction
///        and per UTC day. The operator can never choose a receiver other than this vault, the
///        owner or an approved recipient, and cannot change any setting.
///      - Everyone else can only submit an owner-signed EIP-712 `AddRecipient` message.
///      The contract is not upgradeable, has no `receive`/`fallback` (native value reverts) and
///      ownership can not be renounced (that would lock the funds).
contract HoddieVault is Ownable2Step, ReentrancyGuard, Pausable, EIP712, Nonces {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Maximum number of simultaneously allowlisted strategies.
    uint256 public constant MAX_STRATEGIES = 8;

    /// @notice EIP-712 type hash of the owner-signed "approve this payment recipient" message.
    bytes32 public constant ADD_RECIPIENT_TYPEHASH =
        keccak256("AddRecipient(address recipient,uint256 nonce,uint256 deadline)");

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The ERC-20 this vault holds and every strategy must use (USDC).
    IERC20 public immutable asset;

    /// @notice The only address that may call the operator functions. `address(0)` = revoked.
    address public operator;

    /// @notice Maximum USDC (base units) of a single limited operator outflow.
    uint256 public maxPerTx;

    /// @notice Maximum USDC (base units) of limited operator outflows per UTC day.
    uint256 public dailyLimit;

    /// @notice USDC counted against `dailyLimit` during the day `lastSpendDay`.
    /// @dev Only meaningful when `lastSpendDay` is the current day, see {spentToday}.
    uint256 public spentInDay;

    /// @notice UTC day number (`block.timestamp / 1 days`) of the last limited outflow.
    uint256 public lastSpendDay;

    /// @notice Whether `strategy` is an allowlisted ERC-4626 strategy.
    mapping(address strategy => bool) public isStrategy;

    /// @notice Whether `recipient` is approved to receive operator payments.
    mapping(address recipient => bool) public isRecipient;

    address[] private _strategies;

    /*//////////////////////////////////////////////////////////////
                                  EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice The operator changed (also emitted once by the constructor).
    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);
    /// @notice The spending limits changed (also emitted once by the constructor).
    event LimitsUpdated(uint256 maxPerTx, uint256 dailyLimit);
    /// @notice A strategy was added to the allowlist.
    event StrategyAllowed(address indexed strategy);
    /// @notice A strategy was removed from the allowlist. Shares already held stay in the vault.
    event StrategyDisallowed(address indexed strategy);
    /// @notice A payment recipient was approved.
    event RecipientAdded(address indexed recipient);
    /// @notice A payment recipient was removed.
    event RecipientRemoved(address indexed recipient);
    /// @notice The operator deposited idle USDC into a strategy.
    event DepositedToStrategy(address indexed strategy, uint256 assets, uint256 shares);
    /// @notice The operator withdrew an exact USDC amount from a strategy into the vault.
    event WithdrawnFromStrategy(address indexed strategy, uint256 assets, uint256 shares);
    /// @notice The operator redeemed an exact share amount from a strategy into the vault.
    event RedeemedFromStrategy(address indexed strategy, uint256 shares, uint256 assets);
    /// @notice The operator sent idle USDC to the owner.
    event TransferredToOwner(address indexed owner, uint256 amount);
    /// @notice The operator paid an approved recipient. `ref` lets Hodd match the payment to a bill.
    event Payment(address indexed recipient, uint256 amount, bytes32 indexed ref);
    /// @notice The owner ran `withdrawAll` (or `exitStrategy`) for one strategy.
    /// @dev `assetsReceived` is the amount the strategy reported for the redeem it did on the
    ///      owner's behalf. It is informational, a hostile strategy could misreport it.
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
    error ExceedsMaxPerTx(uint256 amount, uint256 maxPerTx);
    error ExceedsDailyLimit(uint256 attemptedSpentInDay, uint256 dailyLimit);
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
    /// @param maxPerTx_ Per-transaction cap of limited operator outflows (USDC base units).
    /// @param dailyLimit_ Per-UTC-day cap of limited operator outflows (USDC base units).
    /// @param strategies_ Initial strategy allowlist (each must be an ERC-4626 over `asset_`).
    constructor(
        IERC20 asset_,
        address owner_,
        address operator_,
        uint256 maxPerTx_,
        uint256 dailyLimit_,
        address[] memory strategies_
    ) Ownable(owner_) EIP712("HoddieVault", "1") {
        if (address(asset_) == address(0)) revert ZeroAddress();
        asset = asset_;

        operator = operator_;
        emit OperatorUpdated(address(0), operator_);

        maxPerTx = maxPerTx_;
        dailyLimit = dailyLimit_;
        emit LimitsUpdated(maxPerTx_, dailyLimit_);

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
    /// @dev Counts against `maxPerTx` and `dailyLimit`. Approves exactly `assets`, then resets the
    ///      allowance to zero.
    /// @param strategy The allowlisted strategy.
    /// @param assets USDC amount (base units) to deposit.
    /// @return shares Strategy shares minted to this vault.
    function depositToStrategy(address strategy, uint256 assets)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        if (!isStrategy[strategy]) revert StrategyNotAllowed(strategy);
        if (assets == 0) revert ZeroAmount();
        _consumeLimit(assets);

        asset.forceApprove(strategy, assets);
        shares = IERC4626(strategy).deposit(assets, address(this));
        asset.forceApprove(strategy, 0);

        if (shares == 0) revert ZeroShares();
        emit DepositedToStrategy(strategy, assets, shares);
    }

    /// @notice Withdraw an exact USDC amount from a strategy back into this vault.
    /// @dev Receiver and share owner are always this vault. Not subject to the spending limits
    ///      because the funds stay in custody.
    /// @param strategy The allowlisted strategy.
    /// @param assets USDC amount (base units) to withdraw.
    /// @return shares Strategy shares burned.
    function withdrawFromStrategy(address strategy, uint256 assets)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        if (!isStrategy[strategy]) revert StrategyNotAllowed(strategy);
        if (assets == 0) revert ZeroAmount();

        shares = IERC4626(strategy).withdraw(assets, address(this), address(this));
        emit WithdrawnFromStrategy(strategy, assets, shares);
    }

    /// @notice Redeem an exact share amount from a strategy back into this vault.
    /// @dev Receiver and share owner are always this vault. Not subject to the spending limits.
    /// @param strategy The allowlisted strategy.
    /// @param shares Strategy shares to burn.
    /// @return assets USDC received by this vault.
    function redeemFromStrategy(address strategy, uint256 shares)
        external
        onlyOperator
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        if (!isStrategy[strategy]) revert StrategyNotAllowed(strategy);
        if (shares == 0) revert ZeroAmount();

        assets = IERC4626(strategy).redeem(shares, address(this), address(this));
        emit RedeemedFromStrategy(strategy, shares, assets);
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
    /// @dev Counts against `maxPerTx` and `dailyLimit`.
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
        _consumeLimit(amount);

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

    /// @notice Set the per-transaction and per-UTC-day caps of limited operator outflows.
    /// @dev Does not reset the amount already spent today. The effective per-transaction cap is
    ///      the lower of the two values. Setting either to 0 freezes limited outflows.
    /// @param maxPerTx_ New per-transaction cap (USDC base units).
    /// @param dailyLimit_ New per-day cap (USDC base units).
    function setLimits(uint256 maxPerTx_, uint256 dailyLimit_) external onlyOwner {
        maxPerTx = maxPerTx_;
        dailyLimit = dailyLimit_;
        emit LimitsUpdated(maxPerTx_, dailyLimit_);
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

    /// @notice Approve a recipient for operator payments. Idempotent.
    /// @param recipient The recipient to approve.
    function addRecipient(address recipient) external onlyOwner {
        _addRecipient(recipient);
    }

    /// @notice Remove a payment recipient. Idempotent.
    /// @param recipient The recipient to remove.
    function removeRecipient(address recipient) external onlyOwner {
        if (isRecipient[recipient]) {
            isRecipient[recipient] = false;
            emit RecipientRemoved(recipient);
        }
    }

    /// @notice Approve a recipient with the owner's EIP-712 signature. Anyone may submit it (Hodd's
    ///         server pays the gas).
    /// @dev The owner signs `AddRecipient(address recipient,uint256 nonce,uint256 deadline)` in the
    ///      domain `("HoddieVault", "1", chainId, thisVault)`, where `nonce` is `nonces(owner())`.
    ///      Valid for EOAs (ECDSA) and smart accounts (ERC-1271 `isValidSignature(digest, sig)`).
    ///      The nonce is consumed on success, so a signature works once. Signatures only count
    ///      for the owner at submission time, an ownership change voids older signatures.
    /// @param recipient The recipient to approve.
    /// @param deadline Last second (inclusive) at which the signature may be submitted.
    /// @param signature The owner's signature over the EIP-712 digest.
    function addRecipientWithSig(address recipient, uint256 deadline, bytes calldata signature)
        external
    {
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert SignatureExpired(deadline);

        address signer = owner();
        bytes32 digest = _addRecipientDigest(recipient, nonces(signer), deadline);
        if (!SignatureChecker.isValidSignatureNowCalldata(signer, digest, signature)) {
            revert InvalidSignature();
        }

        _useNonce(signer);
        _addRecipient(recipient);
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
    /// @dev For every allowlisted strategy holding shares it (1) tries to redeem all shares with
    ///      the owner as receiver, (2) if that fails, redeems `maxRedeem` shares, (3) sends any
    ///      shares still left to the owner as share tokens so they can redeem later. Each step
    ///      uses guarded low-level calls: a strategy that reverts, returns garbage or has no code
    ///      is skipped (`StrategyExitFailed`) and can not block the others. Finally all idle USDC
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
    ///      never sends anything but the redeemed assets or the share tokens to the owner. Does
    ///      not touch idle USDC.
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

    /// @notice USDC already counted against today's limit.
    /// @return Amount (base units), 0 when nothing was spent during the current UTC day.
    function spentToday() public view returns (uint256) {
        // forge-lint: disable-next-line(block-timestamp)
        return lastSpendDay == block.timestamp / 1 days ? spentInDay : 0;
    }

    /// @notice How much the operator can still push through the limits right now.
    /// @return Amount (base units): the lower of the daily allowance left and `maxPerTx`.
    function remainingAllowance() external view returns (uint256) {
        uint256 spent = spentToday();
        uint256 left = spent >= dailyLimit ? 0 : dailyLimit - spent;
        return left < maxPerTx ? left : maxPerTx;
    }

    /// @notice The EIP-712 digest the owner must sign to approve `recipient` with the current nonce.
    /// @param recipient The recipient to approve.
    /// @param deadline Signature expiry (unix seconds).
    /// @return The digest passed to ECDSA / ERC-1271 verification.
    function addRecipientDigest(address recipient, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _addRecipientDigest(recipient, nonces(owner()), deadline);
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _addRecipientDigest(address recipient, uint256 nonce, uint256 deadline)
        private
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(ADD_RECIPIENT_TYPEHASH, recipient, nonce, deadline))
        );
    }

    function _setOperator(address newOperator) private {
        address previous = operator;
        operator = newOperator;
        emit OperatorUpdated(previous, newOperator);
    }

    function _addRecipient(address recipient) private {
        if (recipient == address(0) || recipient == address(this) || recipient == address(asset)) {
            revert InvalidRecipient(recipient);
        }
        if (!isRecipient[recipient]) {
            isRecipient[recipient] = true;
            emit RecipientAdded(recipient);
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

    /// @dev Counts `amount` against `maxPerTx` and today's `dailyLimit`.
    function _consumeLimit(uint256 amount) private {
        if (amount > maxPerTx) revert ExceedsMaxPerTx(amount, maxPerTx);

        uint256 today = block.timestamp / 1 days;
        uint256 newSpent = (lastSpendDay == today ? spentInDay : 0) + amount;
        if (newSpent > dailyLimit) revert ExceedsDailyLimit(newSpent, dailyLimit);

        lastSpendDay = today;
        spentInDay = newSpent;
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

        // 1) Try to redeem everything. ERC-4626 redeem must revert if it can not be fully served.
        uint256 assetsReceived;
        (ok, assetsReceived) =
            _callUint(strategy, abi.encodeCall(IERC4626.redeem, (shares, to, address(this))));

        if (!ok) {
            assetsReceived = 0;
            // 2) Redeem the part the strategy says it can serve right now.
            (bool okMax, uint256 maxShares) =
                _staticUint(strategy, abi.encodeCall(IERC4626.maxRedeem, (address(this))));
            if (okMax && maxShares != 0 && maxShares < shares) {
                (ok, assetsReceived) = _callUint(
                    strategy, abi.encodeCall(IERC4626.redeem, (maxShares, to, address(this)))
                );
                if (!ok) assetsReceived = 0;
            }
        }

        // 3) Whatever is still in the vault goes to the owner as share tokens.
        uint256 left;
        (ok, left) = _staticUint(strategy, abi.encodeCall(IERC20.balanceOf, (address(this))));
        if (!ok) left = shares; // unknown: assume nothing was redeemed
        uint256 redeemed = shares > left ? shares - left : 0;

        uint256 sent;
        if (ok && left != 0) {
            _callUint(strategy, abi.encodeCall(IERC20.transfer, (to, left)));
            uint256 leftAfter;
            (ok, leftAfter) =
                _staticUint(strategy, abi.encodeCall(IERC20.balanceOf, (address(this))));
            if (ok && leftAfter < left) sent = left - leftAfter;
            left = ok ? leftAfter : left;
        }

        emit StrategyExited(strategy, redeemed, assetsReceived, sent);
        if (left != 0) emit StrategyExitFailed(strategy, left);
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
