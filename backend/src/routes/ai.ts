import { Router } from 'express';
import { escrowAbi, escrowAddress, publicClient, arbiterWallet, Status } from '../chain';
import { getVerdict } from '../arbiter';
import { buildSubmissionDigest } from '../github';
import { requireAuth, getDb, firebaseEnabled } from '../firebase';

export const aiRouter = Router();

/** Persist an AI verdict to Firestore if storage is configured (best-effort). */
async function recordVerdict(
  jobId: string,
  layer: 'submission' | 'dispute',
  data: Record<string, unknown>,
) {
  if (!firebaseEnabled) return;
  try {
    await getDb()
      .collection('aiVerdicts')
      .add({ jobId, layer, ...data, createdAt: Date.now() });
  } catch (err) {
    console.error('Failed to record AI verdict:', err);
  }
}

/** Latest AI verdicts for a job (submission review + any dispute arbitration). */
aiRouter.get('/ai/verdicts/:jobId', async (req, res) => {
  if (!firebaseEnabled) return res.json({ verdicts: [] });
  try {
    const snap = await getDb()
      .collection('aiVerdicts')
      .where('jobId', '==', req.params.jobId)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    return res.json({ verdicts: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
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
    const job = await publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: 'getJob',
      args: [BigInt(jobId)],
    });

    const { digest, isGithub, resolved } = await buildSubmissionDigest(submissionUrl);
    const verdict = await getVerdict(job.detailsURI, digest);

    await recordVerdict(jobId, 'submission', { ...verdict, submissionUrl, isGithub, resolved });

    return res.json({ jobId, submissionUrl, isGithub, resolved, ...verdict });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Second AI layer — dispute arbitration. Re-evaluates a disputed job and, if it is in the
 * Disputed state, signs resolveDispute() from the arbiter wallet. This opens the on-chain
 * appeal window; it does not move funds.
 */
aiRouter.post('/ai/arbitrate/:jobId', requireAuth, async (req, res) => {
  const jobId = BigInt(req.params.jobId);
  const submissionUrl = String(req.body?.submissionUrl ?? '').trim();
  if (!submissionUrl) {
    return res.status(400).json({ error: 'submissionUrl is required' });
  }

  try {
    const job = await publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: 'getJob',
      args: [jobId],
    });

    if (job.status !== Status.Disputed) {
      return res
        .status(409)
        .json({ error: `job ${jobId} is not in the Disputed state (status ${job.status})` });
    }

    const { digest } = await buildSubmissionDigest(submissionUrl);
    const verdict = await getVerdict(job.detailsURI, digest);
    const approve = verdict.recommendation === 'complete';

    // Inline the rationale as a data URI so the decision is permanently on-chain-referenced.
    const rationaleURI = `data:text/plain,${encodeURIComponent(verdict.rationale)}`;

    const txHash = await arbiterWallet.writeContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: 'resolveDispute',
      args: [jobId, approve, rationaleURI],
    });

    await recordVerdict(jobId.toString(), 'dispute', { ...verdict, approve, txHash });

    return res.json({ jobId: jobId.toString(), approve, ...verdict, txHash });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});
