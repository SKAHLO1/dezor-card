import { Router } from 'express';
import { escrowAbi, escrowAddress, publicClient, Status, readBtcPrice } from '../chain';

export const statsRouter = Router();

/**
 * Marketplace-wide numbers for the landing page, aggregated straight from the escrow contract.
 * Cached briefly — it is a public endpoint.
 */
const TTL_MS = 30_000;
const MAX_JOBS = 1000;
let cache: { at: number; body: Record<string, unknown> } | null = null;
let inflight: Promise<Record<string, unknown>> | null = null;

const ACTIVE = new Set<number>([
  Status.Open,
  Status.Claimed,
  Status.Submitted,
  Status.Disputed,
  Status.DisputeResolved,
  Status.Appealed,
]);

statsRouter.get('/stats', async (_req, res) => {
  if (cache && Date.now() - cache.at < TTL_MS) return res.json(cache.body);
  try {
    inflight ??= computeStats().finally(() => {
      inflight = null;
    });
    const body = await inflight;
    cache = { at: Date.now(), body };
    return res.json(body);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

async function computeStats(): Promise<Record<string, unknown>> {
  // The chain is the source of truth, so the numbers are right even when the indexer is
  // behind or not running. Capped + batched to keep RPC load bounded; the response is cached.
  const count = Number(
    await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: 'nextJobId' }),
  );
  const ids = Array.from({ length: Math.min(count, MAX_JOBS) }, (_, i) => i);
  const jobs: { status: number; mode: number; amount: bigint; employer: string; freelancer: string }[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = await Promise.all(
      ids.slice(i, i + 20).map((id) =>
        publicClient.readContract({
          address: escrowAddress,
          abi: escrowAbi,
          functionName: 'getJob',
          args: [BigInt(id)],
        }),
      ),
    );
    jobs.push(...batch);
  }

  let totalJobs = 0;
  let activeJobs = 0;
  let settledJobs = 0;
  let inEscrow = 0n;
  let paid = 0n;
  const paidDevs = new Set<string>();
  const btcEmployers = new Set<`0x${string}`>();
  for (const oc of jobs) {
    if (oc.status === Status.None) continue;
    totalJobs++;
    if (oc.mode === 1) btcEmployers.add(oc.employer as `0x${string}`);
    if (ACTIVE.has(oc.status)) {
      activeJobs++;
      inEscrow += oc.amount;
    }
    if (oc.status === Status.Released) {
      settledJobs++;
      paid += oc.amount;
      paidDevs.add(oc.freelancer.toLowerCase());
    }
  }
  // BTC locked = collateral currently in employers' active troves, read from Mezo's TroveManager
  // through the escrow's getTrove view (employers can withdraw or close, so job deposits overstate it).
  let btcLocked = 0n;
  let activeTroves = 0;
  for (const employer of btcEmployers) {
    const t = await publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: 'getTrove',
      args: [employer],
    });
    if (t.status === 1) {
      btcLocked += t.coll;
      activeTroves++;
    }
  }
  const btcPrice = await readBtcPrice().catch(() => 0n);
  return {
    activeTroves,
    totalJobs,
    activeJobs,
    settledJobs,
    developersPaid: paidDevs.size,
    btcLockedWei: btcLocked.toString(),
    musdInEscrowWei: inEscrow.toString(),
    musdPaidWei: paid.toString(),
    // BTC/USD from Mezo's PriceFeed (18 decimals); "0" when the oracle is stale.
    btcPriceWei: btcPrice.toString(),
  };
}
