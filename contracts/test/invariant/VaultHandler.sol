// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddieVault} from "../../src/HoddieVault.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockStrategy} from "../mocks/MockStrategy.sol";
import {HostileStrategy} from "../mocks/HostileStrategy.sol";
import {MockRolesAuthority, MockUSYC, MockTeller} from "../mocks/MockTeller.sol";

/// @dev Lets the operator, the owner and a stranger call random vault functions with random
///      arguments, and records every property violation in a ghost flag that the invariant
///      contract asserts to be false. Strategies: two OZ ERC-4626 mocks that can behave like
///      Morpho Vault V2 / capped / blocked / share-locked, a hostile one, and a permissioned
///      teller (USYC) whose allowlist the handler flips at random.
contract VaultHandler is CommonBase, StdCheats, StdUtils {
    uint256 internal constant OWNER_PK = 0xA11CE;
    uint256 internal constant STRANGER_PK = 0xBAD;
    uint256 internal constant START = 20_000 days + 12 hours;
    uint256 internal constant NO_CAP = type(uint256).max;

    HoddieVault public vault;
    MockUSDC public usdc;
    MockStrategy public good1;
    MockStrategy public good2;
    MockStrategy public never; // never allowlisted
    HostileStrategy public hostile; // allowlisted from the start, misbehaves
    MockRolesAuthority public auth;
    MockUSYC public usyc;
    MockTeller public teller;
    address public treasury;
    address public feeRecipient;

    address public owner;
    address public operator;
    address public stranger;
    address public donor;
    address[] internal pool; // payment recipient candidates
    address[] internal outsiders; // never approved
    address[] internal allActors;

    // ---- ghost state ----
    mapping(address => bool) public everApproved;
    mapping(address => bool) public everAllowed;
    uint256 public minted;

    // every successful limited spend, to rebuild the rolling windows independently
    uint256[] internal depTs;
    uint256[] internal depAmt;
    uint256[] internal payTs;
    uint256[] internal payAmt;

    bool public limitViolation; // a 24h or per-call limit was exceeded
    bool public recipientCapViolation; // a payment above the recipient's cap went through
    bool public unlimitedOpChangedBudget;
    bool public slippageViolation; // an operator call succeeded although its bound was not met
    bool public withdrawAllReverted;
    bool public withdrawAllViolation;
    bool public strangerSucceeded;
    bool public strangerChangedState;
    bool public badSignatureAccepted;
    bool public goodSignatureRejected;
    bool public paidUnapproved;

    // call counters (to see that the campaign actually exercised the paths)
    uint256 public okDeposits;
    uint256 public okPayments;
    uint256 public okWithdrawAlls;
    uint256 public okStrangerRejects;
    uint256 public okSignatures;

    constructor() {
        vm.warp(START);
        owner = vm.addr(OWNER_PK);
        operator = makeAddr("operator");
        stranger = vm.addr(STRANGER_PK);
        donor = makeAddr("donor");
        treasury = makeAddr("treasury");
        feeRecipient = makeAddr("feeRecipient");

        usdc = new MockUSDC();
        good1 = new MockStrategy(IERC20(address(usdc)));
        good2 = new MockStrategy(IERC20(address(usdc)));
        never = new MockStrategy(IERC20(address(usdc)));
        hostile = new HostileStrategy(address(usdc), HostileStrategy.Mode.REVERT);
        auth = new MockRolesAuthority();
        usyc = new MockUSYC(auth);
        teller = new MockTeller(IERC20(address(usdc)), usyc, auth, treasury, feeRecipient);
        usyc.setMinter(address(teller), true);

        for (uint256 i; i < 4; ++i) {
            pool.push(makeAddr(string.concat("recipient", vm.toString(i))));
        }
        outsiders.push(makeAddr("outsider0"));
        outsiders.push(makeAddr("outsider1"));

        address[] memory list = new address[](4);
        list[0] = address(hostile);
        list[1] = address(good1);
        list[2] = address(good2);
        list[3] = address(teller);
        vault = new HoddieVault(
            IERC20(address(usdc)),
            owner,
            operator,
            HoddieVault.Limits(1000e6, 3000e6, 1000e6, 3000e6),
            list
        );
        everAllowed[address(hostile)] = true;
        everAllowed[address(good1)] = true;
        everAllowed[address(good2)] = true;
        everAllowed[address(teller)] = true;

        _mint(address(vault), 50_000e6);
        _mint(donor, 1_000_000e6);
        _mint(treasury, 1_000_000e6);
        vm.prank(donor);
        usdc.approve(address(good1), type(uint256).max);
        vm.prank(donor);
        usdc.approve(address(good2), type(uint256).max);
        vm.prank(treasury);
        usdc.approve(address(teller), type(uint256).max);

        // Circle has allowlisted the vault and the owner
        auth.setUserRole(address(vault), 0, true);
        auth.setUserRole(owner, 0, true);

        // A realistic starting point: two approved recipients and money already invested, so
        // that payments, withdrawals and withdrawAll have something to work on from call one.
        vm.startPrank(owner);
        vault.addRecipient(pool[0], 800e6);
        vault.addRecipient(pool[1], NO_CAP);
        vm.stopPrank();
        everApproved[pool[0]] = true;
        everApproved[pool[1]] = true;
        vm.startPrank(operator);
        vault.depositToStrategy(address(good1), 900e6, 1);
        vault.depositToStrategy(address(good2), 600e6, 1);
        vault.depositToStrategy(address(teller), 400e6, 1);
        vm.stopPrank();
        _logDeposit(900e6);
        _logDeposit(600e6);
        _logDeposit(400e6);

        allActors.push(owner);
        allActors.push(operator);
        allActors.push(stranger);
        for (uint256 i; i < pool.length; ++i) {
            allActors.push(pool[i]);
        }
        for (uint256 i; i < outsiders.length; ++i) {
            allActors.push(outsiders[i]);
        }
    }

    /*//////////////////////////////////////////////////////////////
                              VIEW HELPERS
    //////////////////////////////////////////////////////////////*/

    function poolAddresses() external view returns (address[] memory) {
        return pool;
    }

    function outsiderAddresses() external view returns (address[] memory) {
        return outsiders;
    }

    /// @dev Spends still counted by hour-bucket accounting at `at`: hours [hour(at)-24, hour(at)].
    function bucketedDeposits(uint256 at) public view returns (uint256) {
        return _bucketed(depTs, depAmt, at);
    }

    function bucketedPayments(uint256 at) public view returns (uint256) {
        return _bucketed(payTs, payAmt, at);
    }

    function _bucketed(uint256[] storage ts, uint256[] storage amt, uint256 at)
        internal
        view
        returns (uint256 total)
    {
        uint256 h = at / 1 hours;
        for (uint256 i; i < ts.length; ++i) {
            if (ts[i] / 1 hours + 24 >= h) total += amt[i];
        }
    }

    /// @dev The real amount spent in the trailing 24 hours (the property the owner cares about).
    function _trailing24h(uint256[] storage ts, uint256[] storage amt, uint256 at)
        internal
        view
        returns (uint256 total)
    {
        for (uint256 i; i < ts.length; ++i) {
            if (ts[i] + 24 hours >= at) total += amt[i];
        }
    }

    /*//////////////////////////////////////////////////////////////
                               OPERATOR
    //////////////////////////////////////////////////////////////*/

    function opDeposit(uint256 stratSeed, uint256 amount, uint256 boundSeed) external {
        address s = _strategy(stratSeed);
        amount = bound(amount, 0, 800e6);
        uint256 expected = _previewDeposit(s, amount);
        uint256 minShares = _tightness(expected, boundSeed, true);
        IERC20 shareToken = IERC20(vault.shareTokenOf(s));
        uint256 sharesBefore = shareToken.balanceOf(address(vault));

        vm.prank(operator);
        try vault.depositToStrategy(s, amount, minShares) {
            okDeposits++;
            if (shareToken.balanceOf(address(vault)) < sharesBefore + minShares) {
                slippageViolation = true;
            }
            _recordDeposit(amount);
        } catch {
            revert("vault call reverted"); // expected failure: shows up in the metrics table
        }
    }

    function opWithdraw(uint256 stratSeed, uint256 amount, uint256 boundSeed) external {
        address s = _strategy(stratSeed);
        amount = bound(amount, 0, 800e6);
        uint256 expected = _previewWithdraw(s, amount);
        uint256 maxShares = boundSeed % 3 == 0 ? type(uint256).max : _tightness(expected, boundSeed, false);
        IERC20 shareToken = IERC20(vault.shareTokenOf(s));
        uint256 sharesBefore = shareToken.balanceOf(address(vault));
        uint256 usdcBefore = usdc.balanceOf(address(vault));
        uint256 depBefore = vault.depositSpentLast24h();
        uint256 payBefore = vault.paymentSpentLast24h();

        vm.prank(operator);
        try vault.withdrawFromStrategy(s, amount, maxShares) {
            if (
                maxShares != type(uint256).max
                    && shareToken.balanceOf(address(vault)) + maxShares < sharesBefore
            ) {
                slippageViolation = true; // burned more than the bound
            }
            if (usdc.balanceOf(address(vault)) < usdcBefore + amount) slippageViolation = true;
            _checkBudgetUntouched(depBefore, payBefore);
        } catch {
            revert("vault call reverted");
        }
    }

    function opRedeem(uint256 stratSeed, uint256 shares, uint256 boundSeed) external {
        address s = _strategy(stratSeed);
        // the hostile strategy reverts on balanceOf, so do not ask it
        uint256 held = s == address(hostile) ? 100e6 : IERC20(vault.shareTokenOf(s)).balanceOf(address(vault));
        shares = bound(shares, 0, held + 1);
        uint256 minAssets = _tightness(_previewRedeem(s, shares), boundSeed, true);
        uint256 usdcBefore = usdc.balanceOf(address(vault));
        uint256 depBefore = vault.depositSpentLast24h();
        uint256 payBefore = vault.paymentSpentLast24h();

        vm.prank(operator);
        try vault.redeemFromStrategy(s, shares, minAssets) {
            if (usdc.balanceOf(address(vault)) < usdcBefore + minAssets) slippageViolation = true;
            _checkBudgetUntouched(depBefore, payBefore);
        } catch {
            revert("vault call reverted");
        }
    }

    function opTransferToOwner(uint256 amount) external {
        amount = bound(amount, 0, 400e6);
        uint256 depBefore = vault.depositSpentLast24h();
        uint256 payBefore = vault.paymentSpentLast24h();
        vm.prank(operator);
        try vault.transferToOwner(amount) {
            _checkBudgetUntouched(depBefore, payBefore);
        } catch {
            revert("vault call reverted");
        }
    }

    function opPay(uint256 targetSeed, uint256 amount, bytes32 ref) external {
        address to = _payTarget(targetSeed);
        amount = bound(amount, 0, 800e6);
        uint256 cap = vault.recipientCap(to);
        vm.prank(operator);
        try vault.pay(to, amount, ref) {
            okPayments++;
            if (!vault.isRecipient(to)) paidUnapproved = true;
            if (amount > cap) recipientCapViolation = true;
            _recordPayment(amount);
        } catch {
            revert("vault call reverted");
        }
    }

    function _checkBudgetUntouched(uint256 depBefore, uint256 payBefore) internal {
        // other things may expire in between? no: same block. Spent amounts must not move.
        if (vault.depositSpentLast24h() != depBefore || vault.paymentSpentLast24h() != payBefore) {
            unlimitedOpChangedBudget = true;
        }
    }

    function _logDeposit(uint256 amount) internal {
        depTs.push(block.timestamp);
        depAmt.push(amount);
    }

    /// @dev After a successful deposit the rules must have held at that moment.
    function _recordDeposit(uint256 amount) internal {
        _logDeposit(amount);
        if (amount > vault.maxDepositPerTx()) limitViolation = true;
        // the real trailing-24h total never exceeds the limit ...
        if (_trailing24h(depTs, depAmt, block.timestamp) > vault.depositLimit24h()) {
            limitViolation = true;
        }
        // ... and the contract's own window equals the independent hour-bucket model
        if (vault.depositSpentLast24h() != bucketedDeposits(block.timestamp)) limitViolation = true;
        if (bucketedDeposits(block.timestamp) > vault.depositLimit24h()) limitViolation = true;
    }

    function _recordPayment(uint256 amount) internal {
        payTs.push(block.timestamp);
        payAmt.push(amount);
        if (amount > vault.maxPaymentPerTx()) limitViolation = true;
        if (_trailing24h(payTs, payAmt, block.timestamp) > vault.paymentLimit24h()) {
            limitViolation = true;
        }
        if (vault.paymentSpentLast24h() != bucketedPayments(block.timestamp)) limitViolation = true;
        if (bucketedPayments(block.timestamp) > vault.paymentLimit24h()) limitViolation = true;
    }

    /// @dev 0: no protection beyond the minimum (1); 1: exact expectation; 2: one unit too
    ///      demanding (for a minimum), or one unit too little (for a maximum).
    function _tightness(uint256 expected, uint256 seed, bool isMinimum) internal pure returns (uint256) {
        uint256 mode = seed % 3;
        if (isMinimum) {
            if (mode == 0 || expected == 0) return 1;
            return mode == 1 ? expected : expected + 1;
        }
        if (expected == 0) return 1;
        return mode == 1 ? expected : expected - 1 == 0 ? 1 : expected - 1;
    }

    function _previewDeposit(address s, uint256 amount) internal view returns (uint256) {
        if (s == address(teller)) {
            (uint256 sh,,) = teller.previewDepositData(address(vault), amount);
            return sh;
        }
        if (s == address(never) || s == address(hostile)) return 0;
        return MockStrategy(s).previewDeposit(amount);
    }

    function _previewWithdraw(address s, uint256 amount) internal view returns (uint256) {
        if (s == address(teller)) {
            (uint256 sh,,) = teller.previewWithdrawData(address(vault), amount);
            return sh;
        }
        if (s == address(never) || s == address(hostile)) return 0;
        return MockStrategy(s).previewWithdraw(amount);
    }

    function _previewRedeem(address s, uint256 shares) internal view returns (uint256) {
        if (s == address(teller)) {
            (uint256 a,,) = teller.previewRedeemData(address(vault), shares);
            return a;
        }
        if (s == address(never) || s == address(hostile)) return 0;
        return MockStrategy(s).previewRedeem(shares);
    }

    /*//////////////////////////////////////////////////////////////
                                 OWNER
    //////////////////////////////////////////////////////////////*/

    function ownerSetLimits(uint256 a, uint256 b, uint256 c, uint256 d) external {
        vm.prank(owner);
        vault.setLimits(
            bound(a, 0, 1500e6), bound(b, 0, 6000e6), bound(c, 0, 1500e6), bound(d, 0, 6000e6)
        );
    }

    /// @dev Pauses on one seed in sixteen and unpauses otherwise, so the vault is mostly running.
    function ownerPause(uint256 seed) external {
        vm.prank(owner);
        if (seed % 16 == 0) {
            try vault.pause() {}
            catch {
                revert("already paused");
            }
        } else {
            try vault.unpause() {}
            catch {
                revert("not paused");
            }
        }
    }

    function _capFrom(uint256 seed) internal pure returns (uint256) {
        uint256 m = seed % 4;
        if (m == 0) return 0;
        if (m == 1) return 50e6;
        if (m == 2) return 400e6;
        return NO_CAP;
    }

    function ownerAddRecipient(uint256 seed, uint256 capSeed) external {
        address r = pool[seed % pool.length];
        vm.prank(owner);
        vault.addRecipient(r, _capFrom(capSeed));
        everApproved[r] = true;
    }

    function ownerSetRecipientCap(uint256 seed, uint256 capSeed) external {
        address r = pool[seed % pool.length];
        vm.prank(owner);
        try vault.setRecipientCap(r, _capFrom(capSeed)) {}
        catch {
            revert("not approved");
        }
    }

    /// @dev Only acts on one seed in four, so recipients stay approved most of the time.
    function ownerRemoveRecipient(uint256 seed) external {
        if (seed % 4 != 0) return;
        vm.prank(owner);
        vault.removeRecipient(pool[(seed / 4) % pool.length]);
    }

    /// @dev Tops the vault up, so the campaign does not end up with an empty vault.
    function fundVault(uint256 amount) external {
        _mint(address(vault), bound(amount, 0, 20_000e6));
    }

    function ownerAllowStrategy(uint256 seed) external {
        address s = seed % 3 == 0 ? address(good1) : seed % 3 == 1 ? address(good2) : address(teller);
        vm.prank(owner);
        try vault.allowStrategy(s) {
            everAllowed[s] = true;
        } catch {
            revert("already allowed");
        }
    }

    function ownerDisallowStrategy(uint256 seed) external {
        // good strategies are removed less often than the hostile one, to keep the vault busy
        address s = seed % 8 == 0
            ? address(good1)
            : seed % 8 == 1 ? address(good2) : seed % 8 == 2 ? address(teller) : address(hostile);
        vm.prank(owner);
        try vault.disallowStrategy(s) {}
        catch {
            revert("not allowed");
        }
    }

    function ownerAllowHostile() external {
        vm.prank(owner);
        try vault.allowStrategy(address(hostile)) {}
        catch {
            revert("already allowed");
        }
    }

    /// @dev Revokes the operator on one seed in sixteen and (re)sets it otherwise.
    function ownerSetOperator(uint256 seed) external {
        vm.prank(owner);
        if (seed % 16 == 0) vault.revokeOperator();
        else vault.setOperator(operator);
    }

    function ownerRescueUsdc(uint256 amount) external {
        uint256 idle = usdc.balanceOf(address(vault));
        amount = bound(amount, 0, idle < 300e6 ? idle : 300e6); // small, so the vault keeps funds
        vm.prank(owner);
        vault.rescueToken(IERC20(address(usdc)), amount);
    }

    function ownerExitStrategy(uint256 seed) external {
        address s = _strategy(seed);
        vm.prank(owner);
        try vault.exitStrategy(s) {} catch {}
    }

    function ownerInvalidateNonce() external {
        vm.prank(owner);
        vault.invalidateNonce();
    }

    /*//////////////////////////////////////////////////////////////
                             withdrawAll (checked)
    //////////////////////////////////////////////////////////////*/

    struct Snap {
        uint256 idle;
        uint256 ownerUsdc;
        uint256 expectedOutGood;
        uint256[2] vaultSharesBefore;
        uint256[2] ownerSharesBefore;
        uint256[2] expectVaultAfter;
        uint256[2] expectOwnerGain;
        // teller
        bool tListed;
        uint256 tShares;
        uint256 ownerUsycBefore;
        bool vaultOk;
        bool ownerOk;
        bool fullOk;
    }

    /// @dev Acts on one call in three: it empties the vault, so it must not run all the time.
    function ownerWithdrawAll(uint256 seed) external {
        if (seed % 3 != 0) return;
        Snap memory s = _snapshot();

        vm.prank(owner);
        try vault.withdrawAll() {
            okWithdrawAlls++;
        } catch {
            withdrawAllReverted = true;
            return;
        }
        _checkWithdrawAll(s);
    }

    function _snapshot() internal view returns (Snap memory s) {
        s.idle = usdc.balanceOf(address(vault));
        s.ownerUsdc = usdc.balanceOf(owner);

        address[] memory list = vault.strategies();
        MockStrategy[2] memory goods = [good1, good2];
        for (uint256 g; g < 2; ++g) {
            MockStrategy m = goods[g];
            bool listed;
            for (uint256 i; i < list.length; ++i) {
                if (list[i] == address(m)) listed = true;
            }
            uint256 sh = m.balanceOf(address(vault));
            s.vaultSharesBefore[g] = sh;
            s.ownerSharesBefore[g] = m.balanceOf(owner);
            if (!listed || sh == 0) {
                s.expectVaultAfter[g] = sh; // not visited (or nothing to do)
                continue;
            }
            uint256 redeemNow;
            MockStrategy.Mode md = m.mode();
            if (md == MockStrategy.Mode.NORMAL || md == MockStrategy.Mode.V2) {
                redeemNow = sh;
            } else if (md == MockStrategy.Mode.CAPPED) {
                redeemNow = m.redeemCap() < sh ? m.redeemCap() : sh;
            }
            if (redeemNow != 0) s.expectedOutGood += m.previewRedeem(redeemNow);
            uint256 rest = sh - redeemNow;
            if (m.sharesLocked()) s.expectVaultAfter[g] = rest;
            else s.expectOwnerGain[g] = rest;
        }

        for (uint256 i; i < list.length; ++i) {
            if (list[i] == address(teller)) s.tListed = true;
        }
        s.tShares = usyc.balanceOf(address(vault));
        s.ownerUsycBefore = usyc.balanceOf(owner);
        s.vaultOk = !auth.paused() && auth.investor(address(vault));
        s.ownerOk = auth.investor(owner);
        if (s.tListed && s.tShares != 0) {
            (uint256 assets, uint256 fee,) = teller.previewRedeemData(address(vault), s.tShares);
            uint256 remaining = teller.redemptionLimitRemaining(address(vault), teller.todayTimestamp());
            s.fullOk = s.vaultOk && remaining >= assets && teller.totalAssets(address(vault)) >= assets + fee;
        }
    }

    function _checkWithdrawAll(Snap memory s) internal {
        if (usdc.balanceOf(address(vault)) != 0) withdrawAllViolation = true;

        // the plain ERC-4626 strategies: exact
        MockStrategy[2] memory goods = [good1, good2];
        for (uint256 g; g < 2; ++g) {
            if (goods[g].balanceOf(address(vault)) != s.expectVaultAfter[g]) {
                withdrawAllViolation = true;
            }
            if (goods[g].balanceOf(owner) - s.ownerSharesBefore[g] != s.expectOwnerGain[g]) {
                withdrawAllViolation = true;
            }
        }

        uint256 ownerGain = usdc.balanceOf(owner) - s.ownerUsdc;
        if (ownerGain < s.idle + s.expectedOutGood) {
            withdrawAllViolation = true;
            return;
        }
        uint256 fromTeller = ownerGain - s.idle - s.expectedOutGood;

        uint256 vaultAfter = usyc.balanceOf(address(vault));
        uint256 ownerAfter = usyc.balanceOf(owner);
        if (!s.tListed || s.tShares == 0) {
            // nothing to do with the teller: nothing may have moved
            if (fromTeller != 0 || vaultAfter != s.tShares || ownerAfter != s.ownerUsycBefore) {
                withdrawAllViolation = true;
            }
            return;
        }
        if (vaultAfter > s.tShares || ownerAfter < s.ownerUsycBefore) {
            withdrawAllViolation = true;
            return;
        }
        uint256 moved = ownerAfter - s.ownerUsycBefore;
        if (vaultAfter + moved > s.tShares) {
            withdrawAllViolation = true;
            return;
        }
        uint256 burned = s.tShares - vaultAfter - moved;

        // what the owner got from the teller is exactly what the teller pays for those shares
        (uint256 payout,,) = teller.previewRedeemData(address(vault), burned);
        if (burned == 0 ? fromTeller != 0 : fromTeller != payout) withdrawAllViolation = true;

        // frozen: if the vault is not allowlisted (or the authority is paused) nothing moves
        if (!s.vaultOk && (burned != 0 || moved != 0 || fromTeller != 0)) withdrawAllViolation = true;
        // both allowlisted: whatever was not redeemed is handed to the owner as USYC
        if (s.vaultOk && s.ownerOk && vaultAfter != 0) withdrawAllViolation = true;
        // the owner is never sent USYC it is not allowed to hold
        if (s.vaultOk && !s.ownerOk && moved != 0) withdrawAllViolation = true;
        // unconstrained: the whole position is redeemed
        if (s.fullOk && burned != s.tShares) withdrawAllViolation = true;
    }

    /*//////////////////////////////////////////////////////////////
                                SIGNATURES
    //////////////////////////////////////////////////////////////*/

    function signedAddRecipient(
        uint256 seed,
        uint256 capSeed,
        bool ownerKey,
        bool tamper,
        bool stale
    ) external {
        address r = pool[seed % pool.length];
        uint256 cap = _capFrom(capSeed);
        uint256 submittedCap = tamper ? (cap == 0 ? 1 : cap - 1) : cap;
        uint256 deadline = stale ? block.timestamp - 1 : block.timestamp + 1 days;

        bytes memory sig = _sign(ownerKey ? OWNER_PK : STRANGER_PK, r, cap, vault.nonces(owner), deadline);

        bool expectValid = ownerKey && !tamper && !stale;
        vm.prank(stranger); // the stranger (Hodd's server) submits
        try vault.addRecipientWithSig(r, submittedCap, deadline, sig) {
            if (!expectValid) badSignatureAccepted = true;
            else {
                okSignatures++;
                everApproved[r] = true;
                if (vault.recipientCap(r) != cap) badSignatureAccepted = true;
            }
        } catch {
            if (expectValid) {
                goodSignatureRejected = true; // a violation: must persist, so do not revert
                return;
            }
            revert("invalid signature rejected"); // expected failure
        }
    }

    function _sign(uint256 pk, address r, uint256 cap, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash =
            keccak256(abi.encode(vault.ADD_RECIPIENT_TYPEHASH(), r, cap, nonce, deadline));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("HoddieVault"),
                keccak256("1"),
                block.chainid,
                address(vault)
            )
        );
        (uint8 v, bytes32 rr, bytes32 ss) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(rr, ss, v);
    }

    /*//////////////////////////////////////////////////////////////
                                 STRANGER
    //////////////////////////////////////////////////////////////*/

    function strangerCall(uint256 fnSeed, uint256 targetSeed, uint256 amount, bytes32 ref)
        external
    {
        address target = allActors[targetSeed % allActors.length];
        if (targetSeed % 5 == 0) target = _strategy(targetSeed);
        bytes memory data = _strangerCalldata(fnSeed % 23, target, amount, ref);

        bytes32 beforeHash = _stateHash(target);
        vm.prank(stranger);
        (bool ok,) = address(vault).call(data);
        if (ok) strangerSucceeded = true;
        else okStrangerRejects++;
        if (_stateHash(target) != beforeHash) strangerChangedState = true;
    }

    function _strangerCalldata(uint256 fn, address target, uint256 amount, bytes32 ref)
        internal
        view
        returns (bytes memory)
    {
        if (fn == 0) return abi.encodeCall(vault.depositToStrategy, (target, amount, 1));
        if (fn == 1) return abi.encodeCall(vault.withdrawFromStrategy, (target, amount, NO_CAP));
        if (fn == 2) return abi.encodeCall(vault.redeemFromStrategy, (target, amount, 1));
        if (fn == 3) return abi.encodeCall(vault.transferToOwner, (amount));
        if (fn == 4) return abi.encodeCall(vault.pay, (target, amount, ref));
        if (fn == 5) return abi.encodeCall(vault.pause, ());
        if (fn == 6) return abi.encodeCall(vault.unpause, ());
        if (fn == 7) return abi.encodeCall(vault.setLimits, (amount, amount, amount, amount));
        if (fn == 8) return abi.encodeCall(vault.setOperator, (stranger));
        if (fn == 9) return abi.encodeCall(vault.revokeOperator, ());
        if (fn == 10) return abi.encodeCall(vault.allowStrategy, (address(never)));
        if (fn == 11) return abi.encodeCall(vault.disallowStrategy, (target));
        if (fn == 12) return abi.encodeCall(vault.addRecipient, (stranger, amount));
        if (fn == 13) return abi.encodeCall(vault.setRecipientCap, (target, amount));
        if (fn == 14) return abi.encodeCall(vault.removeRecipient, (target));
        if (fn == 15) return abi.encodeCall(vault.invalidateNonce, ());
        if (fn == 16) return abi.encodeCall(vault.withdrawAll, ());
        if (fn == 17) return abi.encodeCall(vault.exitStrategy, (target));
        if (fn == 18) return abi.encodeCall(vault.rescueToken, (IERC20(address(usdc)), amount));
        if (fn == 19) return abi.encodeCall(vault.transferOwnership, (stranger));
        if (fn == 20) return abi.encodeCall(vault.acceptOwnership, ());
        if (fn == 21) return abi.encodeCall(vault.renounceOwnership, ());
        // an unsigned/garbage signature path: must fail
        return abi.encodeCall(vault.addRecipientWithSig, (stranger, amount, block.timestamp + 1 days, hex"1234"));
    }

    /*//////////////////////////////////////////////////////////////
                               ENVIRONMENT
    //////////////////////////////////////////////////////////////*/

    function warp(uint256 secondsForward) external {
        // mostly short hops (within the same hour), sometimes hours, sometimes a jump over days
        uint256 kind = secondsForward % 8;
        uint256 hop = kind == 0
            ? bound(secondsForward, 0, 3 days)
            : kind < 3 ? bound(secondsForward, 0, 26 hours) : bound(secondsForward, 0, 30 minutes);
        vm.warp(block.timestamp + hop);
    }

    function setStrategyMode(uint256 seed, uint256 modeSeed, uint256 capSeed) external {
        MockStrategy m = seed % 2 == 0 ? good1 : good2;
        MockStrategy.Mode md = MockStrategy.Mode(modeSeed % 4);
        uint256 cap = bound(capSeed, 0, m.balanceOf(address(vault)) + 1);
        m.setMode(md, cap);
    }

    function setSharesLocked(uint256 seed, bool locked) external {
        (seed % 2 == 0 ? good1 : good2).setSharesLocked(locked);
    }

    function setHostileMode(uint256 modeSeed) external {
        // BURN is covered by unit tests (it makes gas accounting of the whole run noisy)
        hostile.setMode(HostileStrategy.Mode(modeSeed % 5));
    }

    function donateYield(uint256 seed, uint256 amount) external {
        amount = bound(amount, 0, 500e6);
        vm.prank(donor);
        (seed % 2 == 0 ? good1 : good2).donate(amount);
    }

    // ---- the permissioned teller's world ----

    /// @dev Circle (de)allowlists the vault (rarely) and the owner (sometimes).
    function setTellerAccess(uint256 seed) external {
        auth.setUserRole(address(vault), 0, seed % 8 != 0);
        auth.setUserRole(owner, 0, (seed / 8) % 4 != 0);
    }

    function setTellerEconomics(uint256 priceSeed, uint256 feeSeed, bool nextPrice) external {
        uint256 price = 0.9e18 + bound(priceSeed, 0, 4000) * 1e14; // 0.90 .. 1.30
        uint256 next = price + bound(priceSeed / 7, 0, 30) * 1e14;
        uint256 depFee = feeSeed % 3 == 0 ? 0 : (feeSeed % 3) * 25; // 0, 25 or 50 bps
        uint256 redFee = (feeSeed / 3) % 3 == 0 ? 0 : ((feeSeed / 3) % 3) * 25;
        teller.configure(price, next, nextPrice, depFee, redFee);
    }

    function setTellerLimits(uint256 seed) external {
        uint256 m = seed % 4;
        uint256 redeem = m == 0 ? type(uint256).max : m == 1 ? 300e6 : m == 2 ? 800e6 : 0;
        uint256 subscribe = (seed / 4) % 3 == 0 ? 500e6 : type(uint256).max;
        teller.setLimits(subscribe, redeem);
    }

    function moveTreasury(uint256 seed, bool drain) external {
        if (drain) {
            uint256 bal = usdc.balanceOf(treasury);
            vm.prank(treasury);
            usdc.transfer(donor, bound(seed, 0, bal));
        } else {
            uint256 bal = usdc.balanceOf(donor);
            vm.prank(donor);
            usdc.transfer(treasury, bound(seed, 0, bal));
        }
    }

    /// @dev Circle can pause its RolesAuthority: every permission check then reverts.
    function pauseAuthority(uint256 seed) external {
        auth.setPaused(seed % 16 == 0);
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _mint(address to, uint256 amount) internal {
        usdc.mint(to, amount);
        minted += amount;
    }

    /// @dev 2/10 good1, 2/10 good2, 4/10 teller, 1/10 never-allowlisted, 1/10 hostile.
    function _strategy(uint256 seed) internal view returns (address) {
        uint256 i = seed % 10;
        if (i < 2) return address(good1);
        if (i < 4) return address(good2);
        if (i < 8) return address(teller);
        if (i == 8) return address(never);
        return address(hostile);
    }

    /// @dev 2/3 recipient candidates, 1/3 addresses that are never approved.
    function _payTarget(uint256 seed) internal view returns (address) {
        uint256 i = seed % 12;
        if (i < 8) return pool[i % 4];
        if (i < 10) return outsiders[i - 8];
        if (i == 10) return operator;
        return stranger;
    }

    function _stateHash(address target) internal view returns (bytes32) {
        bytes32 h = keccak256(
            abi.encode(
                vault.owner(),
                vault.pendingOwner(),
                vault.operator(),
                vault.maxDepositPerTx(),
                vault.depositLimit24h(),
                vault.maxPaymentPerTx(),
                vault.paymentLimit24h()
            )
        );
        h = keccak256(
            abi.encode(
                h,
                vault.depositSpentLast24h(),
                vault.paymentSpentLast24h(),
                vault.paused(),
                vault.strategies(),
                vault.nonces(owner)
            )
        );
        h = keccak256(
            abi.encode(
                h, vault.isRecipient(target), vault.recipientCap(target), vault.isStrategy(target)
            )
        );
        for (uint256 i; i < allActors.length; ++i) {
            h = keccak256(
                abi.encode(
                    h,
                    usdc.balanceOf(allActors[i]),
                    good1.balanceOf(allActors[i]),
                    good2.balanceOf(allActors[i]),
                    usyc.balanceOf(allActors[i]),
                    vault.isRecipient(allActors[i]),
                    vault.recipientCap(allActors[i])
                )
            );
        }
        return keccak256(
            abi.encode(
                h,
                usdc.balanceOf(address(vault)),
                good1.balanceOf(address(vault)),
                good2.balanceOf(address(vault)),
                usyc.balanceOf(address(vault)),
                usdc.balanceOf(address(good1)),
                usdc.balanceOf(address(good2)),
                usdc.balanceOf(treasury)
            )
        );
    }
}
