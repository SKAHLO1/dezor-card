import { escrowAbi, escrowAddress, publicClient } from './chain';
import { getDb, firebaseEnabled } from './firebase';
import { reviewSubmission, arbitrateDispute, hasVerdict } from './services/ai';
import { env } from './env';

/**
 * Event indexer. A separate long-running process that:
 *  - Watches every SatLockEscrow lifecycle event and projects it into Firestore so the feed
 *    is always consistent with the chain even if a user closes their browser mid-flow.
 *  - Auto-fires the AI submission review on WorkSubmitted and the AI dispute arbitration on
 *    JobDisputed, deduped on (jobId, layer) so it is safe across restarts and reorgs.
 *
 * Cursor: a `meta/indexer.lastBlock` doc in Firestore. On restart we rewind 50 blocks to
 * tolerate small reorgs; events are idempotent at the Firestore-write level.
 */

const REORG_REWIND = 50n;
const POLL_INTERVAL_MS = 10_000;
const META_DOC = 'meta/indexer';

type LogLike = {
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  args: Record<string, unknown>;
  eventName?: string;
};

async function loadCursor(): Promise<bigint> {
  if (!firebaseEnabled) return env.mezo.indexerStartBlock;
  try {
    const snap = await getDb().doc(META_DOC).get();
    const v = snap.data()?.lastBlock as string | number | undefined;
    if (v === undefined) return env.mezo.indexerStartBlock;
    return BigInt(v);
  } catch {
    return env.mezo.indexerStartBlock;
  }
}

async function saveCursor(block: bigint) {
  if (!firebaseEnabled) return;
  try {
    await getDb()
      .doc(META_DOC)
      .set({ lastBlock: block.toString(), updatedAt: Date.now() }, { merge: true });
  } catch (err) {
    console.error('indexer: failed to persist cursor:', err);
  }
}

async function projectJobToFirestore(jobId: string) {
  if (!firebaseEnabled) return;
  try {
    const job = await publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: 'getJob',
      args: [BigInt(jobId)],
    });
    await getDb()
      .collection('jobs')
      .doc(jobId)
      .set(
        {
          onchain: {
            employer: job.employer,
            freelancer: job.freelancer,
            amount: job.amount.toString(),
            btcCollateral: job.btcCollateral.toString(),
            mode: job.mode,
            status: job.status,
            deadline: Number(job.deadline),
            claimedAt: Number(job.claimedAt),
            appealDeadline: Number(job.appealDeadline),
            aiVerdictApprove: job.aiVerdictApprove,
            rating: job.rating,
            detailsURI: job.detailsURI,
          },
          updatedAt: Date.now(),
        },
        { merge: true },
      );
  } catch (err) {
    console.error(`indexer: failed to project job ${jobId}:`, err);
  }
}

async function getSubmissionUrl(jobId: string): Promise<string | null> {
  if (!firebaseEnabled) return null;
  try {
    const snap = await getDb().collection('jobs').doc(jobId).get();
    const url = snap.data()?.submissionUrl as string | undefined;
    return url ?? null;
  } catch {
    return null;
  }
}

async function handleEvent(log: LogLike) {
  const id = log.args.id as bigint | undefined;
  const jobId = id !== undefined ? id.toString() : undefined;
  if (jobId === undefined) return;

  // Project the up-to-date on-chain snapshot for every lifecycle event.
  await projectJobToFirestore(jobId);

  // Side-effects: auto-fire AI.
  if (log.eventName === 'WorkSubmitted') {
    const submissionUrl = (log.args.submissionURI as string | undefined)?.trim() || null;
    const url = submissionUrl || (await getSubmissionUrl(jobId));
    if (!url) {
      console.warn(`indexer: WorkSubmitted on job ${jobId} but no submission URL — skipping AI review`);
      return;
    }
    if (await hasVerdict(jobId, 'submission')) return;
    try {
      await reviewSubmission(jobId, url);
      console.log(`indexer: AI submission review recorded for job ${jobId}`);
    } catch (err) {
      console.error(`indexer: AI submission review failed for job ${jobId}:`, err);
    }
  }

  if (log.eventName === 'JobDisputed') {
    const url = await getSubmissionUrl(jobId);
    if (!url) {
      console.warn(`indexer: JobDisputed on job ${jobId} but no submission URL — skipping AI arbitration`);
      return;
    }
    if (await hasVerdict(jobId, 'dispute')) return;
    try {
      const r = await arbitrateDispute(jobId, url);
      console.log(
        `indexer: AI arbitration ${r.escalated ? 'escalated' : 'recorded'} for job ${jobId}` +
          (r.txHash ? ` (tx ${r.txHash})` : ''),
      );
    } catch (err) {
      console.error(`indexer: AI arbitration failed for job ${jobId}:`, err);
    }
  }
}

async function scanRange(from: bigint, to: bigint) {
  const logs = await publicClient.getContractEvents({
    address: escrowAddress,
    abi: escrowAbi,
    fromBlock: from,
    toBlock: to,
  });
  // Process in chain order so dependent state transitions land in order.
  logs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return Number(a.blockNumber - b.blockNumber);
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });
  for (const log of logs) {
    await handleEvent(log as unknown as LogLike);
  }
}

async function tick() {
  const cursor = await loadCursor();
  const head = await publicClient.getBlockNumber();
  const from = cursor > REORG_REWIND ? cursor - REORG_REWIND : 0n;
  if (head < from) return;
  await scanRange(from, head);
  await saveCursor(head);
}

async function main() {
  if (!firebaseEnabled) {
    console.warn('indexer: Firebase is not configured — running in pass-through mode (no projection or dedup).');
  }
  console.log(`indexer: starting against ${escrowAddress} on ${env.mezo.rpcUrl}`);
  console.log(`indexer: poll interval ${POLL_INTERVAL_MS}ms, reorg rewind ${REORG_REWIND} blocks`);

  // Run forever. Catch and log per-tick errors so a single failure doesn't kill the loop.
  // Avoid recursive setTimeout chains by using a simple async loop.
  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error('indexer: tick failed:', err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('indexer: fatal', err);
  process.exit(1);
});
