import { Router } from 'express';
import { requireAuth, requireAdmin, getDb, firebaseEnabled } from '../firebase';
import { escrowAbi, escrowAddress, publicClient, Status } from '../chain';

export const appealsRouter = Router();

/** Serialize all bigints in a Job tuple to strings so JSON.stringify doesn't throw. */
function serializeJob(j: Awaited<ReturnType<typeof publicClient.readContract>> & {
  amount: bigint;
  btcCollateral: bigint;
  deadline: bigint;
  claimedAt: bigint;
  appealDeadline: bigint;
}) {
  return {
    employer: j.employer,
    freelancer: j.freelancer,
    amount: j.amount.toString(),
    btcCollateral: j.btcCollateral.toString(),
    mode: j.mode,
    status: j.status,
    deadline: Number(j.deadline),
    claimedAt: Number(j.claimedAt),
    appealDeadline: Number(j.appealDeadline),
    aiVerdictApprove: j.aiVerdictApprove,
    rating: j.rating,
    detailsURI: j.detailsURI,
  };
}

/**
 * Appeal threads. The on-chain ladder is: AI resolveDispute() -> appeal window -> either
 * finalizeDispute() or, if appealed, the admin's adminResolve(). The actual adminResolve()
 * transaction is signed by the admin from their own wallet in the frontend `/admin` page;
 * these routes store the human-readable thread + status that surface the queue.
 */

function notConfigured(res: import('express').Response) {
  return res.status(503).json({ error: 'appeal storage not configured' });
}

/** A party opens an appeal after the AI verdict — escalates to the admin. */
appealsRouter.post('/appeals', requireAuth, async (req, res) => {
  if (!firebaseEnabled) return notConfigured(res);
  const { jobId, reason } = req.body ?? {};
  if (jobId === undefined || !reason) {
    return res.status(400).json({ error: 'jobId and reason are required' });
  }
  try {
    const ref = getDb().collection('appeals').doc(String(jobId));
    await ref.set(
      {
        jobId: String(jobId),
        openedByUid: req.uid,
        openedByWallet: req.walletAddress ?? null,
        reason: String(reason).slice(0, 2000),
        status: 'open',
        createdAt: Date.now(),
      },
      { merge: true },
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Admin: every on-chain job currently in a dispute state. Reads directly from the chain
 * so it's authoritative even if the indexer is not running or has fallen behind. Returns
 * jobs grouped by status with their off-chain metadata + most recent AI verdict attached.
 *
 * Cost: O(nextJobId) RPC reads per call. Fine at MVP scale; add an indexer-backed cache
 * if the job count climbs.
 */
appealsRouter.get('/admin/disputes', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const n = await publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: 'nextJobId',
    });
    const ids = Array.from({ length: Number(n) }, (_, i) => i);
    const interesting = [Status.Disputed, Status.DisputeResolved, Status.Appealed] as number[];

    const jobs = await Promise.all(
      ids.map(async (i) => {
        const j = await publicClient.readContract({
          address: escrowAddress,
          abi: escrowAbi,
          functionName: 'getJob',
          args: [BigInt(i)],
        });
        if (!interesting.includes(j.status)) return null;
        const id = String(i);

        const [meta, verdictsSnap, appealSnap] = await Promise.all([
          firebaseEnabled
            ? getDb().collection('jobs').doc(id).get().then((s) => (s.exists ? s.data() : null))
            : Promise.resolve(null),
          firebaseEnabled
            ? getDb().collection('aiVerdicts').where('jobId', '==', id).get()
            : Promise.resolve(null),
          firebaseEnabled
            ? getDb().collection('appeals').doc(id).get().then((s) => (s.exists ? s.data() : null))
            : Promise.resolve(null),
        ]);

        const verdicts = verdictsSnap
          ? verdictsSnap.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .sort(
                (a: { createdAt?: number }, b: { createdAt?: number }) =>
                  Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0),
              )
          : [];

        return {
          id,
          onchain: serializeJob(j as never),
          meta: meta ?? null,
          verdicts,
          appeal: appealSnap ?? null,
        };
      }),
    );

    res.json({ jobs: jobs.filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Admin queue — all open appeals, oldest first. Sorts in memory (no composite index). */
appealsRouter.get('/appeals', requireAuth, requireAdmin, async (_req, res) => {
  if (!firebaseEnabled) return res.json({ appeals: [] });
  try {
    const snap = await getDb().collection('appeals').where('status', '==', 'open').get();
    const appeals = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0));
    return res.json({ appeals });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Admin records the outcome of an appeal. The on-chain adminResolve() tx is sent from the
 * admin's wallet client-side; this persists the decision + note and closes the thread.
 */
appealsRouter.post('/admin/resolve/:jobId', requireAuth, requireAdmin, async (req, res) => {
  if (!firebaseEnabled) return notConfigured(res);
  const { approve, note, txHash } = req.body ?? {};
  try {
    await getDb()
      .collection('appeals')
      .doc(req.params.jobId)
      .set(
        {
          status: 'resolved',
          adminApprove: !!approve,
          adminNote: String(note ?? '').slice(0, 2000),
          adminTxHash: txHash ?? null,
          resolvedAt: Date.now(),
        },
        { merge: true },
      );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});
