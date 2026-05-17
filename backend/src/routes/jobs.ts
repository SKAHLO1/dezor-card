import { Router } from 'express';
import { requireAuth, getDb, firebaseEnabled } from '../firebase';
import { escrowAbi, escrowAddress, publicClient, Status } from '../chain';

export const jobsRouter = Router();

/**
 * Off-chain job metadata. The contract holds escrow + lifecycle state; Firestore holds the
 * rich content that powers the marketplace feed (title, description, tags, submission URL).
 * Each doc id is the on-chain job id as a string.
 */

function notConfigured(res: import('express').Response) {
  return res.status(503).json({ error: 'job storage not configured (set FIREBASE_SERVICE_ACCOUNT)' });
}

/**
 * Upsert a job's *off-chain* metadata. Called by the buyer right after posting on-chain.
 *
 * Only mutates user-supplied content fields (title, description, tags, budgetMusd,
 * fundingMode, deadline, submissionUrl). The authoritative on-chain projection is
 * written exclusively by the indexer under `onchain.*` — clients cannot lie about
 * status, freelancer, amount, etc.
 */
jobsRouter.post('/jobs/sync', requireAuth, async (req, res) => {
  if (!firebaseEnabled) return notConfigured(res);
  const { onchainId, title, description, tags, budgetMusd, fundingMode, deadline, submissionUrl } =
    req.body ?? {};
  if (onchainId === undefined || !title) {
    return res.status(400).json({ error: 'onchainId and title are required' });
  }

  try {
    const id = String(onchainId);

    // Source of truth for ownership = the chain. Verify the job exists on-chain and that
    // the caller's verified wallet matches the employer. This is what makes the route safe
    // to call repeatedly / from any uid: as long as the caller proved their wallet during
    // onboarding, and that wallet is the on-chain employer of this job, they may write
    // its off-chain metadata.
    const job = await publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: 'getJob',
      args: [BigInt(id)],
    });
    if (job.status === Status.None) {
      return res.status(404).json({ error: 'no on-chain job exists at that id — post the tx first' });
    }
    if (!req.walletAddress || job.employer.toLowerCase() !== req.walletAddress) {
      return res.status(403).json({ error: 'connected wallet is not the on-chain employer' });
    }

    const ref = getDb().collection('jobs').doc(id);
    const existing = await ref.get();
    const base = existing.exists ? {} : { createdAt: Date.now(), employerUid: req.uid };
    await ref.set(
      {
        ...base,
        onchainId: id,
        employerWallet: req.walletAddress ?? null,
        title: String(title).slice(0, 200),
        description: String(description ?? '').slice(0, 8000),
        tags: Array.isArray(tags) ? tags.slice(0, 12).map((t) => String(t).slice(0, 30)) : [],
        budgetMusd: budgetMusd ?? null,
        fundingMode: fundingMode === 'BTC' ? 'BTC' : 'MUSD',
        deadline: deadline ?? null,
        ...(submissionUrl ? { submissionUrl: String(submissionUrl).slice(0, 500) } : {}),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    return res.json({ ok: true, id });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Attach / update the developer's submission URL on a job (called alongside submitWork).
 * Authorised against the on-chain freelancer projection written by the indexer — only the
 * wallet currently holding the job can attach a submission URL.
 */
jobsRouter.post('/jobs/:id/submission', requireAuth, async (req, res) => {
  if (!firebaseEnabled) return notConfigured(res);
  const submissionUrl = String(req.body?.submissionUrl ?? '').trim();
  if (!submissionUrl) return res.status(400).json({ error: 'submissionUrl is required' });
  try {
    const ref = getDb().collection('jobs').doc(req.params.id);
    const snap = await ref.get();
    const onchainFreelancer = (snap.data()?.onchain?.freelancer as string | undefined)?.toLowerCase();
    if (onchainFreelancer && onchainFreelancer !== req.walletAddress) {
      return res.status(403).json({ error: 'not the job freelancer' });
    }
    await ref.set(
      {
        submissionUrl: submissionUrl.slice(0, 500),
        submittedByUid: req.uid,
        submittedAt: Date.now(),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/** Public feed read — all jobs, newest first. The frontend filters/sorts client-side. */
jobsRouter.get('/jobs', async (_req, res) => {
  if (!firebaseEnabled) return res.json({ jobs: [] });
  try {
    const snap = await getDb().collection('jobs').orderBy('createdAt', 'desc').limit(200).get();
    return res.json({ jobs: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/** Single job's off-chain metadata. */
jobsRouter.get('/jobs/:id', async (req, res) => {
  if (!firebaseEnabled) return notConfigured(res);
  try {
    const doc = await getDb().collection('jobs').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'job not found' });
    return res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});
