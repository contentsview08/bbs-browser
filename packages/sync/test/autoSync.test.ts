// 自動の同期を本物のエンジンと偽サーバーでつなぐ。偽の時計で進め、要求の回数を数える
import { describe, expect, it } from 'vitest'
import { LogStore, UserOps } from '../../logstore/src/index'
import * as S from '../src/index'
import { FakeSyncServer, signTicket } from './fakeServer'
import { testDb } from './scenarioRunner'

const HEAD_MS = S.HEAD_INTERVAL_MS
const PUSH_MS = S.PUSH_INTERVAL_MS
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
  // /records が書く SQLite の行数。N 件で 2N + 2(レコードと version の索引が N ずつ、meta と request_id の控えが 1 ずつ。サーバーの cost.test.ts の値)
  const rows = { n: 0 }
  const base: S.SyncTransport = {
    async send(req) {
      const u = new URL(req.url)
      const res = server.handle({ method: req.method, path: u.pathname + u.search, headers: req.headers, body: req.body })
      requests.push(`${req.method} ${u.pathname} ${res.status}`)
      if (u.pathname === '/records' && res.status === 200) rows.n += 2 * ((JSON.parse(req.body ?? '{}') as { records?: unknown[] }).records?.length ?? 0) + 2
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
    cycle: (reason) => ctl.autoCycle(reason),
    check: () => ctl.autoCheck(),
    hasChanges: () => ctl.hasChanges(),
    pace: () => ctl.pace(),
    idleStops,
  })
  const engine = new S.SyncEngine({ db, keyStore: { load: async () => material, save: async (v) => void (material = v), clear: async () => void (material = null) }, transport: wrap ? wrap(base) : base, serverUrl: 'https://sync.test', adapters, now: () => clock.now, newDeviceId: () => name })
  return { db, store, ops: new UserOps(store), ctl, scheduler, engine, requests, rows, material: () => material }
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
    await clock.advance(HEAD_MS)
    expect(a.requests).toEqual(['GET /head 304'])
    // 変化なしのあとは間隔が 2 倍になる
    await clock.advance(HEAD_MS)
    expect(a.requests).toEqual(['GET /head 304'])
    await clock.advance(HEAD_MS)
    expect(a.requests).toEqual(['GET /head 304', 'GET /head 304'])
    await a.scheduler.background()
    await a.scheduler.foreground()
    a.requests.length = 0
    await clock.advance(HEAD_MS)
    expect(a.requests).toEqual(['GET /head 304'])
    // 読んで操作すると確認は 1 分おきに戻り、次の送信の時計で送る。直前の確認が 304 なので /changes は読まず、送った分は読み戻さない
    await open(a.store, '1')
    await a.ops.markRead(thread('1'), 7, clock.now)
    a.scheduler.activity()
    a.requests.length = 0
    await clock.advance(PUSH_MS - HEAD_MS)
    expect(a.requests).toEqual(['GET /head 304', 'GET /head 304', 'POST /records 200'])
    // 既読と閲覧履歴の 2 件で 2 × 2 + 2 行
    expect(a.rows.n).toBe(6)
    a.requests.length = 0
    await clock.advance(HEAD_MS)
    expect(a.requests).toEqual(['GET /head 304'])
    // 相手は次の確認で変化を見て読む
    await clock.advance(HEAD_MS * 4)
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

  /** 2 台を作って対にし、最初の周を済ませる。回数は 0 から数え直す */
  async function pairTwo(clock: Clock) {
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
    return { pc, phone }
  }

  type Dev = Awaited<ReturnType<typeof pairTwo>>['pc']
  const count = (list: string[], p: string) => list.filter((r) => r.startsWith(p)).length
  const tally = (d: Dev) => ({ total: d.requests.length, head: count(d.requests, 'GET /head'), changes: count(d.requests, 'GET /changes'), records: count(d.requests, 'POST /records'), rows: d.rows.n, limited: d.requests.filter((r) => r.endsWith(' 429')).length })
  const show = (name: string, pc: Dev, phone: Dev) => {
    const a = tally(pc)
    const b = tally(phone)
    console.log(`${name}: PC ${a.total}(head ${a.head}・changes ${a.changes}・records ${a.records}・行 ${a.rows})、スマホ ${b.total}(head ${b.head}・changes ${b.changes}・records ${b.records}・行 ${b.rows})、合計 ${a.total + b.total}、行 ${a.rows + b.rows}、429 ${a.limited + b.limited}`)
    expect(a.limited + b.limited).toBe(0)
    return { pc: a, phone: b }
  }

  // 1 日の要求の回数。docs/sync-design.md の「費用」の表の元
  it('1 日の要求の回数 (a): PC 8 時間とスマホ 3 時間、1 分に 1 回読み続ける', async () => {
    const clock = new Clock()
    const { pc, phone } = await pairTwo(clock)
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
    const r = show('(a) 読み続ける', pc, phone)
    // PC は操作で確認が 1 分おきのまま、送信は 5 分おきで読み戻さない(changes 0)。スマホは操作がないので確認が伸び、送信の周で pull する
    expect(r.pc).toMatchObject({ total: 481, head: 384, changes: 0, records: 97, rows: 582 })
    expect(r.phone).toMatchObject({ total: 146, head: 72, changes: 37, records: 37, rows: 222 })
    // 100 人分の書き込み行が無料枠に収まる
    expect((r.pc.rows + r.phone.rows) * 100).toBeLessThan(100_000)
  }, 300_000)

  it('1 日の要求の回数 (b): 読まずに開いているだけ。PC 8 時間とスマホ 3 時間', async () => {
    const clock = new Clock()
    const { pc, phone } = await pairTwo(clock)
    await pc.scheduler.foreground()
    await clock.advance(8 * 3_600_000)
    await pc.scheduler.background()
    await phone.scheduler.foreground()
    await clock.advance(3 * 3_600_000)
    await phone.scheduler.background()
    const r = show('(b) 開いているだけ', pc, phone)
    // PC は 1・3・7 分で確認して放置で止まる。スマホは 5 分おきまで伸びる
    expect(r.pc).toMatchObject({ total: 3, head: 3, changes: 0, records: 0, rows: 0 })
    expect(r.phone).toMatchObject({ total: 38, head: 37, changes: 1, records: 0, rows: 0 })
  }, 300_000)

  it('1 日の要求の回数 (c): 2 台が同時に前面で 3 時間、PC だけ 1 分に 1 回読む', async () => {
    const clock = new Clock()
    const { pc, phone } = await pairTwo(clock)
    await pc.scheduler.foreground()
    await phone.scheduler.foreground()
    await open(pc.store, '1')
    for (let m = 1; m <= 3 * 60; m++) {
      await clock.advance(60_000)
      await pc.ops.markRead(thread('1'), m, clock.now)
      pc.scheduler.activity()
    }
    await clock.advance(HEAD_MS * 5)
    await pc.scheduler.background()
    await phone.scheduler.background()
    const r = show('(c) 2 台同時', pc, phone)
    // 読んだ分は相手に届いている
    expect((await phone.db.select<{ read_no: number }>('SELECT read_no FROM threads WHERE key = $1', ['1']))[0]?.read_no).toBe(180)
    // 読んでいない側は、確認のたびに相手の変更を見て読む
    expect(r.pc).toMatchObject({ total: 184, head: 146, changes: 1, records: 37, rows: 222 })
    expect(r.phone).toMatchObject({ total: 129, head: 92, changes: 37, records: 0, rows: 0 })
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
