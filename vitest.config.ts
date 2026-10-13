import { defineConfig } from 'vitest/config';

/** Domain, API and store tests run from the repository root in a node environment. */
export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
});
