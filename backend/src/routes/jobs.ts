import { Router } from 'express';
import { requireAuth, getDb, firebaseEnabled } from '../firebase';

export const jobsRouter = Router();

/**
 * Off-chain job metadata. The contract holds escrow + lifecycle state; Firestore holds the
 * rich content that powers the marketplace feed (title, description, tags, submission URL).
 * Each doc id is the on-chain job id as a string.
 */

function notConfigured(res: import('express').Response) {
  return res.status(503).json({ error: 'job storage not configured (set FIREBASE_SERVICE_ACCOUNT)' });
}

/** Upsert a job's off-chain metadata. Called by the buyer right after posting on-chain. */
jobsRouter.post('/jobs/sync', requireAuth, async (req, res) => {
  if (!firebaseEnabled) return notConfigured(res);
  const { onchainId, title, description, tags, budgetMusd, fundingMode, deadline, submissionUrl } =
    req.body ?? {};
  if (onchainId === undefined || !title) {
    return res.status(400).json({ error: 'onchainId and title are required' });
  }

  try {
    const id = String(onchainId);
    const ref = getDb().collection('jobs').doc(id);
    const existing = await ref.get();
    const base = existing.exists ? {} : { createdAt: Date.now(), employerUid: req.uid };
    await ref.set(
      {
        ...base,
        onchainId: id,
        employerWallet: req.walletAddress ?? null,
        title,
        description: description ?? '',
        tags: Array.isArray(tags) ? tags.slice(0, 12) : [],
        budgetMusd: budgetMusd ?? null,
        fundingMode: fundingMode ?? 'MUSD',
        deadline: deadline ?? null,
        ...(submissionUrl ? { submissionUrl } : {}),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    return res.json({ ok: true, id });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/** Attach / update the developer's submission URL on a job (called alongside submitWork). */
jobsRouter.post('/jobs/:id/submission', requireAuth, async (req, res) => {
  if (!firebaseEnabled) return notConfigured(res);
  const submissionUrl = String(req.body?.submissionUrl ?? '').trim();
  if (!submissionUrl) return res.status(400).json({ error: 'submissionUrl is required' });
  try {
    await getDb()
      .collection('jobs')
      .doc(req.params.id)
      .set(
        { submissionUrl, submittedByUid: req.uid, submittedAt: Date.now(), updatedAt: Date.now() },
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
