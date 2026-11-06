// 統合テストだけで使う入口。本物の Worker と Durable Object に、時計・設定・観察の口を足す。src/index.ts からは参照しない
import { LedgerDO as RealLedger } from '../src/ledger'
import { SpaceDO as RealSpace } from '../src/space'
import worker from '../src/index'
import type { Env } from '../src/config'
import { fromHex, randomToken, sha256, toHex } from '../src/encoding'
import { runtime } from '../src/runtime'

export interface InjectRecord {
  record_id: string
  kind_tag: string
  schema_version: number
  deleted: boolean
  nonce: string
  ciphertext: string
}

export class SpaceDO extends RealSpace {
  testBump(): void {
    if (this.meta()) this.sql.exec('UPDATE meta SET epoch = ? WHERE id = 1', randomToken(16))
  }
  testInject(r: InjectRecord): void {
    const m = this.meta()
    if (!m) return
    const cur = this.sql.exec<{ n: number }>('SELECT LENGTH(ciphertext) AS n FROM records WHERE record_id = ?', r.record_id).toArray()[0]
    const version = m.next + 1
    this.sql.exec('INSERT OR REPLACE INTO records (record_id, version, kind_tag, schema_version, deleted, nonce, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', r.record_id, version, r.kind_tag, r.schema_version, r.deleted ? 1 : 0, r.nonce, r.ciphertext, runtime.now())
    this.sql.exec('UPDATE meta SET next = ?, ever_written = 1, used_bytes = used_bytes + ?, record_count = record_count + ? WHERE id = 1', version, r.ciphertext.length - (cur?.n ?? 0), cur ? 0 : 1)
  }
  testDump(): string | null {
    const m = this.meta()
    if (!m) return null
    const records = this.sql.exec('SELECT * FROM records').toArray().map((r) => ({ ...r, deleted: r.deleted === 1 }))
    return JSON.stringify({ epoch: m.epoch, next: m.next, gc_floor: m.gc_floor, records })
  }
}

export class LedgerDO extends RealLedger {
  testCount(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM spaces').one().n
  }
  testClear(): void {
    for (const t of ['spaces', 'source_events', 'source_blocks', 'flags', 'nonces', 'audit', 'jobs', 'job_items']) this.sql.exec(`DELETE FROM ${t}`)
  }
}

const known = new Set<string>()
let lastNow = -1

interface TestEnv extends Omit<Env, 'SPACE' | 'LEDGER'> {
  SPACE: DurableObjectNamespace<SpaceDO>
  LEDGER: DurableObjectNamespace<LedgerDO>
}

async function testOp(op: string, body: Record<string, unknown>, env: TestEnv): Promise<Response> {
  const ledger = env.LEDGER.getByName('ledger')
  const id = body.id as string
  switch (op) {
    case 'reset':
      for (const k of known) await env.SPACE.getByName(k).adminWipe(null)
      known.clear()
      await ledger.testClear()
      lastNow = -1
      runtime.overrides = body.overrides as Record<string, string>
      return new Response('ok')
    case 'delete': {
      await env.SPACE.getByName(id).adminWipe(null)
      await ledger.forget(id)
      return new Response('ok')
    }
    case 'bump':
      await env.SPACE.getByName(id).testBump()
      return new Response('ok')
    case 'inject':
      known.add(id)
      await env.SPACE.getByName(id).testInject(body.record as InjectRecord)
      return new Response('ok')
    case 'space':
      return new Response((await env.SPACE.getByName(id).testDump()) ?? 'null')
    case 'count':
      return new Response(String(await ledger.testCount()))
    default:
      return new Response('unknown', { status: 400 })
  }
}

export default {
  async fetch(req: Request, env: TestEnv): Promise<Response> {
    const url = new URL(req.url)
    const header = req.headers.get('X-Test-Now')
    if (header) {
      const now = Number(header)
      runtime.now = () => now
      // 偽サーバーは要求のたびに片づけるので、時刻が動いたときに同じことをする
      if (now !== lastNow) {
        lastNow = now
        for (const k of known) await env.SPACE.getByName(k).housekeep()
        await env.LEDGER.getByName('ledger').housekeep()
      }
    }
    if (url.pathname.startsWith('/__test/')) return await testOp(url.pathname.slice(8), (await req.json()) as Record<string, unknown>, env)
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('Authorization') ?? '')
    if (m) known.add(toHex(await sha256(fromHex(m[1]))))
    return await worker.fetch(req, env as unknown as Env)
  },
}
