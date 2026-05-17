'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount, useSignMessage } from 'wagmi';
import { AppShell, Protected } from '@/components/AppShell';
import { Card, Button, Badge, Textarea, EmptyState, Skeleton } from '@/components/ui';
import { useAuth } from '@/components/AuthProvider';
import { useEscrowAction } from '@/lib/escrow';
import { adminProofMessage, api, type AdminProof, type AiVerdict } from '@/lib/api';
import { JobStatus, jobStatusLabel } from '@/lib/contracts';
import { env } from '@/lib/env';
import { shortAddr, explorerTx, musd, timeLeft } from '@/lib/format';

/**
 * Admin dispute console. Shows every on-chain job currently in a dispute state and the
 * right action per state. On-chain rules:
 *   - Disputed         -> waiting on AI arbitration. Admin may manually trigger it.
 *   - DisputeResolved  -> AI verdict landed, 3-day appeal window open. Read-only here —
 *                         only the parties can appeal or finalize.
 *   - Appealed         -> admin acts via adminResolve(). The contract only allows this
 *                         state to be settled by the admin's wallet.
 */

interface DisputeJob {
  id: string;
  onchain: {
    employer: string;
    freelancer: string;
    amount: string;
    btcCollateral: string;
    mode: number;
    status: number;
    deadline: number;
    appealDeadline: number;
    aiVerdictApprove: boolean;
    detailsURI: string;
  };
  meta: { title?: string; submissionUrl?: string } | null;
  verdicts: AiVerdict[];
  appeal: { reason?: string; status?: string; openedByWallet?: string | null } | null;
}

