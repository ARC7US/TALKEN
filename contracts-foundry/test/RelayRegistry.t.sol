// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/TalkenToken.sol";
import "../src/RelayRegistry.sol";

contract RelayRegistryTest is Test {
    TalkenToken public token;
    RelayRegistry public registry;
    address public deployer = makeAddr("deployer");
    address public relayOp = makeAddr("relayOp");
    uint256 constant STAKE_AMOUNT = 100 * 1e18;

    function setUp() public {
        vm.prank(deployer);
        token = new TalkenToken(deployer);
        registry = new RelayRegistry(address(token));

        // Give relayOp enough TALKEN to stake
        vm.prank(deployer);
        token.transfer(relayOp, 2000 * 1e18);
    }

    function test_register() public {
        vm.startPrank(relayOp);
        token.approve(address(registry), STAKE_AMOUNT);
        registry.register("wss://relay1.example.com");
        vm.stopPrank();

        assertTrue(registry.staked(relayOp));
    }

    function test_register_insufficientBalance() public {
        address poor = makeAddr("poor");
        vm.prank(poor);
        vm.expectRevert("Insufficient TALKEN balance");
        registry.register("wss://relay.example.com");
    }

    function test_unregister() public {
        vm.startPrank(relayOp);
        token.approve(address(registry), STAKE_AMOUNT);
        registry.register("wss://relay1.example.com");

        uint256 balBefore = token.balanceOf(relayOp);
        registry.unregister();
        uint256 balAfter = token.balanceOf(relayOp);

        assertFalse(registry.staked(relayOp));
        assertEq(balAfter - balBefore, STAKE_AMOUNT);
        vm.stopPrank();
    }

    function test_event_emitted() public {
        vm.startPrank(relayOp);
        token.approve(address(registry), STAKE_AMOUNT);

        vm.expectEmit(true, false, false, true);
        emit RelayRegistry.RelayRegistered(relayOp, "wss://relay1.example.com");
        registry.register("wss://relay1.example.com");
        vm.stopPrank();
    }
}
