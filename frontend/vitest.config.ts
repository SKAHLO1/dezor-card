import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Vitest config. Two things to worry about:
 *
 *  1. CSS — we provide an inline empty PostCSS config so Vite doesn't autodiscover the
 *     project's postcss.config.mjs (Tailwind v4's array-of-strings format is
 *     incompatible with Vite's generic PostCSS loader). Tests don't import styles, so
 *     this is lossless.
 *
 *  2. Path aliases — Next.js understands `@/*` from tsconfig.json paths automatically;
 *     Vitest doesn't. We declare it here so test files can `import { x } from '@/lib/foo'`
 *     the same way the app does.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  css: {
    postcss: { plugins: [] },
  },
  test: {
    css: false,
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'components/**/*.test.ts'],
  },
});
