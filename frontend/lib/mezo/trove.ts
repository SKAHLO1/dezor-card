import { env } from '@/lib/env';

/**
 * Mezo trove math. Mezo's MUSD is a Liquity-style CDP — opening a trove requires:
 *  - net debt >= MIN_NET_DEBT (protocol floor)
 *  - collateral ratio = (collateral * btcPriceUsd) / debt >= MIN_COLLATERAL_RATIO
 *
 * The exact protocol parameters can change; treat the constants below as conservative
 * defaults and override at runtime via NEXT_PUBLIC_MEZO_* envs. There is no oracle wired
 * in the v1 codebase — BTC price is configured (or set by the user in the form) and
 * surfaced as an explicit health preview so the buyer sees what they're signing for.
 */

export const MIN_COLLATERAL_RATIO = Number(
  process.env.NEXT_PUBLIC_TROVE_MIN_CR ?? env.app.troveMinCR ?? '1.10',
);
/** Recommended safety buffer above the minimum — keeps the trove out of immediate liquidation. */
export const SAFE_COLLATERAL_RATIO = Number(
  process.env.NEXT_PUBLIC_TROVE_SAFE_CR ?? env.app.troveSafeCR ?? '1.50',
);
/** Minimum MUSD debt the protocol will issue. Mezo's value is in the low thousands. */
export const MIN_NET_DEBT_MUSD = Number(
  process.env.NEXT_PUBLIC_TROVE_MIN_DEBT_MUSD ?? env.app.troveMinDebt ?? '1800',
);
/** Default BTC price used for previews; override per-buyer in the form. */
export const DEFAULT_BTC_PRICE_USD = Number(
  process.env.NEXT_PUBLIC_BTC_PRICE_USD ?? env.app.btcPriceUsd ?? '95000',
);

export type TroveHealth = 'safe' | 'tight' | 'liquidation';

export interface TroveQuote {
  /** Effective collateral ratio at the given BTC price. */
  ratio: number;
  /** USD value of the BTC collateral at the given price. */
  collateralUsd: number;
  /** Maximum MUSD a buyer can safely borrow against this collateral. */
  maxBorrowable: number;
  /** Minimum BTC required to mint the requested MUSD at the safe ratio. */
  requiredCollateral: number;
  /** Whether the requested debt clears the protocol minimum. */
  clearsMinDebt: boolean;
  health: TroveHealth;
  /** Human-readable diagnostics — empty if the trove is in good shape. */
  warnings: string[];
}

export function quoteTrove(
  btcCollateral: number,
  musdToBorrow: number,
  btcPriceUsd: number = DEFAULT_BTC_PRICE_USD,
): TroveQuote {
  const collateralUsd = btcCollateral * btcPriceUsd;
  const ratio = musdToBorrow > 0 ? collateralUsd / musdToBorrow : Infinity;
  const maxBorrowable = collateralUsd / SAFE_COLLATERAL_RATIO;
  const requiredCollateral = (musdToBorrow * SAFE_COLLATERAL_RATIO) / btcPriceUsd;
  const clearsMinDebt = musdToBorrow >= MIN_NET_DEBT_MUSD;

  const warnings: string[] = [];
  if (!clearsMinDebt) {
    warnings.push(
      `MUSD debt must be at least ${MIN_NET_DEBT_MUSD.toLocaleString()} (Mezo protocol minimum).`,
    );
  }
  if (ratio < MIN_COLLATERAL_RATIO) {
    warnings.push(
      `Collateral ratio ${(ratio * 100).toFixed(0)}% is below the ${
        MIN_COLLATERAL_RATIO * 100
      }% protocol minimum — the trove will revert. Add more BTC or borrow less.`,
    );
  } else if (ratio < SAFE_COLLATERAL_RATIO) {
    warnings.push(
      `Collateral ratio ${(ratio * 100).toFixed(0)}% is below the recommended ${
        SAFE_COLLATERAL_RATIO * 100
      }% safety buffer — the trove may be liquidated on a BTC price drop.`,
    );
  }

  const health: TroveHealth =
    ratio < MIN_COLLATERAL_RATIO
      ? 'liquidation'
      : ratio < SAFE_COLLATERAL_RATIO
        ? 'tight'
        : 'safe';

  return {
    ratio,
    collateralUsd,
    maxBorrowable,
    requiredCollateral,
    clearsMinDebt,
    health,
    warnings,
  };
}
