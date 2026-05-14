import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { NextFunction, Request, Response } from 'express';
import { env } from './env';

/**
 * Firebase Admin: verifies client ID tokens and gives the backend a Firestore handle.
 * Optional in dev — if FIREBASE_SERVICE_ACCOUNT is unset, auth is bypassed with a dev
 * identity and Firestore-backed routes will report that storage is not configured.
 */

let app: App | null = null;
let firestore: Firestore | null = null;

if (env.firebase.serviceAccount) {
  try {
    const creds = JSON.parse(env.firebase.serviceAccount);
    app = getApps()[0] ?? initializeApp({ credential: cert(creds) });
    firestore = getFirestore(app);
  } catch (err) {
    console.error('Failed to initialize Firebase Admin — check FIREBASE_SERVICE_ACCOUNT:', err);
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

  try {
    const decoded = await getAuth(app).verifyIdToken(token);
    req.uid = decoded.uid;
    req.email = decoded.email;
    // The wallet address is stored on the user's Firestore profile; load it lazily.
    const snap = await getDb().collection('users').doc(decoded.uid).get();
    req.walletAddress = (snap.data()?.walletAddress as string | undefined)?.toLowerCase();
    next();
  } catch (err) {
    res.status(401).json({ error: `invalid token: ${(err as Error).message}` });
  }
}

/** Express middleware: requires the caller's linked wallet to match ADMIN_ADDRESS. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!env.admin.address) {
    return res.status(503).json({ error: 'admin address not configured' });
  }
  if (req.walletAddress !== env.admin.address) {
    return res.status(403).json({ error: 'admin only' });
  }
  next();
}
