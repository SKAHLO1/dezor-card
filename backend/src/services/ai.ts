import { escrowAbi, escrowAddress, publicClient, arbiterWallet, Status } from '../chain';
import { getVerdict, type Verdict } from '../arbiter';
import { buildSubmissionDigest, type DigestQuality } from '../github';
import { getDb, firebaseEnabled } from '../firebase';
import { env } from '../env';

/**
 * Core AI logic, shared between HTTP routes and the event indexer. Each function is
 * idempotent at the granularity used by callers — the routes call them once per request,
 * the indexer calls them once per (jobId, layer) pair after a dedup check.
 */

interface DigestMeta {
  isGithub: boolean;
  resolved: boolean;
  quality: DigestQuality;
  contentBytes: number;
  digestNote: string;
}

export interface SubmissionReview extends Verdict, DigestMeta {
  jobId: string;
  submissionUrl: string;
}

export interface DisputeArbitration extends Verdict, DigestMeta {
  jobId: string;
  approve: boolean;
  escalated: boolean;
  txHash: `0x${string}` | null;
}

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

/**
 * Resolve the *actual* job specification text the AI should reason over. The on-chain
 * detailsURI is just a pointer (e.g. "satlock:job:2") — the real title, description, and
 * tags live in Firestore. Pass them to Gemini in a structured way so it can judge the
 * deliverable against what the buyer actually asked for.
 */
async function resolveJobSpec(jobId: string, detailsURI: string): Promise<string> {
  if (!firebaseEnabled) {
    return `Job specification pointer: ${detailsURI}\n(No off-chain spec store configured — the AI has no description of the work to compare against.)`;
  }
  try {
    const snap = await getDb().collection('jobs').doc(jobId).get();
    if (!snap.exists) {
      return `Job specification pointer: ${detailsURI}\n(No off-chain record found for this job id — the buyer never saved a description.)`;
    }
    const data = snap.data()!;
    const parts: string[] = [];
    if (data.title) parts.push(`Title: ${data.title}`);
    if (data.description) parts.push(`Description:\n${data.description}`);
    if (Array.isArray(data.tags) && data.tags.length) parts.push(`Tags: ${data.tags.join(', ')}`);
    if (data.budgetMusd) parts.push(`Budget: ${data.budgetMusd} MUSD`);
    if (data.fundingMode) parts.push(`Funding mode: ${data.fundingMode}`);
    return parts.length
      ? parts.join('\n\n')
      : `Job specification pointer: ${detailsURI}\n(Off-chain record exists but has no title or description.)`;
  } catch (err) {
    console.error(`resolveJobSpec failed for job ${jobId}:`, err);
    return `Job specification pointer: ${detailsURI}\n(Failed to read off-chain spec.)`;
  }
}

export async function reviewSubmission(
  jobId: string,
  submissionUrl: string,
): Promise<SubmissionReview> {
  const job = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: 'getJob',
    args: [BigInt(jobId)],
  });
  const [{ digest, isGithub, resolved, quality, contentBytes, note }, spec] = await Promise.all([
    buildSubmissionDigest(submissionUrl),
    resolveJobSpec(jobId, job.detailsURI),
  ]);
  const verdict = await getVerdict(spec, digest, 'submission');
  const meta: DigestMeta = { isGithub, resolved, quality, contentBytes, digestNote: note };
  await recordVerdict(jobId, 'submission', { ...verdict, submissionUrl, ...meta });
  return { jobId, submissionUrl, ...verdict, ...meta };
}

export async function arbitrateDispute(
  jobId: string,
  submissionUrl: string,
): Promise<DisputeArbitration> {
  const job = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: 'getJob',
    args: [BigInt(jobId)],
  });
  if (job.status !== Status.Disputed) {
    throw new Error(`job ${jobId} is not in the Disputed state (status ${job.status})`);
  }

  const [{ digest, isGithub, resolved, quality, contentBytes, note }, spec] = await Promise.all([
    buildSubmissionDigest(submissionUrl),
    resolveJobSpec(jobId, job.detailsURI),
  ]);
  const verdict = await getVerdict(spec, digest, 'dispute');
  const approve = verdict.recommendation === 'complete';
  const meta: DigestMeta = { isGithub, resolved, quality, contentBytes, digestNote: note };

  // Confidence floor — escalate to the admin queue instead of writing on-chain.
  if (verdict.confidence < env.arbiter.autoResolveMinConfidence) {
    await recordVerdict(jobId, 'dispute', {
      ...verdict,
      ...meta,
      approve,
      escalated: true,
      reason: 'confidence below auto-resolve threshold',
    });
    if (firebaseEnabled) {
      try {
        await getDb()
          .collection('appeals')
          .doc(jobId)
          .set(
            {
              jobId,
              openedByUid: 'ai-arbiter',
              openedByWallet: null,
              reason: `AI confidence ${verdict.confidence.toFixed(2)} below threshold ${env.arbiter.autoResolveMinConfidence}. Digest quality: ${quality} (${contentBytes} content bytes). ${note} AI rationale: ${verdict.rationale}`,
              status: 'open',
              createdAt: Date.now(),
            },
            { merge: true },
          );
      } catch (err) {
        console.error('Failed to escalate low-confidence verdict:', err);
      }
    }
    return { jobId, approve, ...verdict, ...meta, escalated: true, txHash: null };
  }

  const rationaleURI = `data:text/plain,${encodeURIComponent(verdict.rationale)}`;
  const txHash = await arbiterWallet.writeContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: 'resolveDispute',
    args: [BigInt(jobId), approve, rationaleURI],
  });
  await recordVerdict(jobId, 'dispute', { ...verdict, ...meta, approve, txHash });
  return { jobId, approve, ...verdict, ...meta, escalated: false, txHash };
}

/**
 * True if we've already produced a verdict of this layer for this job. Single-field
 * filter + in-memory check to avoid the Firestore composite-index requirement.
 */
export async function hasVerdict(
  jobId: string,
  layer: 'submission' | 'dispute',
): Promise<boolean> {
  if (!firebaseEnabled) return false;
  const snap = await getDb().collection('aiVerdicts').where('jobId', '==', jobId).get();
  return snap.docs.some((d) => d.data().layer === layer);
}
