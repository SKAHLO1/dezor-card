import { Router } from 'express';
import { requireAuth, getDb, firebaseEnabled } from '../firebase';
import { reviewSubmission, arbitrateDispute } from '../services/ai';

export const aiRouter = Router();

/**
 * Latest AI verdicts for a job (submission review + any dispute arbitration).
 * Sorts in memory to avoid the Firestore composite-index requirement on (where + orderBy).
 */
aiRouter.get('/ai/verdicts/:jobId', async (req, res) => {
  if (!firebaseEnabled) return res.json({ verdicts: [] });
  try {
    const snap = await getDb()
      .collection('aiVerdicts')
      .where('jobId', '==', req.params.jobId)
      .get();
    const verdicts = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0)))
      .slice(0, 10);
    return res.json({ verdicts });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * First AI layer — advisory only. Scans the developer's deliverable (GitHub repo or other
 * reference) against the on-chain job spec and returns a recommendation. Never touches the
 * chain: the buyer is the one who acts on it.
 */
aiRouter.post('/ai/review-submission', requireAuth, async (req, res) => {
  const jobId = String(req.body?.jobId ?? '');
  const submissionUrl = String(req.body?.submissionUrl ?? '').trim();
  if (!jobId || !submissionUrl) {
    return res.status(400).json({ error: 'jobId and submissionUrl are required' });
  }
  try {
    const result = await reviewSubmission(jobId, submissionUrl);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Second AI layer — dispute arbitration. Re-evaluates a disputed job and, if confidence
 * clears the threshold, signs resolveDispute() from the arbiter wallet. Below threshold the
 * verdict is recorded and the case is escalated to the human admin queue.
 */
aiRouter.post('/ai/arbitrate/:jobId', requireAuth, async (req, res) => {
  const jobId = req.params.jobId;
  const submissionUrl = String(req.body?.submissionUrl ?? '').trim();
  if (!submissionUrl) {
    return res.status(400).json({ error: 'submissionUrl is required' });
  }
  try {
    const result = await arbitrateDispute(jobId, submissionUrl);
    return res.json(result);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg.includes('not in the Disputed state') ? 409 : 500;
    return res.status(status).json({ error: msg });
  }
});
