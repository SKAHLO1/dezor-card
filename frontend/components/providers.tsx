'use client';

import { useState, type ReactNode } from 'react';
import { RainbowKitProvider, lightTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import '@rainbow-me/rainbowkit/styles.css';
import { wagmiConfig } from '@/lib/mezo/config';
import { mezoMatsnet } from '@/lib/mezo/chain';
import { AuthProvider } from '@/components/AuthProvider';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={mezoMatsnet}
          theme={lightTheme({
            accentColor: '#d5f43b',
            accentColorForeground: '#10120d',
            borderRadius: 'medium',
            overlayBlur: 'small',
          })}
        >
          <AuthProvider>{children}</AuthProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
