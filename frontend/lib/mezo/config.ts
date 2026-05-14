'use client';

import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { env } from '@/lib/env';
import { mezoMatsnet } from '@/lib/mezo/chain';

// getDefaultConfig throws on an empty projectId. Fall back to a placeholder so the app
// builds without a configured WalletConnect ID — injected wallets (MetaMask) still work;
// WalletConnect itself needs the real ID from https://cloud.reown.com.
export const wagmiConfig = getDefaultConfig({
  appName: env.app.name,
  projectId: env.app.walletConnectId || 'satlock-placeholder-projectid',
  chains: [mezoMatsnet],
  ssr: true,
});
