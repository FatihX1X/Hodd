// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PoolBase} from "./PoolBase.sol";
import {DeployHoddUSYCVault} from "../../script/DeployHoddUSYCVault.s.sol";
import {HoddUSYCVault} from "../../src/HoddUSYCVault.sol";

/// @dev Runs the deploy script inside the test EVM with the mock Circle contracts. The key is a
///      throwaway fixture that exists only in this local test.
contract DeployHoddUSYCVaultTest is PoolBase {
    uint256 internal constant FIXTURE_KEY = 0xA11CE;

    function test_script_guardsTheChainAndDeploysThePool() public {
        DeployHoddUSYCVault script = new DeployHoddUSYCVault();

        // refuses any chain but Arc Testnet unless told otherwise
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployHoddUSYCVault.WrongChain.selector, block.chainid, 5_042_002
            )
        );
        script.execute(
            FIXTURE_KEY, admin, address(usdc), address(teller), address(usyc), address(auth), false
        );

        HoddUSYCVault deployed = script.execute(
            FIXTURE_KEY, admin, address(usdc), address(teller), address(usyc), address(auth), true
        );
        assertEq(deployed.owner(), admin);
        assertEq(address(deployed.teller()), address(teller));
        assertEq(address(deployed.usyc()), address(usyc));
        assertEq(address(deployed.authority()), address(auth));
        assertEq(deployed.asset(), address(usdc));
        assertGt(address(deployed).code.length, 0);
    }
}
