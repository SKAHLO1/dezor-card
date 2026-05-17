import { defineConfig } from 'vitest/config';

/**
 * Vitest config. We provide an inline empty PostCSS config so Vite doesn't autodiscover
 * the project's postcss.config.mjs, which uses Tailwind v4's array-of-strings plugin
 * format that Vite's generic PostCSS loader rejects (Tailwind v4 expects to be processed
 * by Next.js / its own pipeline, not Vite). Our unit tests don't import any styles,
 * so giving them no PostCSS plugins is lossless.
 */
export default defineConfig({
  css: {
    postcss: { plugins: [] },
  },
  test: {
    css: false,
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'components/**/*.test.ts'],
  },
});
