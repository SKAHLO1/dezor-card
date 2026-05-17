import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { NextFunction, Request, Response } from 'express';
import { verifyMessage } from 'viem';
import { env } from './env';

/**
 * Firebase Admin: verifies client ID tokens and gives the backend a Firestore handle.
 * Optional in dev — if no Firebase credentials are configured, auth is bypassed with a dev
 * identity and Firestore-backed routes will report that storage is not configured.
 *
 * Three accepted credential shapes, tried in order:
 *   1. FIREBASE_SERVICE_ACCOUNT_PATH  -> path to the downloaded JSON file (recommended).
 *   2. FIREBASE_SERVICE_ACCOUNT       -> raw JSON, single-line.
 *   3. FIREBASE_SERVICE_ACCOUNT       -> base64-encoded JSON (set FIREBASE_SERVICE_ACCOUNT_BASE64=1).
 */

function loadCredentials(): Record<string, unknown> | null {
  if (env.firebase.serviceAccountPath) {
    const p = resolve(env.firebase.serviceAccountPath);
    if (!existsSync(p)) {
      console.error(`Firebase: FIREBASE_SERVICE_ACCOUNT_PATH points at "${p}" but no file exists there.`);
      return null;
    }
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch (err) {
      console.error(`Firebase: failed to parse service-account file at ${p}:`, err);
      return null;
    }
  }
  if (env.firebase.serviceAccount) {
    const raw = env.firebase.serviceAccount;
    const decoded = env.firebase.serviceAccountBase64
      ? Buffer.from(raw, 'base64').toString('utf8')
      : raw;
    try {
      return JSON.parse(decoded);
    } catch (err) {
      console.error('Firebase: failed to parse FIREBASE_SERVICE_ACCOUNT as JSON:', err);
      return null;
    }
  }
  return null;
}

let app: App | null = null;
let firestore: Firestore | null = null;

const creds = loadCredentials();
if (creds) {
  try {
    app = getApps()[0] ?? initializeApp({ credential: cert(creds as Parameters<typeof cert>[0]) });
    firestore = getFirestore(app);
  } catch (err) {
    console.error('Failed to initialize Firebase Admin:', err);
  }
}

export const firebaseEnabled = !!firestore;

/** Firestore handle — throws a clear error if Firebase is not configured. */
export function getDb(): Firestore {
  if (!firestore) {
    throw new Error('Firebase is not configured on the backend (set FIREBASE_SERVICE_ACCOUNT).');
  }
  return firestore;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      uid?: string;
      walletAddress?: string;
      email?: string;
    }
  }
}

/**
 * Express middleware: verifies the `Authorization: Bearer <Firebase ID token>` header.
 * In dev (Firebase disabled) it accepts an `x-dev-uid` / `x-dev-wallet` header instead so
 * the rest of the stack stays testable without a Firebase project.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!app) {
    req.uid = (req.header('x-dev-uid') as string) || 'dev-user';
    req.walletAddress = (req.header('x-dev-wallet') as string)?.toLowerCase();
    return next();
  }

  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'missing bearer token' });

  // Verify the token FIRST — surface auth failures distinctly from Firestore failures.
  let decoded;
  try {
    decoded = await getAuth(app).verifyIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: `invalid token: ${(err as Error).message}` });
  }
  req.uid = decoded.uid;
  req.email = decoded.email;

  // The wallet address is stored on the user's Firestore profile; load it lazily.
  // A missing profile is fine (the user hasn't onboarded yet); a hard Firestore error is
  // a 500, not a 401 — the token is valid, the backend just can't reach Firestore.
  try {
    const snap = await getDb().collection('users').doc(decoded.uid).get();
    req.walletAddress = (snap.data()?.walletAddress as string | undefined)?.toLowerCase();
    next();
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error('Firestore read failed during auth middleware:', msg);
    res.status(500).json({
      error:
        msg.includes('NOT_FOUND') || msg.includes('does not exist')
          ? 'Firestore database does not exist for this Firebase project. Create it in the Firebase Console → Firestore Database → Create database.'
          : `firestore error: ${msg}`,
    });
  }
}

/** Build the canonical admin-proof message for a given timestamp. Frontend signs the same
 *  string; backend re-derives it and verifies against env.admin.address. */
export function adminProofMessage(timestamp: number): string {
  return `TrustieWork admin proof @ ${timestamp}`;
}

const ADMIN_PROOF_TTL_MS = 60 * 60 * 1000;

/**
 * Admin gate. Accepts either:
 *   1. The caller onboarded with the admin wallet — req.walletAddress matches env.admin.address.
 *   2. The caller presents a fresh signed proof from the admin wallet via headers:
 *        x-admin-timestamp: <ms>
 *        x-admin-signature: <signature over `TrustieWork admin proof @ <ms>`>
 *      The signature is verified against env.admin.address and must be < 1 hour old.
 *
 * Path #2 is what the /admin page uses — the connected wallet signs a one-off proof so
 * the user doesn't have to re-onboard as the admin to use the console.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!env.admin.address) {
    return res.status(503).json({ error: 'admin address not configured' });
  }

  // Path 1 — profile-based: works when the caller onboarded with the admin wallet itself.
  if (req.walletAddress && req.walletAddress === env.admin.address) return next();

  // Path 2 — per-session signed proof from the connected admin wallet.
  const ts = Number(req.header('x-admin-timestamp'));
  const sig = req.header('x-admin-signature');
  if (ts && sig) {
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > ADMIN_PROOF_TTL_MS) {
      return res.status(401).json({ error: 'admin proof expired — re-sign required' });
    }
    try {
      const ok = await verifyMessage({
        address: env.admin.address as `0x${string}`,
        message: adminProofMessage(ts),
        signature: sig as `0x${string}`,
      });
      if (ok) return next();
      return res.status(401).json({ error: 'admin signature does not match admin wallet' });
    } catch (err) {
      return res.status(401).json({ error: `admin signature invalid: ${(err as Error).message}` });
    }
  }

  return res.status(403).json({
    error:
      'admin only — connect the contract owner wallet and sign the admin proof, or onboard with that wallet',
  });
}
