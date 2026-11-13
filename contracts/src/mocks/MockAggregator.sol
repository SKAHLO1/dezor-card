// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Chainlink-style aggregator used by the Matsnet fork test to stand in for Mezo's
///         oracle precompile (0x7b7c…0015), which a Hardhat fork cannot execute. The fork test
///         installs this runtime code at the precompile address and writes the live answer and
///         decimals read from Matsnet into slots 0 and 1. `updatedAt` is always "now".
contract MockAggregator {
    int256 public answer;  // slot 0
    uint8 public decimals; // slot 1

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, answer, block.timestamp, block.timestamp, 1);
    }
}
