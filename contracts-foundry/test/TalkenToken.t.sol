// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/TalkenToken.sol";

contract TalkenTokenTest is Test {
    TalkenToken public token;
    address public deployer = makeAddr("deployer");
    address public alice = makeAddr("alice");

    function setUp() public {
        vm.prank(deployer);
        token = new TalkenToken(deployer);
    }

    function test_totalSupply() public view {
        assertEq(token.totalSupply(), 100_000_000 * 1e18);
    }

    function test_deployerBalance() public view {
        assertEq(token.balanceOf(deployer), 100_000_000 * 1e18);
    }

    function test_nameAndSymbol() public view {
        assertEq(token.name(), "TALKEN");
        assertEq(token.symbol(), "TALKEN");
    }

    function test_transfer() public {
        vm.prank(deployer);
        token.transfer(alice, 1000 * 1e18);
        assertEq(token.balanceOf(alice), 1000 * 1e18);
        assertEq(token.balanceOf(deployer), (100_000_000 - 1000) * 1e18);
    }

    function test_noMintFunction() public {
        // Verify that calling "mint" reverts (function doesn't exist)
        bytes memory payload = abi.encodeWithSignature("mint(address,uint256)", alice, 1 ether);
        (bool success,) = address(token).call(payload);
        assertFalse(success, "mint() should not exist");
    }

    function test_noBurnFunction() public {
        bytes memory payload = abi.encodeWithSignature("burn(uint256)", 1 ether);
        (bool success,) = address(token).call(payload);
        assertFalse(success, "burn() should not exist");
    }

    function test_noOwnerFunction() public {
        bytes memory payload = abi.encodeWithSignature("owner()");
        (bool success,) = address(token).call(payload);
        assertFalse(success, "owner() should not exist");
    }
}
