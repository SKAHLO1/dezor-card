// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20, IBorrowerOperations} from "./interfaces/IMezo.sol";

/// @title TroveVault
/// @notice One per employer, deployed by SatLockEscrow on that employer's first BTC-funded job.
///         Mezo allows a single trove per address, so each employer's trove lives in their own
///         vault: the escrow borrows MUSD through it to fund jobs (opening the trove, or pooling
///         further jobs into it with adjustTrove), and the employer manages it directly —
///         repaying debt, adding or withdrawing BTC, closing it, and claiming surplus collateral.
///         Every BTC the trove returns is forwarded straight to the employer.
///
///         Job funds are safe from these actions: minted MUSD is moved into the escrow the moment
///         it is borrowed, so the trove only ever secures the employer's own debt.
contract TroveVault {
    address public immutable escrow;
    address public immutable employer;
    IBorrowerOperations public immutable borrowerOps;
    IERC20 public immutable musd;

    event CollateralReturned(address indexed employer, uint256 amount);
    event DebtRepaid(address indexed employer, uint256 amount);
    event TroveClosedByEmployer(address indexed employer, uint256 musdBurned);

    modifier onlyEscrow() {
        require(msg.sender == escrow, "not escrow");
        _;
    }

    modifier onlyEmployer() {
        require(msg.sender == employer, "not employer");
        _;
    }

    constructor(address _employer, address _borrowerOps, address _musd) {
        escrow = msg.sender;
        employer = _employer;
        borrowerOps = IBorrowerOperations(_borrowerOps);
        musd = IERC20(_musd);
    }

    /// @notice BTC sent back by Mezo's ActivePool / CollSurplusPool lands here first.
    receive() external payable {}

    // --------------------------------------------------------------------
    // Job funding (escrow only)
    // --------------------------------------------------------------------

    /// @notice Open the employer's trove with the BTC sent and pass the minted MUSD to the escrow.
    function openTroveFor(uint256 debt, address upperHint, address lowerHint) external payable onlyEscrow {
        borrowerOps.openTrove{value: msg.value}(debt, upperHint, lowerHint);
        require(musd.transfer(escrow, debt), "MUSD transfer failed");
    }

    /// @notice Pool another job into the existing trove: optionally add BTC and borrow more MUSD.
    function borrowMoreFor(uint256 debt, address upperHint, address lowerHint) external payable onlyEscrow {
        borrowerOps.adjustTrove{value: msg.value}(0, debt, true, upperHint, lowerHint);
        require(musd.transfer(escrow, debt), "MUSD transfer failed");
    }

    // --------------------------------------------------------------------
    // Trove management (employer only)
    // --------------------------------------------------------------------

    function addCollateral(address upperHint, address lowerHint) external payable onlyEmployer {
        borrowerOps.addColl{value: msg.value}(upperHint, lowerHint);
    }

    /// @notice Withdraw BTC from the trove back to the employer (must keep the trove above MCR).
    function withdrawCollateral(uint256 amount, address upperHint, address lowerHint) external onlyEmployer {
        borrowerOps.withdrawColl(amount, upperHint, lowerHint);
        _returnCollateral();
    }

    /// @notice Repay part of the trove's debt with MUSD the employer approved to this vault.
    function repay(uint256 amount, address upperHint, address lowerHint) external onlyEmployer {
        require(musd.transferFrom(employer, address(this), amount), "MUSD transfer failed");
        borrowerOps.repayMUSD(amount, upperHint, lowerHint);
        emit DebtRepaid(employer, amount);
    }

    /// @notice Close the trove and get all the BTC back. Mezo burns `debt - 200 MUSD` (the gas
    ///         compensation is burned from the gas pool), including interest accrued up to now.
    ///         `maxMusd` is pulled from the employer as a ceiling; whatever is not burned is refunded.
    function closeTrove(uint256 maxMusd) external onlyEmployer {
        require(musd.transferFrom(employer, address(this), maxMusd), "MUSD transfer failed");
        uint256 before = musd.balanceOf(address(this));
        borrowerOps.closeTrove();
        uint256 burned = before - musd.balanceOf(address(this));
        _refundMusd();
        _returnCollateral();
        emit TroveClosedByEmployer(employer, burned);
    }

    /// @notice Claim collateral left over after a liquidation in Recovery Mode or a redemption.
    function claimCollateral() external onlyEmployer {
        borrowerOps.claimCollateral();
        _returnCollateral();
    }

    /// @notice Recover MUSD or BTC that ended up in the vault (e.g. sent by mistake).
    function sweep() external onlyEmployer {
        _refundMusd();
        _returnCollateral();
    }

    // --------------------------------------------------------------------
    // Internal
    // --------------------------------------------------------------------

    function _refundMusd() internal {
        uint256 bal = musd.balanceOf(address(this));
        if (bal > 0) require(musd.transfer(employer, bal), "MUSD refund failed");
    }

    function _returnCollateral() internal {
        uint256 bal = address(this).balance;
        if (bal == 0) return;
        (bool ok, ) = employer.call{value: bal}("");
        require(ok, "BTC transfer failed");
        emit CollateralReturned(employer, bal);
    }
}
