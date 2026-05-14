import { formatEther } from 'viem';
import { env } from '@/lib/env';

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export const musd = (wei?: bigint) =>
  wei === undefined ? '—' : `${Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 2 })} MUSD`;

export const btc = (wei?: bigint) =>
  wei === undefined ? '—' : `${Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 6 })} BTC`;

export function timeLeft(deadlineSec?: bigint | number | null): string {
  if (!deadlineSec) return '—';
  const ms = Number(deadlineSec) * 1000 - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d left`;
  const hours = Math.floor(ms / 3_600_000);
  return `${hours}h left`;
}

export const explorerTx = (hash: string) => `${env.mezo.explorerUrl}/tx/${hash}`;
export const explorerAddr = (addr: string) => `${env.mezo.explorerUrl}/address/${addr}`;

export const isZeroAddr = (a?: string) => !a || /^0x0{40}$/i.test(a);
