// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ArcNativeCoinMock, ArcBlocklistMock} from "./ArcNativeCoinMock.sol";

interface ITeller {
    function asset() external view returns (address);
    function share() external view returns (address);
    function afterHourTrading() external view returns (uint256);
    function mintPrice() external view returns (int256);
    function convertToAssets(uint256) external view returns (uint256);
    function convertToShares(uint256) external view returns (uint256);
    function todayTimestamp() external view returns (uint256);
    function feeManager() external view returns (address);
    function treasury(address) external view returns (address);
    function oracle() external view returns (address);
    function isDST() external view returns (bool);
    function limit(address) external view returns (uint56 subscribe, uint56 redeem);
    function subscriptionLimitRemaining(address, uint256) external view returns (uint256);
    function redemptionLimitRemaining(address, uint256) external view returns (uint256);
    function previewDepositData(address, uint256) external view returns (uint256, uint256, int256);
    function previewRedeemData(address, uint256) external view returns (uint256, uint256, int256);
    function previewWithdrawData(address, uint256) external view returns (uint256, uint256, int256);
    function maxRedeem(address) external view returns (uint256);
    function maxDeposit(address) external view returns (uint256);
    function totalAssets(address) external view returns (uint256);
    function deposit(uint256, address) external returns (uint256);
    function redeem(uint256, address, address) external returns (uint256);
    function withdraw(uint256, address, address) external returns (uint256);
    function allowance(address, address) external view returns (uint256);
}

interface IAuth {
    function owner() external view returns (address);
    function setUserRole(address, uint8, bool) external;
    function getUserRoles(address) external view returns (bytes32);
    function canCall(address, address, bytes4) external view returns (bool);
}

interface IErc {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function totalSupply() external view returns (uint256);
    function decimals() external view returns (uint8);
    function allowance(address, address) external view returns (uint256);
}

contract ProbeTellerForkTest is Test {
    ITeller constant T = ITeller(0x9fdF14c5B14173D74C08Af27AebFf39240dC105A);
    IAuth constant AUTH = IAuth(0xCC205224862C7641930c87679E98999d23C26113);
    IErc constant USDC = IErc(0x3600000000000000000000000000000000000000);
    IErc constant USYC = IErc(0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C);

    function setUp() public {
        if (block.chainid != 5_042_002) {
            vm.skip(true);
            return;
        }
        vm.etch(0x1800000000000000000000000000000000000000, address(new ArcNativeCoinMock()).code);
        vm.allowCheatcodes(0x1800000000000000000000000000000000000000);
        vm.etch(0x1800000000000000000000000000000000000001, address(new ArcBlocklistMock()).code);
    }

    function test_probe() public {
        console.log("block ts", block.timestamp);
        console.log("afterHourTrading", T.afterHourTrading());
        console.log("isDST", T.isDST());
        console.log("mintPrice", uint256(T.mintPrice()));
        console.log("convertToAssets(1e6 shares)", T.convertToAssets(1e6));
        console.log("convertToShares(1e6 assets)", T.convertToShares(1e6));
        console.log("todayTimestamp", T.todayTimestamp());
        console.log("feeManager", T.feeManager());
        console.log("treasury(0)", T.treasury(address(0)));
        console.log("oracle", T.oracle());
        (uint56 s, uint56 r) = T.limit(address(0));
        console.log("default limit subscribe", uint256(s));
        console.log("default limit redeem", uint256(r));
        console.log("USYC decimals", USYC.decimals());
        console.log("USYC totalSupply", USYC.totalSupply());
        address treasury = T.treasury(address(0));
        console.log("treasury USDC bal", USDC.balanceOf(treasury));
        console.log("treasury allowance->teller", USDC.allowance(treasury, address(T)));
        console.log("owner", AUTH.owner());

        _flow();
    }

    address v;
    address ownerEoa;

    function _flow() internal {
        v = makeAddr("vault");
        ownerEoa = makeAddr("ownerEoa");
        vm.deal(v, 1000e6 * 1e12);

        // not allowlisted
        console.log("vault canCall deposit", AUTH.canCall(v, address(T), ITeller.deposit.selector));
        (uint256 sh, uint256 fee, int256 price) = T.previewDepositData(v, 100e6);
        console.log("preview deposit 100: shares", sh);
        console.log("  fee", fee);
        console.log("  price", uint256(price));
        vm.startPrank(v);
        USDC.approve(address(T), 100e6);
        vm.expectRevert();
        T.deposit(100e6, v);
        vm.stopPrank();

        // allowlist as owner
        vm.startPrank(AUTH.owner());
        AUTH.setUserRole(v, 0, true);
        AUTH.setUserRole(ownerEoa, 0, true);
        vm.stopPrank();
        console.log("vault roles", uint256(AUTH.getUserRoles(v)));
        console.log("vault canCall deposit", AUTH.canCall(v, address(T), ITeller.deposit.selector));
        console.log("vault canCall redeem", AUTH.canCall(v, address(T), ITeller.redeem.selector));
        console.log(
            "vault canCall withdraw", AUTH.canCall(v, address(T), ITeller.withdraw.selector)
        );
        console.log(
            "vault canCall approve", AUTH.canCall(v, address(T), ITeller.allowance.selector)
        );

        vm.startPrank(v);
        uint256 usdcBefore = USDC.balanceOf(v);
        uint256 minted = T.deposit(100e6, v);
        console.log("deposit 100 -> shares", minted);
        console.log("USDC spent", usdcBefore - USDC.balanceOf(v));
        console.log("USYC bal", USYC.balanceOf(v));
        console.log("USDC allowance left (vault->teller)", USDC.allowance(v, address(T)));
        console.log("maxRedeem(vault)", T.maxRedeem(v));
        console.log("redemptionLimitRemaining", T.redemptionLimitRemaining(v, T.todayTimestamp()));
        console.log(
            "subscriptionLimitRemaining", T.subscriptionLimitRemaining(v, T.todayTimestamp())
        );
        (uint256 a, uint256 f, int256 p) = T.previewRedeemData(v, minted);
        console.log("previewRedeem all: assets", a);
        console.log("  fee", f);
        console.log("  price", uint256(p));

        // redeem half to the vault itself
        uint256 b0 = USDC.balanceOf(v);
        uint256 got = T.redeem(minted / 2, v, v);
        console.log("redeem half -> assets", got);
        console.log("USDC delta", USDC.balanceOf(v) - b0);
        // redeem rest to owner
        uint256 o0 = USDC.balanceOf(ownerEoa);
        got = T.redeem(T.maxRedeem(v), ownerEoa, v);
        console.log("redeem rest to owner -> assets", got);
        console.log("owner USDC delta", USDC.balanceOf(ownerEoa) - o0);
        console.log("USYC left", USYC.balanceOf(v));
        vm.stopPrank();
    }
}
