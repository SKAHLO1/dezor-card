import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from './env';
import { arbiterAccount } from './chain';
import { firebaseEnabled } from './firebase';
import { logger, httpLogger } from './logger';
import { aiRouter } from './routes/ai';
import { jobsRouter } from './routes/jobs';
import { usersRouter } from './routes/users';
import { reviewsRouter } from './routes/reviews';
import { appealsRouter } from './routes/appeals';
import { authRouter } from './routes/auth';

const app = express();

app.use(cors({ origin: env.frontendOrigin }));
app.use(express.json({ limit: '256kb' }));
app.use(httpLogger);

// Gemini-cost protection — rate-limit the AI routes per IP.
const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: env.rateLimit.aiPerMin,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many AI requests — try again in a minute' },
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'trustiework-backend',
    arbiterAddress: arbiterAccount.address,
    escrowAddress: env.mezo.escrowAddress,
    geminiConfigured: !!env.gemini.apiKey,
    firebaseConfigured: firebaseEnabled,
  });
});

app.use(authRouter);
app.use('/ai', aiLimiter);
app.use(aiRouter);
app.use(jobsRouter);
app.use(usersRouter);
app.use(reviewsRouter);
app.use(appealsRouter);

app.listen(env.port, () => {
  logger.info(
    {
      port: env.port,
      arbiter: arbiterAccount.address,
      escrow: env.mezo.escrowAddress,
      gemini: !!env.gemini.apiKey,
      firebase: firebaseEnabled,
    },
    'trustiework backend listening',
  );
});
