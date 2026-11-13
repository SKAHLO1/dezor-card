import { MCR, CCR } from '@/lib/contracts';

/**
 * Mezo trove math for the job-posting preview. Mezo's MUSD is a Liquity-style CDP:
 *  - opening a trove needs principal >= minNetDebt (read live from BorrowerOperations)
 *  - every trove carries a 200 MUSD gas compensation on top of its debt
 *  - a borrowing fee (read live) is added to the debt, not deducted from what you receive
 *  - the trove must stay >= 110% collateral ratio (MCR); we recommend >= 150% (CCR)
 *
 * The BTC price comes from Mezo's PriceFeed via the escrow's getTrove() view — never a constant.
 * Each employer has one trove: the first BTC job opens it, later jobs pool into it, so the
 * preview always works on the *resulting* trove (existing collateral/debt + this job).
 */

export const MUSD_GAS_COMPENSATION = 200;

const pct = (r: number) => `${Math.round(r * 100)}%`;

export type TroveHealth = 'safe' | 'tight' | 'liquidation';

export interface ExistingTrove {
  /** BTC already in the employer's active trove. */
  coll: number;
  /** Total MUSD debt already on it (incl. gas compensation and fees). */
  debt: number;
}

export interface TroveQuoteInput {
  /** BTC added with this job (0 is allowed when pooling into an existing trove). */
  btcToAdd: number;
  /** MUSD minted for this job. */
  musdToBorrow: number;
  /** Live BTC/USD from Mezo's PriceFeed. */
  btcPriceUsd: number;
  /** Live BorrowerOperations.minNetDebt(). */
  minNetDebt: number;
  /** Live borrowing fee rate (getBorrowingFee(1e18) / 1e18). */
  feeRate: number;
  /** The employer's active trove, or null when this job opens a new one. */
  existing: ExistingTrove | null;
}

export interface TroveQuote {
  /** True when this job opens the trove, false when it pools in via adjustTrove. */
  opens: boolean;
  /** Collateral and debt the trove will hold after this job. */
  newColl: number;
  newDebt: number;
  fee: number;
  /** Collateral ratio after this job. */
  ratio: number;
  collateralUsd: number;
  /** BTC price at which the trove would hit the 110% MCR. */
  liquidationPrice: number;
  /** Extra MUSD that could still be borrowed while staying at the 150% buffer. */
  maxBorrowable: number;
  clearsMinDebt: boolean;
  health: TroveHealth;
  warnings: string[];
}

export function quoteTrove(q: TroveQuoteInput): TroveQuote {
  const opens = !q.existing;
  const fee = q.musdToBorrow * q.feeRate;
  const newColl = (q.existing?.coll ?? 0) + q.btcToAdd;
  const newDebt = (q.existing?.debt ?? MUSD_GAS_COMPENSATION) + q.musdToBorrow + fee;
  const collateralUsd = newColl * q.btcPriceUsd;
  const ratio = newDebt > 0 ? collateralUsd / newDebt : Infinity;
  const liquidationPrice = newColl > 0 ? (newDebt * MCR) / newColl : Infinity;
  const maxBorrowable = Math.max(0, collateralUsd / CCR - newDebt) / (1 + q.feeRate);
  const clearsMinDebt = !opens || q.musdToBorrow >= q.minNetDebt;

  const warnings: string[] = [];
  if (opens && q.btcToAdd <= 0) warnings.push('Opening a trove needs BTC collateral.');
  if (!clearsMinDebt) {
    warnings.push(
      `A new trove must borrow at least ${q.minNetDebt.toLocaleString()} MUSD (Mezo minNetDebt).`,
    );
  }
  if (ratio < MCR) {
    warnings.push(
      `Collateral ratio ${pct(ratio)} is below Mezo's ${pct(MCR)} minimum — the transaction will revert. Add BTC or borrow less.`,
    );
  } else if (ratio < CCR) {
    warnings.push(
      `Collateral ratio ${pct(ratio)} is below the recommended ${pct(CCR)} buffer — a BTC price drop could get the trove liquidated.`,
    );
  }

  const health: TroveHealth = ratio < MCR ? 'liquidation' : ratio < CCR ? 'tight' : 'safe';
  return {
    opens,
    newColl,
    newDebt,
    fee,
    ratio,
    collateralUsd,
    liquidationPrice,
    maxBorrowable,
    clearsMinDebt,
    health,
    warnings,
  };
}
