// 自動の同期を本物のエンジンと偽サーバーでつなぐ。偽の時計で進め、要求の回数を数える
import { describe, expect, it } from 'vitest'
import { LogStore, UserOps } from '../../logstore/src/index'
import * as S from '../src/index'
import { FakeSyncServer, signTicket } from './fakeServer'
import { testDb } from './scenarioRunner'

const HEAD_MS = S.HEAD_INTERVAL_MS
const K = new Uint8Array(32).fill(7)
const K2 = new Uint8Array(32).fill(9)
const BOARD = 'https://a.5ch.io/x/'
const thread = (key: string) => ({ connectorId: '2ch-compat', boardUrl: BOARD, key, title: `t${key}`, postCount: 0, order: 0 })
const tick = async () => {
  for (let i = 0; i < 400; i++) await Promise.resolve()
}

class Clock {
  now = 1_800_000_000_000
  private seq = 0
  timers = new Map<number, { at: number; f: () => void }>()
  setTimer = (f: () => void, ms: number) => {
    this.timers.set(++this.seq, { at: this.now + ms, f })
    return this.seq
  }
  clearTimer = (t: unknown) => void this.timers.delete(t as number)
  async advance(ms: number) {
    const end = this.now + ms
    for (;;) {
      const next = [...this.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      this.timers.delete(next[0])
      this.now = next[1].at
      next[1].f()
      await new Promise((r) => setImmediate(r))
      await tick()
    }
    this.now = end
    await new Promise((r) => setImmediate(r))
  }
}

function device(name: string, clock: Clock, server: FakeSyncServer, idleStops: boolean, wrap?: (t: S.SyncTransport) => S.SyncTransport) {
  const db = testDb()
  let material: S.SyncKeyMaterial | null = null
  const requests: string[] = []
  const base: S.SyncTransport = {
    async send(req) {
      const u = new URL(req.url)
      const res = server.handle({ method: req.method, path: u.pathname + u.search, headers: req.headers, body: req.body })
      requests.push(`${req.method} ${u.pathname} ${res.status}`)
      return res
    },
  }
  const store = new LogStore(db)
  const resolve = (u: string) => ({ boardUrl: u, connectorId: '2ch-compat' })
  const adapters = [new S.PostAdapter(db, resolve), ...S.historyAdapters(db, { resolve, retentionDays: () => 0, newResetId: () => `r${name}` })]
  const ctl = new S.SyncController({
    db,
    keyStore: { load: async () => material, save: async (v) => void (material = v), clear: async () => void (material = null) },
    transport: wrap ? wrap(base) : base,
    defaultServerUrl: 'https://sync.test',
    adapters,
    now: () => clock.now,
    keyHint: () => material !== null,
    openStartWindow: async () => null,
  })
  const scheduler = new S.SyncScheduler({
    now: () => clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    enabled: () => ctl.autoEnabled(),
    cycle: () => ctl.autoCycle(),
    check: () => ctl.autoCheck(),
    hasChanges: () => ctl.hasChanges(),
    pace: () => ctl.pace(),
    idleStops,
  })
  const engine = new S.SyncEngine({ db, keyStore: { load: async () => material, save: async (v) => void (material = v), clear: async () => void (material = null) }, transport: wrap ? wrap(base) : base, serverUrl: 'https://sync.test', adapters, now: () => clock.now, newDeviceId: () => name })
  return { db, store, ops: new UserOps(store), ctl, scheduler, engine, requests, material: () => material }
}

async function open(store: LogStore, key: string) {
  await store.db.execute('INSERT OR IGNORE INTO threads (board_url, key, connector_id, title) VALUES ($1, $2, $3, $4)', [BOARD, key, '2ch-compat', `t${key}`])
}

describe('自動の同期', () => {
  it('変更がないと送らず、確認は 304。別の端末の変更は次の確認で届く', async () => {
    const clock = new Clock()
    const server = new FakeSyncServer({ now: () => clock.now, rate_per_minute: null, full_pull_per_hour: null })
    const a = device('pc', clock, server, true)
    const b = device('phone', clock, server, false)
    const ticket = signTicket(S.spaceId(S.deriveKeys(K).auth_token), 4_000_000_000)
    await a.engine.pair(K, ticket)
    await b.engine.pair(K, ticket)
    await a.engine.runCycle({ manual: true })
    await b.engine.runCycle({ manual: true })
    await a.scheduler.foreground()
    await b.scheduler.foreground()
    a.requests.length = 0
    await clock.advance(HEAD_MS * 2)
    a.requests.length = 0
    await clock.advance(HEAD_MS * 4)
    expect(a.requests).toEqual(Array(4).fill('GET /head 304'))
    await open(a.store, '1')
    await a.ops.markRead(thread('1'), 7, clock.now)
    a.requests.length = 0
    await clock.advance(HEAD_MS)
    expect(a.requests.filter((r) => r.startsWith('POST /records'))).toHaveLength(1)
    await clock.advance(HEAD_MS)
    expect((await b.db.select<{ read_no: number }>('SELECT read_no FROM threads WHERE key = $1', ['1']))[0]?.read_no).toBe(7)
    a.scheduler.dispose()
    b.scheduler.dispose()
  })

  it('裏では要求を出さない', async () => {
    const clock = new Clock()
    const server = new FakeSyncServer({ now: () => clock.now, rate_per_minute: null, full_pull_per_hour: null })
    const a = device('pc', clock, server, true)
    await a.engine.pair(K, signTicket(S.spaceId(S.deriveKeys(K).auth_token), 4_000_000_000))
    await a.engine.runCycle({ manual: true })
    await a.scheduler.foreground()
    await a.scheduler.background()
    a.requests.length = 0
    await clock.advance(3_600_000)
    expect(a.requests).toEqual([])
    expect(clock.timers.size).toBe(0)
  })

  it('サーバーの指示より短くしない。429 の待つ秒より早く試さない', async () => {
    const clock = new Clock()
    const server = new FakeSyncServer({ now: () => clock.now, rate_per_minute: null, full_pull_per_hour: null, pace_head_sec: 120 })
    const a = device('pc', clock, server, false)
    await a.engine.pair(K, signTicket(S.spaceId(S.deriveKeys(K).auth_token), 4_000_000_000))
    await a.scheduler.foreground()
    await clock.advance(HEAD_MS)
    a.requests.length = 0
    await clock.advance(119_000)
    expect(a.requests.filter((r) => r.startsWith('GET /head')).length).toBeLessThanOrEqual(1)
    await clock.advance(121_000 * 3)
    expect(a.requests.filter((r) => r.startsWith('GET /head')).length).toBeLessThanOrEqual(4)
    a.scheduler.dispose()
  })

  it('1 日の要求の回数: PC 8 時間とスマホ 3 時間、1 分に 1 回読む', async () => {
    const clock = new Clock()
    const server = new FakeSyncServer({ now: () => clock.now, rate_per_minute: 20, full_pull_per_hour: null })
    const pc = device('pc', clock, server, true)
    const phone = device('phone', clock, server, false)
    const ticket = signTicket(S.spaceId(S.deriveKeys(K).auth_token), 4_000_000_000)
    await pc.engine.pair(K, ticket)
    await phone.engine.pair(K, ticket)
    await pc.engine.runCycle({ manual: true })
    await phone.engine.runCycle({ manual: true })
    pc.requests.length = 0
    phone.requests.length = 0
    await pc.scheduler.foreground()
    await open(pc.store, '1')
    for (let m = 1; m <= 8 * 60; m++) {
      await clock.advance(60_000)
      await pc.ops.markRead(thread('1'), m, clock.now)
      pc.scheduler.activity()
    }
    await pc.scheduler.background()
    await phone.scheduler.foreground()
    await open(phone.store, '2')
    for (let m = 1; m <= 3 * 60; m++) {
      await clock.advance(60_000)
      await phone.ops.markRead(thread('2'), m, clock.now)
    }
    await phone.scheduler.background()
    const count = (list: string[], p: string) => list.filter((r) => r.startsWith(p)).length
    const total = pc.requests.length + phone.requests.length
    const limited = [...pc.requests, ...phone.requests].filter((r) => r.endsWith(' 429')).length
    console.log(`要求の回数: PC ${pc.requests.length}(head ${count(pc.requests, 'GET /head')}・changes ${count(pc.requests, 'GET /changes')}・records ${count(pc.requests, 'POST /records')})、スマホ ${phone.requests.length}(head ${count(phone.requests, 'GET /head')}・changes ${count(phone.requests, 'GET /changes')}・records ${count(phone.requests, 'POST /records')})、合計 ${total}、429 ${limited}`)
    expect(limited).toBe(0)
    expect(total).toBeLessThan(6000)
  }, 300_000)
})

describe('leave と周回の排他', () => {
  it('周の途中で別の領域へ移っても、古い領域の受信が混ざらない', async () => {
    const clock = new Clock()
    const server = new FakeSyncServer({ now: () => clock.now, rate_per_minute: null, full_pull_per_hour: null })
    const other = device('old', clock, server, false)
    await other.engine.pair(K, signTicket(S.spaceId(S.deriveKeys(K).auth_token), 4_000_000_000))
    await open(other.store, '9')
    await other.ops.markRead(thread('9'), 3, clock.now)
    await other.engine.runCycle({ manual: true })

    let release: (() => void) | null = null
    let holding = false
    const a = device('pc', clock, server, false, (t) => ({
      async send(req) {
        const res = await t.send(req)
        if (holding && req.url.includes('/changes')) {
          holding = false
          await new Promise<void>((r) => (release = r))
        }
        return res
      },
    }))
    await a.engine.pair(K, signTicket(S.spaceId(S.deriveKeys(K).auth_token), 4_000_000_000))
    holding = true
    const running = a.engine.runCycle({ manual: true })
    for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setImmediate(r))
    expect(release).not.toBeNull()
    const leaving = a.engine.leave()
    await tick()
    ;(release as unknown as () => void)()
    await running
    await leaving
    expect(await a.db.select('SELECT record_id FROM sync_records')).toEqual([])
    expect(await a.db.select('SELECT key FROM sync_state')).toEqual([])
    await a.engine.pair(K2, signTicket(S.spaceId(S.deriveKeys(K2).auth_token), 4_000_000_000))
    await a.engine.runCycle({ manual: true })
    expect(await a.db.select('SELECT record_id FROM sync_records')).toEqual([])
    expect(await a.db.select('SELECT read_no FROM threads')).toEqual([])
  })

  it('周の後の leave で 2 周目が走らない', async () => {
    const clock = new Clock()
    const server = new FakeSyncServer({ now: () => clock.now, rate_per_minute: null, full_pull_per_hour: null })
    const a = device('pc', clock, server, false)
    await a.engine.pair(K, signTicket(S.spaceId(S.deriveKeys(K).auth_token), 4_000_000_000))
    const first = a.engine.runCycle({ manual: true })
    void a.engine.runCycle({ manual: true })
    await a.engine.leave()
    await first
    expect(a.engine.state).toBe('off')
    expect(await a.db.select('SELECT key FROM sync_state')).toEqual([])
    expect(a.material()).toBeNull()
  })
})
