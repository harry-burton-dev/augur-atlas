import { defineConfig } from 'vitest/config';

// The tests share one Postgres schema, so their files run one after another.
// A test makes many round trips to Postgres, which on a busy CI runner can take
// longer than vitest's 5 seconds.
export default defineConfig({ test: { fileParallelism: false, testTimeout: 20_000, hookTimeout: 30_000 } });
