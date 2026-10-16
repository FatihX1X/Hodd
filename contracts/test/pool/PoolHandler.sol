// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddUSYCVault} from "../../src/HoddUSYCVault.sol";
import {ITeller} from "../../src/interfaces/ITeller.sol";
import {IRolesAuthority} from "../../src/interfaces/IRolesAuthority.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockRolesAuthority, MockUSYC, MockTeller} from "../mocks/MockTeller.sol";

/// @dev Three ordinary users (never allowlisted), an allowlisted donor, the admin and a stranger
///      act on the pool at random while Circle's side (allowlist, authority pause, price, next
///      price, fees, daily limits, treasury liquidity) changes under it. Every property violation
///      is recorded in a ghost flag that the invariant contract asserts to be false.
contract PoolHandler is CommonBase, StdCheats, StdUtils {
    uint256 internal constant START = 20_000 days + 12 hours;

    HoddUSYCVault public pool;
    MockUSDC public usdc;
    MockRolesAuthority public auth;
    MockUSYC public usyc;
    MockTeller public teller;

    address public admin;
    address public donor;
    address public stranger;
    address public treasury;
    address public feeRecipient;
    address[3] public users;
    address[] internal actors; // everyone whose balances are watched

    // ---- ghost state ----
    uint256 public minted; // total USDC ever minted
    uint256 public usycIn; // USYC the pool received through deposits
    uint256 public usycOut; // USYC the pool paid out through redemptions
    uint256 public usycGifts; // USYC the pool received without minting shares
    mapping(address => uint256) public contributed; // USYC each user brought
    mapping(address => uint256) public redeemed; // USYC each user took out

    bool public redeemPaidSomeoneElse;
    bool public redeemWrongAmount;
    bool public userGotMoreThanContributedPlusGifts;
    bool public adminChangedBalances;
    bool public strangerSucceeded;
    bool public strangerChangedState;
    bool public depositMintedWrongShares;

    uint256 public okDeposits;
    uint256 public okRedeems;
    uint256 public okReinvests;
    uint256 public blockedRedeems; // redeems that failed because Circle's side refused

    constructor() {
        vm.warp(START);
        admin = makeAddr("admin");
        donor = makeAddr("donor");
        stranger = makeAddr("stranger");
        treasury = makeAddr("treasury");
        feeRecipient = makeAddr("feeRecipient");
        users = [makeAddr("alice"), makeAddr("bob"), makeAddr("carol")];

        usdc = new MockUSDC();
        auth = new MockRolesAuthority();
        usyc = new MockUSYC(auth);
        teller = new MockTeller(IERC20(address(usdc)), usyc, auth, treasury, feeRecipient);
        usyc.setMinter(address(teller), true);
        pool = new HoddUSYCVault(
            IERC20(address(usdc)),
            ITeller(address(teller)),
            IERC20(address(usyc)),
            IRolesAuthority(address(auth)),
            admin
        );
        vm.prank(admin);
        pool.setDepositCaps(5000e6, 500_000e6);

        auth.setUserRole(address(pool), 0, true);
        auth.setUserRole(donor, 0, true);

        _mint(treasury, 5_000_000e6);
        vm.prank(treasury);
        usdc.approve(address(teller), type(uint256).max);
        for (uint256 i; i < 3; ++i) {
            _mint(users[i], 1_000_000e6);
            vm.prank(users[i]);
            usdc.approve(address(pool), type(uint256).max);
            actors.push(users[i]);
        }
        _mint(donor, 1_000_000e6);
        vm.startPrank(donor);
        usdc.approve(address(teller), type(uint256).max);
        vm.stopPrank();
        actors.push(donor);
        actors.push(admin);
        actors.push(stranger);
        actors.push(feeRecipient);
    }

    function _mint(address to, uint256 amount) internal {
        usdc.mint(to, amount);
        minted += amount;
    }

    function actorList() external view returns (address[] memory) {
        return actors;
    }

    /*//////////////////////////////////////////////////////////////
                                  USERS
    //////////////////////////////////////////////////////////////*/

    function deposit(uint256 userSeed, uint256 amount, uint256 boundSeed) external {
        address u = users[userSeed % 3];
        amount = bound(amount, 0, 5000e6);
        uint256 heldBefore = usyc.balanceOf(address(pool));
        uint256 supplyBefore = pool.totalSupply();
        uint256 minShares = boundSeed % 3 == 0 ? 0 : pool.previewDeposit(amount);

        vm.prank(u);
        try pool.deposit(amount, u, minShares) returns (uint256 shares) {
            okDeposits++;
            uint256 got = usyc.balanceOf(address(pool)) - heldBefore;
            usycIn += got;
            contributed[u] += got;
            // the shares are exactly what the formula says
            if (shares != (got * (supplyBefore + 1e6)) / (heldBefore + 1)) {
                depositMintedWrongShares = true;
            }
        } catch {
            revert("deposit reverted"); // expected failure: shows up in the metrics table
        }
    }

    function redeem(uint256 userSeed, uint256 sharesSeed, bool all) external {
        // prefer a user who actually holds shares, so redemptions are exercised often
        address u = users[userSeed % 3];
        for (uint256 i; i < 3 && pool.balanceOf(u) == 0; ++i) {
            u = users[(userSeed + i + 1) % 3];
        }
        uint256 balance = pool.balanceOf(u);
        uint256 shares = all ? balance : bound(sharesSeed, 0, balance);

        uint256 heldBefore = usyc.balanceOf(address(pool));
        uint256 supplyBefore = pool.totalSupply();
        uint256 expectedUsyc = (shares * (heldBefore + 1)) / (supplyBefore + 1e6);
        uint256[] memory usdcBefore = _usdcBalances();
        uint256 poolUsdcBefore = usdc.balanceOf(address(pool));

        vm.prank(u);
        try pool.redeem(shares, u, u) returns (uint256 assets) {
            okRedeems++;
            uint256 paid = heldBefore - usyc.balanceOf(address(pool));
            usycOut += paid;
            redeemed[u] += paid;
            if (paid != expectedUsyc) redeemWrongAmount = true;
            if (redeemed[u] > contributed[u] + usycGifts + 1) {
                userGotMoreThanContributedPlusGifts = true;
            }
            // the USDC went to the holder and to nobody else
            uint256[] memory usdcAfter = _usdcBalances();
            for (uint256 i; i < actors.length; ++i) {
                if (actors[i] == u) {
                    if (usdcAfter[i] != usdcBefore[i] + assets) redeemPaidSomeoneElse = true;
                } else if (actors[i] == feeRecipient) {
                    // the Teller's fee goes to its recipient, which is not a holder
                } else if (usdcAfter[i] != usdcBefore[i]) {
                    redeemPaidSomeoneElse = true;
                }
            }
            if (usdc.balanceOf(address(pool)) != poolUsdcBefore) redeemPaidSomeoneElse = true;
        } catch {
            if (shares != 0 && balance != 0) blockedRedeems++;
            revert("redeem reverted");
        }
    }

    /// @dev A holder tries to have the USDC sent to somebody else, or somebody else (also the admin)
    ///      tries to redeem the holder's shares: all of it must fail and move nothing.
    function redeemElsewhere(uint256 userSeed, uint256 mode) external {
        address u = users[userSeed % 3];
        for (uint256 i; i < 3 && pool.balanceOf(u) == 0; ++i) {
            u = users[(userSeed + i + 1) % 3];
        }
        uint256 shares = pool.balanceOf(u);
        if (shares == 0) return;
        address other = mode % 2 == 0 ? stranger : users[(userSeed + 1) % 3];
        if (other == u) other = stranger;

        bytes32 beforeHash = _stateHash();
        address caller = mode % 3 == 0 ? u : mode % 3 == 1 ? other : admin;
        address receiver = mode % 3 == 0 ? other : u; // holder -> other receiver, or other -> holder
        vm.prank(caller);
        (bool ok,) = address(pool)
            .call(abi.encodeWithSignature("redeem(uint256,address,address)", shares, receiver, u));
        if (ok) redeemPaidSomeoneElse = true;
        if (_stateHash() != beforeHash) redeemPaidSomeoneElse = true;
    }

    /*//////////////////////////////////////////////////////////////
                                 DONATIONS
    //////////////////////////////////////////////////////////////*/

    function donateUsdc(uint256 amount) external {
        amount = bound(amount, 0, 20_000e6);
        vm.prank(donor);
        usdc.transfer(address(pool), amount);
    }

    function reinvestIdle(uint256 callerSeed) external {
        uint256 heldBefore = usyc.balanceOf(address(pool));
        vm.prank(callerSeed % 2 == 0 ? stranger : users[callerSeed % 3]);
        try pool.reinvestIdle() {
            okReinvests++;
            usycGifts += usyc.balanceOf(address(pool)) - heldBefore;
        } catch {
            revert("reinvest reverted");
        }
    }

    /// @dev An allowlisted party buys USYC and gifts it to the pool.
    function donateUsyc(uint256 amount) external {
        amount = bound(amount, 2e6, 20_000e6);
        vm.startPrank(donor);
        try teller.deposit(amount, donor) returns (uint256 got) {
            usyc.transfer(address(pool), got);
            usycGifts += got;
        } catch {
            vm.stopPrank();
            revert("teller refused");
        }
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                                  ADMIN
    //////////////////////////////////////////////////////////////*/

    function adminActs(uint256 seed, uint256 a, uint256 b) external {
        uint256[] memory usdcBefore = _usdcBalances();
        uint256[] memory usycBefore = _usycBalances();
        uint256[] memory sharesBefore = _shareBalances();
        uint256 poolUsdc = usdc.balanceOf(address(pool));
        uint256 poolUsyc = usyc.balanceOf(address(pool));
        uint256 supply = pool.totalSupply();

        vm.startPrank(admin);
        uint256 k = seed % 4;
        if (k == 0) pool.pauseDeposits();
        else if (k == 1) pool.unpauseDeposits();
        else if (k == 2) pool.setDepositCaps(bound(a, 0, 5000e6), bound(b, 0, 500_000e6));
        else pool.setDepositCaps(5000e6, 500_000e6);
        vm.stopPrank();

        uint256[] memory usdcAfter = _usdcBalances();
        uint256[] memory usycAfter = _usycBalances();
        uint256[] memory sharesAfter = _shareBalances();
        for (uint256 i; i < actors.length; ++i) {
            if (
                usdcAfter[i] != usdcBefore[i] || usycAfter[i] != usycBefore[i]
                    || sharesAfter[i] != sharesBefore[i]
            ) adminChangedBalances = true;
        }
        if (
            usdc.balanceOf(address(pool)) != poolUsdc || usyc.balanceOf(address(pool)) != poolUsyc
                || pool.totalSupply() != supply
        ) adminChangedBalances = true;
    }

    /*//////////////////////////////////////////////////////////////
                                 STRANGER
    //////////////////////////////////////////////////////////////*/

    function strangerCall(uint256 fnSeed, uint256 amount, uint256 targetSeed) external {
        address victim = users[targetSeed % 3];
        bytes memory data;
        uint256 k = fnSeed % 11;
        if (k == 0) {
            data = abi.encodeCall(pool.pauseDeposits, ());
        } else if (k == 1) {
            data = abi.encodeCall(pool.unpauseDeposits, ());
        } else if (k == 2) {
            data = abi.encodeCall(pool.setDepositCaps, (amount, amount));
        } else if (k == 3) {
            data = abi.encodeCall(pool.transferOwnership, (stranger));
        } else if (k == 4) {
            data = abi.encodeCall(pool.acceptOwnership, ());
        } else if (k == 5) {
            data = abi.encodeCall(pool.renounceOwnership, ());
        } else if (k == 6) {
            data = abi.encodeWithSignature(
                "redeem(uint256,address,address)", pool.balanceOf(victim), stranger, victim
            );
        } else if (k == 7) {
            data = abi.encodeWithSignature(
                "redeem(uint256,address,address)", pool.balanceOf(victim), victim, victim
            );
        } else if (k == 8) {
            data = abi.encodeCall(pool.transferFrom, (victim, stranger, amount));
        } else if (k == 9) {
            data = abi.encodeCall(pool.mint, (amount, stranger));
        } else {
            data = abi.encodeCall(pool.withdraw, (amount, stranger, victim));
        }

        bytes32 beforeHash = _stateHash();
        vm.prank(stranger);
        (bool ok,) = address(pool).call(data);
        if (ok) strangerSucceeded = true;
        if (_stateHash() != beforeHash) strangerChangedState = true;
    }

    /*//////////////////////////////////////////////////////////////
                         CIRCLE'S SIDE OF THE WORLD
    //////////////////////////////////////////////////////////////*/

    function setPrices(uint256 priceSeed, uint256 nextSeed, bool useNext, uint256 feeSeed)
        external
    {
        uint256 p = 1.0e18 + bound(priceSeed, 0, 3000) * 1e14;
        uint256 np = p + bound(nextSeed, 0, 100) * 1e14;
        uint256 depFee = feeSeed % 3 == 0 ? 0 : (feeSeed % 3) * 25;
        uint256 redFee = (feeSeed / 3) % 3 == 0 ? 0 : ((feeSeed / 3) % 3) * 25;
        teller.configure(p, np, useNext, depFee, redFee);
    }

    /// @dev Circle takes the pool off the allowlist now and then.
    function setAllowlist(uint256 seed) external {
        auth.setUserRole(address(pool), 0, seed % 6 != 0);
    }

    function pauseAuthority(uint256 seed) external {
        auth.setPaused(seed % 12 == 0);
    }

    function setTellerLimits(uint256 seed) external {
        uint256 m = seed % 4;
        uint256 redeemLimit = m == 0 ? type(uint256).max : m == 1 ? 500e6 : m == 2 ? 3000e6 : 0;
        uint256 subscribeLimit = (seed / 4) % 3 == 0 ? 2000e6 : type(uint256).max;
        teller.setLimits(subscribeLimit, redeemLimit);
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

    function warp(uint256 seconds_) external {
        uint256 k = seconds_ % 4;
        vm.warp(
            block.timestamp + (k == 0 ? bound(seconds_, 0, 3 days) : bound(seconds_, 0, 2 hours))
        );
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNALS
    //////////////////////////////////////////////////////////////*/

    function _usdcBalances() internal view returns (uint256[] memory out) {
        out = new uint256[](actors.length);
        for (uint256 i; i < actors.length; ++i) {
            out[i] = usdc.balanceOf(actors[i]);
        }
    }

    function _usycBalances() internal view returns (uint256[] memory out) {
        out = new uint256[](actors.length);
        for (uint256 i; i < actors.length; ++i) {
            out[i] = usyc.balanceOf(actors[i]);
        }
    }

    function _shareBalances() internal view returns (uint256[] memory out) {
        out = new uint256[](actors.length);
        for (uint256 i; i < actors.length; ++i) {
            out[i] = pool.balanceOf(actors[i]);
        }
    }

    function _stateHash() internal view returns (bytes32 h) {
        h = keccak256(
            abi.encode(
                pool.owner(),
                pool.pendingOwner(),
                pool.depositsPaused(),
                pool.maxDepositPerTx(),
                pool.maxTotalAssets(),
                pool.totalSupply(),
                usdc.balanceOf(address(pool)),
                usyc.balanceOf(address(pool)),
                _shareBalances(),
                _usdcBalances()
            )
        );
    }
}
