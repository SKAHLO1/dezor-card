'use client';

import { useState } from 'react';
import { useAccount, useBalance, usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { Badge, Banner, Button, Card, CardTitle, Field, Input, Skeleton, type Tone } from '@/components/ui';
import { useTrove, useClaimableCollateral, useContractAction } from '@/lib/escrow';
import {
  erc20Abi,
  musdAddress,
  troveVaultAbi,
  TroveStatus,
  MUSD_GAS_COMPENSATION,
  MCR,
  CCR,
} from '@/lib/contracts';
import { explorerAddr, explorerTx, shortAddr } from '@/lib/format';

const ZERO = '0x0000000000000000000000000000000000000000' as const;

const STATUS: Record<number, { label: string; tone: Tone }> = {
  [TroveStatus.None]: { label: 'No trove', tone: 'neutral' },
  [TroveStatus.Active]: { label: 'Active', tone: 'success' },
  [TroveStatus.ClosedByOwner]: { label: 'Closed', tone: 'neutral' },
  [TroveStatus.ClosedByLiquidation]: { label: 'Liquidated', tone: 'danger' },
  [TroveStatus.ClosedByRedemption]: { label: 'Redeemed', tone: 'warning' },
};

/** Interest accrues between the read and the transaction; pull a little extra, the vault refunds it. */
const CLOSE_BUFFER_BPS = 50n; // 0.5%

const fmt = (n: number, max = 4) => n.toLocaleString(undefined, { maximumFractionDigits: max });
const num = (wei?: bigint) => (wei === undefined ? 0 : Number(formatEther(wei)));

type Op = 'add' | 'withdraw' | 'repay' | 'close' | 'claim';

/**
 * The employer's own Mezo trove, held by their TroveVault. Reads TroveManager + PriceFeed via the
 * escrow's getTrove() view and Mezo's CollSurplusPool; every action calls the vault, which talks to
 * BorrowerOperations and forwards returned BTC straight to the employer.
 */
export function TrovePanel() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { trove, refetch, isLoading } = useTrove(address);
  const vault = trove?.vault && trove.vault !== ZERO ? trove.vault : undefined;
  const { claimable, refetch: refetchClaimable } = useClaimableCollateral(vault);
  const vaultAction = useContractAction(vault, troveVaultAbi);
  const { data: musdBal, refetch: refetchMusd } = useReadContract({
    address: musdAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: btcBal, refetch: refetchBtc } = useBalance({ address });

  const [amount, setAmount] = useState<Record<'add' | 'withdraw' | 'repay', string>>({
    add: '',
    withdraw: '',
    repay: '',
  });
  const [busy, setBusy] = useState<Op | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string; tx?: string } | null>(null);

  if (!address) {
    return (
      <Card>
        <CardTitle>Your Mezo trove</CardTitle>
        <p className="text-sm text-muted">Connect your wallet to see your trove.</p>
      </Card>
    );
  }
  if (isLoading || !trove) {
    return <Skeleton className="h-56" />;
  }

  const active = trove.status === TroveStatus.Active;
  const price = num(trove.price);
  const coll = num(trove.coll);
  const debt = num(trove.debt);
  const icr = num(trove.icr);
  const liqPrice = coll > 0 ? (debt * MCR) / coll : 0;
  // closeTrove burns debt - 200 MUSD (Mezo burns the gas compensation from its gas pool).
  const closeNeed = trove.debt > MUSD_GAS_COMPENSATION ? trove.debt - MUSD_GAS_COMPENSATION : 0n;
  const closeCeiling = closeNeed + (closeNeed * CLOSE_BUFFER_BPS) / 10_000n;
  const musdBalance = (musdBal as bigint | undefined) ?? 0n;
  const status = STATUS[trove.status] ?? STATUS[TroveStatus.None];

  const refresh = () => {
    refetch();
    refetchClaimable();
    refetchMusd();
    refetchBtc();
  };

  async function approveMusd(spender: `0x${string}`, value: bigint) {
    const hash = await writeContractAsync({
      address: musdAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, value],
    });
    const receipt = await publicClient?.waitForTransactionReceipt({ hash });
    if (receipt && receipt.status !== 'success') throw new Error('MUSD approval reverted');
  }

  async function run(op: Op, fn: () => Promise<`0x${string}` | null>, success: string) {
    setBusy(op);
    setNotice(null);
    try {
      const hash = await fn();
      // A failed write returns null; its message is in vaultAction.error (rendered below).
      if (hash) {
        setNotice({ tone: 'success', text: success, tx: hash });
        if (op !== 'close' && op !== 'claim') setAmount((a) => ({ ...a, [op]: '' }));
      }
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message.split('\n')[0] });
    } finally {
      setBusy(null);
      refresh();
    }
  }

  const addBtc = () =>
    run(
      'add',
      () => vaultAction.run('addCollateral', [ZERO, ZERO], { value: parseEther(amount.add) }),
      `Added ${amount.add} BTC to your trove.`,
    );
  const withdrawBtc = () =>
    run(
      'withdraw',
      () => vaultAction.run('withdrawCollateral', [parseEther(amount.withdraw), ZERO, ZERO]),
      `${amount.withdraw} BTC returned to your wallet.`,
    );
  const repay = () =>
    run(
      'repay',
      async () => {
        const value = parseEther(amount.repay);
        await approveMusd(vault!, value);
        return vaultAction.run('repay', [value, ZERO, ZERO]);
      },
      `Repaid ${amount.repay} MUSD.`,
    );
  const close = () =>
    run(
      'close',
      async () => {
        await approveMusd(vault!, closeCeiling);
        return vaultAction.run('closeTrove', [closeCeiling]);
      },
      `Trove closed — ${fmt(coll, 6)} BTC returned to your wallet.`,
    );
  const claim = () =>
    run('claim', () => vaultAction.run('claimCollateral', []), `${fmt(num(claimable), 6)} BTC claimed.`);

  const icrTone =
    icr === 0 ? 'text-muted' : icr < MCR ? 'text-danger' : icr < CCR ? 'text-warning' : 'text-success';

  return (
    <Card>
      <CardTitle
        aside={
          <span className="flex items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            {vault && (
              <a href={explorerAddr(vault)} target="_blank" rel="noreferrer" className="text-xs underline">
                vault {shortAddr(vault)}
              </a>
            )}
          </span>
        }
      >
        Your Mezo trove
      </CardTitle>

      {!vault ? (
        <p className="text-sm text-muted">
          Post a job with <strong className="text-fg">Lock BTC collateral</strong> to open your own Mezo trove.
          It lives in a personal TroveVault: later BTC jobs pool into it, and you can repay, close it and take your
          BTC back at any time.
        </p>
      ) : (
        <>
          <div className="panel-ink grid gap-4 p-4 sm:grid-cols-4">
            <Metric label="Collateral" value={`${fmt(coll, 6)} BTC`} sub={price ? `≈ $${fmt(coll * price, 0)}` : undefined} />
            <Metric label="Debt" value={`${fmt(debt, 2)} MUSD`} sub="incl. fees, interest, 200 gas comp." />
            <Metric
              label="Collateral ratio"
              value={active && icr ? `${(icr * 100).toFixed(0)}%` : '—'}
              valueClass={icrTone}
              sub={`min ${Math.round(MCR * 100)}% · safe ${Math.round(CCR * 100)}%`}
            />
            <Metric
              label="BTC price"
              value={price ? `$${fmt(price, 0)}` : 'stale'}
              sub={active && liqPrice ? `liquidation < $${fmt(liqPrice, 0)}` : 'Mezo PriceFeed'}
            />
          </div>

          <p className="mt-3 text-xs text-muted">
            Wallet: {fmt(num(btcBal?.value), 6)} BTC · {fmt(num(musdBalance), 2)} MUSD. Refunded jobs return MUSD to
            you, which you can use to repay.
          </p>

          {claimable > 0n && (
            <div className="mt-4">
              <Banner
                tone="warning"
                title={`${fmt(num(claimable), 6)} BTC of surplus collateral is claimable`}
                action={
                  <Button onClick={claim} loading={busy === 'claim'}>
                    Claim collateral
                  </Button>
                }
              >
                Left over after a liquidation or redemption, held by Mezo&apos;s CollSurplusPool.
              </Banner>
            </div>
          )}

          {active && (
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <ActionBox title="Add BTC" hint="Raises your collateral ratio.">
                <Field label="BTC">
                  <Input type="number" min="0" step="0.001" value={amount.add} onChange={(e) => setAmount({ ...amount, add: e.target.value })} />
                </Field>
                <Button onClick={addBtc} disabled={!(Number(amount.add) > 0)} loading={busy === 'add'} variant="secondary">
                  Add collateral
                </Button>
              </ActionBox>
              <ActionBox title="Withdraw BTC" hint={`The trove must stay above ${Math.round(MCR * 100)}%.`}>
                <Field label="BTC">
                  <Input type="number" min="0" step="0.001" value={amount.withdraw} onChange={(e) => setAmount({ ...amount, withdraw: e.target.value })} />
                </Field>
                <Button onClick={withdrawBtc} disabled={!(Number(amount.withdraw) > 0)} loading={busy === 'withdraw'} variant="secondary">
                  Withdraw to wallet
                </Button>
              </ActionBox>
              <ActionBox title="Repay MUSD" hint="Debt must stay above Mezo's minimum unless you close.">
                <Field label="MUSD">
                  <Input type="number" min="0" step="1" value={amount.repay} onChange={(e) => setAmount({ ...amount, repay: e.target.value })} />
                </Field>
                <Button onClick={repay} disabled={!(Number(amount.repay) > 0)} loading={busy === 'repay'} variant="secondary">
                  Approve &amp; repay
                </Button>
              </ActionBox>
            </div>
          )}

          {active && (
            <div className="mt-4">
              <Banner
                tone="info"
                title={`Close trove: repay ${fmt(num(closeNeed), 2)} MUSD, get ${fmt(coll, 6)} BTC back`}
                action={
                  <Button onClick={close} disabled={musdBalance < closeCeiling} loading={busy === 'close'}>
                    Approve &amp; close
                  </Button>
                }
              >
                Mezo burns your debt minus the 200 MUSD gas compensation. Up to{' '}
                {fmt(num(closeCeiling), 2)} MUSD is approved to cover interest accrued until the transaction; the
                unused part is refunded.
                {musdBalance < closeCeiling && (
                  <span className="mt-1 block text-danger">
                    You need {fmt(num(closeCeiling - musdBalance), 2)} more MUSD in your wallet to close.
                  </span>
                )}
              </Banner>
            </div>
          )}

          {!notice && !busy && vaultAction.error && (
            <p className="mt-3 text-sm text-danger">{vaultAction.error}</p>
          )}
          {notice && (
            <p className={`mt-3 text-sm ${notice.tone === 'danger' ? 'text-danger' : 'text-success'}`}>
              {notice.text}
              {notice.tx && (
                <>
                  {' '}
                  <a href={explorerTx(notice.tx)} target="_blank" rel="noreferrer" className="underline">
                    View tx ↗
                  </a>
                </>
              )}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function Metric({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.12em] text-bg/60">{label}</p>
      <p className={`mt-1 font-display text-xl font-bold ${valueClass ?? ''}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-bg/60">{sub}</p>}
    </div>
  );
}

function ActionBox({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-bg-elevated p-3">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted">{hint}</p>
      {children}
    </div>
  );
}
