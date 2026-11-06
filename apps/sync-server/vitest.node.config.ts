// sql.js は workerd の中で動かないので、端末のエンジンと CLI は Node から Miniflare のサーバーへ通す
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/node/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
