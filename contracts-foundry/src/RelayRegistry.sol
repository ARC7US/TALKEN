// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title TALKEN Relay Node Registry
/// @notice Relay operators stake TALKEN to register. Plugin reads events to discover nodes.
/// @dev Unstake is a two-step process: requestUnstake → wait → claimUnstake.
contract RelayRegistry {
    IERC20 public immutable talken;
    uint256 public constant MIN_STAKE = 100 * 1e18;

    /// @notice Minimum time (seconds) before an operator can request unstake.
    uint256 public constant MIN_STAKE_DURATION = 7 days;
    /// @notice Delay (seconds) between requesting unstake and claiming tokens.
    uint256 public constant UNBONDING_PERIOD = 7 days;

    event RelayRegistered(address indexed operator, string url);
    event RelayRemoved(address indexed operator);
    event UnstakeRequested(address indexed operator, uint256 unlockTime);

    struct StakeInfo {
        bool active;
        uint256 stakedAt;       // block.timestamp of register()
        uint256 unstakeAfter;   // 0 = no pending unstake; >0 = claimable after this time
        bytes32 ipHash;         // keccak256(IP) — permanently bound on first registration
    }

    mapping(address => StakeInfo) public stakes;

    constructor(address _talken) {
        talken = IERC20(_talken);
    }

    /// @notice Register as a relay node. Must hold >= MIN_STAKE TALKEN.
    /// @param url WebSocket URL of the relay node.
    /// @param ipHash keccak256(abi.encodePacked(IP)) — permanently bound on first registration.
    function register(string calldata url, bytes32 ipHash) external {
        StakeInfo storage s = stakes[msg.sender];
        require(!s.active, "Already registered");
        require(ipHash != 0, "IP hash required");

        // IP binding: set on first registration, must match on re-registration
        if (s.ipHash == 0) {
            s.ipHash = ipHash;
        } else {
            require(ipHash == s.ipHash, "IP mismatch with original registration");
        }

        require(talken.balanceOf(msg.sender) >= MIN_STAKE, "Insufficient TALKEN balance");

        talken.transferFrom(msg.sender, address(this), MIN_STAKE);

        s.active = true;
        s.stakedAt = block.timestamp;
        s.unstakeAfter = 0;

        emit RelayRegistered(msg.sender, url);
    }

    /// @notice Step 1: Request to leave the network.
    /// Starts the unbonding period. The node is still "active" during unbonding
    /// so it can finish pending tasks, but the network should stop assigning new ones.
    function requestUnstake() external {
        StakeInfo storage s = stakes[msg.sender];
        require(s.active, "Not registered");
        require(s.unstakeAfter == 0, "Unstake already requested");
        require(
            block.timestamp >= s.stakedAt + MIN_STAKE_DURATION,
            "Must wait 7 days after staking before unstaking"
        );

        s.unstakeAfter = block.timestamp + UNBONDING_PERIOD;

        emit UnstakeRequested(msg.sender, s.unstakeAfter);
    }

    /// @notice Step 2: Claim stake after the unbonding period expires.
    function claimUnstake() external {
        StakeInfo storage s = stakes[msg.sender];
        require(s.active, "Not registered");
        require(s.unstakeAfter > 0, "No pending unstake");
        require(block.timestamp >= s.unstakeAfter, "Unbonding period not over");

        s.active = false;
        s.stakedAt = 0;
        s.unstakeAfter = 0;

        talken.transfer(msg.sender, MIN_STAKE);

        emit RelayRemoved(msg.sender);
    }

    /// @notice Returns true if the operator is actively staked.
    function isStaked(address operator) external view returns (bool) {
        return stakes[operator].active;
    }

    /// @notice Returns true if the operator has a pending unbonding request.
    function isUnbonding(address operator) external view returns (bool) {
        StakeInfo storage s = stakes[operator];
        return s.active && s.unstakeAfter > 0;
    }
}
