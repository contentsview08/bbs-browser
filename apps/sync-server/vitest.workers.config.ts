// 本物の Worker と Durable Object を workerd の中で動かす
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    include: ['test/workers/**/*.test.ts'],
    testTimeout: 60_000,
    poolOptions: {
      workers: {
        // 同じ実体で要求を重ねると、テストの枠の包みが積もって遅くなり、スタックが尽きる。ファイルごとに分ける
        singleWorker: false,
        isolatedStorage: true,
        wrangler: { configPath: './wrangler.example.toml' },
        miniflare: {
          bindings: { POW_SECRET: 'test-pow-secret' },
        },
      },
    },
  },
})
