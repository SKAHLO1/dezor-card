'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { AppShell, Protected } from '@/components/AppShell';
import { Card, Button, Badge, Textarea, EmptyState, Skeleton } from '@/components/ui';
import { useAuth } from '@/components/AuthProvider';
import { useEscrowAction } from '@/lib/escrow';
import { api, type Appeal, type AiVerdict } from '@/lib/api';
import { env } from '@/lib/env';
import { shortAddr, explorerTx } from '@/lib/format';

function AdminConsole() {
  const { address } = useAccount();
  const action = useEscrowAction();
  const [appeals, setAppeals] = useState<Appeal[] | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, AiVerdict | undefined>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .get<{ appeals: Appeal[] }>('/appeals')
      .then(async (r) => {
        setAppeals(r.appeals);
        // pull the dispute verdict for each appealed job
        const entries = await Promise.all(
          r.appeals.map(async (a) => {
            try {
              const res = await api.get<{ verdicts: AiVerdict[] }>(`/ai/verdicts/${a.jobId}`);
              return [a.jobId, res.verdicts.find((v) => v.layer === 'dispute')] as const;
            } catch {
              return [a.jobId, undefined] as const;
            }
          }),
        );
        setVerdicts(Object.fromEntries(entries));
      })
      .catch((e) => {
        setError((e as Error).message);
        setAppeals([]);
      });
  };

  useEffect(load, []);

  const resolve = async (jobId: string, approve: boolean) => {
    const note = notes[jobId]?.trim() || (approve ? 'Admin: released to developer.' : 'Admin: refunded buyer.');
    const rationaleURI = `data:text/plain,${encodeURIComponent(note)}`;
    const hash = await action.run('adminResolve', [BigInt(jobId), approve, rationaleURI]);
    if (!hash) return;
    try {
      await api.post(`/admin/resolve/${jobId}`, { approve, note, txHash: hash });
    } catch {
      /* best-effort — the on-chain settlement is the source of truth */
    }
    load();
  };

  return (
    <AppShell wide>
      <h1 className="font-display text-2xl font-bold">Admin — appeal queue</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Disputes that were appealed past the AI verdict. Your decision settles the escrow on-chain
        and is final. Signed in as {shortAddr(address)}.
      </p>

      {error && (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {appeals === null ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : appeals.length === 0 ? (
        <EmptyState title="No open appeals" body="When a party appeals an AI verdict, it shows up here." />
      ) : (
        <div className="space-y-4">
          {appeals.map((a) => {
            const v = verdicts[a.jobId];
            return (
              <Card key={a.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <Link href={`/jobs/${a.jobId}`} className="font-semibold hover:underline">
                    Job #{a.jobId}
                  </Link>
                  <Badge tone="danger">Appealed</Badge>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-faint">Appeal reason</p>
                  <p className="text-sm text-muted">{a.reason}</p>
                  <p className="mt-1 text-xs text-faint">
                    opened by {shortAddr(a.openedByWallet ?? '')}
                  </p>
                </div>

                {v && (
                  <div className="rounded-lg border border-border bg-bg-elevated p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-faint">AI arbiter verdict</span>
                      <Badge tone={v.recommendation === 'complete' ? 'success' : 'danger'}>
                        {v.recommendation === 'complete' ? 'release' : 'refund'}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-sm text-muted">{v.rationale}</p>
                  </div>
                )}

                <Textarea
                  rows={2}
                  placeholder="Your written rationale (recorded on-chain)…"
                  value={notes[a.jobId] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [a.jobId]: e.target.value }))}
                />

                <div className="flex gap-2">
                  <Button onClick={() => resolve(a.jobId, true)} loading={action.busy}>
                    Release to developer
                  </Button>
                  <Button variant="danger" onClick={() => resolve(a.jobId, false)} loading={action.busy}>
                    Refund buyer
                  </Button>
                </div>
              </Card>
            );
          })}
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

function AdminGate() {
  const { profile } = useAuth();
  const isAdmin =
    !!env.admin.address && profile?.walletAddress?.toLowerCase() === env.admin.address;

  if (!isAdmin) {
    return (
      <AppShell>
        <Card>
          <p className="font-semibold">Admin access only</p>
          <p className="mt-1 text-sm text-muted">
            This console is restricted to the SatLock admin wallet.
          </p>
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
