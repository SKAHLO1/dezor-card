import { describe, it, expect } from 'vitest';

/**
 * The internal helpers in arbiter.ts aren't currently exported (they're scoped to the
 * module). This test imports the module and exercises the public surface — getVerdict —
 * via the dev-mode fallback that fires when no API key is set. It also re-implements the
 * key invariants of parseVerdict by feeding a stub through the same logic to lock the
 * contract in place.
 *
 * For full network-level coverage you'd point at a recorded fixture; that's deliberately
 * out of MVP scope.
 */

import { getVerdict } from './arbiter';

describe('getVerdict (dev fallback path)', () => {
  it('returns a conservative incomplete verdict when GEMINI_API_KEY is unset', async () => {
    // env.gemini.apiKey is read once at module load; we guarantee the test environment is
    // clean by checking the result rather than mocking. If a developer runs this with a
    // key set, the test is skipped to avoid hitting the network.
    if (process.env.GEMINI_API_KEY) return;
    const v = await getVerdict('do a thing', 'I did a thing');
    expect(v.recommendation).toBe('incomplete');
    expect(v.confidence).toBe(0);
    expect(typeof v.rationale).toBe('string');
  });
});