function AdminConsole() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const action = useEscrowAction();
  const [jobs, setJobs] = useState<DisputeJob[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [aiBusy, setAiBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<AdminProof | null>(null);
  const [signingProof, setSigningProof] = useState(false);

  const requestProof = useCallback(async (): Promise<AdminProof | null> => {
    setSigningProof(true);
    setError(null);
    try {
      const timestamp = Date.now();
      const signature = await signMessageAsync({ message: adminProofMessage(timestamp) });
      const p = { timestamp, signature };
      setProof(p);
      return p;
    } catch (e) {
      setError(
        `Admin sign-in cancelled. Click "Sign admin proof" to retry. (${(e as Error).message})`,
      );
      return null;
    } finally {
      setSigningProof(false);
    }
  }, [signMessageAsync]);

  const load = useCallback(
    async (currentProof?: AdminProof | null) => {
      setError(null);
      const p = currentProof ?? proof ?? (await requestProof());
      if (!p) return;
      try {
        const r = await api.get<{ jobs: DisputeJob[] }>('/admin/disputes', { adminProof: p });
        setJobs(
          r.jobs.sort((a, b) => {
            const order = (s: number) =>
              s === JobStatus.Appealed ? 0 : s === JobStatus.DisputeResolved ? 1 : 2;
            return order(a.onchain.status) - order(b.onchain.status);
          }),
        );
      } catch (e) {
        const msg = (e as Error).message;
        // Expired proof — wipe it so the next load() re-signs automatically.
        if (msg.includes('proof expired') || msg.includes('signature')) setProof(null);
        setError(msg);
        setJobs([]);
      }
    },
    [proof, requestProof],
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adminResolve = async (jobId: string, approve: boolean) => {
    const note = notes[jobId]?.trim() || (approve ? 'Admin: released to developer.' : 'Admin: refunded buyer.');
    const rationaleURI = `data:text/plain,${encodeURIComponent(note)}`;
    const hash = await action.run('adminResolve', [BigInt(jobId), approve, rationaleURI]);
    if (!hash) return;
    try {
      await api.post(`/admin/resolve/${jobId}`, { approve, note, txHash: hash }, { adminProof: proof });
    } catch {
      /* on-chain settlement is the source of truth */
    }
    load();
  };

  const forceArbitration = async (job: DisputeJob) => {
    const url = job.meta?.submissionUrl;
    if (!url) {
      setError(`Job #${job.id} has no submission URL on file. The AI can't arbitrate without one.`);
      return;
    }
    setAiBusy((b) => ({ ...b, [job.id]: true }));
    setError(null);
    try {
      // /ai/arbitrate isn't admin-gated — uses the normal Firebase token only.
      await api.post(`/ai/arbitrate/${job.id}`, { submissionUrl: url });
      load();
    } catch (e) {
      setError(`Arbitration failed for job #${job.id}: ${(e as Error).message}`);
    } finally {
      setAiBusy((b) => ({ ...b, [job.id]: false }));
    }
  };

  const groups = {
    [JobStatus.Appealed]: jobs?.filter((j) => j.onchain.status === JobStatus.Appealed) ?? [],
    [JobStatus.Disputed]: jobs?.filter((j) => j.onchain.status === JobStatus.Disputed) ?? [],
    [JobStatus.DisputeResolved]:
      jobs?.filter((j) => j.onchain.status === JobStatus.DisputeResolved) ?? [],
  };

  return (
    <AppShell wide>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Admin — dispute console</h1>
          <p className="mt-1 text-sm text-muted">
            Every on-chain job currently in a dispute state. Signed in as {shortAddr(address)} —{' '}
            {proof ? (
              <span className="text-success">admin proof valid for 1 hour</span>
            ) : (
              <span className="text-warning">admin proof not yet signed</span>
            )}
            .
          </p>
        </div>
        <div className="flex gap-2">
          {!proof && (
            <Button onClick={() => requestProof().then((p) => p && load(p))} loading={signingProof}>
              Sign admin proof
            </Button>
          )}
          <Button variant="ghost" onClick={() => load()}>Refresh</Button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {jobs === null ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No active disputes"
          body="When a job enters Disputed, DisputeResolved, or Appealed it appears here."
        />
      ) : (
        <div className="space-y-8">
          <Section
            title="Appealed — your action required"
            tone="danger"
            jobs={groups[JobStatus.Appealed]}
            empty="No appealed jobs."
            render={(j) => (
              <AppealedActions
                job={j}
                note={notes[j.id] ?? ''}
                setNote={(v) => setNotes((n) => ({ ...n, [j.id]: v }))}
                onResolve={(approve) => adminResolve(j.id, approve)}
                busy={action.busy}
              />
            )}
          />

          <Section
            title="Disputed — awaiting AI arbitration"
            tone="warning"
            jobs={groups[JobStatus.Disputed]}
            empty="No disputes waiting on the AI arbiter."
            render={(j) => (
              <Button
                variant="secondary"
                onClick={() => forceArbitration(j)}
                loading={!!aiBusy[j.id]}
                disabled={!j.meta?.submissionUrl}
              >
                {j.meta?.submissionUrl
                  ? 'Trigger AI arbitration'
                  : 'No submission URL — cannot arbitrate'}
              </Button>
            )}
          />

          <Section
            title="AI verdict — appeal window open"
            tone="neutral"
            jobs={groups[JobStatus.DisputeResolved]}
            empty="No jobs in the appeal window."
            render={(j) => (
              <p className="text-xs text-faint">
                AI verdict: <span className="font-semibold text-fg">{j.onchain.aiVerdictApprove ? 'release' : 'refund'}</span>.
                Appeal window closes {timeLeft(BigInt(j.onchain.appealDeadline))}. Either party may appeal;
                otherwise anyone can finalize the verdict after the window closes.
              </p>
            )}
          />
        </div>
      )}

      {action.txHash && (
        <p className="mt-4 text-xs text-faint">
          Last tx:{' '}
          <a href={explorerTx(action.txHash)} target="_blank" className="hover:underline">
            {shortAddr(action.txHash)}
          </a>
        </p>
      )}
      {action.error && <p className="mt-2 text-sm text-danger">{action.error}</p>}
    </AppShell>
  );
}

/* ---- presentation helpers ---- */

function Section({
  title,
  tone,
  jobs,
  empty,
  render,
}: {
  title: string;
  tone: 'danger' | 'warning' | 'neutral';
  jobs: DisputeJob[];
  empty: string;
  render: (job: DisputeJob) => React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
        <Badge tone={tone}>{jobs.length}</Badge>
        {title}
      </h2>
      {jobs.length === 0 ? (
        <p className="text-sm text-faint">{empty}</p>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <Card key={j.id} className="space-y-3">
              <JobHeader job={j} />
              <LatestVerdict verdicts={j.verdicts} />
              {render(j)}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function JobHeader({ job }: { job: DisputeJob }) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/jobs/${job.id}`} className="font-semibold hover:underline">
          {job.meta?.title ?? `Job #${job.id}`}
        </Link>
        <span className="text-xs text-faint">
          {jobStatusLabel[job.onchain.status as JobStatus]} · {musd(BigInt(job.onchain.amount))} ·
          buyer {shortAddr(job.onchain.employer)} · dev {shortAddr(job.onchain.freelancer)}
        </span>
      </div>
      {job.meta?.submissionUrl && (
        <p className="mt-1 truncate text-xs">
          deliverable:{' '}
          <a href={job.meta.submissionUrl} target="_blank" className="text-accent-2 hover:underline">
            {job.meta.submissionUrl}
          </a>
        </p>
      )}
      {job.appeal?.reason && (
        <p className="mt-1 text-xs text-muted">
          appeal reason: <span className="text-fg">{job.appeal.reason}</span>
        </p>
      )}
    </div>
  );
}

function LatestVerdict({ verdicts }: { verdicts: AiVerdict[] }) {
  const dispute = verdicts.find((v) => v.layer === 'dispute');
  const v = dispute ?? verdicts[0];
  if (!v) return null;
  const unreliable = v.quality === 'unreachable' || v.quality === 'empty' || (v.contentBytes ?? 0) === 0;
  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-faint">
          Latest AI verdict ({v.layer ?? '?'})
        </span>
        <Badge tone={v.recommendation === 'complete' ? 'success' : 'danger'}>
          {v.recommendation === 'complete' ? 'recommends release' : 'recommends refund'}
        </Badge>
      </div>
      <p className="mt-2 text-muted">{v.rationale}</p>
      <p className="mt-1 text-xs text-faint">
        confidence {Math.round((v.confidence ?? 0) * 100)}%
        {v.escalated && ' · escalated by confidence floor'}
        {v.txHash && (
          <>
            {' · '}
            <a href={explorerTx(v.txHash)} target="_blank" className="hover:underline">
              on-chain tx
            </a>
          </>
        )}
      </p>
      {unreliable && (
        <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          AI had low-signal input: {v.digestNote ?? `quality ${v.quality}`}
          {v.contentBytes !== undefined && ` (${v.contentBytes} chars analysed)`}
        </div>
      )}
    </div>
  );
}

function AppealedActions({
  job,
  note,
  setNote,
  onResolve,
  busy,
}: {
  job: DisputeJob;
  note: string;
  setNote: (v: string) => void;
  onResolve: (approve: boolean) => void;
  busy: boolean;
}) {
  return (
    <>
      <Textarea
        rows={2}
        placeholder="Your written rationale (recorded on-chain via the rationaleURI)…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button onClick={() => onResolve(true)} loading={busy}>
          Release to developer ({shortAddr(job.onchain.freelancer)})
        </Button>
        <Button variant="danger" onClick={() => onResolve(false)} loading={busy}>
          Refund buyer ({shortAddr(job.onchain.employer)})
        </Button>
      </div>
    </>
  );
}

function AdminGate() {
  const { address, isConnected } = useAccount();
  const connected = address?.toLowerCase();
  const expected = env.admin.address;
  const isAdmin = !!expected && !!connected && connected === expected;

  if (!isAdmin) {
    return (
      <AppShell>
        <Card>
          <p className="font-semibold">Admin access only</p>
          <p className="mt-1 text-sm text-muted">
            This console is gated to the contract owner — whoever deployed SatLockEscrow.
            Connect that wallet in MetaMask (top-right) to enter.
          </p>
          <div className="mt-4 space-y-1 rounded-lg border border-border bg-bg-elevated p-3 font-mono text-xs">
            <p>
              <span className="text-faint">expected (env.admin.address):</span>{' '}
              <span className={expected ? 'text-fg' : 'text-danger'}>
                {expected || '(unset — set NEXT_PUBLIC_ADMIN_ADDRESS in frontend/.env.local)'}
              </span>
            </p>
            <p>
              <span className="text-faint">connected wallet:</span>{' '}
              <span className={connected ? 'text-fg' : 'text-warning'}>
                {connected ?? (isConnected ? '(reading…)' : '(no wallet connected)')}
              </span>
            </p>
          </div>
        </Card>
      </AppShell>
    );
  }
  return <AdminConsole />;
}

export default function AdminPage() {
  return (
    <Protected>
      <AdminGate />
    </Protected>
  );
}
