import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false, restoreMocks: true, testTimeout: 15000, hookTimeout: 30000,
  },
});
