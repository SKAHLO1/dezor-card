import { describe, it, expect } from 'vitest';
import { quoteTrove, type TroveQuoteInput } from './trove';

const base: Omit<TroveQuoteInput, 'btcToAdd' | 'musdToBorrow'> = {
  btcPriceUsd: 50_000,
  minNetDebt: 1800,
  feeRate: 0.001,
  existing: null,
};

describe('quoteTrove', () => {
  it('flags a new trove below the 110% MCR as liquidation-bound', () => {
    // $1,000 collateral against 1800 + 1.8 fee + 200 gas compensation of debt
    const q = quoteTrove({ ...base, btcToAdd: 0.02, musdToBorrow: 1800 });
    expect(q.opens).toBe(true);
    expect(q.newDebt).toBeCloseTo(2001.8);
    expect(q.health).toBe('liquidation');
    expect(q.warnings.some((w) => w.includes('110% minimum'))).toBe(true);
  });

  it('flags a ratio between 110% and 150% as tight', () => {
    // $2,500 collateral / 2001.8 debt ≈ 125%
    const q = quoteTrove({ ...base, btcToAdd: 0.05, musdToBorrow: 1800 });
    expect(q.health).toBe('tight');
  });

  it('is safe with comfortable collateral and reports the liquidation price', () => {
    const q = quoteTrove({ ...base, btcToAdd: 0.2, musdToBorrow: 2000 });
    expect(q.health).toBe('safe');
    expect(q.warnings).toEqual([]);
    // (2000 + 2 fee + 200) * 1.1 / 0.2
    expect(q.liquidationPrice).toBeCloseTo(12_111);
  });

  it('enforces minNetDebt only when opening a trove', () => {
    const open = quoteTrove({ ...base, btcToAdd: 1, musdToBorrow: 500 });
    expect(open.clearsMinDebt).toBe(false);
    expect(open.warnings.some((w) => w.includes('minNetDebt'))).toBe(true);

    const pooled = quoteTrove({ ...base, btcToAdd: 0, musdToBorrow: 500, existing: { coll: 0.2, debt: 2202 } });
    expect(pooled.opens).toBe(false);
    expect(pooled.clearsMinDebt).toBe(true);
  });

  it('pools a job into an existing trove without new BTC', () => {
    const q = quoteTrove({ ...base, btcToAdd: 0, musdToBorrow: 1000, existing: { coll: 0.2, debt: 2202 } });
    expect(q.newColl).toBe(0.2);
    expect(q.newDebt).toBeCloseTo(3203);
    expect(q.health).toBe('safe'); // $10,000 / 3203 ≈ 312%
  });

  it('requires BTC to open a trove', () => {
    const q = quoteTrove({ ...base, btcToAdd: 0, musdToBorrow: 2000 });
    expect(q.warnings.some((w) => w.includes('needs BTC'))).toBe(true);
  });
});
