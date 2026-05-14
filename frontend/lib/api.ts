'use client';

import { auth } from '@/lib/firebase';
import { env } from '@/lib/env';

/**
 * Thin wrapper over the SatLock backend. Attaches the current Firebase ID token so the
 * backend can verify the caller and resolve their linked wallet.
 */

async function authHeader(): Promise<Record<string, string>> {
  const user = auth?.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { authorization: `Bearer ${token}` };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.backend.url}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(await authHeader()),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
};

/* ---- shared response shapes ---- */
export interface JobMeta {
  id: string;
  onchainId: string;
  title: string;
  description: string;
  tags: string[];
  budgetMusd: string | null;
  fundingMode: 'MUSD' | 'BTC';
  deadline: number | null;
  employerWallet: string | null;
  employerUid?: string;
  submissionUrl?: string;
  createdAt: number;
}

export interface UserProfile {
  id: string;
  uid: string;
  email: string | null;
  role: 'buyer' | 'developer';
  walletAddress: string;
  displayName: string;
  bio: string;
  skills: string[];
  avgRating: number;
  ratingCount: number;
  jobCount: number;
}

export interface Review {
  id: string;
  jobId: string;
  fromWallet: string | null;
  toWallet: string;
  rating: number;
  text: string;
  createdAt: number;
}

export interface AiVerdict {
  id?: string;
  jobId?: string;
  layer?: 'submission' | 'dispute';
  recommendation: 'complete' | 'incomplete';
  confidence: number;
  rationale: string;
  isGithub?: boolean;
  resolved?: boolean;
  approve?: boolean;
  txHash?: string;
  submissionUrl?: string;
  createdAt?: number;
}

export interface Appeal {
  id: string;
  jobId: string;
  openedByWallet: string | null;
  reason: string;
  status: 'open' | 'resolved';
  adminApprove?: boolean;
  adminNote?: string;
  createdAt: number;
}
