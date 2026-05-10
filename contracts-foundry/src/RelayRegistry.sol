// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title TALKEN Relay Node Registry
/// @notice Relay operators stake TALKEN to register. Plugin reads events to discover nodes.
contract RelayRegistry {
    IERC20 public immutable talken;
    uint256 public constant MIN_STAKE = 100 * 1e18;

    event RelayRegistered(address indexed operator, string url);
    event RelayRemoved(address indexed operator);

    mapping(address => bool) public staked;

    constructor(address _talken) {
        talken = IERC20(_talken);
    }

    /// @notice Register as a relay node. Must stake TALKEN first.
    function register(string calldata url) external {
        require(talken.balanceOf(msg.sender) >= MIN_STAKE, "Insufficient TALKEN balance");
        require(!staked[msg.sender], "Already registered");

        // Transfer stake to this contract
        talken.transferFrom(msg.sender, address(this), MIN_STAKE);
        staked[msg.sender] = true;

        emit RelayRegistered(msg.sender, url);
    }

    /// @notice Unregister and reclaim stake.
    function unregister() external {
        require(staked[msg.sender], "Not registered");

        staked[msg.sender] = false;
        talken.transfer(msg.sender, MIN_STAKE);

        emit RelayRemoved(msg.sender);
    }
}
