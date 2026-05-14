import express from 'express';
import cors from 'cors';
import { env } from './env';
import { arbiterAccount } from './chain';
import { firebaseEnabled } from './firebase';
import { aiRouter } from './routes/ai';
import { jobsRouter } from './routes/jobs';
import { usersRouter } from './routes/users';
import { reviewsRouter } from './routes/reviews';
import { appealsRouter } from './routes/appeals';

const app = express();

app.use(cors({ origin: env.frontendOrigin }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'satlock-backend',
    arbiterAddress: arbiterAccount.address,
    escrowAddress: env.mezo.escrowAddress,
    geminiConfigured: !!env.gemini.apiKey,
    firebaseConfigured: firebaseEnabled,
  });
});

app.use(aiRouter);
app.use(jobsRouter);
app.use(usersRouter);
app.use(reviewsRouter);
app.use(appealsRouter);

app.listen(env.port, () => {
  console.log(`SatLock backend on :${env.port}`);
  console.log(`  arbiter wallet: ${arbiterAccount.address}`);
  console.log(`  escrow:         ${env.mezo.escrowAddress}`);
  console.log(`  gemini:         ${env.gemini.apiKey ? 'configured' : 'NOT configured'}`);
  console.log(`  firebase:       ${firebaseEnabled ? 'configured' : 'NOT configured'}`);
});
