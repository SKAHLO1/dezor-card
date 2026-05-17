'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { AppShell, Protected } from '@/components/AppShell';
import { Badge, Button, Card, Field, Input, Textarea, Skeleton, Spinner } from '@/components/ui';
import { Stars, RatingInput } from '@/components/Stars';
import { useAuth } from '@/components/AuthProvider';
import { useJob, useEscrowAction } from '@/lib/escrow';
import { JobStatus, jobStatusLabel, jobStatusTone, FundingMode } from '@/lib/contracts';
import { api, type JobMeta, type AiVerdict } from '@/lib/api';
import { musd, btc, shortAddr, timeLeft, explorerAddr, explorerTx, isZeroAddr } from '@/lib/format';

function JobDetail({ id }: { id: string }) {
  const { profile } = useAuth();
  const { address } = useAccount();
  const { job, refetch, isLoading } = useJob(id);
  const action = useEscrowAction();

  const [meta, setMeta] = useState<JobMeta | null>(null);
  const [verdicts, setVerdicts] = useState<AiVerdict[]>([]);
  const [submissionUrl, setSubmissionUrl] = useState('');
  const [reviewText, setReviewText] = useState('');
  const [rating, setRating] = useState(5);
  const [appealReason, setAppealReason] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Recovery panel state — used when the buyer owns the job on-chain but has no off-chain
  // metadata (typical of a job posted via a tx that succeeded after the sync step failed).
  const [recoverTitle, setRecoverTitle] = useState('');
  const [recoverDesc, setRecoverDesc] = useState('');
  const [recoverTags, setRecoverTags] = useState('');
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);

  const loadOffchain = useCallback(() => {
    api.get<JobMeta>(`/jobs/${id}`).then(setMeta).catch(() => setMeta(null));
    api.get<{ verdicts: AiVerdict[] }>(`/ai/verdicts/${id}`).then((r) => setVerdicts(r.verdicts)).catch(() => {});
  }, [id]);

  useEffect(loadOffchain, [loadOffchain]);

  const me = address?.toLowerCase();
  const isEmployer = !!me && job?.employer.toLowerCase() === me;
  const isFreelancer = !!me && job?.freelancer.toLowerCase() === me;
  const isParty = isEmployer || isFreelancer;
  const status = (job?.status ?? JobStatus.None) as JobStatus;
  const submissionReview = verdicts.find((v) => v.layer === 'submission');
  const disputeVerdict = verdicts.find((v) => v.layer === 'dispute');

  const refresh = () => {
    refetch();
    loadOffchain();
  };

  /* ---- actions ---- */
  const claim = async () => (await action.run('claimJob', [BigInt(id)])) && refresh();
  const unclaim = async () => (await action.run('unclaimJob', [BigInt(id)])) && refresh();

  const submitWork = async () => {
    if (!submissionUrl.trim()) return;
    const hash = await action.run('submitWork', [BigInt(id), submissionUrl.trim()]);
    if (!hash) return;
    await api.post(`/jobs/${id}/submission`, { submissionUrl: submissionUrl.trim() });
    setNotice('Work submitted. Running the AI review…');
    setAiBusy(true);
    try {
      await api.post('/ai/review-submission', { jobId: id, submissionUrl: submissionUrl.trim() });
    } catch (err) {
      setNotice(`AI review failed: ${(err as Error).message}`);
    }
    setAiBusy(false);
    refresh();
  };

  const runAiReview = async () => {
    const url = meta?.submissionUrl;
    if (!url) return;
    setAiBusy(true);
    setNotice(null);
    try {
      await api.post('/ai/review-submission', { jobId: id, submissionUrl: url });
      loadOffchain();
    } catch (err) {
      setNotice(`AI review failed: ${(err as Error).message}`);
    }
    setAiBusy(false);
  };

  const approveRelease = async () => {
    const hash = await action.run('approveAndRelease', [BigInt(id), rating]);
    if (!hash) return;
    try {
      await api.post('/reviews', {
        jobId: id,
        toWallet: job?.freelancer,
        rating,
        text: reviewText.trim(),
      });
    } catch {
      /* review text is best-effort; the on-chain rating is the source of truth */
    }
    refresh();
  };

  const dispute = async () => (await action.run('dispute', [BigInt(id)])) && refresh();

  const runArbitration = async () => {
    const url = meta?.submissionUrl;
    if (!url) {
      setNotice('No submission URL on file — cannot arbitrate.');
      return;
    }
    setAiBusy(true);
    setNotice('AI arbiter re-evaluating the dispute…');
    try {
      await api.post(`/ai/arbitrate/${id}`, { submissionUrl: url });
      setNotice(null);
    } catch (err) {
      setNotice(`Arbitration failed: ${(err as Error).message}`);
    }
    setAiBusy(false);
    refresh();
  };

  const appeal = async () => {
    const hash = await action.run('appeal', [BigInt(id)]);
    if (!hash) return;
    try {
      await api.post('/appeals', { jobId: id, reason: appealReason.trim() || 'No reason provided.' });
    } catch {
      /* best-effort */
    }
    refresh();
  };

  const finalize = async () => (await action.run('finalizeDispute', [BigInt(id)])) && refresh();
  const cancel = async () => (await action.run('cancelOpenJob', [BigInt(id)])) && refresh();
  const reclaim = async () => (await action.run('reclaimExpired', [BigInt(id)])) && refresh();

  const recoverMetadata = async () => {
    if (!job) return;
    setRecoverError(null);
    setRecoverBusy(true);
    try {
      await api.post('/jobs/sync', {
        onchainId: id,
        title: recoverTitle.trim(),
        description: recoverDesc.trim(),
        tags: recoverTags.split(',').map((t) => t.trim()).filter(Boolean),
        budgetMusd: undefined, // indexer is the source of truth for on-chain fields
        fundingMode: job.mode === FundingMode.BTC ? 'BTC' : 'MUSD',
        deadline: Number(job.deadline),
      });
      loadOffchain();
    } catch (err) {
      setRecoverError((err as Error).message);
    } finally {
      setRecoverBusy(false);
    }
  };

  if (isLoading || !job) {
    return (
      <AppShell>
        <Skeleton className="mb-4 h-8 w-2/3" />
        <Skeleton className="h-64" />
      </AppShell>
    );
  }

  if (status === JobStatus.None) {
    return (
      <AppShell>
        <Card>
          <p className="font-semibold">Job #{id} not found</p>
          <p className="mt-1 text-sm text-muted">No on-chain job exists with that id.</p>
        </Card>
      </AppShell>
    );
  }

  const appealOpen = Number(job.appealDeadline) * 1000 > Date.now();

  return (
    <AppShell>
      {/* header */}
      <div className="mb-1 flex items-center gap-3">
        <span className="text-sm text-faint">Job #{id}</span>
        <Badge tone={jobStatusTone[status]}>{jobStatusLabel[status]}</Badge>
        {job.mode === FundingMode.BTC && <Badge tone="accent">BTC-backed</Badge>}
      </div>
      <h1 className="font-display text-2xl font-bold">{meta?.title ?? 'Untitled job'}</h1>

      {/* facts */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-faint">Escrow</p>
          <p className="mt-1 font-semibold">{musd(job.amount)}</p>
          {job.mode === FundingMode.BTC && (
            <p className="text-xs text-muted">{btc(job.btcCollateral)} collateral</p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-faint">Deadline</p>
          <p className="mt-1 font-semibold">{timeLeft(job.deadline)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-faint">Developer</p>
          <p className="mt-1 font-semibold">
            {isZeroAddr(job.freelancer) ? (
              'Unclaimed'
            ) : (
              <Link href={`/profile/${job.freelancer}`} className="text-accent-soft hover:underline">
                {shortAddr(job.freelancer)}
              </Link>
            )}
          </p>
        </Card>
      </div>

      {/* recovery — buyer owns the job on-chain but no metadata was saved off-chain */}
      {isEmployer && !meta?.title && (
        <Card className="mt-4 border-warning/40 bg-warning/5">
          <p className="font-semibold">Finish setting up this job</p>
          <p className="mt-1 text-sm text-muted">
            Your funds are locked on-chain (Job #{id}), but no public title or description was saved.
            Developers won&apos;t see this job in the feed until you add them — no new transaction needed.
          </p>
          <div className="mt-3 space-y-3">
            <Field label="Title">
              <Input
                value={recoverTitle}
                onChange={(e) => setRecoverTitle(e.target.value)}
                placeholder="e.g. Build a Next.js landing page"
              />
            </Field>
            <Field label="Description">
              <Textarea
                rows={4}
                value={recoverDesc}
                onChange={(e) => setRecoverDesc(e.target.value)}
                placeholder="Scope, acceptance criteria, links…"
              />
            </Field>
            <Field label="Tags" hint="Comma-separated.">
              <Input
                value={recoverTags}
                onChange={(e) => setRecoverTags(e.target.value)}
                placeholder="react, frontend, design"
              />
            </Field>
            {recoverError && (
              <p className="rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-sm text-danger">
                {recoverError}
              </p>
            )}
            <Button
              onClick={recoverMetadata}
              disabled={recoverBusy || recoverTitle.trim().length < 3}
              loading={recoverBusy}
            >
              Save job details
            </Button>
          </div>
        </Card>
      )}

      {/* description */}
      <Card className="mt-4">
        <p className="mb-2 text-xs uppercase tracking-wide text-faint">Brief</p>
        <p className="whitespace-pre-wrap text-sm text-muted">
          {meta?.description || 'No off-chain description was synced for this job.'}
        </p>
        {meta?.tags && meta.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {meta.tags.map((t) => (
              <span key={t} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
                {t}
              </span>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-faint">
          Posted by{' '}
          <a href={explorerAddr(job.employer)} target="_blank" className="hover:underline">
            {shortAddr(job.employer)}
          </a>
        </p>
      </Card>

      {/* submission */}
      {meta?.submissionUrl && (
        <Card className="mt-4">
          <p className="mb-1 text-xs uppercase tracking-wide text-faint">Deliverable</p>
          <a
            href={meta.submissionUrl}
            target="_blank"
            className="break-all text-sm text-accent-2 hover:underline"
          >
            {meta.submissionUrl}
          </a>
        </Card>
      )}

      {/* AI verdict panel */}
      {(submissionReview || disputeVerdict || aiBusy) && (
        <Card className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-faint">AI review</p>
            {aiBusy && <Spinner />}
          </div>
          {disputeVerdict && <VerdictBlock label="Dispute arbitration" v={disputeVerdict} />}
          {submissionReview && <VerdictBlock label="Submission review" v={submissionReview} />}
          {!submissionReview && !disputeVerdict && aiBusy && (
            <p className="text-sm text-muted">Gemini is scanning the deliverable…</p>
          )}
        </Card>
      )}

      {/* role-gated actions */}
      <div className="mt-4 space-y-4">
        {/* OPEN */}
        {status === JobStatus.Open && (
          <Card>
            {isEmployer ? (
              <ActionRow
                title="This job is open"
                body="No developer has claimed it yet. You can cancel and reclaim your escrow."
                action={<Button variant="danger" onClick={cancel} loading={action.busy}>Cancel & refund</Button>}
              />
            ) : profile?.role === 'developer' ? (
              <ActionRow
                title="Claim this job"
                body="Take the job, build the deliverable, and submit it for review."
                action={<Button onClick={claim} loading={action.busy}>Claim job</Button>}
              />
            ) : (
              <p className="text-sm text-muted">This job is open for developers to claim.</p>
            )}
          </Card>
        )}

        {/* CLAIMED */}
        {status === JobStatus.Claimed && isFreelancer && (
          <Card className="space-y-3">
            <p className="font-semibold">Submit your deliverable</p>
            <Field label="GitHub link or deliverable URL">
              <Input
                value={submissionUrl}
                onChange={(e) => setSubmissionUrl(e.target.value)}
                placeholder="https://github.com/you/project"
              />
            </Field>
            <div className="flex gap-2">
              <Button onClick={submitWork} disabled={!submissionUrl.trim()} loading={action.busy}>
                Submit work
              </Button>
              <Button variant="ghost" onClick={unclaim} loading={action.busy}>
                Abandon job
              </Button>
            </div>
          </Card>
        )}
        {status === JobStatus.Claimed && !isFreelancer && (
          <Card>
            <p className="text-sm text-muted">
              {isEmployer
                ? 'A developer is working on this job. You’ll be able to review once they submit.'
                : 'This job has been claimed and is in progress.'}
            </p>
            {isEmployer && timeLeft(job.deadline) === 'expired' && (
              <Button variant="danger" className="mt-3" onClick={reclaim} loading={action.busy}>
                Deadline passed — reclaim escrow
              </Button>
            )}
          </Card>
        )}

        {/* SUBMITTED */}
        {status === JobStatus.Submitted && isEmployer && (
          <Card className="space-y-4">
            <div>
              <p className="font-semibold">Review the submission</p>
              <p className="text-sm text-muted">
                Run the AI review for a recommendation, then release payment or open a dispute.
              </p>
            </div>
            {!submissionReview && meta?.submissionUrl && (
              <Button variant="secondary" onClick={runAiReview} loading={aiBusy}>
                Run AI review
              </Button>
            )}
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-sm font-medium">Approve & release payment</p>
              <RatingInput value={rating} onChange={setRating} />
              <Textarea
                rows={3}
                className="mt-3"
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                placeholder="Leave a review for the developer…"
              />
              <div className="mt-3 flex gap-2">
                <Button onClick={approveRelease} loading={action.busy}>
                  Approve & pay {musd(job.amount)}
                </Button>
                <Button variant="danger" onClick={dispute} loading={action.busy}>
                  Dispute
                </Button>
              </div>
            </div>
          </Card>
        )}
        {status === JobStatus.Submitted && isFreelancer && (
          <Card>
            <ActionRow
              title="Waiting on the buyer"
              body="The buyer is reviewing your submission. If you believe it’s being held unfairly, you can open a dispute."
              action={<Button variant="danger" onClick={dispute} loading={action.busy}>Open dispute</Button>}
            />
          </Card>
        )}

        {/* DISPUTED */}
        {status === JobStatus.Disputed && (
          <Card>
            <ActionRow
              title="In AI arbitration"
              body="The dispute goes to the AI arbiter first. It re-evaluates the deliverable against the brief and records a verdict on-chain, opening a 3-day appeal window."
              action={
                isParty ? (
                  <Button onClick={runArbitration} loading={aiBusy}>
                    Run AI arbitration
                  </Button>
                ) : undefined
              }
            />
          </Card>
        )}

        {/* DISPUTE RESOLVED — appeal window */}
        {status === JobStatus.DisputeResolved && (
          <Card className="space-y-3">
            <p className="font-semibold">
              AI verdict: {job.aiVerdictApprove ? 'release to developer' : 'refund the buyer'}
            </p>
            <p className="text-sm text-muted">
              {appealOpen
                ? `Appeal window closes ${timeLeft(job.appealDeadline)}. Either party can escalate to the human admin, or anyone can finalize the verdict once the window passes.`
                : 'The appeal window has closed — the verdict can now be finalized by anyone.'}
            </p>
            {appealOpen && isParty && (
              <div>
                <Field label="Reason for appeal">
                  <Textarea
                    rows={2}
                    value={appealReason}
                    onChange={(e) => setAppealReason(e.target.value)}
                    placeholder="Why the AI verdict should be reviewed by the admin…"
                  />
                </Field>
                <div className="mt-2 flex gap-2">
                  <Button variant="danger" onClick={appeal} loading={action.busy}>
                    Appeal to admin
                  </Button>
                  {!appealOpen && (
                    <Button onClick={finalize} loading={action.busy}>
                      Finalize verdict
                    </Button>
                  )}
                </div>
              </div>
            )}
            {!appealOpen && (
              <Button onClick={finalize} loading={action.busy}>
                Finalize verdict
              </Button>
            )}
          </Card>
        )}

        {/* APPEALED */}
        {status === JobStatus.Appealed && (
          <Card>
            <p className="font-semibold">Escalated to the admin</p>
            <p className="mt-1 text-sm text-muted">
              A human admin is reviewing this dispute and will make the final, binding decision.
            </p>
          </Card>
        )}

        {/* TERMINAL */}
        {(status === JobStatus.Released ||
          status === JobStatus.Refunded ||
          status === JobStatus.Cancelled) && (
          <Card>
            <p className="font-semibold">
              {status === JobStatus.Released
                ? `Payment released to the developer${job.rating ? '' : ''}.`
                : status === JobStatus.Refunded
                  ? 'Escrow refunded to the buyer.'
                  : 'Job cancelled — escrow refunded to the buyer.'}
            </p>
            {status === JobStatus.Released && job.rating > 0 && (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted">
                Buyer rating: <Stars value={job.rating} />
              </div>
            )}
          </Card>
        )}

        {action.txHash && (
          <p className="text-xs text-faint">
            Last tx:{' '}
            <a href={explorerTx(action.txHash)} target="_blank" className="hover:underline">
              {shortAddr(action.txHash)}
            </a>
          </p>
        )}
        {(notice || action.error) && (
          <p className="text-sm text-muted">{action.error ? `Error: ${action.error}` : notice}</p>
        )}
      </div>
    </AppShell>
  );
}

function VerdictBlock({ label, v }: { label: string; v: AiVerdict }) {
  const good = v.recommendation === 'complete';
  const unreliable = v.quality === 'unreachable' || v.quality === 'empty' || (v.contentBytes ?? 0) === 0;
  return (
    <div className="mb-3 rounded-lg border border-border bg-bg-elevated p-3 last:mb-0">
      <div className="flex items-center justify-between">
        <span className="text-xs text-faint">{label}</span>
        <Badge tone={good ? 'success' : 'danger'}>
          {good ? 'Recommends complete' : 'Recommends incomplete'}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-muted">{v.rationale}</p>
      <p className="mt-1.5 text-xs text-faint">
        Confidence {Math.round((v.confidence ?? 0) * 100)}%
        {v.txHash && (
          <>
            {' · '}
            <a href={explorerTx(v.txHash)} target="_blank" className="hover:underline">
              on-chain verdict
            </a>
          </>
        )}
        {v.escalated && ' · escalated to admin'}
      </p>
      {(v.digestNote || v.quality) && (
        <div
          className={`mt-2 rounded-md border p-2 text-xs ${
            unreliable
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-border bg-surface-2 text-faint'
          }`}
        >
          <span className="font-medium">
            {unreliable ? 'Low-signal input — AI could not verify the deliverable: ' : 'AI input: '}
          </span>
          {v.digestNote ?? `quality: ${v.quality}`}
          {v.contentBytes !== undefined && ` (${v.contentBytes} chars analysed)`}
        </div>
      )}
    </div>
  );
}

function ActionRow({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="max-w-md text-sm text-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Protected>
      <JobDetail id={id} />
    </Protected>
  );
}
