// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITeller} from "./interfaces/ITeller.sol";
import {IRolesAuthority} from "./interfaces/IRolesAuthority.sol";

/// @title HoddUSYCVault
/// @author Hodd
/// @notice One pooled, Hodd-wide vault over Circle's USYC. Users deposit only USDC and get USDC
///         back at their own address; the vault subscribes to, holds and redeems USYC internally.
///         Circle allowlists this ONE contract, so end users never need to be allowlisted.
///
/// @dev It is an ERC-4626 vault over USDC so that a {HoddieVault} can use it as a normal
///      strategy, with the following DELIBERATE deviations (each one is on purpose):
///
///      1. SHARES FOLLOW THE USYC ACTUALLY RECEIVED, NOT AN ORACLE QUOTE. The Teller prices a
///         subscription at the NEXT price when the oracle price is stale or after the 14:00 New
///         York cut-off, while `convertToAssets` uses the current one. Minting shares from the
///         NAV would let a depositor buy in at a price the pool does not get, diluting everybody
///         across the cut-off. So `deposit` measures the USYC delta and mints
///         `usycReceived * (supply + 10**OFFSET) / (usycHeld + 1)`.
///      2. `redeem` PAYS ONLY THE HOLDER: `msg.sender == owner == receiver`. No allowance-based
///         redemption, no third-party receiver. (The Teller pays USDC to this contract, which is
///         the allowlisted party; the contract forwards exactly that USDC to the holder.)
///      3. Shares are NOT TRANSFERABLE (`transfer`, `transferFrom`, `approve` revert). They are a
///         claim only their holder can redeem.
///      4. `mint` and `withdraw` are NOT SUPPORTED (they revert; `maxMint`/`maxWithdraw` are 0):
///         the amount of USYC, and therefore of USDC, a given number of shares fetches is only
///         known at redemption time, so there is no exact-assets exit.
///      5. `totalAssets`, `convertToShares`, `convertToAssets` are INFORMATIONAL (NAV at the
///         current oracle price plus idle USDC). Actual minting and burning use the USYC ratio.
///      6. Slippage overloads `deposit(assets, receiver, minShares)` and
///         `redeem(shares, receiver, owner, minAssets)`.
///
///      SHARE MATH. `usycHeld` is the vault's whole USYC balance. Virtual shares and a virtual
///      USYC unit (OZ style) make inflation/donation attacks unprofitable:
///      `shares = usycIn * (supply + 10**OFFSET) / (usycHeld + 1)` and
///      `usycOut = shares * (usycHeld + 1) / (supply + 10**OFFSET)`, both rounded DOWN (towards
///      the pool). OFFSET is 6, so a first deposit of U USYC base units mints U * 10**6 shares and
///      the share token has 12 decimals (6 of USYC + OFFSET). With 10**6 virtual shares an
///      attacker who inflates the share price by donating to the pool loses about 10**6 times more
///      than he can steal. The invariant `supply <= 10**OFFSET * usycHeld` holds from the first
///      deposit on (deposits keep it, redemptions keep it, donations only improve it), which makes
///      the USYC claimed by all shares never exceed the USYC held.
///
///      DONATIONS. Share value is measured in USYC only, so sending USDC to the vault cannot move
///      the share price: it is idle until anyone calls {reinvestIdle}, which subscribes it for the
///      whole pool (a gift to all holders, no shares minted). USYC can only be sent by
///      allowlisted senders; a USYC donation is a gift to all holders as well.
///
///      ADMIN. The admin can only pause/unpause NEW deposits and set the deposit caps. It can not
///      move, freeze or redeem anybody's funds, can not pause redemptions and can not change the
///      Teller, USYC or the authority (all immutable).
///
///      CIRCLE-SIDE RISKS (testnet only). If Circle removes this contract from the allowlist or
///      pauses its `RolesAuthority`, deposits and redemptions revert until it is restored; shares
///      stay valid claims. The Teller's daily subscription/redemption limits and its treasury
///      liquidity are shared by every user of the pool. Pooled exposure for non-allowlisted users
///      needs Circle's explicit approval before any mainnet use.
contract HoddUSYCVault is ERC20, Ownable2Step, ReentrancyGuard, IERC4626 {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Decimals added to USYC's 6 for the share token (virtual-share offset).
    uint8 public constant OFFSET = 6;

    /// @dev 10**OFFSET, the number of virtual shares.
    uint256 private constant VIRTUAL_SHARES = 10 ** 6;

    /// @dev Function selectors the Teller and the USYC token check with the RolesAuthority.
    bytes4 private constant DEPOSIT_SELECTOR = ITeller.deposit.selector;
    bytes4 private constant REDEEM_SELECTOR = ITeller.redeem.selector;
    bytes4 private constant TRANSFER_SELECTOR = bytes4(keccak256("transfer(address,uint256)"));

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice USDC, the only asset users deal in.
    IERC20 public immutable usdc;
    /// @notice Circle's Teller, which subscribes and redeems USYC.
    ITeller public immutable teller;
    /// @notice The USYC token held by the pool.
    IERC20 public immutable usyc;
    /// @notice Circle's RolesAuthority, read to know whether this contract is allowlisted.
    IRolesAuthority public immutable authority;

    /// @notice Whether NEW deposits are paused. Redemptions are never paused.
    bool public depositsPaused;
    /// @notice The most one deposit may bring (USDC base units).
    uint256 public maxDepositPerTx;
    /// @notice The most the pool may be worth (NAV incl. idle USDC) after a deposit.
    uint256 public maxTotalAssets;

    /*//////////////////////////////////////////////////////////////
                                  EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice A deposit: `usdcIn` bought `usycIn` USYC, minted `shares` to `receiver`.
    event UsycSubscribed(
        address indexed user,
        address indexed receiver,
        uint256 usdcIn,
        uint256 usycIn,
        uint256 shares
    );
    /// @notice A redemption: `shares` of `user` burned, `usycOut` USYC redeemed, `usdcOut` paid.
    event UsycRedeemed(address indexed user, uint256 shares, uint256 usycOut, uint256 usdcOut);
    /// @notice Idle USDC was subscribed for the whole pool (no shares minted).
    event IdleReinvested(address indexed caller, uint256 usdcIn, uint256 usycIn);
    /// @notice The admin paused new deposits.
    event DepositsPaused(address indexed admin);
    /// @notice The admin resumed new deposits.
    event DepositsUnpaused(address indexed admin);
    /// @notice The admin changed the deposit caps.
    event DepositCapsUpdated(uint256 maxDepositPerTx, uint256 maxTotalAssets);

    /*//////////////////////////////////////////////////////////////
                                  ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAddress();
    error WrongTellerAsset(address expected, address actual);
    error WrongTellerShare(address expected, address actual);
    error UnexpectedDecimals(address token, uint8 decimals);
    error DepositsArePaused();
    error NotPermittedByCircle();
    error ZeroAmount();
    error ZeroShares();
    error ZeroAssets();
    error ExceedsMaxDepositPerTx(uint256 amount, uint256 max);
    error ExceedsMaxTotalAssets(uint256 totalAfter, uint256 max);
    error InsufficientShares(uint256 received, uint256 minShares);
    error InsufficientAssets(uint256 received, uint256 minAssets);
    error RedeemOnlyByAndToTheHolder();
    error NothingToReinvest();
    error SharesNotTransferable();
    error NotSupported();
    error RenounceDisabled();

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @param usdc_ USDC (6 decimals).
    /// @param teller_ Circle's USYC Teller. Its `asset()` must be `usdc_`.
    /// @param usyc_ The USYC token (6 decimals). The Teller's `share()` must be `usyc_`.
    /// @param authority_ Circle's RolesAuthority (the Teller's and USYC's allowlist).
    /// @param admin_ Hodd's ops key: may only pause deposits and set the deposit caps. Starts with
    ///        conservative caps (1,000 USDC per deposit, 100,000 USDC in total).
    constructor(
        IERC20 usdc_,
        ITeller teller_,
        IERC20 usyc_,
        IRolesAuthority authority_,
        address admin_
    ) ERC20("Hodd USYC Pool Share", "hUSYC") Ownable(admin_) {
        if (
            address(usdc_) == address(0) || address(teller_) == address(0)
                || address(usyc_) == address(0) || address(authority_) == address(0)
        ) revert ZeroAddress();
        if (teller_.asset() != address(usdc_)) {
            revert WrongTellerAsset(address(usdc_), teller_.asset());
        }
        if (teller_.share() != address(usyc_)) {
            revert WrongTellerShare(address(usyc_), teller_.share());
        }
        uint8 usdcDecimals = IERC20Metadata(address(usdc_)).decimals();
        if (usdcDecimals != 6) revert UnexpectedDecimals(address(usdc_), usdcDecimals);
        uint8 usycDecimals = IERC20Metadata(address(usyc_)).decimals();
        if (usycDecimals != 6) revert UnexpectedDecimals(address(usyc_), usycDecimals);

        usdc = usdc_;
        teller = teller_;
        usyc = usyc_;
        authority = authority_;

        maxDepositPerTx = 1000e6;
        maxTotalAssets = 100_000e6;
        emit DepositCapsUpdated(1000e6, 100_000e6);
    }

    /*//////////////////////////////////////////////////////////////
                                DEPOSIT
    //////////////////////////////////////////////////////////////*/

    /// @notice ERC-4626 deposit: `assets` USDC in, shares to `receiver`, no slippage bound.
    /// @param assets USDC to deposit (pulled from the caller, who must have approved this vault).
    /// @param receiver Who gets the shares (the only one who can redeem them).
    /// @return shares Shares minted.
    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        return _deposit(assets, receiver, 0);
    }

    /// @notice Deposit with a bound: reverts unless at least `minShares` are minted.
    /// @param assets USDC to deposit.
    /// @param receiver Who gets the shares.
    /// @param minShares Minimum shares the deposit must mint.
    /// @return shares Shares minted.
    function deposit(uint256 assets, address receiver, uint256 minShares)
        external
        nonReentrant
        returns (uint256 shares)
    {
        return _deposit(assets, receiver, minShares);
    }

    function _deposit(uint256 assets, address receiver, uint256 minShares)
        private
        returns (uint256 shares)
    {
        if (depositsPaused) revert DepositsArePaused();
        if (assets == 0) revert ZeroAmount();
        if (assets > maxDepositPerTx) revert ExceedsMaxDepositPerTx(assets, maxDepositPerTx);
        uint256 totalAfter = totalAssets() + assets;
        if (totalAfter > maxTotalAssets) revert ExceedsMaxTotalAssets(totalAfter, maxTotalAssets);
        if (!_canSubscribe()) revert NotPermittedByCircle();

        uint256 held = usyc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), assets);
        uint256 usycIn = _subscribe(assets, held);

        shares = _usycToShares(usycIn, held, totalSupply());
        if (shares == 0) revert ZeroShares();
        if (shares < minShares) revert InsufficientShares(shares, minShares);

        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
        emit UsycSubscribed(msg.sender, receiver, assets, usycIn, shares);
    }

    /// @dev Subscribes `assets` USDC held by this contract; returns the USYC actually received.
    function _subscribe(uint256 assets, uint256 heldBefore) private returns (uint256 usycIn) {
        usdc.forceApprove(address(teller), assets);
        teller.deposit(assets, address(this));
        usdc.forceApprove(address(teller), 0);
        usycIn = usyc.balanceOf(address(this)) - heldBefore;
    }

    /*//////////////////////////////////////////////////////////////
                                 REDEEM
    //////////////////////////////////////////////////////////////*/

    /// @notice ERC-4626 redeem, restricted: the caller must be the holder and the receiver.
    /// @param shares Shares to burn.
    /// @param receiver Must be `holder`.
    /// @param holder The share owner, must be the caller.
    /// @return assets USDC paid to the holder.
    function redeem(uint256 shares, address receiver, address holder)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        return _redeem(shares, receiver, holder, 0);
    }

    /// @notice Redeem with a bound: reverts unless at least `minAssets` USDC are paid.
    /// @param shares Shares to burn.
    /// @param receiver Must be `holder`.
    /// @param holder The share owner, must be the caller.
    /// @param minAssets Minimum USDC the holder must receive.
    /// @return assets USDC paid to the holder.
    function redeem(uint256 shares, address receiver, address holder, uint256 minAssets)
        external
        nonReentrant
        returns (uint256 assets)
    {
        return _redeem(shares, receiver, holder, minAssets);
    }

    function _redeem(uint256 shares, address receiver, address owner_, uint256 minAssets)
        private
        returns (uint256 assets)
    {
        if (msg.sender != owner_ || receiver != owner_) revert RedeemOnlyByAndToTheHolder();
        if (shares == 0) revert ZeroAmount();

        // The ratio is taken BEFORE the burn, so the holder gets exactly their pro-rata part.
        uint256 usycOut = _sharesToUsyc(shares, usyc.balanceOf(address(this)), totalSupply());
        _burn(owner_, shares);
        if (usycOut == 0) revert ZeroAssets();

        uint256 usdcBefore = usdc.balanceOf(address(this));
        teller.redeem(usycOut, address(this), address(this));
        assets = usdc.balanceOf(address(this)) - usdcBefore;
        if (assets == 0) revert ZeroAssets();
        if (assets < minAssets) revert InsufficientAssets(assets, minAssets);

        usdc.safeTransfer(owner_, assets);
        emit Withdraw(msg.sender, owner_, owner_, assets, shares);
        emit UsycRedeemed(owner_, shares, usycOut, assets);
    }

    /*//////////////////////////////////////////////////////////////
                          REINVEST IDLE USDC
    //////////////////////////////////////////////////////////////*/

    /// @notice Subscribes any idle USDC (donations, stray transfers) into USYC for the whole pool.
    /// @dev Permissionless. No shares are minted: the USYC raises the value of every share, so it
    ///      can neither be stolen nor lost. Works while deposits are paused (it adds no new
    ///      claim). Reverts if the Teller refuses (not allowlisted, limits...).
    /// @return usycIn USYC the pool received.
    function reinvestIdle() external nonReentrant returns (uint256 usycIn) {
        uint256 idle = usdc.balanceOf(address(this));
        if (idle == 0) revert NothingToReinvest();
        usycIn = _subscribe(idle, usyc.balanceOf(address(this)));
        emit IdleReinvested(msg.sender, idle, usycIn);
    }

    /*//////////////////////////////////////////////////////////////
                              ADMIN (LIMITED)
    //////////////////////////////////////////////////////////////*/

    /// @notice Pause NEW deposits. Redemptions and {reinvestIdle} are unaffected.
    function pauseDeposits() external onlyOwner nonReentrant {
        depositsPaused = true;
        emit DepositsPaused(msg.sender);
    }

    /// @notice Resume new deposits.
    function unpauseDeposits() external onlyOwner nonReentrant {
        depositsPaused = false;
        emit DepositsUnpaused(msg.sender);
    }

    /// @notice Set the deposit caps. 0 blocks new deposits; `type(uint256).max` removes a cap.
    /// @dev The caps only limit NEW deposits; they never touch existing shares or redemptions.
    /// @param maxDepositPerTx_ The most one deposit may bring (USDC base units).
    /// @param maxTotalAssets_ The most the pool may be worth after a deposit (NAV + idle USDC).
    function setDepositCaps(uint256 maxDepositPerTx_, uint256 maxTotalAssets_)
        external
        onlyOwner
        nonReentrant
    {
        maxDepositPerTx = maxDepositPerTx_;
        maxTotalAssets = maxTotalAssets_;
        emit DepositCapsUpdated(maxDepositPerTx_, maxTotalAssets_);
    }

    /// @dev The admin has no power over funds; giving the role up would only freeze the caps.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /*//////////////////////////////////////////////////////////////
                         SHARES ARE NOT TRANSFERABLE
    //////////////////////////////////////////////////////////////*/

    /// @dev Always reverts: shares are a claim only their holder can redeem.
    function transfer(address, uint256) public pure override(ERC20, IERC20) returns (bool) {
        revert SharesNotTransferable();
    }

    /// @dev Always reverts: shares are a claim only their holder can redeem.
    function transferFrom(address, address, uint256)
        public
        pure
        override(ERC20, IERC20)
        returns (bool)
    {
        revert SharesNotTransferable();
    }

    /// @dev Always reverts: there are no allowances because nobody else can redeem.
    function approve(address, uint256) public pure override(ERC20, IERC20) returns (bool) {
        revert SharesNotTransferable();
    }

    /// @inheritdoc ERC20
    function decimals() public pure override(ERC20, IERC20Metadata) returns (uint8) {
        return 6 + OFFSET;
    }

    /*//////////////////////////////////////////////////////////////
                         UNSUPPORTED ERC-4626 PARTS
    //////////////////////////////////////////////////////////////*/

    /// @dev Not supported: always reverts. Use {deposit}.
    function mint(uint256, address) external pure override returns (uint256) {
        revert NotSupported();
    }

    /// @dev Not supported: always reverts. Use {redeem}.
    function withdraw(uint256, address, address) external pure override returns (uint256) {
        revert NotSupported();
    }

    /// @dev Not supported: always reverts.
    function previewMint(uint256) external pure override returns (uint256) {
        revert NotSupported();
    }

    /// @dev Not supported: always reverts.
    function previewWithdraw(uint256) external pure override returns (uint256) {
        revert NotSupported();
    }

    /// @notice Always 0: `mint` is not supported.
    function maxMint(address) external pure override returns (uint256) {
        return 0;
    }

    /// @notice Always 0: `withdraw` is not supported.
    function maxWithdraw(address) external pure override returns (uint256) {
        return 0;
    }

    /*//////////////////////////////////////////////////////////////
                              VIEWS (NEVER REVERT)
    //////////////////////////////////////////////////////////////*/

    /// @notice The asset users deal in (USDC).
    function asset() external view override returns (address) {
        return address(usdc);
    }

    /// @notice USYC held by the pool.
    /// @return The pool's USYC balance.
    function usycHeld() public view returns (uint256) {
        return usyc.balanceOf(address(this));
    }

    /// @notice USYC that `shares` are worth at the current pool ratio (what a redemption pulls
    ///         from the Teller). Rounded down.
    /// @param shares An amount of shares.
    /// @return The USYC amount.
    function usycOf(uint256 shares) public view returns (uint256) {
        return _sharesToUsyc(shares, usycHeld(), totalSupply());
    }

    /// @notice Informational NAV: the USYC at the Teller's current (latest) price plus idle USDC.
    ///         Not used to mint or burn shares.
    /// @return Total assets in USDC base units (never reverts).
    function totalAssets() public view override returns (uint256) {
        uint256 held = usycHeld();
        uint256 nav;
        if (held != 0) {
            (bool ok, uint256 value) =
                _word(address(teller), abi.encodeCall(ITeller.convertToAssets, (held)));
            if (ok) nav = value;
        }
        return nav + usdc.balanceOf(address(this));
    }

    /// @notice Informational: shares for `assets` at the NAV. Actual minting follows the USYC
    ///         received, see {previewDeposit}.
    /// @param assets USDC amount.
    /// @return Shares (rounded down).
    function convertToShares(uint256 assets) external view override returns (uint256) {
        return (assets * (totalSupply() + VIRTUAL_SHARES)) / (totalAssets() + 1);
    }

    /// @notice Informational: USDC value of `shares` at the NAV (rounded down).
    /// @param shares An amount of shares.
    /// @return USDC base units.
    function convertToAssets(uint256 shares) external view override returns (uint256) {
        return (shares * (totalAssets() + 1)) / (totalSupply() + VIRTUAL_SHARES);
    }

    /// @notice Shares a deposit of `assets` would mint right now, from the Teller's own quote of
    ///         the USYC it would issue (so it prices a subscription exactly like the deposit).
    ///         Returns 0 when the Teller can not quote. Does not check pauses or caps, see
    ///         {maxDeposit}.
    /// @param assets USDC amount.
    /// @return Shares (rounded down; a later price change can still move the real figure).
    function previewDeposit(uint256 assets) public view override returns (uint256) {
        (bool ok, uint256 usycIn) = _word(
            address(teller), abi.encodeCall(ITeller.previewDepositData, (address(this), assets))
        );
        if (!ok) return 0;
        return _usycToShares(usycIn, usycHeld(), totalSupply());
    }

    /// @notice USDC a redemption of `shares` would pay right now (after the Teller's fee).
    ///         Returns 0 when the Teller can not quote.
    /// @param shares Shares to redeem.
    /// @return USDC base units.
    function previewRedeem(uint256 shares) public view override returns (uint256) {
        uint256 usycOut = usycOf(shares);
        if (usycOut == 0) return 0;
        (bool ok, uint256 value) = _word(
            address(teller), abi.encodeCall(ITeller.previewRedeemData, (address(this), usycOut))
        );
        return ok ? value : 0;
    }

    /// @notice The most USDC a single deposit could bring now: 0 while deposits are paused, while
    ///         Circle does not permit this contract (not allowlisted, authority paused or
    ///         unreadable) or the Teller's subscription limit is used up; otherwise the lowest of
    ///         the per-deposit cap, the room under the pool cap and the Teller's remaining
    ///         subscription limit for this contract today.
    /// @return USDC base units.
    function maxDeposit(address) public view override returns (uint256) {
        if (depositsPaused || !_canSubscribe()) return 0;

        uint256 limit = maxDepositPerTx;
        uint256 total = totalAssets();
        uint256 room = maxTotalAssets > total ? maxTotalAssets - total : 0;
        if (room < limit) limit = room;

        (bool okDay, uint256 today) =
            _word(address(teller), abi.encodeCall(ITeller.todayTimestamp, ()));
        if (!okDay) return 0;
        (bool okRem, uint256 remaining) = _word(
            address(teller),
            abi.encodeCall(ITeller.subscriptionLimitRemaining, (address(this), today))
        );
        if (!okRem) return 0;
        return remaining < limit ? remaining : limit;
    }

    /// @notice The most shares `owner` could redeem now: the holder's balance, bounded by what the
    ///         Teller lets this contract redeem today (`maxRedeem`: daily limit, treasury
    ///         liquidity) converted to shares. 0 if Circle does not permit this contract.
    /// @param holder The share owner.
    /// @return Shares.
    function maxRedeem(address holder) public view override returns (uint256) {
        uint256 balance = balanceOf(holder);
        if (balance == 0 || !_canRedeem()) return 0;

        (bool ok, uint256 maxUsyc) =
            _word(address(teller), abi.encodeCall(ITeller.maxRedeem, (address(this))));
        if (!ok) return 0;
        uint256 held = usycHeld();
        if (maxUsyc >= held) return balance;
        // largest share count whose USYC value (rounded down) stays within `maxUsyc`
        uint256 byTeller = (maxUsyc * (totalSupply() + VIRTUAL_SHARES)) / (held + 1);
        return byTeller < balance ? byTeller : balance;
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNALS
    //////////////////////////////////////////////////////////////*/

    /// @dev shares = usyc * (supply + 10**OFFSET) / (held + 1), rounded down.
    function _usycToShares(uint256 usycAmount, uint256 held, uint256 supply)
        private
        pure
        returns (uint256)
    {
        return (usycAmount * (supply + VIRTUAL_SHARES)) / (held + 1);
    }

    /// @dev usyc = shares * (held + 1) / (supply + 10**OFFSET), rounded down.
    function _sharesToUsyc(uint256 shares, uint256 held, uint256 supply)
        private
        pure
        returns (uint256)
    {
        return (shares * (held + 1)) / (supply + VIRTUAL_SHARES);
    }

    /// @dev Mirrors what the Teller and the USYC token check on a subscription: this contract may
    ///      call `deposit` on the Teller and may receive USYC. A paused authority makes `canCall`
    ///      revert, which reads as "not permitted".
    function _canSubscribe() private view returns (bool) {
        return _can(address(teller), DEPOSIT_SELECTOR) && _can(address(usyc), TRANSFER_SELECTOR);
    }

    /// @dev Same for a redemption: this contract may call `redeem` and hold/burn USYC.
    function _canRedeem() private view returns (bool) {
        return _can(address(teller), REDEEM_SELECTOR) && _can(address(usyc), TRANSFER_SELECTOR);
    }

    function _can(address target, bytes4 selector) private view returns (bool) {
        (bool ok, uint256 value) = _word(
            address(authority),
            abi.encodeCall(IRolesAuthority.canCall, (address(this), target, selector))
        );
        return ok && value != 0;
    }

    /// @dev `staticcall` that returns the first word of the answer; `ok` is false on revert, no
    ///      code or less than 32 bytes returned, so views built on it never revert.
    function _word(address target, bytes memory data)
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
}
