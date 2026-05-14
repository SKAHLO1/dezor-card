// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockMUSD} from "./MockMUSD.sol";

/// @notice Test stand-in for Mezo's BorrowerOperations. `openTrove` simply mints the
///         requested MUSD debt to the caller (the escrow contract), holding the sent BTC
///         as if it were trove collateral.
contract MockBorrowerOperations {
    MockMUSD public immutable musd;

    constructor(address _musd) {
        musd = MockMUSD(_musd);
    }

    function openTrove(uint256 _debtAmount, address, address) external payable {
        require(msg.value > 0, "no collateral");
        musd.mint(msg.sender, _debtAmount);
    }
}
