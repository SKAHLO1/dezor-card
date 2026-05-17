'use client';

import { useCallback, useState } from 'react';
import {
  useReadContract,
  useReadContracts,
  useWriteContract,
  usePublicClient,
} from 'wagmi';
import {
  escrowAddress,
  satLockEscrowAbi,
  type OnchainJob,
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

export type TxStatus = 'idle' | 'signing' | 'confirming' | 'success' | 'error';

/**
 * Wraps a contract write + receipt wait into a single call with a tracked status,
 * so action buttons across the app behave consistently.
 */
export function useEscrowAction() {
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
        const hash = await writeContractAsync({
          address: escrowAddress as `0x${string}`,
          abi: satLockEscrowAbi,
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
    [writeContractAsync, publicClient],
  );

  const reset = () => {
    setStatus('idle');
    setError(null);
    setTxHash(null);
  };

  return { run, status, error, txHash, reset, busy: status === 'signing' || status === 'confirming' };
}
