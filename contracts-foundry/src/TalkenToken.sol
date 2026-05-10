// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TALKEN — ERC-20 token for the TALKEN Agent Network (Arbitrum)
/// @notice Fixed supply of 100 000 000 tokens, no mint / burn / admin.
contract TalkenToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 100_000_000 * 1e18;

    constructor(address initialOwner) ERC20("TALKEN", "TALKEN") {
        _mint(initialOwner, TOTAL_SUPPLY);
    }
}
