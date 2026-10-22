'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { AppShell, Protected } from '@/components/AppShell';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  CardTitle,
  CheckList,
  Countdown,
  Field,
  Input,
  Skeleton,
  Spinner,
  Stepper,
  Tag,
  Textarea,
  type StepItem,
} from '@/components/ui';
import { Stars, RatingInput } from '@/components/Stars';
import { useAuth } from '@/components/AuthProvider';
import { useJob, useEscrowAction } from '@/lib/escrow';
import { JobStatus, jobStatusLabel, jobStatusTone, FundingMode, escrowAddress } from '@/lib/contracts';
import { api, type JobMeta, type AiVerdict, type JobEvent } from '@/lib/api';
import { musd, btc, shortAddr, timeLeft, explorerAddr, explorerTx, isZeroAddr } from '@/lib/format';
import { DEFAULT_BTC_PRICE_USD } from '@/lib/mezo/trove';
import { formatEther } from 'viem';

const EVENT_LABEL: Record<string, string> = {
  JobPosted: 'Job posted & escrow funded',
  JobClaimed: 'Claimed by a developer',
  JobUnclaimed: 'Developer abandoned the job',
  WorkSubmitted: 'Work submitted',
  JobDisputed: 'Dispute opened',
  DisputeResolved: 'AI arbiter recorded a verdict',
  JobAppealed: 'Verdict appealed to admin',
  AdminResolved: 'Admin made the final decision',
  JobReleased: 'Payment released to developer',
  JobRefunded: 'Escrow refunded to buyer',
  JobCancelled: 'Job cancelled by buyer',
  ReviewLeft: 'Buyer left a review',
};

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function JobDetail({ id }: { id: string }) {
  const { profile } = useAuth();
  const { address } = useAccount();
  const { job, refetch, isLoading } = useJob(id);
  const action = useEscrowAction();

  const [meta, setMeta] = useState<JobMeta | null>(null);
  const [verdicts, setVerdicts] = useState<AiVerdict[]>([]);
  const [events, setEvents] = useState<JobEvent[]>([]);
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
    api.get<{ events: JobEvent[] }>(`/jobs/${id}/events`).then((r) => setEvents(r.events)).catch(() => {});
  }, [id]);

  useEffect(loadOffchain, [loadOffchain]);

  const me = address?.toLowerCase();
  const isEmployer = !!me && job?.employer.toLowerCase() === me;
  const isFreelancer = !!me && job?.freelancer.toLowerCase() === me;
  const isParty = isEmployer || isFreelancer;
  const status = (job?.status ?? JobStatus.None) as JobStatus;
  const submissionReview = verdicts.find((v) => v.layer === 'submission');
  const disputeVerdict = verdicts.find((v) => v.layer === 'dispute');
  const repo = submissionReview?.repo ?? disputeVerdict?.repo;

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

  /* ---- derived view state ---- */
  const hasFreelancer = job ? !isZeroAddr(job.freelancer) : false;
  const submitted =
    [JobStatus.Submitted, JobStatus.Disputed, JobStatus.DisputeResolved, JobStatus.Appealed, JobStatus.Released].includes(
      status,
    ) || (status === JobStatus.Refunded && !!meta?.submissionUrl);
  const settled = [JobStatus.Released, JobStatus.Refunded, JobStatus.Cancelled].includes(status);

  const steps: StepItem[] = useMemo(() => {
    const aiDone = !!submissionReview;
    return [
      { label: 'Funded', note: job?.mode === FundingMode.BTC ? 'BTC collateral' : 'MUSD escrow', state: 'done' },
      {
        label: 'In progress',
        note: hasFreelancer ? shortAddr(job?.freelancer) : status === JobStatus.Cancelled ? 'Cancelled' : 'Awaiting developer',
        state: hasFreelancer ? 'done' : status === JobStatus.Open ? 'active' : 'todo',
      },
      {
        label: 'Submitted',
        note: meta?.submittedAt ? fmtDate(meta.submittedAt) : undefined,
        state: submitted ? 'done' : status === JobStatus.Claimed ? 'active' : 'todo',
      },
      {
        label: 'AI verification',
        note: aiDone
          ? `${submissionReview!.recommendation === 'complete' ? 'Complete' : 'Incomplete'} · ${Math.round(
              (submissionReview!.confidence ?? 0) * 100,
            )}%`
          : aiBusy
            ? 'In progress'
            : undefined,
        state: aiDone ? 'done' : submitted || aiBusy ? 'active' : 'todo',
      },
      {
        label: 'Settlement',
        note:
          status === JobStatus.Released
            ? 'Paid'
            : status === JobStatus.Refunded
              ? 'Refunded'
              : status === JobStatus.Cancelled
                ? 'Cancelled'
                : status === JobStatus.DisputeResolved
                  ? 'Appeal window'
                  : status === JobStatus.Appealed
                    ? 'Admin review'
                    : status === JobStatus.Disputed
                      ? 'AI arbitration'
                      : undefined,
        state: settled
          ? 'done'
          : [JobStatus.Disputed, JobStatus.DisputeResolved, JobStatus.Appealed].includes(status)
            ? 'active'
            : 'todo',
      },
    ];
  }, [job, hasFreelancer, status, submitted, settled, submissionReview, aiBusy, meta?.submittedAt]);

  const timeline = useMemo(() => {
    const items: { at: number; label: string; tx?: string }[] = [];
    if (events.length > 0) {
      events.forEach((e) => items.push({ at: e.timestamp, label: EVENT_LABEL[e.name] ?? e.name, tx: e.txHash }));
    } else {
      if (meta?.createdAt) items.push({ at: meta.createdAt, label: EVENT_LABEL.JobPosted });
      if (job && Number(job.claimedAt) > 0) items.push({ at: Number(job.claimedAt) * 1000, label: EVENT_LABEL.JobClaimed });
      if (meta?.submittedAt) items.push({ at: meta.submittedAt, label: EVENT_LABEL.WorkSubmitted });
    }
    verdicts.forEach((v) => {
      if (v.createdAt)
        items.push({
          at: v.createdAt,
          label: v.layer === 'dispute' ? 'AI arbitration recorded' : 'AI verification completed',
          tx: v.txHash,
        });
    });
    return items.sort((a, b) => a.at - b.at);
  }, [events, verdicts, meta, job]);

  if (isLoading || !job) {
    return (
      <AppShell wide>
        <Skeleton className="mb-4 h-8 w-2/3" />
        <Skeleton className="h-64" />
      </AppShell>
    );
  }

  if (status === JobStatus.None) {
    return (
      <AppShell wide>
        <Card>
          <p className="font-semibold">Job #{id} not found</p>
          <p className="mt-1 text-sm text-muted">No on-chain job exists with that id.</p>
        </Card>
      </AppShell>
    );
  }

  const appealOpen = Number(job.appealDeadline) * 1000 > Date.now();
  const btcAmount = Number(formatEther(job.btcCollateral));
  const payoutEvent = [...events].reverse().find((e) => e.name === 'JobReleased' || e.name === 'JobRefunded');

  return (
    <AppShell wide>
      <Link href="/feed" className="text-xs text-muted hover:text-fg">
        ← Back to marketplace
      </Link>

      {/* header */}
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {meta?.category && <Badge tone="accent">{meta.category}</Badge>}
            <Badge tone={jobStatusTone[status]}>{jobStatusLabel[status]}</Badge>
            {job.mode === FundingMode.BTC && <Badge tone="ink">BTC-backed</Badge>}
            <span className="text-xs text-faint">Job #{id}</span>
          </div>
          <h1 className="font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {meta?.title ?? 'Untitled job'}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <a href={explorerAddr(job.employer)} target="_blank" className="flex items-center gap-1.5 hover:underline">
              <Avatar seed={job.employer} size={20} />
              {shortAddr(job.employer)}
            </a>
            {meta?.createdAt && <span>Posted {new Date(meta.createdAt).toLocaleDateString()}</span>}
            <span>
              Developer:{' '}
              {hasFreelancer ? (
                <Link href={`/profile/${job.freelancer}`} className="font-semibold text-fg hover:underline">
                  {shortAddr(job.freelancer)}
                </Link>
              ) : (
                'Unclaimed'
              )}
            </span>
          </div>
        </div>

        <div className="card flex flex-col justify-between gap-3 p-5">
          <div>
            <p className="eyebrow">
              {status === JobStatus.DisputeResolved
                ? 'Appeal window closes in'
                : settled
                  ? 'Final status'
                  : 'Time remaining'}
            </p>
            <p className="mt-1 font-display text-2xl font-bold">
              {settled ? (
                jobStatusLabel[status]
              ) : status === JobStatus.DisputeResolved ? (
                <Countdown to={job.appealDeadline} />
              ) : status === JobStatus.Submitted || status === JobStatus.Disputed || status === JobStatus.Appealed ? (
                'Under review'
              ) : (
                <Countdown to={job.deadline} />
              )}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {status === JobStatus.DisputeResolved
                ? 'Either party can appeal to the admin before it ends.'
                : `Deadline ${fmtDate(Number(job.deadline) * 1000)}`}
            </p>
          </div>
        </div>
      </div>

      {/* stepper */}
      <Card className="mt-6 overflow-x-auto">
        <div className="min-w-[34rem]">
          <Stepper steps={steps} />
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* main column */}
        <div className="space-y-6">
          {/* facts */}
          <div className="panel-ink grid gap-6 p-5 sm:grid-cols-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-bg/60">BTC collateral</p>
              <p className="mt-1 font-display text-2xl font-bold">
                {job.mode === FundingMode.BTC ? btc(job.btcCollateral) : 'MUSD-funded'}
              </p>
              <p className="mt-1 text-xs text-bg/60">
                {job.mode === FundingMode.BTC
                  ? `≈ $${(btcAmount * DEFAULT_BTC_PRICE_USD).toLocaleString(undefined, { maximumFractionDigits: 0 })} est.`
                  : 'No BTC locked for this job'}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-bg/60">MUSD escrow</p>
              <p className="mt-1 font-display text-2xl font-bold">{musd(job.amount)}</p>
              <p className="mt-1 text-xs text-bg/60">Locked in the escrow contract</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-bg/60">Deadline</p>
              <p className="mt-1 font-display text-2xl font-bold">{timeLeft(job.deadline)}</p>
              <p className="mt-1 text-xs text-bg/60">{fmtDate(Number(job.deadline) * 1000)}</p>
            </div>
          </div>

          {/* recovery — buyer owns the job on-chain but no metadata was saved off-chain */}
          {isEmployer && !meta?.title && (
            <Card className="border-warning/40 bg-warning/10">
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

          {/* brief + requirements */}
          <Card>
            <CardTitle>Brief</CardTitle>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
              {meta?.description || 'No off-chain description was synced for this job.'}
            </p>
            {meta?.requirements && meta.requirements.length > 0 && (
              <div className="mt-5">
                <p className="eyebrow mb-2">Requirements</p>
                <CheckList items={meta.requirements} />
              </div>
            )}
            {meta?.tags && meta.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {meta.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            )}
          </Card>

          {/* submission details */}
          {meta?.submissionUrl && (
            <Card>
              <CardTitle
                aside={
                  <a
                    href={repo?.url ?? meta.submissionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold hover:underline"
                  >
                    View on GitHub ↗
                  </a>
                }
              >
                Submission details
              </CardTitle>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="eyebrow">Repository / deliverable</dt>
                  <dd className="mt-1 break-all">
                    <a href={meta.submissionUrl} target="_blank" rel="noreferrer" className="font-medium underline">
                      {meta.submissionUrl}
                    </a>
                  </dd>
                </div>
                {repo && (
                  <>
                    <div>
                      <dt className="eyebrow">Branch</dt>
                      <dd className="mt-1 font-medium">{repo.branch}</dd>
                    </div>
                    {repo.commit && (
                      <div>
                        <dt className="eyebrow">Latest commit</dt>
                        <dd className="mt-1">
                          <a href={repo.commit.url} target="_blank" rel="noreferrer" className="font-mono text-xs font-semibold underline">
                            {repo.commit.sha.slice(0, 7)}
                          </a>{' '}
                          <span className="text-muted">· {repo.commit.date.slice(0, 10)}</span>
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{repo.commit.message}</p>
                        </dd>
                      </div>
                    )}
                  </>
                )}
                {meta.submittedAt && (
                  <div>
                    <dt className="eyebrow">Submitted</dt>
                    <dd className="mt-1 font-medium">{fmtDate(meta.submittedAt)}</dd>
                  </div>
                )}
              </dl>
            </Card>
          )}

          {/* AI verdict panel */}
          {(submissionReview || disputeVerdict || aiBusy) && (
            <Card>
              <CardTitle
                aside={
                  aiBusy ? (
                    <Spinner />
                  ) : (
                    <span className="rounded-full border border-border-strong px-2.5 py-0.5 text-[11px] text-muted">
                      Powered by Google Gemini
                    </span>
                  )
                }
              >
                AI verification results
              </CardTitle>
              {disputeVerdict && <VerdictBlock label="Dispute arbitration" v={disputeVerdict} />}
              {submissionReview && <VerdictBlock label="Submission review" v={submissionReview} />}
              {!submissionReview && !disputeVerdict && aiBusy && (
                <p className="text-sm text-muted">Gemini is scanning the deliverable…</p>
              )}
            </Card>
          )}

          {/* role-gated actions */}
          <div className="space-y-4">
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
                <p className="font-display text-lg font-bold">Submit your deliverable</p>
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
                  <p className="font-display text-lg font-bold">Review the submission</p>
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
                  <div className="mt-3 flex flex-wrap gap-2">
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
            {status === JobStatus.Submitted && !isParty && (
              <Card>
                <p className="text-sm text-muted">The buyer is reviewing this submission.</p>
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
              <div className="space-y-3">
                <Banner
                  tone="danger"
                  title={`AI verdict: ${job.aiVerdictApprove ? 'release to developer' : 'refund the buyer'}`}
                  action={
                    !appealOpen ? (
                      <Button onClick={finalize} loading={action.busy}>
                        Finalize verdict
                      </Button>
                    ) : undefined
                  }
                >
                  {appealOpen ? (
                    <>
                      You can request a human review if you disagree. Appeal window closes in{' '}
                      <strong className="text-fg">
                        <Countdown to={job.appealDeadline} />
                      </strong>
                      ; after that anyone can finalize the verdict.
                    </>
                  ) : (
                    'The appeal window has closed — the verdict can now be finalized by anyone.'
                  )}
                </Banner>
                {appealOpen && isParty && (
                  <Card>
                    <Field label="Reason for appeal">
                      <Textarea
                        rows={2}
                        value={appealReason}
                        onChange={(e) => setAppealReason(e.target.value)}
                        placeholder="Why the AI verdict should be reviewed by the admin…"
                      />
                    </Field>
                    <Button variant="danger" className="mt-3" onClick={appeal} loading={action.busy}>
                      Request appeal
                    </Button>
                  </Card>
                )}
              </div>
            )}

            {/* APPEALED */}
            {status === JobStatus.Appealed && (
              <Banner tone="warning" title="Escalated to the admin">
                A human admin is reviewing this dispute and will make the final, binding decision.
              </Banner>
            )}

            {/* TERMINAL */}
            {settled && (
              <Banner
                tone={status === JobStatus.Released ? 'success' : 'info'}
                title={
                  status === JobStatus.Released
                    ? 'Payment released to the developer.'
                    : status === JobStatus.Refunded
                      ? 'Escrow refunded to the buyer.'
                      : 'Job cancelled — escrow refunded to the buyer.'
                }
              >
                {status === JobStatus.Released && job.rating > 0 && (
                  <span className="flex items-center gap-2">
                    Buyer rating: <Stars value={job.rating} />
                  </span>
                )}
              </Banner>
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
        </div>

        {/* sidebar */}
        <aside className="space-y-6">
          <Card>
            <CardTitle>Timeline</CardTitle>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted">No activity recorded yet.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-border-strong pl-4">
                {timeline.map((t, i) => (
                  <li key={`${t.at}-${i}`} className="relative">
                    <span className="absolute -left-[1.4rem] top-1 h-2.5 w-2.5 rounded-full bg-ink ring-4 ring-surface" />
                    <p className="text-sm font-medium">{t.label}</p>
                    <p className="text-xs text-muted">
                      {fmtDate(t.at)}
                      {t.tx && (
                        <>
                          {' · '}
                          <a href={explorerTx(t.tx)} target="_blank" rel="noreferrer" className="underline">
                            tx
                          </a>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <CardTitle>Payout status</CardTitle>
            <p className="font-display text-2xl font-bold">{musd(job.amount)}</p>
            <p className="mt-1 text-sm text-muted">
              {status === JobStatus.Released
                ? `Paid to ${shortAddr(job.freelancer)}.`
                : status === JobStatus.Refunded
                  ? `Refunded to ${shortAddr(job.employer)}.`
                  : status === JobStatus.Cancelled
                    ? 'Returned to the buyer.'
                    : 'Held in escrow. Released when the buyer approves, or when a dispute settlement is final.'}
            </p>
            {payoutEvent && (
              <a href={explorerTx(payoutEvent.txHash)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold underline">
                View settlement tx ↗
              </a>
            )}
          </Card>

          {job.mode === FundingMode.BTC && (
            <Card>
              <CardTitle>Powered by Mezo</CardTitle>
              <p className="text-sm text-muted">
                The buyer locked BTC in a Mezo Trove and minted MUSD to fund this job — keeping their
                Bitcoin exposure while paying in a stable asset.
              </p>
            </Card>
          )}

          <Card>
            <CardTitle>Secure &amp; transparent</CardTitle>
            <p className="text-sm text-muted">
              Funds are held by the escrow smart contract and move only on a final settlement.
            </p>
            <a href={explorerAddr(escrowAddress)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold underline">
              View escrow contract ↗
            </a>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}

const CHECK_STYLE = {
  met: { label: 'Verified', tone: 'success' as const },
  partial: { label: 'Partial', tone: 'warning' as const },
  missing: { label: 'Missing', tone: 'danger' as const },
};

function VerdictBlock({ label, v }: { label: string; v: AiVerdict }) {
  const good = v.recommendation === 'complete';
  const unreliable = v.quality === 'unreachable' || v.quality === 'empty' || (v.contentBytes ?? 0) === 0;
  const pct = Math.round((v.confidence ?? 0) * 100);
  return (
    <div className="mb-4 rounded-xl border border-border bg-bg-elevated p-4 last:mb-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold text-white ${
              good ? 'bg-success' : 'bg-danger'
            }`}
          >
            {good ? '✓' : '✕'}
          </span>
          <div>
            <p className="eyebrow">{label}</p>
            <p className="font-display text-lg font-bold">
              {good ? 'Requirements satisfied' : 'Requirements not satisfied'}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="eyebrow">Confidence</p>
          <p className="font-display text-2xl font-bold">{pct}%</p>
        </div>
      </div>

      <p className="mt-3 text-sm text-muted">{v.rationale}</p>

      {v.checks && v.checks.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Requirement</th>
                <th className="px-3 py-2 font-semibold">Evidence</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {v.checks.map((c, i) => (
                <tr key={i} className="border-t border-border align-top">
                  <td className="px-3 py-2">{c.requirement}</td>
                  <td className="px-3 py-2 text-xs text-muted">{c.evidence}</td>
                  <td className="px-3 py-2">
                    <Badge tone={CHECK_STYLE[c.status].tone}>{CHECK_STYLE[c.status].label}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-faint">
        {v.txHash && (
          <>
            <a href={explorerTx(v.txHash)} target="_blank" className="underline">
              on-chain verdict
            </a>
            {' · '}
          </>
        )}
        {v.escalated && 'escalated to admin · '}
        AI advice only — the buyer decides.
      </p>

      {(v.digestNote || v.quality) && (
        <div
          className={`mt-2 rounded-md border p-2 text-xs ${
            unreliable
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-border bg-surface-2 text-muted'
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
        <p className="font-display text-lg font-bold">{title}</p>
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
