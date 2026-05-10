// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/TalkenToken.sol";

contract DeployTalken is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        TalkenToken token = new TalkenToken(deployer);
        vm.stopBroadcast();

        console.log("=== Deployment Result ===");
        console.log("Token address: ", address(token));
        console.log("Deployer:      ", deployer);
        console.log("Total supply:  100,000,000 TALKEN");
    }
}
