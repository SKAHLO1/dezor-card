import { defineChain } from 'viem';
import { env } from '@/lib/env';

export const mezoMatsnet = defineChain({
  id: env.mezo.chainId,
  name: 'Mezo Matsnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: {
    default: { http: [env.mezo.rpcUrl] },
  },
  blockExplorers: {
    default: { name: 'Mezo Explorer', url: env.mezo.explorerUrl },
  },
  testnet: true,
});

export const explorerTx = (hash: string) => `${env.mezo.explorerUrl}/tx/${hash}`;
export const explorerAddr = (addr: string) => `${env.mezo.explorerUrl}/address/${addr}`;
