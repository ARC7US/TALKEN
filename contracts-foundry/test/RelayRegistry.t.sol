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

        vm.prank(deployer);
        token.transfer(relayOp, 2000 * 1e18);
    }

    function test_register() public {
        vm.startPrank(relayOp);
        token.approve(address(registry), STAKE_AMOUNT);
        registry.register("wss://relay1.example.com");
        vm.stopPrank();

        assertTrue(registry.isStaked(relayOp));
    }

    function test_register_insufficientBalance() public {
        address poor = makeAddr("poor");
        vm.prank(poor);
        vm.expectRevert("Insufficient TALKEN balance");
        registry.register("wss://relay.example.com");
    }

    function test_twoStepUnstake() public {
        // Register
        vm.startPrank(relayOp);
        token.approve(address(registry), STAKE_AMOUNT);
        registry.register("wss://relay1.example.com");
        assertTrue(registry.isStaked(relayOp));

        // Cannot unstake before 7 days
        vm.expectRevert("Must wait 7 days after staking before unstaking");
        registry.requestUnstake();

        // Fast-forward past MIN_STAKE_DURATION
        vm.warp(block.timestamp + 8 days);

        // Step 1: request unstake
        registry.requestUnstake();
        assertTrue(registry.isUnbonding(relayOp));
        assertTrue(registry.isStaked(relayOp)); // still staked during unbonding

        // Cannot claim before unbonding period ends
        vm.expectRevert("Unbonding period not over");
        registry.claimUnstake();

        // Fast-forward past UNBONDING_PERIOD
        vm.warp(block.timestamp + 8 days);

        // Step 2: claim
        uint256 balBefore = token.balanceOf(relayOp);
        registry.claimUnstake();
        uint256 balAfter = token.balanceOf(relayOp);

        assertFalse(registry.isStaked(relayOp));
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
