'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useBalance, usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { AppShell, Protected } from '@/components/AppShell';
import { Button, Card, Field, Input, Textarea } from '@/components/ui';
import { useAuth } from '@/components/AuthProvider';
import { useEscrowAction, useJobCount } from '@/lib/escrow';
import { escrowAddress, musdAddress, erc20Abi } from '@/lib/contracts';
import { isEscrowConfigured } from '@/lib/env';
import { api } from '@/lib/api';
import { quoteTrove, DEFAULT_BTC_PRICE_USD } from '@/lib/mezo/trove';

type Mode = 'MUSD' | 'BTC';

function NewJob() {
  const router = useRouter();
  const { profile } = useAuth();
  const { address, isConnected } = useAccount();
  const { count } = useJobCount();
  const action = useEscrowAction();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  // Pre-flight balance checks — surface "you have no MUSD" / "not enough BTC" before the
  // user signs a tx that will revert and burn gas.
  const { data: musdBalance } = useReadContract({
    address: musdAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: btcBalance } = useBalance({ address });

  const [mode, setMode] = useState<Mode>('MUSD');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [budget, setBudget] = useState('500');
  const [btcCollateral, setBtcCollateral] = useState('0.05');
  const [btcPrice, setBtcPrice] = useState(String(DEFAULT_BTC_PRICE_USD));
  const [days, setDays] = useState('14');
  const [step, setStep] = useState<string | null>(null);
  // If the on-chain post lands but the off-chain sync fails, we stash the id here so the
  // user can retry the sync without re-posting (and re-funding) the job.
  const [unsyncedId, setUnsyncedId] = useState<number | null>(null);

  const trove =
    mode === 'BTC'
      ? quoteTrove(Number(btcCollateral) || 0, Number(budget) || 0, Number(btcPrice) || 0)
      : null;
  const troveOk = !trove || (trove.health !== 'liquidation' && trove.clearsMinDebt);

  // Funding-balance checks against the connected wallet.
  let balanceError: string | null = null;
  if (isConnected && Number(budget) > 0) {
    if (mode === 'MUSD') {
      const need = parseEther(budget || '0');
      const have = (musdBalance as bigint | undefined) ?? 0n;
      if (have < need) {
        balanceError = `You have ${formatEther(have)} MUSD but this job needs ${budget}. Either reduce the payout, or switch to "Lock BTC collateral" to mint MUSD against BTC in one step.`;
      }
    } else {
      const need = parseEther(btcCollateral || '0');
      const have = btcBalance?.value ?? 0n;
      if (have < need) {
        balanceError = `You have ${formatEther(have)} BTC but this job locks ${btcCollateral}. Top up from the matsnet faucet or lower the collateral.`;
      }
    }
  }

  const configured = isEscrowConfigured();
  const canSubmit =
    configured &&
    isConnected &&
    title.trim().length > 2 &&
    Number(budget) > 0 &&
    troveOk &&
    !balanceError;

  const submit = async () => {
    if (!canSubmit) return;
    action.reset();
    try {
      const onchainId = count; // nextJobId is assigned in order — this will be the new job's id
      const amount = parseEther(budget || '0');
      const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(days) * 86_400);
      const detailsURI = `satlock:job:${onchainId}`; // off-chain metadata keyed by id in Firestore

      if (unsyncedId === null) {
        // First-time post: do the on-chain calls.
        if (mode === 'MUSD') {
          setStep('Approving MUSD…');
          const approveHash = await writeContractAsync({
            address: musdAddress,
            abi: erc20Abi,
            functionName: 'approve',
            args: [escrowAddress as `0x${string}`, amount],
          });
          await publicClient?.waitForTransactionReceipt({ hash: approveHash });

          setStep('Posting job & locking MUSD…');
          const hash = await action.run('postJobWithMUSD', [amount, deadline, detailsURI]);
          if (!hash) return;
        } else {
          setStep('Locking BTC, minting MUSD & posting…');
          const hash = await action.run('postJobWithBTC', [amount, deadline, detailsURI], {
            value: parseEther(btcCollateral || '0'),
          });
          if (!hash) return;
        }
        // On-chain post landed. From here on, the funds are committed — if the metadata
        // sync below fails, the user can retry via the same form without re-posting.
        setUnsyncedId(onchainId);
      }

      const syncId = unsyncedId ?? onchainId;
      setStep('Saving job details…');
      try {
        await api.post('/jobs/sync', {
          onchainId: syncId,
          title: title.trim(),
          description: description.trim(),
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          budgetMusd: budget,
          fundingMode: mode,
          deadline: Number(deadline),
        });
        setUnsyncedId(null);
        router.replace(`/jobs/${syncId}`);
      } catch (syncErr) {
        // Funds are already on-chain. Surface the failure but keep the form usable so the
        // user can fix whatever broke (network blip, backend down) and hit submit again.
        setStep(
          `Job #${syncId} is live on-chain but saving its details failed: ${
            (syncErr as Error).message
          }. Click "Save job details" to retry — no new transaction will be sent.`,
        );
        throw syncErr;
      }
    } catch (err) {
      if (!step?.includes('live on-chain')) {
        setStep(`Error: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  };

  if (profile?.role !== 'buyer') {
    return (
      <AppShell>
        <Card>
          <p className="font-semibold">Only buyers can post jobs.</p>
          <p className="mt-1 text-sm text-muted">
            Your account is set up as a developer. Browse the feed to find work instead.
          </p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="font-display text-2xl font-bold">Post a job</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Funds lock in the TrustieWork escrow contract until the work is accepted or arbitrated.
      </p>

      {!configured && (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          Escrow contract address not set — set <code>NEXT_PUBLIC_ESCROW_ADDRESS</code>.
        </p>
      )}

      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Build a Next.js landing page" />
        </Field>
        <Field label="Description">
          <Textarea
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Scope, acceptance criteria, links, anything the developer (and the AI reviewer) needs."
          />
        </Field>
        <Field label="Tags" hint="Comma-separated.">
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="react, frontend, design" />
        </Field>

        {/* funding mode */}
        <div>
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-faint">
            Funding mode
          </span>
          <div className="flex gap-2">
            {(['MUSD', 'BTC'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${
                  mode === m
                    ? 'border-accent bg-accent/15 text-accent-soft'
                    : 'border-border text-muted hover:border-border-strong'
                }`}
              >
                {m === 'MUSD' ? 'Fund with MUSD' : 'Lock BTC collateral'}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-faint">
            {mode === 'MUSD'
              ? 'Deposit MUSD you already hold. Requires a one-time approval.'
              : 'Lock native BTC — TrustieWork mints MUSD against it via Mezo’s trove system, so your Bitcoin keeps working.'}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment to developer (MUSD)">
            <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>
          {mode === 'BTC' && (
            <>
              <Field label="BTC collateral to lock">
                <Input
                  type="number"
                  step="0.001"
                  value={btcCollateral}
                  onChange={(e) => setBtcCollateral(e.target.value)}
                />
              </Field>
              <Field label="BTC price assumption (USD)" hint="Used only for the trove health preview below.">
                <Input
                  type="number"
                  step="100"
                  value={btcPrice}
                  onChange={(e) => setBtcPrice(e.target.value)}
                />
              </Field>
            </>
          )}
          <Field label="Deadline (days from now)">
            <Input type="number" value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>

        {balanceError && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {balanceError}
          </div>
        )}

        {trove && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              trove.health === 'liquidation'
                ? 'border-danger/40 bg-danger/10 text-danger'
                : trove.health === 'tight'
                  ? 'border-warning/40 bg-warning/10 text-warning'
                  : 'border-border bg-surface-2 text-muted'
            }`}
          >
            <p className="font-semibold">Trove preview</p>
            <p className="mt-1">
              Collateral ratio:{' '}
              {Number.isFinite(trove.ratio) ? `${(trove.ratio * 100).toFixed(0)}%` : '∞'} ·
              collateral value: ${trove.collateralUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} ·
              max safe borrow: {trove.maxBorrowable.toLocaleString(undefined, { maximumFractionDigits: 0 })} MUSD
            </p>
            {trove.warnings.map((w) => (
              <p key={w} className="mt-1">{w}</p>
            ))}
          </div>
        )}

        <Button onClick={submit} disabled={!canSubmit || action.busy} loading={action.busy} className="w-full">
          {!isConnected
            ? 'Connect your wallet'
            : unsyncedId !== null
              ? `Save job details (Job #${unsyncedId} already on-chain)`
              : 'Post & fund job'}
        </Button>

        {(step || action.error) && (
          <p className="text-sm text-muted">{action.error ? `Error: ${action.error}` : step}</p>
        )}
      </div>
    </AppShell>
  );
}

export default function NewJobPage() {
  return (
    <Protected>
      <NewJob />
    </Protected>
  );
}
