import { defineConfig } from 'vitest/config';

/**
 * Vitest config. We deliberately disable CSS processing so Vitest doesn't try to load
 * Tailwind v4's PostCSS plugin (the plugin uses a Tailwind-specific format that Vite's
 * generic PostCSS loader rejects). Our unit tests don't import any styles, so this is
 * lossless — Next.js still builds CSS normally via `next build`.
 */
export default defineConfig({
  test: {
    css: false,
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'components/**/*.test.ts'],
  },
});
