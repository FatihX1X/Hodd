// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddUSYCVault} from "../../src/HoddUSYCVault.sol";
import {ITeller} from "../../src/interfaces/ITeller.sol";
import {IRolesAuthority} from "../../src/interfaces/IRolesAuthority.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MockRolesAuthority, MockUSYC, MockTeller} from "../mocks/MockTeller.sol";

/// @dev Fixture for the pooled USYC vault: a mock Teller / USYC token / RolesAuthority that enforce
///      the allowlist exactly like Circle's contracts, the pool itself allowlisted, and three
///      ordinary users that are NOT allowlisted.
abstract contract PoolBase is Test {
    uint256 internal constant DAY0 = 20_000 days;
    uint256 internal constant USER_FUNDS = 1_000_000e6;

    MockUSDC internal usdc;
    MockRolesAuthority internal auth;
    MockUSYC internal usyc;
    MockTeller internal teller;
    HoddUSYCVault internal pool;

    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal donor = makeAddr("donor"); // an allowlisted USYC holder
    address internal stranger = makeAddr("stranger");
    address internal treasury = makeAddr("treasury");
    address internal feeRecipient = makeAddr("feeRecipient");

    function setUp() public virtual {
        vm.warp(DAY0 + 12 hours);
        usdc = new MockUSDC();
        auth = new MockRolesAuthority();
        usyc = new MockUSYC(auth);
        teller = new MockTeller(IERC20(address(usdc)), usyc, auth, treasury, feeRecipient);
        usyc.setMinter(address(teller), true);
        usdc.mint(treasury, 50_000_000e6);
        vm.prank(treasury);
        usdc.approve(address(teller), type(uint256).max);

        pool = new HoddUSYCVault(
            IERC20(address(usdc)),
            ITeller(address(teller)),
            IERC20(address(usyc)),
            IRolesAuthority(address(auth)),
            admin
        );
        auth.setUserRole(address(pool), 0, true); // Circle allowlists the pool, not the users
        auth.setUserRole(donor, 0, true);

        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < 3; ++i) {
            usdc.mint(users[i], USER_FUNDS);
            vm.prank(users[i]);
            usdc.approve(address(pool), type(uint256).max);
        }
        usdc.mint(donor, USER_FUNDS);

        // roomy caps for the tests (the defaults are exercised in the constructor test)
        vm.prank(admin);
        pool.setDepositCaps(1_000_000e6, 100_000_000e6);
    }

    /// @dev `who` deposits `assets` USDC for themselves.
    function _deposit(address who, uint256 assets) internal returns (uint256 shares) {
        vm.prank(who);
        shares = pool.deposit(assets, who);
    }

    function _redeemAll(address who) internal returns (uint256 assets) {
        uint256 shares = pool.balanceOf(who);
        vm.prank(who);
        assets = pool.redeem(shares, who, who);
    }

    /// @dev An allowlisted party (like the donor) buys USYC from the Teller and gifts it to the pool.
    function _donateUsyc(uint256 usdcAmount) internal returns (uint256 usycGifted) {
        vm.startPrank(donor);
        usdc.approve(address(teller), usdcAmount);
        usycGifted = teller.deposit(usdcAmount, donor);
        usyc.transfer(address(pool), usycGifted);
        vm.stopPrank();
    }

    function _donateUsdc(uint256 amount) internal {
        vm.prank(donor);
        usdc.transfer(address(pool), amount);
    }
}
