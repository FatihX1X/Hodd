// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddieVault} from "../src/HoddieVault.sol";
import {HoddieVaultFactory} from "../src/HoddieVaultFactory.sol";
import {HoddieVaultAddress} from "../src/HoddieVaultAddress.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockStrategy} from "./mocks/MockStrategy.sol";

contract HoddieVaultFactoryTest is Test {
    MockUSDC internal usdc;
    MockStrategy internal strat;
    HoddieVaultFactory internal factory;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        usdc = new MockUSDC();
        strat = new MockStrategy(IERC20(address(usdc)));
        factory = new HoddieVaultFactory(IERC20(address(usdc)));
    }

    function _strategies() internal view returns (address[] memory list) {
        list = new address[](1);
        list[0] = address(strat);
    }

    function _limits() internal pure returns (HoddieVault.Limits memory) {
        return HoddieVault.Limits(1000e6, 5000e6, 400e6, 2000e6);
    }

    function test_constructor_setsAssetAndRejectsZero() public {
        assertEq(address(factory.asset()), address(usdc));
        vm.expectRevert(HoddieVaultFactory.ZeroAsset.selector);
        new HoddieVaultFactory(IERC20(address(0)));
    }

    function test_createVault_deploysAtThePredictedAddress() public {
        address predicted = factory.predictVault(owner, operator, _limits(), _strategies());
        assertEq(predicted.code.length, 0);

        vm.expectEmit(true, true, true, true, address(factory));
        emit HoddieVaultFactory.VaultCreated(owner, operator, predicted);
        vm.prank(stranger); // permissionless
        address vaultAddr = factory.createVault(owner, operator, _limits(), _strategies());

        assertEq(vaultAddr, predicted);
        assertGt(vaultAddr.code.length, 0);
        assertTrue(factory.isVault(vaultAddr));
    }

    function test_createVault_vaultHasExactlyTheRequestedConfiguration() public {
        address vaultAddr = factory.createVault(owner, operator, _limits(), _strategies());
        HoddieVault v = HoddieVault(vaultAddr);
        assertEq(address(v.asset()), address(usdc));
        assertEq(v.owner(), owner);
        assertEq(v.operator(), operator);
        assertEq(v.maxDepositPerTx(), 1000e6);
        assertEq(v.depositLimit24h(), 5000e6);
        assertEq(v.maxPaymentPerTx(), 400e6);
        assertEq(v.paymentLimit24h(), 2000e6);
        assertEq(v.strategyCount(), 1);
        assertTrue(v.isStrategy(address(strat)));
        assertFalse(v.paused());
        // the factory keeps no powers over the vault
        assertTrue(v.owner() != address(factory));
        assertTrue(v.operator() != address(factory));
    }

    function test_createVault_revertsWhenAlreadyDeployed() public {
        address vaultAddr = factory.createVault(owner, operator, _limits(), _strategies());
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVaultFactory.VaultAlreadyDeployed.selector, vaultAddr)
        );
        factory.createVault(owner, operator, _limits(), _strategies());
    }

    function test_createVault_everyParameterChangesTheAddress() public view {
        address[] memory none = new address[](0);
        address[] memory s = _strategies();
        HoddieVault.Limits memory l = _limits();
        address base = factory.predictVault(owner, operator, l, s);

        assertTrue(base != factory.predictVault(stranger, operator, l, s));
        assertTrue(base != factory.predictVault(owner, stranger, l, s));
        assertTrue(base != factory.predictVault(owner, operator, l, none));

        HoddieVault.Limits memory l2 = _limits();
        l2.maxDepositPerTx += 1;
        assertTrue(base != factory.predictVault(owner, operator, l2, s));
        l2 = _limits();
        l2.depositLimit24h += 1;
        assertTrue(base != factory.predictVault(owner, operator, l2, s));
        l2 = _limits();
        l2.maxPaymentPerTx += 1;
        assertTrue(base != factory.predictVault(owner, operator, l2, s));
        l2 = _limits();
        l2.paymentLimit24h += 1;
        assertTrue(base != factory.predictVault(owner, operator, l2, s));
    }

    function test_frontRunner_cannotOccupyThePredictedAddressWithOtherParameters() public {
        address predicted = factory.predictVault(owner, operator, _limits(), _strategies());

        // an attacker deploys with a malicious operator / huge limits / no strategies ...
        HoddieVault.Limits memory huge = _limits();
        huge.paymentLimit24h = type(uint64).max;
        vm.startPrank(stranger);
        address evil1 = factory.createVault(owner, stranger, _limits(), _strategies());
        address evil2 = factory.createVault(owner, operator, huge, _strategies());
        address evil3 = factory.createVault(owner, operator, _limits(), new address[](0));
        vm.stopPrank();

        // ... none of it touches the address Hodd predicted
        assertTrue(evil1 != predicted && evil2 != predicted && evil3 != predicted);
        assertEq(predicted.code.length, 0);

        // and the honest deployment still works and has the honest parameters
        address real = factory.createVault(owner, operator, _limits(), _strategies());
        assertEq(real, predicted);
        assertEq(HoddieVault(real).operator(), operator);
        assertEq(HoddieVault(real).paymentLimit24h(), 2000e6);
    }

    function test_frontRunner_sameParametersJustDeploysTheSameHarmlessVault() public {
        // Anyone can create it, but it is exactly the vault the owner wanted.
        address predicted = factory.predictVault(owner, operator, _limits(), _strategies());
        vm.prank(stranger);
        address v = factory.createVault(owner, operator, _limits(), _strategies());
        assertEq(v, predicted);
        assertEq(HoddieVault(v).owner(), owner);
        assertEq(HoddieVault(v).operator(), operator);
    }

    function test_createVault_revertsOnInvalidStrategyAndLeavesNothingDeployed() public {
        address[] memory bad = new address[](1);
        bad[0] = stranger; // an EOA
        address predicted = factory.predictVault(owner, operator, _limits(), bad);
        vm.expectRevert(abi.encodeWithSelector(HoddieVault.InvalidStrategy.selector, stranger));
        factory.createVault(owner, operator, _limits(), bad);
        assertEq(predicted.code.length, 0);
        assertFalse(factory.isVault(predicted));
    }

    function test_createVault_revertsOnZeroOwnerAndOversizedLimits() public {
        vm.expectRevert();
        factory.createVault(address(0), operator, _limits(), _strategies());

        HoddieVault.Limits memory l = _limits();
        l.depositLimit24h = uint256(type(uint64).max) + 1;
        vm.expectRevert(
            abi.encodeWithSelector(HoddieVault.LimitTooLarge.selector, l.depositLimit24h)
        );
        factory.createVault(owner, operator, l, _strategies());
    }

    function test_createVault_allowsNoOperatorAndNoStrategies() public {
        address v = factory.createVault(
            owner, address(0), HoddieVault.Limits(0, 0, 0, 0), new address[](0)
        );
        assertEq(HoddieVault(v).operator(), address(0));
        assertEq(HoddieVault(v).strategyCount(), 0);
    }

    function test_predictVault_isIndependentOfCallerAndTime() public {
        address a = factory.predictVault(owner, operator, _limits(), _strategies());
        vm.prank(stranger);
        vm.warp(block.timestamp + 365 days);
        address b = factory.predictVault(owner, operator, _limits(), _strategies());
        assertEq(a, b);
    }

    function test_twoFactoriesGiveDifferentVaultAddresses() public {
        HoddieVaultFactory other = new HoddieVaultFactory(IERC20(address(usdc)));
        assertTrue(
            factory.predictVault(owner, operator, _limits(), _strategies())
                != other.predictVault(owner, operator, _limits(), _strategies())
        );
    }

    function test_addressLibraryMatchesTheFactoryExactly() public {
        // the off-chain prediction script uses the same library: it must agree with the factory
        address viaLibrary = HoddieVaultAddress.predict(
            address(factory), IERC20(address(usdc)), owner, operator, _limits(), _strategies()
        );
        assertEq(viaLibrary, factory.predictVault(owner, operator, _limits(), _strategies()));
        assertEq(viaLibrary, factory.createVault(owner, operator, _limits(), _strategies()));
    }

    function test_runtimeSizesStayBelowEip170() public view {
        assertLt(address(factory).code.length, 24_576);
        address v = factory.predictVault(owner, operator, _limits(), _strategies());
        assertEq(v.code.length, 0); // not deployed here; the vault size is checked in HoddieVaultTest
    }

    function testFuzz_predictMatchesCreate(
        address owner_,
        address operator_,
        uint64 l1,
        uint64 l2,
        uint64 l3,
        uint64 l4
    ) public {
        vm.assume(owner_ != address(0));
        HoddieVault.Limits memory l = HoddieVault.Limits(l1, l2, l3, l4);
        address[] memory s = _strategies();
        address predicted = factory.predictVault(owner_, operator_, l, s);
        address created = factory.createVault(owner_, operator_, l, s);
        assertEq(created, predicted);
        assertEq(HoddieVault(created).owner(), owner_);
        assertEq(HoddieVault(created).operator(), operator_);
        assertEq(HoddieVault(created).maxDepositPerTx(), l1);
        assertEq(HoddieVault(created).depositLimit24h(), l2);
        assertEq(HoddieVault(created).maxPaymentPerTx(), l3);
        assertEq(HoddieVault(created).paymentLimit24h(), l4);
    }
}
