'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useBalance, usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { AppShell, Protected } from '@/components/AppShell';
import { Button, Card, Field, Input, Textarea } from '@/components/ui';
import { useAuth } from '@/components/AuthProvider';
import { useEscrowAction, useJobCount, useTrove, useMezoParams } from '@/lib/escrow';
import { escrowAddress, musdAddress, erc20Abi, TroveStatus } from '@/lib/contracts';
import { isEscrowConfigured } from '@/lib/env';
import { api } from '@/lib/api';
import { quoteTrove } from '@/lib/mezo/trove';
import { explorerAddr, shortAddr } from '@/lib/format';

const ZERO = '0x0000000000000000000000000000000000000000' as const;

type Mode = 'MUSD' | 'BTC';

const CATEGORIES = [
  'Web Development',
  'Backend',
  'Mobile',
  'Smart Contracts',
  'Design',
  'Data & AI',
  'DevOps',
  'Other',
];

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
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [requirements, setRequirements] = useState('');
  const [budget, setBudget] = useState('500');
  const [btcCollateral, setBtcCollateral] = useState('0.05');
  const [days, setDays] = useState('14');
  const [step, setStep] = useState<string | null>(null);
  // If the on-chain post lands but the off-chain sync fails, we stash the id here so the
  // user can retry the sync without re-posting (and re-funding) the job.
  const [unsyncedId, setUnsyncedId] = useState<number | null>(null);

  // Live Mezo state: the employer's own trove (TroveManager), BTC price (PriceFeed), and
  // protocol parameters (BorrowerOperations). Nothing here is a hard-coded assumption.
  const { trove: myTrove } = useTrove(address);
  const { minNetDebt, feeRate } = useMezoParams();
  const btcPrice = myTrove?.price ? Number(myTrove.price) / 1e18 : null;
  const activeTrove = myTrove?.status === TroveStatus.Active;
  const liveReady = btcPrice !== null && minNetDebt !== null && feeRate !== null;

  const trove =
    mode === 'BTC' && liveReady
      ? quoteTrove({
          btcToAdd: Number(btcCollateral) || 0,
          musdToBorrow: Number(budget) || 0,
          btcPriceUsd: btcPrice!,
          minNetDebt: minNetDebt!,
          feeRate: feeRate!,
          existing: activeTrove
            ? { coll: Number(formatEther(myTrove!.coll)), debt: Number(formatEther(myTrove!.debt)) }
            : null,
        })
      : null;
  const troveOk =
    mode !== 'BTC' ||
    (!!trove && trove.health !== 'liquidation' && trove.clearsMinDebt && trove.warnings.every((w) => !w.includes('needs BTC')));

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
      const need = parseEther(btcCollateral && Number(btcCollateral) > 0 ? btcCollateral : '0');
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
          setStep(
            activeTrove
              ? 'Pooling this job into your trove (adjustTrove) & posting…'
              : 'Opening your trove, minting MUSD & posting…',
          );
          const hash = await action.run('postJobWithBTC', [amount, deadline, detailsURI, ZERO, ZERO], {
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
          category,
          requirements: requirements.split('\n').map((r) => r.trim()).filter(Boolean),
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
      <h1 className="font-display text-4xl font-bold tracking-tight">Post a job</h1>
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
        <Field
          label="Requirements"
          hint="One per line. The AI reviewer checks the deliverable against each of these and reports evidence."
        >
          <Textarea
            rows={4}
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            placeholder={'Responsive design (mobile + desktop)\nNext.js + TypeScript + Tailwind CSS\nFast performance (Lighthouse 90+)'}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tags" hint="Comma-separated.">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="react, frontend, design" />
          </Field>
        </div>

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
                    ? 'border-ink bg-accent text-ink'
                    : 'border-border-strong text-muted hover:border-ink'
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
              <Field
                label={activeTrove ? 'BTC to add to your trove' : 'BTC collateral to lock'}
                hint={
                  activeTrove
                    ? 'Optional — 0 borrows against the collateral already in your trove.'
                    : 'Opens your own Mezo trove, held by your personal TroveVault.'
                }
              >
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={btcCollateral}
                  onChange={(e) => setBtcCollateral(e.target.value)}
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

        {mode === 'BTC' && !liveReady && (
          <div className="rounded-lg border border-border bg-surface-2 p-3 text-sm text-muted">
            Reading your trove and the BTC price from Mezo…
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
            <p className="font-semibold">
              {trove.opens ? 'Opens your trove' : 'Pools into your trove with adjustTrove'}
              {myTrove?.vault && myTrove.vault !== ZERO && (
                <>
                  {' · '}
                  <a href={explorerAddr(myTrove.vault)} target="_blank" rel="noreferrer" className="underline">
                    vault {shortAddr(myTrove.vault)}
                  </a>
                </>
              )}
            </p>
            <p className="mt-1">
              BTC ${btcPrice!.toLocaleString(undefined, { maximumFractionDigits: 0 })} (Mezo PriceFeed) · after
              this job: {trove.newColl.toLocaleString(undefined, { maximumFractionDigits: 6 })} BTC /{' '}
              {trove.newDebt.toLocaleString(undefined, { maximumFractionDigits: 2 })} MUSD debt · ratio{' '}
              {Number.isFinite(trove.ratio) ? `${(trove.ratio * 100).toFixed(0)}%` : '∞'} · liquidation below $
              {Number.isFinite(trove.liquidationPrice)
                ? trove.liquidationPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })
                : '—'}
            </p>
            <p className="mt-1 text-xs">
              Debt includes the {trove.fee.toLocaleString(undefined, { maximumFractionDigits: 2 })} MUSD borrowing fee
              {trove.opens ? ' and the 200 MUSD gas compensation' : ''}. You can repay, top up, close the trove and
              reclaim your BTC from your dashboard.
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
