// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockMUSD} from "./MockMUSD.sol";

/// @notice Test stand-in for Mezo MUSD's BorrowerOperations + TroveManager, enforcing the rules
///         the escrow relies on (mezo-org/musd): one trove per address, a 1800 MUSD minimum net
///         debt, 200 MUSD gas compensation added to debt, a 0.1% borrowing fee added to debt,
///         a 110% minimum collateral ratio, `closeTrove` burning `debt - 200` from the owner, and
///         collateral surplus claimable via `claimCollateral`. Interest is not modelled.
contract MockBorrowerOperations {
    uint256 public constant GAS_COMPENSATION = 200e18;
    uint256 public constant MIN_NET_DEBT = 1800e18;
    uint256 public constant MCR = 1.1e18;
    uint256 public constant FEE_BPS = 10; // 0.1%

    enum Status { nonExistent, active, closedByOwner, closedByLiquidation, closedByRedemption }

    struct Trove {
        uint256 coll;
        uint256 debt;
        Status status;
    }

    MockMUSD public immutable musd;
    uint256 public price = 75_000e18; // BTC/USD, 18 decimals
    mapping(address => Trove) public troves;
    mapping(address => uint256) public surplus;

    constructor(address _musd) {
        musd = MockMUSD(_musd);
    }

    // ---- test helpers ----
    function setPrice(uint256 _price) external {
        price = _price;
    }

    /// @dev Simulates a liquidation in Recovery Mode that leaves claimable surplus collateral.
    function liquidateWithSurplus(address borrower, uint256 surplusColl) external {
        Trove storage t = troves[borrower];
        require(t.status == Status.active, "not active");
        require(surplusColl <= t.coll, "surplus > coll");
        surplus[borrower] += surplusColl;
        t.coll = 0;
        t.debt = 0;
        t.status = Status.closedByLiquidation;
    }

    // ---- BorrowerOperations ----
    function openTrove(uint256 _debtAmount, address, address) external payable {
        Trove storage t = troves[msg.sender];
        require(t.status != Status.active, "trove is active");
        require(msg.value > 0, "no collateral");
        require(_debtAmount >= MIN_NET_DEBT, "below min net debt");
        t.coll = msg.value;
        t.debt = _debtAmount + _fee(_debtAmount) + GAS_COMPENSATION;
        t.status = Status.active;
        _requireICR(msg.sender);
        musd.mint(msg.sender, _debtAmount);
    }

    function adjustTrove(
        uint256 _collWithdrawal,
        uint256 _debtChange,
        bool _isDebtIncrease,
        address,
        address
    ) external payable {
        Trove storage t = troves[msg.sender];
        require(t.status == Status.active, "trove not active");
        require(_collWithdrawal == 0 || msg.value == 0, "singular coll change");
        t.coll = t.coll + msg.value - _collWithdrawal;
        if (_isDebtIncrease) {
            t.debt += _debtChange + _fee(_debtChange);
            musd.mint(msg.sender, _debtChange);
        } else if (_debtChange > 0) {
            _repay(t, _debtChange);
        }
        _requireICR(msg.sender);
        if (_collWithdrawal > 0) _send(msg.sender, _collWithdrawal);
    }

    function addColl(address, address) external payable {
        Trove storage t = troves[msg.sender];
        require(t.status == Status.active, "trove not active");
        t.coll += msg.value;
    }

    function withdrawColl(uint256 _amount, address, address) external {
        Trove storage t = troves[msg.sender];
        require(t.status == Status.active, "trove not active");
        t.coll -= _amount;
        _requireICR(msg.sender);
        _send(msg.sender, _amount);
    }

    function repayMUSD(uint256 _amount, address, address) external {
        Trove storage t = troves[msg.sender];
        require(t.status == Status.active, "trove not active");
        _repay(t, _amount);
    }

    function closeTrove() external {
        Trove storage t = troves[msg.sender];
        require(t.status == Status.active, "trove not active");
        uint256 owed = t.debt - GAS_COMPENSATION;
        musd.burn(msg.sender, owed);
        uint256 coll = t.coll;
        t.coll = 0;
        t.debt = 0;
        t.status = Status.closedByOwner;
        _send(msg.sender, coll);
    }

    function claimCollateral() external {
        uint256 amount = surplus[msg.sender];
        require(amount > 0, "no collateral to claim");
        surplus[msg.sender] = 0;
        _send(msg.sender, amount);
    }

    // ---- TroveManager views ----
    function getTroveStatus(address b) external view returns (uint8) {
        return uint8(troves[b].status);
    }

    function getTroveColl(address b) external view returns (uint256) {
        return troves[b].coll;
    }

    function getTroveDebt(address b) external view returns (uint256) {
        return troves[b].debt;
    }

    function getCurrentICR(address b, uint256 _price) public view returns (uint256) {
        Trove storage t = troves[b];
        return t.debt == 0 ? type(uint256).max : (t.coll * _price) / t.debt;
    }

    // ---- PriceFeed ----
    function fetchPrice() external view returns (uint256) {
        return price;
    }

    // ---- internal ----
    function _fee(uint256 amount) internal pure returns (uint256) {
        return (amount * FEE_BPS) / 10_000;
    }

    function _repay(Trove storage t, uint256 amount) internal {
        require(t.debt - amount >= MIN_NET_DEBT + GAS_COMPENSATION, "below min net debt");
        musd.burn(msg.sender, amount);
        t.debt -= amount;
    }

    function _requireICR(address b) internal view {
        require(getCurrentICR(b, price) >= MCR, "ICR below MCR");
    }

    function _send(address to, uint256 amount) internal {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "send failed");
    }
}
