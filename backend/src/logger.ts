import pino from 'pino';
import pinoHttp from 'pino-http';

/**
 * Structured logger. Pretty-prints in dev (NODE_ENV !== 'production'), JSON in prod so
 * log aggregators can parse it. Use `logger.child({ scope: 'indexer' })` etc. to tag.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  ...(process.env.NODE_ENV !== 'production'
    ? {
        transport: {
          target: 'pino/file',
          options: { destination: 1 }, // stdout — falls back gracefully if pino-pretty isn't installed
        },
      }
    : {}),
});

export const httpLogger = pinoHttp({
  logger,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({ method: req.method, url: req.url, uid: (req as { uid?: string }).uid }),
  },
});
