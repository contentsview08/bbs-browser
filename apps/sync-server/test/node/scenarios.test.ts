// 端末のエンジンの共通シナリオを、偽サーバーの代わりに本物のサーバーへ通す。同期の表の digest まで偽サーバーと同じになること
import { readFileSync } from 'node:fs'
import type { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runScenario, type Scenario } from '../../../../packages/sync/test/scenarioRunner'
import { MiniflareSyncServer, scenarioOverrides, startServer } from './server'

const url = (f: string) => new URL(`../../../../packages/conformance/${f}`, import.meta.url)
const scenarios: Scenario[] = [...JSON.parse(readFileSync(url('sync-client.json'), 'utf-8')), ...JSON.parse(readFileSync(url('sync-client-random.json'), 'utf-8'))]
const digests: Record<string, Record<string, string>> = JSON.parse(readFileSync(url('sync-client-digests.json'), 'utf-8'))

describe('sync-client.json を本物のサーバーへ', () => {
  let mf: Miniflare
  beforeAll(async () => {
    mf = await startServer()
    await mf.ready
  })
  afterAll(async () => {
    await mf.dispose()
  })

  it.each(scenarios)('$name', async (c) => {
    const got = await runScenario(c, (now, options) => new MiniflareSyncServer(mf, now, scenarioOverrides(options)))
    expect(got).toEqual(digests[c.name])
  })
})
