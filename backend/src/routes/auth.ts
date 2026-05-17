import { Router } from 'express';
import { randomBytes } from 'crypto';
import { verifyMessage } from 'viem';
import { requireAuth, getDb, firebaseEnabled } from '../firebase';

export const authRouter = Router();

/**
 * Wallet-ownership proof. Before a user can attach a wallet to their profile, they must sign
 * a uid-scoped challenge with that wallet's private key. The /users route then re-verifies
 * the signature so the backend never trusts a client-supplied wallet address on its own.
 */

const NONCE_TTL_MS = 5 * 60_000;

export function challengeMessage(uid: string, wallet: string, nonce: string, issuedAt: number) {
  return [
    'TrustieWork: confirm wallet ownership.',
    '',
    `Account: ${uid}`,
    `Wallet:  ${wallet.toLowerCase()}`,
    `Nonce:   ${nonce}`,
    `Issued:  ${new Date(issuedAt).toISOString()}`,
  ].join('\n');
}

authRouter.post('/auth/wallet-challenge', requireAuth, async (req, res) => {
  if (!firebaseEnabled) {
    return res.status(503).json({ error: 'auth storage not configured (set FIREBASE_SERVICE_ACCOUNT)' });
  }
  const wallet = String(req.body?.walletAddress ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'a valid wallet address is required' });
  }
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = Date.now();
  const message = challengeMessage(req.uid!, wallet, nonce, issuedAt);

  try {
    await getDb()
      .collection('walletChallenges')
      .doc(req.uid!)
      .set({ wallet, nonce, issuedAt, expiresAt: issuedAt + NONCE_TTL_MS });
    return res.json({ message, nonce, issuedAt });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Verifies a (uid, wallet, signature) tuple against the most recent challenge issued for that
 * uid. Consumes the challenge on success so a signature can't be replayed. Returns the wallet
 * if valid; throws otherwise. Exposed for the /users route — not a public HTTP handler.
 */
export async function consumeWalletProof(
  uid: string,
  wallet: string,
  signature: string,
): Promise<string> {
  const w = wallet.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(w)) throw new Error('invalid wallet address');
  if (!/^0x[0-9a-f]+$/i.test(signature)) throw new Error('invalid signature');

  const ref = getDb().collection('walletChallenges').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('no wallet challenge issued — request one first');
  const data = snap.data() as { wallet: string; nonce: string; issuedAt: number; expiresAt: number };

  if (data.wallet !== w) throw new Error('challenge wallet does not match');
  if (Date.now() > data.expiresAt) throw new Error('challenge expired — request a new one');

  const message = challengeMessage(uid, w, data.nonce, data.issuedAt);
  const ok = await verifyMessage({
    address: w as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  });
  if (!ok) throw new Error('signature does not match wallet');

  await ref.delete();
  return w;
}
