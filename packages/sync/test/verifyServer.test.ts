// 検証用の Worker へ本物の HTTP で通す。普段は回さない。OBB_SYNC_VERIFY に URL を入れたときだけ。試した領域は最後に消す
import { readFileSync } from 'node:fs'
import { sha256 } from '@noble/hashes/sha2.js'
import { describe, expect, it } from 'vitest'
import { fromHex, toHex } from '../src/index'
import { runScenario, type Scenario } from './scenarioRunner'
import type { ScenarioServer } from './fakeServer'

const BASE = process.env.OBB_SYNC_VERIFY ?? ''
const url = (f: string) => new URL(`../../conformance/${f}`, import.meta.url)
const NAMES = (process.env.OBB_SYNC_VERIFY_NAMES ?? '').split(',').filter(Boolean)
// 1 分の上限(領域ごと 60 回・IP ごと 60 回)に当たると 429 で結果が変わるので、余裕を持って間を空ける
const GAP_MS = 3100

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class HttpServer implements ScenarioServer {
  tokens = new Map<string, string>()
  count = 0
  async handle(req: { method: string; path: string; headers?: Record<string, string>; body?: string }) {
    await sleep(req.path === '/tickets' ? 7000 : GAP_MS)
    const auth = req.headers?.Authorization
    if (auth) {
      const token = auth.slice('Bearer '.length)
      this.tokens.set(toHex(sha256(fromHex(token))), token)
    }
    this.count++
    const res = await fetch(BASE + req.path, { method: req.method, headers: req.headers, body: req.body, redirect: 'manual' })
    return { status: res.status, headers: { ETag: res.headers.get('ETag') ?? '' }, body: await res.text() }
  }
  spaceCount() {
    return this.tokens.size
  }
  space() {
    return undefined
  }
  async deleteSpace(id: string) {
    const token = this.tokens.get(id)
    if (token) expect((await fetch(`${BASE}/space`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })).status).toBeLessThan(500)
  }
  bumpEpoch(): never {
    throw new Error('使えない')
  }
  injectRecord(): never {
    throw new Error('使えない')
  }
  async cleanup() {
    for (const id of this.tokens.keys()) await this.deleteSpace(id)
  }
}

describe.skipIf(BASE === '')('検証用の Worker', () => {
  const all: Scenario[] = [...JSON.parse(readFileSync(url('sync-client.json'), 'utf-8')), ...JSON.parse(readFileSync(url('sync-client-random.json'), 'utf-8'))]
  const digests: Record<string, Record<string, string>> = JSON.parse(readFileSync(url('sync-client-digests.json'), 'utf-8'))
  const list = all.filter((c) => NAMES.some((n) => c.name.includes(n)))
  it.each(list)('$name', async (c) => {
    const server = new HttpServer()
    const at = Date.now()
    try {
      const got = await runScenario(c, () => server)
      console.log(`${c.name}: 要求 ${server.count} 回、${Date.now() - at} ms`)
      expect(got).toEqual(digests[c.name])
    } finally {
      await server.cleanup()
    }
  }, 590_000)
})
