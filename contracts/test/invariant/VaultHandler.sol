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

/// @dev Lets the operator, the owner and a stranger call random vault functions with random
///      arguments, and records every property violation in a ghost flag that the invariant
///      contract asserts to be false.
contract VaultHandler is CommonBase, StdCheats, StdUtils {
    uint256 internal constant OWNER_PK = 0xA11CE;
    uint256 internal constant STRANGER_PK = 0xBAD;
    uint256 internal constant START = 20_000 days + 12 hours;

    HoddieVault public vault;
    MockUSDC public usdc;
    MockStrategy public good1;
    MockStrategy public good2;
    MockStrategy public never; // never allowlisted
    HostileStrategy public hostile; // allowlisted from the start, misbehaves

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
    mapping(uint256 => uint256) public spentByDay;
    uint256 public minted;

    bool public limitViolation;
    bool public unlimitedOpChangedBudget;
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

        usdc = new MockUSDC();
        good1 = new MockStrategy(IERC20(address(usdc)));
        good2 = new MockStrategy(IERC20(address(usdc)));
        never = new MockStrategy(IERC20(address(usdc)));
        hostile = new HostileStrategy(address(usdc), HostileStrategy.Mode.REVERT);

        for (uint256 i; i < 4; ++i) {
            pool.push(makeAddr(string.concat("recipient", vm.toString(i))));
        }
        outsiders.push(makeAddr("outsider0"));
        outsiders.push(makeAddr("outsider1"));

        address[] memory list = new address[](3);
        list[0] = address(hostile);
        list[1] = address(good1);
        list[2] = address(good2);
        vault = new HoddieVault(IERC20(address(usdc)), owner, operator, 1000e6, 3000e6, list);
        everAllowed[address(hostile)] = true;
        everAllowed[address(good1)] = true;
        everAllowed[address(good2)] = true;

        _mint(address(vault), 50_000e6);
        _mint(donor, 1_000_000e6);
        vm.prank(donor);
        usdc.approve(address(good1), type(uint256).max);
        vm.prank(donor);
        usdc.approve(address(good2), type(uint256).max);

        // A realistic starting point: two approved recipients and money already invested, so
        // that payments, withdrawals and withdrawAll have something to work on from call one.
        vm.startPrank(owner);
        vault.addRecipient(pool[0]);
        vault.addRecipient(pool[1]);
        vm.stopPrank();
        everApproved[pool[0]] = true;
        everApproved[pool[1]] = true;
        vm.startPrank(operator);
        vault.depositToStrategy(address(good1), 900e6);
        vault.depositToStrategy(address(good2), 600e6);
        vm.stopPrank();
        spentByDay[block.timestamp / 1 days] = 1500e6;

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

    /*//////////////////////////////////////////////////////////////
                               OPERATOR
    //////////////////////////////////////////////////////////////*/

    function opDeposit(uint256 stratSeed, uint256 amount) external {
        address s = _strategy(stratSeed);
        amount = bound(amount, 0, 800e6);
        uint256 beforeSpent = vault.spentToday();
        vm.prank(operator);
        try vault.depositToStrategy(s, amount) {
            okDeposits++;
            _recordLimitedOutflow(amount, beforeSpent);
        } catch {
            revert("vault call reverted"); // expected failure: shows up in the metrics table
        }
    }

    function opWithdraw(uint256 stratSeed, uint256 amount) external {
        address s = _strategy(stratSeed);
        amount = bound(amount, 0, 800e6);
        uint256 beforeSpent = vault.spentToday();
        vm.prank(operator);
        try vault.withdrawFromStrategy(s, amount) {
            if (vault.spentToday() != beforeSpent) unlimitedOpChangedBudget = true;
        } catch {
            revert("vault call reverted");
        }
    }

    function opRedeem(uint256 stratSeed, uint256 shares) external {
        address s = _strategy(stratSeed);
        // the hostile strategy reverts on balanceOf, so do not ask it
        uint256 held = s == address(hostile) ? 100e6 : MockStrategy(s).balanceOf(address(vault));
        shares = bound(shares, 0, held + 1);
        uint256 beforeSpent = vault.spentToday();
        vm.prank(operator);
        try vault.redeemFromStrategy(s, shares) {
            if (vault.spentToday() != beforeSpent) unlimitedOpChangedBudget = true;
        } catch {
            revert("vault call reverted");
        }
    }

    function opTransferToOwner(uint256 amount) external {
        amount = bound(amount, 0, 400e6);
        uint256 beforeSpent = vault.spentToday();
        vm.prank(operator);
        try vault.transferToOwner(amount) {
            if (vault.spentToday() != beforeSpent) unlimitedOpChangedBudget = true;
        } catch {
            revert("vault call reverted");
        }
    }

    function opPay(uint256 targetSeed, uint256 amount, bytes32 ref) external {
        address to = _payTarget(targetSeed);
        amount = bound(amount, 0, 800e6);
        uint256 beforeSpent = vault.spentToday();
        vm.prank(operator);
        try vault.pay(to, amount, ref) {
            okPayments++;
            if (!vault.isRecipient(to)) paidUnapproved = true;
            _recordLimitedOutflow(amount, beforeSpent);
        } catch {
            revert("vault call reverted");
        }
    }

    /// @dev Called after a limited outflow succeeded: the rules must have held at that moment.
    function _recordLimitedOutflow(uint256 amount, uint256 beforeSpent) internal {
        uint256 day = block.timestamp / 1 days;
        spentByDay[day] += amount;
        if (amount > vault.maxPerTx()) limitViolation = true;
        if (spentByDay[day] > vault.dailyLimit()) limitViolation = true;
        if (vault.spentToday() != spentByDay[day]) limitViolation = true;
        if (vault.spentToday() != beforeSpent + amount) limitViolation = true;
    }

    /*//////////////////////////////////////////////////////////////
                                 OWNER
    //////////////////////////////////////////////////////////////*/

    function ownerSetLimits(uint256 maxPerTx, uint256 dailyLimit) external {
        vm.prank(owner);
        vault.setLimits(bound(maxPerTx, 0, 1500e6), bound(dailyLimit, 0, 6000e6));
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

    function ownerAddRecipient(uint256 seed) external {
        address r = pool[seed % pool.length];
        vm.prank(owner);
        vault.addRecipient(r);
        everApproved[r] = true;
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
        address s = seed % 2 == 0 ? address(good1) : address(good2);
        vm.prank(owner);
        try vault.allowStrategy(s) {
            everAllowed[s] = true;
        } catch {
            revert("already allowed");
        }
    }

    function ownerDisallowStrategy(uint256 seed) external {
        // good strategies are removed less often than the hostile one, to keep the vault busy
        address s =
            seed % 4 == 0 ? address(good1) : seed % 4 == 1 ? address(good2) : address(hostile);
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

    /// @dev Acts on one call in three: it empties the vault, so it must not run all the time.
    function ownerWithdrawAll(uint256 seed) external {
        if (seed % 3 != 0) return;
        uint256 idle = usdc.balanceOf(address(vault));
        uint256 ownerUsdcBefore = usdc.balanceOf(owner);

        address[] memory list = vault.strategies();
        MockStrategy[2] memory goods = [good1, good2];
        uint256[2] memory vaultSharesBefore;
        uint256[2] memory ownerSharesBefore;
        uint256[2] memory expectVaultAfter;
        uint256[2] memory expectOwnerGain;
        bool[2] memory listed;
        uint256 expectedOut;

        for (uint256 g; g < 2; ++g) {
            MockStrategy m = goods[g];
            for (uint256 i; i < list.length; ++i) {
                if (list[i] == address(m)) listed[g] = true;
            }
            uint256 sh = m.balanceOf(address(vault));
            vaultSharesBefore[g] = sh;
            ownerSharesBefore[g] = m.balanceOf(owner);
            if (!listed[g] || sh == 0) {
                expectVaultAfter[g] = sh; // not visited (or nothing to do)
                continue;
            }
            uint256 redeemNow;
            MockStrategy.Mode md = m.mode();
            if (md == MockStrategy.Mode.NORMAL || md == MockStrategy.Mode.V2) {
                redeemNow = sh;
            } else if (md == MockStrategy.Mode.CAPPED) {
                redeemNow = m.redeemCap() < sh ? m.redeemCap() : sh;
            }
            if (redeemNow != 0) expectedOut += m.previewRedeem(redeemNow);
            uint256 rest = sh - redeemNow;
            if (m.sharesLocked()) expectVaultAfter[g] = rest;
            else expectOwnerGain[g] = rest;
        }

        vm.prank(owner);
        try vault.withdrawAll() {
            okWithdrawAlls++;
        } catch {
            withdrawAllReverted = true;
            return;
        }

        if (usdc.balanceOf(address(vault)) != 0) withdrawAllViolation = true;
        if (usdc.balanceOf(owner) - ownerUsdcBefore != idle + expectedOut) {
            withdrawAllViolation = true;
        }
        for (uint256 g; g < 2; ++g) {
            if (goods[g].balanceOf(address(vault)) != expectVaultAfter[g]) {
                withdrawAllViolation = true;
            }
            if (goods[g].balanceOf(owner) - ownerSharesBefore[g] != expectOwnerGain[g]) {
                withdrawAllViolation = true;
            }
        }
    }

    /*//////////////////////////////////////////////////////////////
                                SIGNATURES
    //////////////////////////////////////////////////////////////*/

    function signedAddRecipient(
        uint256 seed,
        bool ownerKey,
        bool tamper,
        bool stale,
        uint256 deadlineOffset
    ) external {
        address r = pool[seed % pool.length];
        address submitted = tamper ? pool[(seed + 1) % pool.length] : r;
        uint256 deadline =
            stale ? block.timestamp - 1 : block.timestamp + bound(deadlineOffset, 0, 2 days);
        uint256 nonce = vault.nonces(owner);

        bytes32 structHash =
            keccak256(abi.encode(vault.ADD_RECIPIENT_TYPEHASH(), r, nonce, deadline));
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
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(
            ownerKey ? OWNER_PK : STRANGER_PK,
            keccak256(abi.encodePacked("\x19\x01", domain, structHash))
        );

        bool expectValid = ownerKey && !tamper && !stale;
        vm.prank(stranger); // the stranger (Hodd's server) submits
        try vault.addRecipientWithSig(submitted, deadline, abi.encodePacked(rr, ss, v)) {
            if (!expectValid) {
                badSignatureAccepted = true;
            } else {
                okSignatures++;
                everApproved[submitted] = true;
            }
        } catch {
            if (expectValid) {
                goodSignatureRejected = true; // a violation: must persist, so do not revert
                return;
            }
            revert("invalid signature rejected"); // expected failure
        }
    }

    /*//////////////////////////////////////////////////////////////
                                 STRANGER
    //////////////////////////////////////////////////////////////*/

    function strangerCall(uint256 fnSeed, uint256 targetSeed, uint256 amount, bytes32 ref)
        external
    {
        address target = allActors[targetSeed % allActors.length];
        if (targetSeed % 5 == 0) target = _strategy(targetSeed);
        bytes memory data;
        uint256 fn = fnSeed % 21;
        if (fn == 0) data = abi.encodeCall(vault.depositToStrategy, (target, amount));
        else if (fn == 1) data = abi.encodeCall(vault.withdrawFromStrategy, (target, amount));
        else if (fn == 2) data = abi.encodeCall(vault.redeemFromStrategy, (target, amount));
        else if (fn == 3) data = abi.encodeCall(vault.transferToOwner, (amount));
        else if (fn == 4) data = abi.encodeCall(vault.pay, (target, amount, ref));
        else if (fn == 5) data = abi.encodeCall(vault.pause, ());
        else if (fn == 6) data = abi.encodeCall(vault.unpause, ());
        else if (fn == 7) data = abi.encodeCall(vault.setLimits, (amount, amount));
        else if (fn == 8) data = abi.encodeCall(vault.setOperator, (stranger));
        else if (fn == 9) data = abi.encodeCall(vault.revokeOperator, ());
        else if (fn == 10) data = abi.encodeCall(vault.allowStrategy, (address(never)));
        else if (fn == 11) data = abi.encodeCall(vault.disallowStrategy, (target));
        else if (fn == 12) data = abi.encodeCall(vault.addRecipient, (stranger));
        else if (fn == 13) data = abi.encodeCall(vault.removeRecipient, (target));
        else if (fn == 14) data = abi.encodeCall(vault.invalidateNonce, ());
        else if (fn == 15) data = abi.encodeCall(vault.withdrawAll, ());
        else if (fn == 16) data = abi.encodeCall(vault.exitStrategy, (target));
        else if (fn == 17) data = abi.encodeCall(vault.rescueToken, (IERC20(address(usdc)), amount));
        else if (fn == 18) data = abi.encodeCall(vault.transferOwnership, (stranger));
        else if (fn == 19) data = abi.encodeCall(vault.acceptOwnership, ());
        else data = abi.encodeCall(vault.renounceOwnership, ());

        bytes32 beforeHash = _stateHash(target);
        vm.prank(stranger);
        (bool ok,) = address(vault).call(data);
        if (ok) strangerSucceeded = true;
        else okStrangerRejects++;
        if (_stateHash(target) != beforeHash) strangerChangedState = true;
    }

    /*//////////////////////////////////////////////////////////////
                               ENVIRONMENT
    //////////////////////////////////////////////////////////////*/

    function warp(uint256 secondsForward) external {
        // mostly short hops (same UTC day), sometimes a jump over midnight
        uint256 hop = secondsForward % 4 == 0
            ? bound(secondsForward, 0, 3 days)
            : bound(secondsForward, 0, 2 hours);
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

    /*//////////////////////////////////////////////////////////////
                               INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _mint(address to, uint256 amount) internal {
        usdc.mint(to, amount);
        minted += amount;
    }

    /// @dev 3/8 good1, 3/8 good2, 1/8 never-allowlisted, 1/8 hostile.
    function _strategy(uint256 seed) internal view returns (address) {
        uint256 i = seed % 8;
        if (i < 3) return address(good1);
        if (i < 6) return address(good2);
        if (i == 6) return address(never);
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
                vault.maxPerTx(),
                vault.dailyLimit(),
                vault.spentInDay(),
                vault.lastSpendDay(),
                vault.paused(),
                vault.strategies(),
                vault.nonces(owner),
                vault.isRecipient(target),
                vault.isStrategy(target)
            )
        );
        for (uint256 i; i < allActors.length; ++i) {
            h = keccak256(
                abi.encode(
                    h,
                    usdc.balanceOf(allActors[i]),
                    good1.balanceOf(allActors[i]),
                    good2.balanceOf(allActors[i]),
                    vault.isRecipient(allActors[i])
                )
            );
        }
        return keccak256(
            abi.encode(
                h,
                usdc.balanceOf(address(vault)),
                good1.balanceOf(address(vault)),
                good2.balanceOf(address(vault)),
                usdc.balanceOf(address(good1)),
                usdc.balanceOf(address(good2))
            )
        );
    }
}
