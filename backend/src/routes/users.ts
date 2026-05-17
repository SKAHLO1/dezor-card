import { Router } from 'express';
import { requireAuth, getDb, firebaseEnabled } from '../firebase';
import { consumeWalletProof } from './auth';

export const usersRouter = Router();

/**
 * User profiles. Created during onboarding — a Mezo wallet address is mandatory, which is
 * what gates the rest of the app. Developer reputation (avgRating) is recomputed from
 * on-chain-backed reviews stored in the `reviews` collection.
 */

/** Upsert the caller's own profile. Used by the onboarding flow. */
usersRouter.post('/users', requireAuth, async (req, res) => {
  if (!firebaseEnabled) {
    return res.status(503).json({ error: 'user storage not configured (set FIREBASE_SERVICE_ACCOUNT)' });
  }
  const { role, walletAddress, walletSignature, displayName, bio, skills } = req.body ?? {};
  if (role !== 'buyer' && role !== 'developer') {
    return res.status(400).json({ error: 'role must be "buyer" or "developer"' });
  }
  const wallet = String(walletAddress ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
    return res.status(400).json({ error: 'a valid Mezo wallet address is required' });
  }

  try {
    const ref = getDb().collection('users').doc(req.uid!);
    const existing = await ref.get();
    const existingWallet = (existing.data()?.walletAddress as string | undefined)?.toLowerCase();

    // If the caller is binding a wallet that isn't already on file, require a fresh signature
    // proving they control the private key. Existing wallets pass through unchanged.
    if (wallet !== existingWallet) {
      if (!walletSignature) {
        return res
          .status(400)
          .json({ error: 'walletSignature required — sign the /auth/wallet-challenge message first' });
      }
      try {
        await consumeWalletProof(req.uid!, wallet, String(walletSignature));
      } catch (err) {
        return res.status(401).json({ error: (err as Error).message });
      }
    }
    await ref.set(
      {
        uid: req.uid,
        email: req.email ?? existing.data()?.email ?? null,
        role,
        walletAddress: wallet,
        displayName: displayName ?? existing.data()?.displayName ?? '',
        bio: bio ?? existing.data()?.bio ?? '',
        skills: Array.isArray(skills) ? skills.slice(0, 20) : existing.data()?.skills ?? [],
        avgRating: existing.data()?.avgRating ?? 0,
        ratingCount: existing.data()?.ratingCount ?? 0,
        jobCount: existing.data()?.jobCount ?? 0,
        createdAt: existing.data()?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    const doc = await ref.get();
    return res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/** The caller's own profile (or 404 if they have not onboarded yet). */
usersRouter.get('/users/me', requireAuth, async (req, res) => {
  if (!firebaseEnabled) return res.status(404).json({ error: 'not found' });
  try {
    const doc = await getDb().collection('users').doc(req.uid!).get();
    if (!doc.exists) return res.status(404).json({ error: 'profile not found' });
    return res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

/** Public profile lookup by wallet address — powers developer profile pages. */
usersRouter.get('/users/:address', async (req, res) => {
  if (!firebaseEnabled) return res.status(404).json({ error: 'not found' });
  const wallet = req.params.address.toLowerCase();
  try {
    const db = getDb();
    const snap = await db.collection('users').where('walletAddress', '==', wallet).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: 'user not found' });
    const user = { id: snap.docs[0].id, ...snap.docs[0].data() };

    const reviewsSnap = await db.collection('reviews').where('toWallet', '==', wallet).get();
    const reviews = reviewsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
      .slice(0, 50);

    return res.json({ user, reviews });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});
