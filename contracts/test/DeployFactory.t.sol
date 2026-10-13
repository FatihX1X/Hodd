// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployFactory} from "../script/DeployFactory.s.sol";
import {HoddieVaultFactory} from "../src/HoddieVaultFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Exercises the deploy script inside the test EVM. The key below is a throwaway fixture
///      that only exists in this local test, it controls nothing anywhere.
///      One test only: environment variables are process-wide and forge runs tests in parallel.
contract DeployFactoryTest is Test {
    string internal constant FIXTURE_KEY =
        "0x00000000000000000000000000000000000000000000000000000000000a11ce";

    function test_script_guardsTheChainAndDeploysTheFactory() public {
        MockUSDC usdc = new MockUSDC();
        vm.setEnv("PRIVATE_KEY", FIXTURE_KEY);
        vm.setEnv("USDC_ADDRESS", vm.toString(address(usdc)));
        DeployFactory script = new DeployFactory();

        // on any chain other than Arc Testnet it refuses unless explicitly allowed
        vm.setEnv("ALLOW_OTHER_CHAIN", "false");
        vm.expectRevert(
            abi.encodeWithSelector(DeployFactory.WrongChain.selector, block.chainid, 5_042_002)
        );
        script.run();

        // explicitly allowed: deploys the factory for the given asset
        vm.setEnv("ALLOW_OTHER_CHAIN", "true");
        HoddieVaultFactory factory = script.run();
        assertEq(address(factory.asset()), address(usdc));
        assertGt(address(factory).code.length, 0);
    }
}
