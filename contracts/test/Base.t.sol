// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HoddieVault} from "../src/HoddieVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockStrategy} from "./mocks/MockStrategy.sol";

/// @dev Shared fixture: a vault owned by an EOA (known key), one operator, two OZ strategies.
abstract contract Base is Test {
    uint256 internal constant OWNER_PK = 0xA11CE;
    uint256 internal constant MAX_TX = 1000e6;
    uint256 internal constant DAILY = 2500e6;
    uint256 internal constant FUNDS = 10_000e6;
    /// @dev A UTC midnight, so tests can reason about day boundaries.
    uint256 internal constant DAY0 = 20_000 days;

    MockUSDC internal usdc;
    MockStrategy internal strat;
    MockStrategy internal strat2;
    HoddieVault internal vault;

    address internal owner;
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");
    address internal recipient = makeAddr("recipient");
    address internal recipient2 = makeAddr("recipient2");

    function setUp() public virtual {
        vm.warp(DAY0 + 12 hours);
        owner = vm.addr(OWNER_PK);
        usdc = new MockUSDC();
        strat = new MockStrategy(IERC20(address(usdc)));
        strat2 = new MockStrategy(IERC20(address(usdc)));

        address[] memory list = new address[](2);
        list[0] = address(strat);
        list[1] = address(strat2);
        vault = _newVault(owner, operator, list);
        usdc.mint(address(vault), FUNDS);
    }

    function _newVault(address owner_, address operator_, address[] memory list)
        internal
        returns (HoddieVault)
    {
        return new HoddieVault(IERC20(address(usdc)), owner_, operator_, MAX_TX, DAILY, list);
    }

    function _depositAs(address strategy, uint256 amount) internal returns (uint256 shares) {
        vm.prank(operator);
        shares = vault.depositToStrategy(strategy, amount);
    }

    function _typedDigest(address vault_, address recipient_, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("AddRecipient(address recipient,uint256 nonce,uint256 deadline)"),
                recipient_,
                nonce,
                deadline
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("HoddieVault"),
                keccak256("1"),
                block.chainid,
                vault_
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _sign(uint256 pk, address vault_, address recipient_, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, _typedDigest(vault_, recipient_, nonce, deadline));
        return abi.encodePacked(r, s, v);
    }
}
