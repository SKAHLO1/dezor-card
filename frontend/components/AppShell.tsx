'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Nav } from '@/components/Nav';
import { Spinner } from '@/components/ui';
import { useAuth } from '@/components/AuthProvider';

/** Page chrome: sticky nav + a centered container. */
export function AppShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className={`mx-auto px-6 py-10 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>{children}</main>
    </div>
  );
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center text-muted">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

/**
 * Route guard. Redirects unauthenticated users to /login and (when `requireOnboarded`)
 * users without a backend profile to /onboarding. `mode="onboarding"` is the inverse —
 * used by the onboarding page itself to bounce already-onboarded users to the feed.
 */
export function Protected({
  children,
  requireOnboarded = true,
  mode = 'app',
}: {
  children: ReactNode;
  requireOnboarded?: boolean;
  mode?: 'app' | 'onboarding';
}) {
  const { loading, user, profile, firebaseReady } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseReady) return; // surfaced below as a config notice
    if (!user) {
      router.replace('/login');
      return;
    }
    if (mode === 'onboarding' && profile) {
      router.replace('/feed');
      return;
    }
    if (mode === 'app' && requireOnboarded && !profile) {
      router.replace('/onboarding');
    }
  }, [loading, user, profile, firebaseReady, mode, requireOnboarded, router]);

  if (!firebaseReady) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="card max-w-md p-6 text-center text-sm text-muted">
          Firebase is not configured. Set the <code>NEXT_PUBLIC_FIREBASE_*</code> variables in
          <code> .env.local</code> to enable authentication.
        </div>
      </div>
    );
  }
  if (loading) return <FullPageSpinner />;
  if (!user) return <FullPageSpinner />;
  if (mode === 'app' && requireOnboarded && !profile) return <FullPageSpinner />;
  if (mode === 'onboarding' && profile) return <FullPageSpinner />;

  return <>{children}</>;
}
