import { Router } from 'express';
import { requireAuth, getDb, firebaseEnabled } from '../firebase';

export const reviewsRouter = Router();

/**
 * Review text. The 1-5 rating itself is written on-chain by approveAndRelease() for
 * trustless reputation; this stores the accompanying written review and keeps each
 * developer's aggregate rating on their user profile in sync.
 */
reviewsRouter.post('/reviews', requireAuth, async (req, res) => {
  if (!firebaseEnabled) {
    return res.status(503).json({ error: 'review storage not configured' });
  }
  const { jobId, toWallet, rating, text } = req.body ?? {};
  const r = Number(rating);
  if (jobId === undefined || !toWallet || !(r >= 1 && r <= 5)) {
    return res.status(400).json({ error: 'jobId, toWallet and a 1-5 rating are required' });
  }
  const wallet = String(toWallet).toLowerCase();

  try {
    const db = getDb();
    await db.collection('reviews').add({
      jobId: String(jobId),
      fromUid: req.uid,
      fromWallet: req.walletAddress ?? null,
      toWallet: wallet,
      rating: r,
      text: String(text ?? '').slice(0, 2000),
      createdAt: Date.now(),
    });

    // Recompute the developer's aggregate rating.
    const userSnap = await db.collection('users').where('walletAddress', '==', wallet).limit(1).get();
    if (!userSnap.empty) {
      const reviews = await db.collection('reviews').where('toWallet', '==', wallet).get();
      const ratings = reviews.docs.map((d) => Number(d.data().rating) || 0);
      const avg = ratings.reduce((a, b) => a + b, 0) / (ratings.length || 1);
      await userSnap.docs[0].ref.set(
        { avgRating: Number(avg.toFixed(2)), ratingCount: ratings.length, jobCount: ratings.length },
        { merge: true },
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});
