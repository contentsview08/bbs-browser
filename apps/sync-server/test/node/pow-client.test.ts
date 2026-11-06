// 端末の PoW の解き方がサーバーの検証を通ること。問題つきのサーバーへエンジンを通す
import { readFileSync } from 'node:fs'
import type { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkPowChallenge, powOk, solvePow } from '../../../../packages/sync/src/engine/pow'
import { runScenario, type Scenario } from '../../../../packages/sync/test/scenarioRunner'
import { issuePow, verifyPow } from '../../src/pow'
import { MiniflareSyncServer, scenarioOverrides, startServer } from './server'

const url = (f: string) => new URL(`../../../../packages/conformance/${f}`, import.meta.url)
const scenarios: Scenario[] = JSON.parse(readFileSync(url('sync-client.json'), 'utf-8'))

describe('端末の PoW', () => {
  it('解いた答えがサーバーの検証を通る', async () => {
    const id = 'a'.repeat(64)
    const c = await issuePow('s', id, 10, 1000_000, 300)
    const nonce = await solvePow(c, 10)
    expect(await verifyPow('s', id, 10, 1000_000, c, nonce)).toBe(true)
  })
  it('サーバーが無理な難易度を出しても解き始めない', () => {
    expect(() => checkPowChallenge({ challenge: 'x', bits: 40 })).toThrow()
    expect(() => checkPowChallenge({ challenge: 1, bits: 4 })).toThrow()
    expect(() => checkPowChallenge(null)).toThrow()
    expect(checkPowChallenge({ challenge: 'x', bits: 4 })).toEqual({ challenge: 'x', bits: 4 })
  })
  it('共通の例と同じ判定', () => {
    const cases: { challenge: string; nonce: string; bits: number; ok: boolean }[] = JSON.parse(readFileSync(url('sync-pow.json'), 'utf-8'))
    expect(cases.length).toBeGreaterThan(2)
    for (const c of cases) expect(powOk(c.challenge, c.nonce, c.bits), JSON.stringify(c)).toBe(c.ok)
  })

  describe('問題つきのサーバー', () => {
    let mf: Miniflare
    beforeAll(async () => {
      mf = await startServer()
      await mf.ready
    })
    afterAll(async () => {
      await mf.dispose()
    })
    it.each(['お気に入りのスレの追加が別の端末へ届く', '404 からの作り直し: 確認なしで手元から戻り、削除が復活しない', '2 台が同時に作り直しても領域は 1 つで揃う'])('%s', async (name) => {
      const c = scenarios.find((s) => s.name === name) as Scenario
      const got = await runScenario(c, (now, options) => new MiniflareSyncServer(mf, now, scenarioOverrides(options, { POW_BITS: '8' })))
      const digests = JSON.parse(readFileSync(url('sync-client-digests.json'), 'utf-8')) as Record<string, unknown>
      expect(got).toEqual(digests[name])
    })
  })
})
