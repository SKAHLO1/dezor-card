import { describe, it, expect } from 'vitest';
import { quoteTrove } from './trove';

describe('quoteTrove', () => {
  it('flags a trove below the protocol minimum CR as liquidation-bound', () => {
    const q = quoteTrove(0.001, 1000, 50_000); // $50 collateral for $1000 debt
    expect(q.health).toBe('liquidation');
    expect(q.warnings.some((w) => w.includes('protocol minimum'))).toBe(true);
  });

  it('flags below-safe-but-above-minimum CR as tight', () => {
    // collateral $1200, debt $1000 → 120% CR. Above 110% minimum, below 150% safe.
    const q = quoteTrove(0.024, 1000, 50_000);
    expect(q.health).toBe('tight');
  });

  it('returns safe when collateral comfortably exceeds the safe ratio', () => {
    // collateral $5000, debt $1000 → 500% CR.
    const q = quoteTrove(0.1, 2000, 50_000);
    expect(q.health).toBe('safe');
    expect(q.warnings).toEqual([]);
  });

  it('warns when debt is below the protocol minimum', () => {
    const q = quoteTrove(1, 100, 50_000);
    expect(q.clearsMinDebt).toBe(false);
    expect(q.warnings.some((w) => w.includes('Mezo protocol minimum'))).toBe(true);
  });
});
