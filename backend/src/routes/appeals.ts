import { Router } from 'express';
import { requireAuth, requireAdmin, getDb, firebaseEnabled } from '../firebase';

export const appealsRouter = Router();

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

/** Admin queue — all open appeals, oldest first. */
appealsRouter.get('/appeals', requireAuth, requireAdmin, async (_req, res) => {
  if (!firebaseEnabled) return res.json({ appeals: [] });
  try {
    const snap = await getDb()
      .collection('appeals')
      .where('status', '==', 'open')
      .orderBy('createdAt', 'asc')
      .get();
    return res.json({ appeals: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
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
