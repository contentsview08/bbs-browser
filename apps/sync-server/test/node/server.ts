// Node から Miniflare の本物のサーバーを動かす。共通シナリオと CLI のテストで使う
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import type { FakeRequest, FakeResponse, ScenarioServer, ScenarioSpace } from '../../../../packages/sync/test/fakeServer'

const ENTRY = fileURLToPath(new URL('../harness-worker.ts', import.meta.url))
export const ORIGIN = 'https://sync.test'
const TICKET = JSON.parse(readFileSync(new URL('../../../../packages/conformance/sync-ticket.json', import.meta.url), 'utf-8')) as { key: { kid: string; secret: string } }

export async function startServer(bindings: Record<string, string> = {}): Promise<Miniflare> {
  const out = await build({ entryPoints: [ENTRY], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', conditions: ['workerd', 'worker'], mainFields: ['module', 'main'], external: ['cloudflare:*'], write: false, logLevel: 'silent' })
  return new Miniflare({
    modules: [{ type: 'ESModule', path: 'harness.mjs', contents: out.outputFiles[0].text }],
    compatibilityDate: '2026-03-01',
    durableObjects: { SPACE: { className: 'SpaceDO', useSQLite: true }, LEDGER: { className: 'LedgerDO', useSQLite: true } },
    bindings: { POW_SECRET: 'test-pow-secret', TURNSTILE_SECRET: 'test-turnstile-secret', TICKET_KEYS: JSON.stringify({ [TICKET.key.kid]: TICKET.key.secret }), TICKET_KID: TICKET.key.kid, ...bindings },
  })
}

export async function testOp(mf: Miniflare, op: string, body: Record<string, unknown>, now?: number): Promise<string> {
  const res = await mf.dispatchFetch(`${ORIGIN}/__test/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(now !== undefined && { 'X-Test-Now': String(now) }) }, body: JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) throw new Error(`${op}: ${res.status} ${text}`)
  return text
}

/** シナリオの server の項目を環境変数の値にする。偽サーバーにない作成の検査は切る */
export function scenarioOverrides(options: Record<string, unknown>, extra: Record<string, string> = {}): Record<string, string> {
  const o: Record<string, string> = { POW_BITS: '0', SOURCE_LIMIT: '0', EMPTY_SPACE_DAYS: '0', RATE_PER_MINUTE: '0', RATE_PER_DAY: '0', FULL_PULL_PER_HOUR: '0', ...extra }
  if (options.space_limit !== undefined) o.SPACE_LIMIT = String(options.space_limit)
  if (options.quota_bytes !== undefined) o.QUOTA_BYTES = String(options.quota_bytes)
  if (options.quota_records !== undefined) o.QUOTA_RECORDS = String(options.quota_records)
  if (options.creation_closed === true) o.CREATION_CLOSED = '1'
  if (options.ticket_ttl_days !== undefined) o.TICKET_TTL_DAYS = String(options.ticket_ttl_days)
  if (options.pow_bits !== undefined) o.POW_BITS = String(options.pow_bits)
  return o
}

/** dispatchFetch は本文を流れにして長さを落とす。実際の端末の HTTP は長さを送る */
export function withLength(body: string | undefined, headers: Record<string, string>): Record<string, string> {
  return body === undefined ? headers : { ...headers, 'Content-Length': String(Buffer.byteLength(body)) }
}

export class MiniflareSyncServer implements ScenarioServer {
  private ready: Promise<unknown>
  constructor(private readonly mf: Miniflare, private readonly now: () => number, overrides: Record<string, string>) {
    this.ready = testOp(mf, 'reset', { overrides }, now())
  }

  async handle(req: FakeRequest): Promise<FakeResponse> {
    await this.ready
    const res = await this.mf.dispatchFetch(`${ORIGIN}${req.path}`, { method: req.method, headers: withLength(req.body, { ...req.headers, 'CF-Connecting-IP': '203.0.113.9', 'X-Test-Now': String(this.now()) }), ...(req.body !== undefined && { body: req.body }), redirect: 'manual' })
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      headers[k] = v
    })
    return { status: res.status, headers, body: await res.text() }
  }

  private async op(op: string, body: Record<string, unknown>): Promise<string> {
    await this.ready
    return await testOp(this.mf, op, body, this.now())
  }

  async spaceCount(): Promise<number> {
    return Number(await this.op('count', {}))
  }

  async space(id: string): Promise<ScenarioSpace | undefined> {
    const v = JSON.parse(await this.op('space', { id })) as null | { epoch: string; next: number; gc_floor: number; records: { record_id: string }[] }
    if (!v) return undefined
    return { epoch: v.epoch, next: v.next, gc_floor: v.gc_floor, records: new Map(v.records.map((r) => [r.record_id, r as never])) }
  }

  async deleteSpace(id: string): Promise<void> {
    await this.op('delete', { id })
  }

  async bumpEpoch(id: string): Promise<void> {
    await this.op('bump', { id })
  }

  async injectRecord(id: string, record: Parameters<ScenarioServer['injectRecord']>[1]): Promise<void> {
    await this.op('inject', { id, record })
  }
}
