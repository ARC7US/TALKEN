// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/RelayRegistry.sol";
import "../src/TalkenToken.sol";

contract DeployRelayRegistry is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address talkenToken = vm.envAddress("TALKEN_TOKEN_ADDRESS");

        vm.startBroadcast(deployerKey);
        RelayRegistry registry = new RelayRegistry(talkenToken);
        vm.stopBroadcast();

        console.log("=== RelayRegistry Deployment ===");
        console.log("Registry: ", address(registry));
        console.log("TALKEN:   ", talkenToken);
    }
}
