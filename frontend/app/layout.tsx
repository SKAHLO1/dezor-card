import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, Fraunces } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const display = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', axes: ['opsz'] });

export const metadata: Metadata = {
  title: 'TrustieWork — Trust the Work. Bank on Bitcoin.',
  description:
    'The first AI-verified developer marketplace on Bitcoin and Mezo. Lock BTC as collateral, fund jobs with MUSD, and pay developers only when work is verified.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
