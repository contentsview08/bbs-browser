// 本物の Worker と Durable Object を workerd の中で動かす
import { readFileSync } from 'node:fs'
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

const { key } = JSON.parse(readFileSync(new URL('../../packages/conformance/sync-ticket.json', import.meta.url), 'utf-8')) as { key: { kid: string; secret: string } }

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
          bindings: { POW_SECRET: 'test-pow-secret', TURNSTILE_SECRET: 'test-turnstile-secret', TURNSTILE_SITEKEY: 'test-sitekey', TICKET_KEYS: JSON.stringify({ [key.kid]: key.secret }), TICKET_KID: key.kid },
        },
      },
    },
  },
})
