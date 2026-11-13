'use client';

import { useCallback, useState } from 'react';
import {
  useReadContract,
  useReadContracts,
  useWriteContract,
  usePublicClient,
} from 'wagmi';
import type { Abi } from 'viem';
import {
  escrowAddress,
  satLockEscrowAbi,
  borrowerOpsAbi,
  collSurplusPoolAbi,
  mezo,
  type OnchainJob,
  type OnchainTrove,
} from '@/lib/contracts';
import { isEscrowConfigured } from '@/lib/env';

const escrow = { address: escrowAddress as `0x${string}`, abi: satLockEscrowAbi } as const;

/** Total jobs ever posted (also the next id). */
export function useJobCount() {
  const { data, refetch, isLoading } = useReadContract({
    ...escrow,
    functionName: 'nextJobId',
    query: { enabled: isEscrowConfigured() },
  });
  return { count: data ? Number(data) : 0, refetch, isLoading };
}

/** A single on-chain job. */
export function useJob(id?: number | string) {
  const enabled = isEscrowConfigured() && id !== undefined && id !== '';
  const { data, refetch, isLoading } = useReadContract({
    ...escrow,
    functionName: 'getJob',
    args: enabled ? [BigInt(id!)] : undefined,
    query: { enabled },
  });
  return { job: data as unknown as OnchainJob | undefined, refetch, isLoading };
}

/** A batch of on-chain jobs by id — used to enrich the marketplace feed. */
export function useJobs(ids: (number | string)[]) {
  const enabled = isEscrowConfigured() && ids.length > 0;
  const { data, refetch, isLoading } = useReadContracts({
    contracts: ids.map((id) => ({ ...escrow, functionName: 'getJob', args: [BigInt(id)] })),
    query: { enabled },
  });
  const jobs = new Map<string, OnchainJob>();
  data?.forEach((r, i) => {
    if (r.status === 'success') jobs.set(String(ids[i]), r.result as unknown as OnchainJob);
  });
  return { jobs, refetch, isLoading };
}

const ZERO = '0x0000000000000000000000000000000000000000' as const;

/** An employer's trove: their TroveVault plus live TroveManager + PriceFeed reads. */
export function useTrove(employer?: `0x${string}`) {
  const enabled = isEscrowConfigured() && !!employer;
  const { data, refetch, isLoading } = useReadContract({
    ...escrow,
    functionName: 'getTrove',
    args: enabled ? [employer!] : undefined,
    query: { enabled, refetchInterval: 30_000 },
  });
  return { trove: data as unknown as OnchainTrove | undefined, refetch, isLoading };
}

/** Live BTC/USD from Mezo's PriceFeed (number of USD). `null` while loading or if the oracle is stale. */
export function useBtcPrice() {
  const { trove } = useTrove(ZERO);
  const price = trove?.price ? Number(trove.price) / 1e18 : null;
  return { price, raw: trove?.price };
}

/** Mezo protocol parameters read from BorrowerOperations (min net debt, borrowing fee rate). */
export function useMezoParams() {
  const { data } = useReadContracts({
    contracts: [
      { address: mezo.borrowerOperations, abi: borrowerOpsAbi, functionName: 'minNetDebt' },
      { address: mezo.borrowerOperations, abi: borrowerOpsAbi, functionName: 'getBorrowingFee', args: [10n ** 18n] },
    ],
  });
  const minNetDebt = data?.[0].status === 'success' ? Number(data[0].result) / 1e18 : null;
  const feeRate = data?.[1].status === 'success' ? Number(data[1].result) / 1e18 : null;
  return { minNetDebt, feeRate };
}

/** BTC claimable from Mezo's CollSurplusPool after a liquidation or redemption. */
export function useClaimableCollateral(vault?: `0x${string}`) {
  const enabled = !!vault && vault !== ZERO;
  const { data, refetch } = useReadContract({
    address: mezo.collSurplusPool,
    abi: collSurplusPoolAbi,
    functionName: 'getCollateral',
    args: enabled ? [vault!] : undefined,
    query: { enabled },
  });
  return { claimable: (data as bigint | undefined) ?? 0n, refetch };
}

export type TxStatus = 'idle' | 'signing' | 'confirming' | 'success' | 'error';

/**
 * Wraps a contract write + receipt wait into a single call with a tracked status,
 * so action buttons across the app behave consistently.
 */
export function useEscrowAction() {
  return useContractAction(escrowAddress as `0x${string}`, satLockEscrowAbi);
}

/** Same as useEscrowAction, for any contract (e.g. the employer's TroveVault). */
export function useContractAction(address: `0x${string}` | undefined, abi: Abi) {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [status, setStatus] = useState<TxStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const run = useCallback(
    async (
      functionName: string,
      args: readonly unknown[],
      opts?: { value?: bigint },
    ): Promise<`0x${string}` | null> => {
      setError(null);
      setStatus('signing');
      try {
        if (!address) throw new Error('No contract address');
        const hash = await writeContractAsync({
          address,
          abi,
          functionName: functionName as never,
          args: args as never,
          value: opts?.value,
        });
        setTxHash(hash);
        setStatus('confirming');
        const receipt = await publicClient?.waitForTransactionReceipt({ hash });
        // viem returns the receipt even when the tx reverted — treat that as a failure
        // so callers don't proceed with off-chain side-effects after an on-chain revert.
        if (receipt && receipt.status !== 'success') {
          setError('Transaction reverted on-chain. Check the explorer or MetaMask Activity for the reason.');
          setStatus('error');
          return null;
        }
        setStatus('success');
        return hash;
      } catch (err) {
        setError((err as Error).message.split('\n')[0]);
        setStatus('error');
        return null;
      }
    },
    [writeContractAsync, publicClient, address, abi],
  );

  const reset = () => {
    setStatus('idle');
    setError(null);
    setTxHash(null);
  };

  return { run, status, error, txHash, reset, busy: status === 'signing' || status === 'confirming' };
}
