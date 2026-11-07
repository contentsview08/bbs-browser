// 共通シナリオに載せない PC だけの決まり(同時実行・lease)と、定数の表
import { readFileSync } from 'node:fs'
import initSqlJs from 'sql.js'
import { describe, expect, it } from 'vitest'
import { LogStore, UserOps, type SqlDb } from '../../logstore/src/index'
import * as S from '../src/index'
import { FakeSyncServer, signTicket } from './fakeServer'

const migrations = (await import('node:fs')).readdirSync(new URL('../../logstore/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(`../../logstore/migrations/${f}`, import.meta.url), 'utf-8'))
const SQL = await initSqlJs()

function newDb(): SqlDb {
  const db = new SQL.Database()
  for (const m of migrations) db.exec(m)
  const conv = (sql: string) => sql.replace(/\$(\d+)/g, '?$1')
  return {
    async execute(sql, params = []) {
      db.run(conv(sql), params as initSqlJs.BindParams)
    },
    async select<T>(sql: string, params: unknown[] = []) {
      const st = db.prepare(conv(sql))
      st.bind(params as initSqlJs.BindParams)
      const rows: T[] = []
      while (st.step()) rows.push(st.getAsObject() as T)
      st.free()
      return rows
    },
    async batch(statements) {
      db.exec('BEGIN')
      try {
        for (const s of statements) db.run(conv(s.sql), (s.params ?? []) as initSqlJs.BindParams)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}

const thread = (key: string) => ({ connectorId: '2ch-compat', boardUrl: 'https://a.5ch.io/x/', key, title: `t${key}`, postCount: 0, order: 0 })

function setup(o: { lease?: string; db?: SqlDb; now?: () => number; server?: FakeSyncServer; wrap?: (t: S.SyncTransport) => S.SyncTransport; onRequest?: (r: S.SyncRequest) => void } = {}) {
  let now = 1_800_000_000_000
  const clock = o.now ?? (() => now)
  const server = o.server ?? new FakeSyncServer({ now: clock, rate_per_minute: null, full_pull_per_hour: null })
  const db = o.db ?? newDb()
  let material: S.SyncKeyMaterial | null = null
  const base: S.SyncTransport = {
    async send(req) {
      o.onRequest?.(req)
      const u = new URL(req.url)
      return server.handle({ method: req.method, path: u.pathname + u.search, headers: req.headers, body: req.body })
    },
  }
  const engine = new S.SyncEngine({
    db,
    keyStore: { load: async () => material, save: async (v) => void (material = v), clear: async () => void (material = null) },
    transport: o.wrap ? o.wrap(base) : base,
    serverUrl: 'https://sync.test',
    adapters: [new S.FavoriteThreadAdapter(db, (u) => ({ boardUrl: u, connectorId: '2ch-compat' }))],
    now: clock,
    newDeviceId: () => 'dev',
    leaseOwner: o.lease,
  })
  return { engine, db, server, store: new LogStore(db), advance: (ms: number) => (now += ms), setKeys: (m: S.SyncKeyMaterial) => (material = m) }
}

const K = new Uint8Array(32).fill(7)
const TICKET = signTicket(S.spaceId(S.deriveKeys(K).auth_token), 4_000_000_000)

describe('sync-config.json', () => {
  const cfg = JSON.parse(readFileSync(new URL('../../conformance/sync-config.json', import.meta.url), 'utf-8'))
  it('定数が表と同じ', () => {
    for (const [k, v] of Object.entries(cfg.constants)) expect((S as unknown as Record<string, unknown>)[k], k).toBe(v)
  })
  it.each(cfg.backoff as { attempt: number; jitter: number; ms: number }[])('待ち時間 $attempt $jitter', (c) => {
    expect(S.backoffDelayMs(c.attempt, c.jitter)).toBe(c.ms)
  })
  it.each(cfg.server_url as { url: string; allow_localhost?: boolean; ok: string | null }[])('サーバーの URL $url', (c) => {
    const got = (() => {
      try {
        return S.checkServerUrl(c.url, c.allow_localhost === true)
      } catch {
        return null
      }
    })()
    expect(got).toBe(c.ok)
  })
})

describe('同時実行の防止', () => {
  it('走っている間のきっかけは「もう 1 周」にまとまり、通信が重ならない', async () => {
    let release: () => void = () => {}
    let gate: Promise<void> | null = new Promise((r) => (release = r))
    let active = 0
    let peak = 0
    let cycles = 0
    const s = setup({
      wrap: (t) => ({
        async send(req) {
          active++
          peak = Math.max(peak, active)
          if (req.url.includes('/changes')) cycles++
          if (gate) await gate
          const r = await t.send(req)
          active--
          return r
        },
      }),
    })
    await s.engine.pair(K, TICKET)
    const first = s.engine.runCycle({ manual: true })
    const others = [s.engine.runCycle({ manual: true }), s.engine.runCycle({ manual: true }), s.engine.runCycle({ manual: true })]
    await new Promise((r) => setTimeout(r, 0))
    gate = null
    release()
    await Promise.all([first, ...others])
    expect(peak).toBe(1)
    // 初回の周(404 と作成のあとの読み)と、まとまった 1 周
    expect(cycles).toBe(3)
  })

  it('別の起動が lease を持っている間は動かず、期限が切れたら動く', async () => {
    const db = newDb()
    let now = 1_800_000_000_000
    const server = new FakeSyncServer({ now: () => now, rate_per_minute: null, full_pull_per_hour: null })
    const a = setup({ db, lease: 'a', now: () => now, server })
    const b = setup({ db, lease: 'b', now: () => now, server })
    await a.engine.pair(K, TICKET)
    b.setKeys({ k: K, deviceId: 'dev', ticket: TICKET })
    expect((await a.engine.runCycle({ manual: true })).state).toBe('idle')
    const r = await b.engine.runCycle({ manual: true })
    expect(r.skipped).toBe('lease')
    now += S.LEASE_MS + 1
    expect((await b.engine.runCycle({ manual: true })).state).toBe('idle')
    expect((await a.engine.runCycle({ manual: true })).skipped).toBe('lease')
  })

  it('pull は自動のきっかけなら 10 秒あける。手動は例外', async () => {
    let pulls = 0
    const s = setup({ onRequest: (r) => void (r.url.includes('/changes') && pulls++) })
    await s.engine.pair(K, TICKET)
    await s.engine.runCycle({ manual: true })
    pulls = 0
    await s.engine.runCycle()
    expect(pulls).toBe(0)
    s.advance(S.PULL_MIN_GAP_MS)
    await s.engine.runCycle()
    expect(pulls).toBe(1)
    await s.engine.runCycle({ manual: true })
    expect(pulls).toBe(2)
  })

  it('適用と利用者の操作が入れ違っても、後の操作が勝って手元が揃う', async () => {
    const db = newDb()
    let now = 1_800_000_000_000
    const server = new FakeSyncServer({ now: () => now, rate_per_minute: null, full_pull_per_hour: null })
    const other = setup({ now: () => now, server })
    await other.engine.pair(K, TICKET)
    await new UserOps(other.store).favoriteThreadAdd(thread('1'), now)
    await other.engine.runCycle({ manual: true })
    now += 1000
    // 適用の直前に、利用者が同じスレを足してすぐ外した
    let interfered = false
    const wrapped: SqlDb = {
      ...db,
      select: db.select,
      execute: db.execute,
      async batch(st) {
        if (!interfered && st.some((x) => x.sql.includes('INSERT OR IGNORE INTO favorite_threads'))) {
          interfered = true
          await new UserOps(new LogStore(db)).favoriteThreadRemove(thread('1'), now)
        }
        return db.batch(st)
      },
    }
    const me = setup({ db: wrapped, now: () => now, server })
    await me.engine.pair(K, TICKET)
    await me.engine.runCycle({ manual: true })
    expect(interfered).toBe(true)
    // 入れ違いの直後は適用が行を書く。次の周で操作が処理され、全端末で消える
    now += 1000
    await me.engine.runCycle({ manual: true })
    now += 1000
    await other.engine.runCycle({ manual: true })
    expect(await me.store.listFavoriteThreads()).toEqual([])
    expect(await other.store.listFavoriteThreads()).toEqual([])
  })
})

describe('通信の口', () => {
  it('https でないサーバーへは送らず、自動で再開しない', async () => {
    let sent = 0
    const db = newDb()
    let material: S.SyncKeyMaterial | null = null
    const engine = new S.SyncEngine({
      db,
      keyStore: { load: async () => material, save: async (v) => void (material = v), clear: async () => void (material = null) },
      transport: { send: async () => { sent++; return { status: 200, body: '{}' } } },
      serverUrl: 'http://sync.test',
      adapters: [],
      now: () => 1,
      newDeviceId: () => 'dev',
    })
    await engine.pair(K, TICKET)
    const r = await engine.runCycle({ manual: true })
    expect(r.state).toBe('blocked')
    expect(sent).toBe(0)
  })

  it('大きすぎる応答は捨てる', async () => {
    const s = setup({
      wrap: (t) => ({
        async send(req) {
          if (req.url.includes('/changes')) return { status: 200, body: ' '.repeat(S.MAX_RESPONSE_BYTES + 1) }
          return t.send(req)
        },
      }),
    })
    await s.engine.pair(K, TICKET)
    expect((await s.engine.runCycle({ manual: true })).state).toBe('backoff')
    expect((await s.db.select<{ value: string }>("SELECT value FROM sync_state WHERE key = 'last_error'"))[0].value).toBe('too_large')
  })

  it('要求の本文に平文を載せない。トークンはヘッダーだけ', async () => {
    const bodies: string[] = []
    const s = setup({ onRequest: (r) => void (r.body && bodies.push(r.body)) })
    await s.engine.pair(K, TICKET)
    await new UserOps(s.store).favoriteThreadAdd({ ...thread('1'), title: 'ひみつのスレタイ' }, 1)
    await s.engine.runCycle({ manual: true })
    const all = bodies.join('\n')
    expect(all).toContain('ciphertext')
    expect(all).not.toContain('ひみつ')
    expect(all).not.toContain('a.5ch.io')
    expect(all).not.toContain(S.toHex(S.deriveKeys(K).auth_token))
  })
})

describe('許可証', () => {
  it('別の領域の許可証を受け取らない。置き換えても鍵はそのまま', async () => {
    const s = setup()
    const other = signTicket('c'.repeat(64), 4_000_000_000)
    await expect(s.engine.pair(K, other)).rejects.toThrow('bad_ticket')
    await expect(s.engine.pair(K, 'garbage')).rejects.toThrow('bad_ticket')
    await expect(s.engine.setTicket(TICKET)).rejects.toThrow('bad_ticket')
    await s.engine.pair(K, null)
    await expect(s.engine.setTicket(other)).rejects.toThrow('bad_ticket')
    await s.engine.setTicket(TICKET)
    expect((await s.engine.runCycle({ manual: true })).state).toBe('idle')
    expect(s.server.spaceCount()).toBe(1)
  })
  it('許可証を作成の本文に入れ、トークンと一緒に送る。問題が出たら両方を送り直す', async () => {
    const bodies: string[] = []
    const s = setup({ onRequest: (r) => void (r.url.endsWith('/spaces') && bodies.push(r.body as string)) })
    s.server.o.pow_bits = 4
    await s.engine.pair(K, TICKET)
    await s.engine.runCycle({ manual: true })
    expect(bodies.length).toBe(2)
    expect(JSON.parse(bodies[0])).toEqual({ ticket: TICKET })
    expect(Object.keys(JSON.parse(bodies[1])).sort()).toEqual(['pow', 'ticket'])
    expect(s.server.spaceCount()).toBe(1)
  })
})

describe('確認と読み戻し', () => {
  const since = async (db: SqlDb) => Number((await db.select<{ value: string }>("SELECT value FROM sync_state WHERE key = 'since'"))[0]?.value ?? 0)
  const tracing = (reqs: string[]) => (t: S.SyncTransport): S.SyncTransport => ({
    async send(req) {
      const r = await t.send(req)
      reqs.push(`${req.method} ${new URL(req.url).pathname} ${r.status}`)
      return r
    },
  })

  it('送った分だけなら since を進め、次の確認は 304。/changes で読み戻さない', async () => {
    const reqs: string[] = []
    const s = setup({ wrap: tracing(reqs) })
    await s.engine.pair(K, TICKET)
    await s.engine.runCycle({ manual: true })
    await new UserOps(s.store).favoriteThreadAdd(thread('1'), 1_800_000_000_000)
    await new UserOps(s.store).favoriteThreadAdd(thread('2'), 1_800_000_000_000)
    const before = await since(s.db)
    await s.engine.runCycle({ manual: true })
    expect(await since(s.db)).toBe(before + 2)
    reqs.length = 0
    expect(await s.engine.checkHead()).toBe(false)
    expect(reqs).toEqual(['GET /head 304'])
    s.advance(S.PULL_MIN_GAP_MS)
    await s.engine.runCycle({ quick: true })
    expect(reqs.filter((r) => r.startsWith('GET /changes'))).toEqual([])
  })

  it('間に別の端末が書いて隙間ができたら since を進めず、次の確認で変化を見て読む', async () => {
    let now = 1_800_000_000_000
    const server = new FakeSyncServer({ now: () => now, rate_per_minute: null, full_pull_per_hour: null })
    const reqs: string[] = []
    const a = setup({ now: () => now, server, wrap: tracing(reqs) })
    const b = setup({ now: () => now, server })
    await a.engine.pair(K, TICKET)
    await b.engine.pair(K, TICKET)
    await a.engine.runCycle({ manual: true })
    await b.engine.runCycle({ manual: true })
    now += S.HEAD_INTERVAL_MS
    expect(await a.engine.checkHead()).toBe(false)
    await new UserOps(b.store).favoriteThreadAdd(thread('1'), now)
    await b.engine.runCycle({ manual: true })
    await new UserOps(a.store).favoriteThreadAdd(thread('2'), now)
    const before = await since(a.db)
    reqs.length = 0
    // 直前の確認が「変化なし」なので pull を省く。送ると version に隙間がある
    now += 1000
    await a.engine.runCycle({ quick: true })
    expect(reqs.filter((r) => r.startsWith('GET /changes'))).toEqual([])
    expect(await since(a.db)).toBe(before)
    reqs.length = 0
    expect(await a.engine.checkHead()).toBe(true)
    expect(reqs).toEqual(['GET /head 200'])
    // 変化を見たあとの自動の周は pull を省かない
    await a.engine.runCycle({ quick: true })
    expect(reqs.filter((r) => r.startsWith('GET /changes'))).toHaveLength(1)
    expect((await a.store.listFavoriteThreads()).map((t) => t.thread.key).sort()).toEqual(['1', '2'])
    expect(await a.engine.checkHead()).toBe(false)
  })

  it('自動の周は直前の確認が「変化なし」なら pull を省く。前面復帰・手動・間隔が過ぎたあとは省かない', async () => {
    let pulls = 0
    const s = setup({ onRequest: (r) => void (r.url.includes('/changes') && pulls++) })
    await s.engine.pair(K, TICKET)
    await s.engine.runCycle({ manual: true })
    s.advance(S.HEAD_INTERVAL_MS)
    expect(await s.engine.checkHead()).toBe(false)
    pulls = 0
    s.advance(S.PULL_MIN_GAP_MS)
    await s.engine.runCycle({ quick: true })
    expect(pulls).toBe(0)
    await s.engine.runCycle()
    expect(pulls).toBe(1)
    await s.engine.runCycle({ manual: true })
    expect(pulls).toBe(2)
    s.advance(S.HEAD_INTERVAL_MS)
    await s.engine.runCycle({ quick: true })
    expect(pulls).toBe(3)
  })

  it('確認で変化を見たあと周が通信の失敗で終わっても、次の確認は 304 にならず変化を見る', async () => {
    let now = 1_800_000_000_000
    const server = new FakeSyncServer({ now: () => now, rate_per_minute: null, full_pull_per_hour: null })
    const other = setup({ now: () => now, server })
    await other.engine.pair(K, TICKET)
    await other.engine.runCycle({ manual: true })
    let failing = false
    const reqs: string[] = []
    const me = setup({
      now: () => now,
      server,
      wrap: (t) => ({
        async send(req) {
          if (failing && req.url.includes('/changes')) throw new S.SyncApiError('network')
          const r = await t.send(req)
          reqs.push(`${req.method} ${new URL(req.url).pathname} ${r.status}`)
          return r
        },
      }),
    })
    await me.engine.pair(K, TICKET)
    await me.engine.runCycle({ manual: true })
    await new UserOps(other.store).favoriteThreadAdd(thread('1'), now)
    await other.engine.runCycle({ manual: true })
    now += S.HEAD_INTERVAL_MS
    expect(await me.engine.checkHead()).toBe(true)
    failing = true
    expect((await me.engine.runCycle()).state).toBe('offline')
    failing = false
    now += S.BACKOFF_MAX_MS
    reqs.length = 0
    expect(await me.engine.checkHead()).toBe(true)
    expect(reqs).toEqual(['GET /head 200'])
    await me.engine.runCycle({ manual: true })
    expect((await me.store.listFavoriteThreads()).map((t) => t.thread.key)).toEqual(['1'])
    expect(await me.engine.checkHead()).toBe(false)
  })

  it('version の並びの判定', () => {
    const ok = (v: number[]) => v.map((version) => ({ status: 200, version }))
    expect(S.pushedRun(ok([4, 3, 5]), 3, 2)).toBe(5)
    expect(S.pushedRun(ok([3]), 1, 2)).toBe(3)
    expect(S.pushedRun(ok([3, 5]), 2, 2)).toBeNull()
    expect(S.pushedRun(ok([4]), 1, 2)).toBeNull()
    expect(S.pushedRun(ok([3]), 2, 2)).toBeNull()
    expect(S.pushedRun([{ status: 200, version: 3 }, { status: 409 }], 2, 2)).toBeNull()
    expect(S.pushedRun([], 0, 2)).toBeNull()
  })
})
