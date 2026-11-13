import { Router, type Request, type Response } from 'express';
import { requireAuth, getDb, firebaseEnabled, ns } from '../firebase';
import { reviewSubmission, arbitrateDispute } from '../services/ai';
import { escrowAbi, escrowAddress, publicClient, Status } from '../chain';
import { env } from '../env';

export const aiRouter = Router();

/**
 * Latest AI verdicts for a job (submission review + any dispute arbitration).
 * Sorts in memory to avoid the Firestore composite-index requirement on (where + orderBy).
 */
aiRouter.get('/ai/verdicts/:jobId', async (req, res) => {
  if (!firebaseEnabled) return res.json({ verdicts: [] });
  try {
    const snap = await getDb()
      .collection(ns('aiVerdicts'))
      .where('jobId', '==', req.params.jobId)
      .get();
    const verdicts = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      .sort(
        (a, b) =>
          Number((b as { createdAt?: number }).createdAt ?? 0) -
          Number((a as { createdAt?: number }).createdAt ?? 0),
      )
      .slice(0, 10);
    return res.json({ verdicts });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Both AI layers spend Gemini quota and the arbiter signs on-chain, so only the job's two
 * parties may trigger them — plus the admin wallet, the contract's final appeal authority.
 * Authorised against the chain: the caller's verified wallet must be the on-chain employer or
 * freelancer. Sends the error response and returns false on refusal.
 */
async function requireJobParty(req: Request, res: Response, jobId: string): Promise<boolean> {
  if (!/^\d+$/.test(jobId)) {
    res.status(400).json({ error: 'invalid jobId' });
    return false;
  }
  const job = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: 'getJob',
    args: [BigInt(jobId)],
  });
  if (job.status === Status.None) {
    res.status(404).json({ error: 'no on-chain job at that id' });
    return false;
  }
  const me = req.walletAddress;
  const isParty = me === job.employer.toLowerCase() || me === job.freelancer.toLowerCase();
  const isAdmin = !!env.admin.address && me === env.admin.address;
  if (!me || (!isParty && !isAdmin)) {
    res.status(403).json({ error: "only the job's employer or freelancer can request this" });
    return false;
  }
  return true;
}

/**
 * First AI layer — advisory only. Scans the deliverable recorded on-chain (the WorkSubmitted
 * event) against the job spec and returns a recommendation. Never touches the chain: the buyer
 * is the one who acts on it. A submissionUrl in the body is ignored.
 */
aiRouter.post('/ai/review-submission', requireAuth, async (req, res) => {
  const jobId = String(req.body?.jobId ?? '');
  try {
    if (!(await requireJobParty(req, res, jobId))) return;
    return res.json(await reviewSubmission(jobId));
  } catch (err) {
    const msg = (err as Error).message;
    return res.status(msg.includes('no on-chain submission') ? 409 : 500).json({ error: msg });
  }
});

/**
 * Second AI layer — dispute arbitration. Re-evaluates a disputed job's on-chain submission and,
 * if confidence clears the threshold, signs resolveDispute() from the arbiter wallet. Below the
 * threshold the verdict is recorded and the case is escalated to the human admin queue.
 */
aiRouter.post('/ai/arbitrate/:jobId', requireAuth, async (req, res) => {
  const jobId = req.params.jobId;
  try {
    if (!(await requireJobParty(req, res, jobId))) return;
    return res.json(await arbitrateDispute(jobId));
  } catch (err) {
    const msg = (err as Error).message;
    const conflict = msg.includes('not in the Disputed state') || msg.includes('no on-chain submission');
    return res.status(conflict ? 409 : 500).json({ error: msg });
  }
});
