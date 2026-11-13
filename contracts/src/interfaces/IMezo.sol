// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC20 surface the escrow and vaults use (Mezo MUSD).
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Subset of Mezo MUSD's BorrowerOperations (mezo-org/musd, solidity/contracts).
///         The trove is always owned by `msg.sender`, minted MUSD goes to `msg.sender`, and
///         returned collateral is sent to `msg.sender` as native BTC.
interface IBorrowerOperations {
    function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) external payable;

    function adjustTrove(
        uint256 _collWithdrawal,
        uint256 _debtChange,
        bool _isDebtIncrease,
        address _upperHint,
        address _lowerHint
    ) external payable;

    function addColl(address _upperHint, address _lowerHint) external payable;

    function withdrawColl(uint256 _amount, address _upperHint, address _lowerHint) external;

    function repayMUSD(uint256 _amount, address _upperHint, address _lowerHint) external;

    function closeTrove() external;

    function claimCollateral() external;
}

/// @notice Subset of Mezo MUSD's TroveManager. `getTroveStatus` returns the Status enum
///         (0 nonExistent, 1 active, 2 closedByOwner, 3 closedByLiquidation, 4 closedByRedemption).
interface ITroveManager {
    function getTroveStatus(address _borrower) external view returns (uint8);

    function getTroveColl(address _borrower) external view returns (uint256);

    function getTroveDebt(address _borrower) external view returns (uint256);

    function getCurrentICR(address _borrower, uint256 _price) external view returns (uint256);
}

/// @notice Mezo MUSD's PriceFeed — BTC/USD with 18 decimals.
interface IPriceFeed {
    function fetchPrice() external view returns (uint256);
}
