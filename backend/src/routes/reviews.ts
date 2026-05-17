import { Router } from 'express';
import { requireAuth, getDb, firebaseEnabled } from '../firebase';
import { escrowAbi, escrowAddress, publicClient, Status } from '../chain';

export const reviewsRouter = Router();

/**
 * Review text. The 1-5 rating is written on-chain by approveAndRelease(); this stores the
 * accompanying written review and keeps each developer's aggregate rating on their user
 * profile in sync. We re-read the chain to confirm the caller really is the employer of
 * a released job before accepting the review — clients cannot spam reviews.
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
    // Authorise against the chain — the caller's linked wallet must be the employer of a
    // released job that pays this freelancer. Belt-and-braces against spoofed reviews.
    const job = await publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: 'getJob',
      args: [BigInt(String(jobId))],
    });
    if (job.status !== Status.Released) {
      return res.status(409).json({ error: 'job is not in the Released state' });
    }
    if (job.employer.toLowerCase() !== req.walletAddress) {
      return res.status(403).json({ error: 'only the buyer can leave the review' });
    }
    if (job.freelancer.toLowerCase() !== wallet) {
      return res.status(400).json({ error: 'toWallet does not match the job freelancer' });
    }

    const db = getDb();
    // One review per (jobId, employer) — re-submitting overwrites the prior text.
    const reviewId = `${String(jobId)}_${req.walletAddress}`;
    await db.collection('reviews').doc(reviewId).set({
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
