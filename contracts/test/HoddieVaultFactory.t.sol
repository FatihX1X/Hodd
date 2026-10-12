// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddieVault} from "../src/HoddieVault.sol";
import {HoddieVaultFactory} from "../src/HoddieVaultFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockStrategy} from "./mocks/MockStrategy.sol";

contract HoddieVaultFactoryTest is Test {
    MockUSDC internal usdc;
    MockStrategy internal strat;
    HoddieVaultFactory internal factory;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");
    uint256 internal constant MAX_TX = 1000e6;
    uint256 internal constant DAILY = 2500e6;

    function setUp() public {
        usdc = new MockUSDC();
        strat = new MockStrategy(IERC20(address(usdc)));
        factory = new HoddieVaultFactory(IERC20(address(usdc)));
    }

    function _strategies() internal view returns (address[] memory list) {
        list = new address[](1);
        list[0] = address(strat);
    }

    function test_constructor_setsAssetAndRejectsZero() public {
        assertEq(address(factory.asset()), address(usdc));
        vm.expectRevert(HoddieVaultFactory.ZeroAsset.selector);
        new HoddieVaultFactory(IERC20(address(0)));
    }

    function test_createVault_deploysAtThePredictedAddress() public {
        address predicted = factory.predictVault(owner, operator, MAX_TX, DAILY, _strategies());
        assertEq(predicted.code.length, 0);

        vm.expectEmit(true, true, true, true, address(factory));
        emit HoddieVaultFactory.VaultCreated(owner, operator, predicted);
        vm.prank(stranger); // permissionless
        address vaultAddr = factory.createVault(owner, operator, MAX_TX, DAILY, _strategies());

        assertEq(vaultAddr, predicted);
        assertGt(vaultAddr.code.length, 0);
        assertTrue(factory.isVault(vaultAddr));
    }

    function test_createVault_vaultHasExactlyTheRequestedConfiguration() public {
        address vaultAddr = factory.createVault(owner, operator, MAX_TX, DAILY, _strategies());
        HoddieVault v = HoddieVault(vaultAddr);
        assertEq(address(v.asset()), address(usdc));
        assertEq(v.owner(), owner);
        assertEq(v.operator(), operator);
        assertEq(v.maxPerTx(), MAX_TX);
        assertEq(v.dailyLimit(), DAILY);
        assertEq(v.strategyCount(), 1);
        assertTrue(v.isStrategy(address(strat)));
        assertFalse(v.paused());
        // the factory keeps no powers over the vault
        assertTrue(v.owner() != address(factory));
        assertTrue(v.operator() != address(factory));
    }

    function test_createVault_revertsWhenAlreadyDeployed() public {
        address vaultAddr = factory.createVault(owner, operator, MAX_TX, DAILY, _strategies());
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVaultFactory.VaultAlreadyDeployed.selector, vaultAddr)
        );
        factory.createVault(owner, operator, MAX_TX, DAILY, _strategies());
    }

    function test_createVault_differentParametersGiveDifferentAddresses() public view {
        address[] memory none = new address[](0);
        address[] memory s = _strategies();
        address base = factory.predictVault(owner, operator, MAX_TX, DAILY, s);

        assertTrue(base != factory.predictVault(stranger, operator, MAX_TX, DAILY, s));
        assertTrue(base != factory.predictVault(owner, stranger, MAX_TX, DAILY, s));
        assertTrue(base != factory.predictVault(owner, operator, MAX_TX + 1, DAILY, s));
        assertTrue(base != factory.predictVault(owner, operator, MAX_TX, DAILY + 1, s));
        assertTrue(base != factory.predictVault(owner, operator, MAX_TX, DAILY, none));
    }

    function test_frontRunner_cannotOccupyThePredictedAddressWithOtherParameters() public {
        address predicted = factory.predictVault(owner, operator, MAX_TX, DAILY, _strategies());

        // an attacker deploys with a malicious operator / huge limits / no strategies ...
        vm.startPrank(stranger);
        address evil1 = factory.createVault(owner, stranger, MAX_TX, DAILY, _strategies());
        address evil2 =
            factory.createVault(owner, operator, type(uint256).max, DAILY, _strategies());
        address evil3 = factory.createVault(owner, operator, MAX_TX, DAILY, new address[](0));
        vm.stopPrank();

        // ... none of it touches the address Hodd predicted
        assertTrue(evil1 != predicted && evil2 != predicted && evil3 != predicted);
        assertEq(predicted.code.length, 0);

        // and the honest deployment still works and has the honest parameters
        address real = factory.createVault(owner, operator, MAX_TX, DAILY, _strategies());
        assertEq(real, predicted);
        assertEq(HoddieVault(real).operator(), operator);
        assertEq(HoddieVault(real).maxPerTx(), MAX_TX);
    }

    function test_frontRunner_sameParametersJustDeploysTheSameHarmlessVault() public {
        // Anyone can create it, but it is exactly the vault the owner wanted.
        address predicted = factory.predictVault(owner, operator, MAX_TX, DAILY, _strategies());
        vm.prank(stranger);
        address v = factory.createVault(owner, operator, MAX_TX, DAILY, _strategies());
        assertEq(v, predicted);
        assertEq(HoddieVault(v).owner(), owner);
        assertEq(HoddieVault(v).operator(), operator);
    }

    function test_createVault_revertsOnInvalidStrategyAndLeavesNothingDeployed() public {
        address[] memory bad = new address[](1);
        bad[0] = stranger; // an EOA
        address predicted = factory.predictVault(owner, operator, MAX_TX, DAILY, bad);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.InvalidStrategy.selector, stranger));
        factory.createVault(owner, operator, MAX_TX, DAILY, bad);
        assertEq(predicted.code.length, 0);
        assertFalse(factory.isVault(predicted));
    }

    function test_createVault_revertsOnZeroOwner() public {
        vm.expectRevert();
        factory.createVault(address(0), operator, MAX_TX, DAILY, _strategies());
    }

    function test_createVault_allowsNoOperatorAndNoStrategies() public {
        address v = factory.createVault(owner, address(0), 0, 0, new address[](0));
        assertEq(HoddieVault(v).operator(), address(0));
        assertEq(HoddieVault(v).strategyCount(), 0);
    }

    function test_predictVault_isIndependentOfCallerAndTime() public {
        address a = factory.predictVault(owner, operator, MAX_TX, DAILY, _strategies());
        vm.prank(stranger);
        vm.warp(block.timestamp + 365 days);
        address b = factory.predictVault(owner, operator, MAX_TX, DAILY, _strategies());
        assertEq(a, b);
    }

    function test_twoFactoriesGiveDifferentVaultAddresses() public {
        HoddieVaultFactory other = new HoddieVaultFactory(IERC20(address(usdc)));
        assertTrue(
            factory.predictVault(owner, operator, MAX_TX, DAILY, _strategies())
                != other.predictVault(owner, operator, MAX_TX, DAILY, _strategies())
        );
    }

    function test_factoryBytecodeStaysBelowEip170() public view {
        assertLt(address(factory).code.length, 24_576);
    }

    function testFuzz_predictMatchesCreate(
        address owner_,
        address operator_,
        uint256 maxPerTx,
        uint256 dailyLimit
    ) public {
        vm.assume(owner_ != address(0));
        address[] memory s = _strategies();
        address predicted = factory.predictVault(owner_, operator_, maxPerTx, dailyLimit, s);
        address created = factory.createVault(owner_, operator_, maxPerTx, dailyLimit, s);
        assertEq(created, predicted);
        assertEq(HoddieVault(created).owner(), owner_);
        assertEq(HoddieVault(created).operator(), operator_);
        assertEq(HoddieVault(created).maxPerTx(), maxPerTx);
        assertEq(HoddieVault(created).dailyLimit(), dailyLimit);
    }
}
