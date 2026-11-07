// packages/conformance/sync-client.json を流す枠。スマホ版の SyncScenarioTest.kt も同じファイルを同じ順で流し、同期の表の digest まで比べる
import { readdirSync, readFileSync } from 'node:fs'
import initSqlJs from 'sql.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { expect } from 'vitest'
import { LogStore, UserOps, type SqlDb } from '../../logstore/src/index'
import type { ThreadSummary } from '../../connectors/src/index'
import { canonicalJson, deriveKeys, FavoriteThreadAdapter, recordId, sealPayload, spaceId, SyncEngine, toBase64Url, toHex, utf8, type CycleResult, type SyncEngineState, type SyncKeyMaterial, type SyncKeyStore, type SyncRequest, type SyncResponse, type SyncTransport } from '../src/index'
import { FakeSyncServer, fakeSpaceIdOf, type ScenarioServer } from './fakeServer'

const SERVER = 'https://sync.test'
const START = 1_800_000_000_000
const migrations = readdirSync(new URL('../../logstore/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(`../../logstore/migrations/${f}`, import.meta.url), 'utf-8'))
const SQL = await initSqlJs()

export type Step = Record<string, any>
export interface Scenario {
  name: string
  devices: string[]
  server?: Record<string, unknown>
  seed?: Record<string, { favorite_threads?: Step[] }>
  skew_ms?: Record<string, number>
  steps: Step[]
  expected?: Record<string, any>
}

function sqlDb(fail: { match: string; times: number }[]): { db: SqlDb; rawExec: (sql: string) => void } {
  const db = new SQL.Database()
  for (const m of migrations) db.exec(m)
  const conv = (sql: string) => sql.replace(/\$(\d+)/g, '?$1')
  return {
    rawExec: (sql) => db.exec(sql),
    db: {
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
          for (const s of statements) {
            const f = fail.find((x) => x.times > 0 && s.sql.includes(x.match))
            if (f) {
              f.times--
              throw new Error('db_fail')
            }
            db.run(conv(s.sql), (s.params ?? []) as initSqlJs.BindParams)
          }
          db.exec('COMMIT')
        } catch (e) {
          db.exec('ROLLBACK')
          throw e
        }
      },
    },
  }
}

class MemoryKeyStore implements SyncKeyStore {
  value: SyncKeyMaterial | null = null
  async load() {
    return this.value
  }
  async save(v: SyncKeyMaterial) {
    this.value = v
  }
  async clear() {
    this.value = null
  }
}

interface Fault {
  kind: 'status' | 'drop' | 'unreachable' | 'redirect' | 'response' | 'swap'
  times: number
  skip?: number
  path?: string
  status?: number
  body?: unknown
  location?: string
  other?: string
}

interface LogEntry {
  device: string
  method: string
  path: string
  host: string
  request_id?: string
}

/** シナリオの server の項目と時計を受け取って、相手のサーバーを作る */
export type MakeServer = (now: () => number, options: Record<string, unknown>) => ScenarioServer

const makeFake: MakeServer = (now, options) => new FakeSyncServer({ now, rate_per_minute: null, full_pull_per_hour: null, ...options })

class World {
  now = START
  server: ScenarioServer
  faults: Fault[] = []
  log: LogEntry[] = []
  mark = 0
  devices = new Map<string, Device>()
  /** 同期を始めるページを通した回数。人の操作の代わり */
  tickets = 0
  constructor(make: MakeServer, options: Record<string, unknown>) {
    this.server = make(() => this.now, options)
  }
}

const resolver = (device: string) => (url: string) => {
  if (device === 'phone' && url.includes('2chan.net')) return null
  return { boardUrl: url.replace(/^http:\/\/([^/]*5ch\.)/, 'https://$1').replace(/5ch\.net/, '5ch.io'), connectorId: '2ch-compat' }
}

class Device {
  sql: ReturnType<typeof sqlDb>
  store: LogStore
  ops: UserOps
  keys = new MemoryKeyStore()
  engine!: SyncEngine
  online = true
  dbFail: { match: string; times: number }[] = []
  last: CycleResult | null = null
  trace: SyncEngineState[] = []
  idCount = 0
  requestCount = 0
  constructor(readonly name: string, readonly world: World, readonly skew: number) {
    this.sql = sqlDb(this.dbFail)
    this.store = new LogStore(this.sql.db)
    this.ops = new UserOps(this.store)
    this.newEngine()
  }
  now = () => this.world.now + this.skew
  transport: SyncTransport = {
    send: async (req: SyncRequest): Promise<SyncResponse> => {
      const w = this.world
      const url = new URL(req.url)
      const path = url.pathname + url.search
      const requestId = req.body ? (JSON.parse(req.body).request_id as string | undefined) : undefined
      w.log.push({ device: this.name, method: req.method, path: url.pathname, host: url.host, ...(requestId && { request_id: requestId }) })
      if (!this.online) throw new Error('offline')
      const f = w.faults.find((x) => x.times > 0 && (x.path === undefined || x.path === url.pathname))
      if (f && (f.skip ?? 0) > 0) f.skip = (f.skip as number) - 1
      else if (f) {
        f.times--
        if (f.kind === 'status') return { status: f.status as number, body: '{}' }
        if (f.kind === 'unreachable') throw new Error('unreachable')
        if (f.kind === 'redirect') return { status: 302, headers: { Location: f.location as string }, body: '' }
        if (f.kind === 'drop') {
          await w.server.handle({ method: req.method, path, headers: req.headers, body: req.body })
          throw new Error('dropped')
        }
        if (f.kind === 'swap') {
          // 本物の別レコードの暗号文を、送った先頭のレコードの 409 として返す
          const sp = await w.server.space(fakeSpaceIdOf((req.headers.Authorization as string).slice(7)))
          const first = (JSON.parse(req.body as string).records as { record_id: string }[])[0].record_id
          return { status: 200, body: JSON.stringify({ results: [{ record_id: first, status: 409, record: sp?.records.get(f.other as string) }], epoch: sp?.epoch, gc_floor: sp?.gc_floor }) }
        }
        const epoch = (await w.server.space(fakeSpaceIdOf((req.headers.Authorization as string).slice(7))))?.epoch ?? ''
        return { status: f.status ?? 200, body: JSON.stringify(f.body).replaceAll('$epoch', epoch) }
      }
      return await w.server.handle({ method: req.method, path, headers: req.headers, body: req.body })
    },
  }
  newEngine() {
    this.engine = new SyncEngine({
      db: this.sql.db,
      keyStore: this.keys,
      transport: this.transport,
      serverUrl: SERVER,
      adapters: [new FavoriteThreadAdapter(this.sql.db, resolver(this.name))],
      now: this.now,
      newDeviceId: () => (this.idCount++ === 0 ? this.name : `${this.name}_${this.idCount}`),
      newRequestId: () => {
        const n = String(++this.requestCount)
        return (this.name + '_'.repeat(22)).slice(0, 22 - n.length) + n
      },
      jitter: () => 0.5,
      onState: (s) => this.trace.push(s),
    })
  }
  /** 同期を始めるページを通して許可証を受け取る。画面の手順の代わりなので通信の記録に入れない */
  async startPage(k: Uint8Array): Promise<string> {
    this.world.tickets++
    const res = await this.world.server.handle({ method: 'POST', path: '/tickets', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnstile: 'test-pass', space_id: spaceId(deriveKeys(k).auth_token) }) })
    return JSON.parse(res.body).ticket as string
  }
  async sync(manual = true) {
    this.trace = []
    this.last = await this.engine.runCycle({ manual })
    return this.last
  }
  state(key: string) {
    return this.sql.db.select<{ value: string }>('SELECT value FROM sync_state WHERE key = $1', [key]).then((r) => r[0]?.value ?? null)
  }
  async count(sql: string): Promise<number> {
    return (await this.sql.db.select<{ n: number }>(`SELECT COUNT(*) AS n ${sql}`))[0].n
  }
  /** 今のデータと同期の表の全部。PC とスマホで同じ文字列になる */
  async digest(): Promise<string> {
    const favorites = await this.sql.db.select('SELECT board_url, key, connector_id, title, created_at, sort, added_at FROM favorite_threads ORDER BY board_url, key')
    const records = await this.sql.db.select('SELECT record_id, kind, kind_tag, schema_version, payload, hlc, deleted, version, pending, priority, needs_apply, ref_board, ref_thread, tomb_at FROM sync_records ORDER BY record_id')
    return toHex(sha256(utf8(canonicalJson({ favorites, records }))))
  }
}

const thread = (s: Step): ThreadSummary => ({
  connectorId: '2ch-compat',
  boardUrl: s.board,
  key: s.key,
  title: s.title ?? '',
  postCount: 0,
  order: 0,
  createdAt: s.created_at === undefined ? undefined : new Date(s.created_at),
})

export const keyOf = (device: string) => sha256(utf8(`key:${device}`))

async function runStep(w: World, s: Step, c: Scenario): Promise<void> {
  const d = s.device === undefined ? (undefined as unknown as Device) : (w.devices.get(s.device) as Device)
  const spaceOf = (x: Device) => async () => spaceId(deriveKeys((await x.keys.load() as SyncKeyMaterial).k).auth_token)
  switch (s.op) {
    case 'advance_ms':
      w.now += s.ms
      break
    case 'favorite_thread_add':
      await d.ops.favoriteThreadAdd(thread(s), d.now())
      break
    case 'favorite_thread_remove':
      await d.ops.favoriteThreadRemove(thread(s), d.now())
      break
    case 'auto_favorite_thread_add':
      await d.store.addFavoriteThread(thread(s), d.now())
      break
    case 'auto_favorite_thread_remove':
      await d.store.removeFavoriteThread(thread(s))
      break
    case 'preset_board_add':
      await d.store.addFavorite({ url: s.url, name: s.name, connectorId: '2ch-compat' } as never)
      break
    case 'pair_first':
      await d.engine.pair(keyOf(s.device), s.no_ticket ? null : await d.startPage(keyOf(s.device)))
      await d.sync()
      break
    case 'pair_join': {
      // QR とコピー用のコードの中身は K と許可証
      const from = (await (w.devices.get(s.from) as Device).keys.load()) as SyncKeyMaterial
      await d.engine.pair(from.k, from.ticket)
      await d.sync()
      break
    }
    case 'start_page': {
      const k = ((await d.keys.load()) as SyncKeyMaterial).k
      await d.engine.setTicket(await d.startPage(k))
      break
    }
    case 'sync':
      await d.sync()
      break
    case 'sync_auto':
      await d.sync(false)
      break
    case 'restart':
      d.newEngine()
      break
    case 'leave':
      await d.engine.leave()
      break
    case 'confirm':
      await d.engine.resolveConfirm(s.choice)
      break
    case 'offline':
      d.online = false
      break
    case 'online':
      d.online = true
      break
    case 'server_fail':
      w.faults.push({ kind: 'status', status: s.status, times: s.times ?? 1, path: s.path, skip: s.skip })
      break
    case 'server_drop_response':
      w.faults.push({ kind: 'drop', times: s.times ?? 1, path: s.path, skip: s.skip })
      break
    case 'server_unreachable':
      w.faults.push({ kind: 'unreachable', times: s.times ?? 1, path: s.path, skip: s.skip })
      break
    case 'server_redirect':
      w.faults.push({ kind: 'redirect', times: s.times ?? 1, path: s.path, location: s.location })
      break
    case 'server_response':
      w.faults.push({ kind: 'response', times: s.times ?? 1, path: s.path, status: s.status, body: s.body })
      break
    case 'server_swap_conflict': {
      const keys = deriveKeys((await d.keys.load() as SyncKeyMaterial).k)
      w.faults.push({ kind: 'swap', times: 1, path: '/records', other: recordId(keys.k_id, s.other[0], s.other[1], s.other[2]) })
      break
    }
    case 'server_delete_space':
      await w.server.deleteSpace(await spaceOf(d)())
      break
    case 'server_bump_epoch':
      await w.server.bumpEpoch(await spaceOf(d)())
      break
    case 'server_inject': {
      const keys = deriveKeys((await d.keys.load() as SyncKeyMaterial).k)
      const id = recordId(keys.k_id, s.record[0], s.record[1], s.record[2], s.record[3])
      const sid = spaceId(keys.auth_token)
      if (s.corrupt) await w.server.injectRecord(sid, { record_id: id, kind_tag: 'h', schema_version: 1, deleted: false, nonce: toBase64Url(new Uint8Array(24)), ciphertext: toBase64Url(new Uint8Array(272)) })
      else await w.server.injectRecord(sid, { record_id: id, kind_tag: 'h', schema_version: 1, deleted: s.payload.deleted === true, ...sealPayload(keys, { space_id: sid, record_id: id, kind_tag: 'h', schema_version: 1 }, s.payload) })
      break
    }
    case 'db_fail':
      d.dbFail.push({ match: s.match, times: s.times ?? 1 })
      break
    case 'tamper_device_id':
      d.sql.rawExec("UPDATE sync_state SET value = 'copied' WHERE key = 'device_id'")
      break
    case 'clear_keys':
      await d.keys.clear()
      break
    case 'mark':
      w.mark = w.log.length
      break
    case 'expect':
      await check(w, s.expect, c.name)
      break
    default:
      throw new Error(`知らない op: ${s.op}`)
  }
}

async function check(w: World, want: Record<string, any>, label: string): Promise<void> {
  for (const [name, e] of Object.entries(want)) {
    if (name === '$server') {
      if (e.spaces !== undefined) expect(await w.server.spaceCount(), `${label}: サーバーの領域の数`).toBe(e.spaces)
      if (e.tickets !== undefined) expect(w.tickets, `${label}: 同期を始めるページを通した回数`).toBe(e.tickets)
      if (e.hosts !== undefined) expect([...new Set(w.log.map((l) => l.host))], `${label}: 通信先`).toEqual(e.hosts)
      if (e.request_id_repeated !== undefined) {
        const ids = w.log.flatMap((l) => (l.request_id ? [l.request_id] : []))
        expect(new Set(ids).size < ids.length, `${label}: 同じ request_id の送り直し`).toBe(e.request_id_repeated)
      }
      for (const [dev, v] of Object.entries<any>(e.of ?? {})) {
        const m = await (w.devices.get(dev) as Device).keys.load()
        const sp = m ? await w.server.space(spaceId(deriveKeys(m.k).auth_token)) : undefined
        if (v.exists !== undefined) expect(sp !== undefined, `${label}: ${dev} の領域`).toBe(v.exists)
        if (v.records !== undefined) expect(sp?.records.size, `${label}: ${dev} の領域のレコード数`).toBe(v.records)
        if (v.head !== undefined) expect(sp?.next, `${label}: ${dev} の領域の version`).toBe(v.head)
        if (v.gc_floor !== undefined) expect(sp?.gc_floor, `${label}: ${dev} の gc_floor`).toBe(v.gc_floor)
      }
      continue
    }
    const d = w.devices.get(name) as Device
    const at = `${label}: ${name}`
    if (e.favorite_threads !== undefined) {
      const rows = await d.sql.db.select<{ key: string }>('SELECT key FROM favorite_threads ORDER BY key')
      expect(rows.map((r) => r.key), `${at} のお気に入り`).toEqual(e.favorite_threads)
    }
    if (e.favorite_rows !== undefined) {
      const rows = await d.sql.db.select<{ board_url: string; key: string; title: string; created_at: number | null }>('SELECT board_url, key, title, created_at FROM favorite_threads ORDER BY board_url, key')
      expect(rows, `${at} のお気に入りの行`).toEqual(e.favorite_rows)
    }
    if (e.favorite_boards !== undefined) {
      const rows = await d.sql.db.select<{ url: string }>('SELECT url FROM favorite_boards ORDER BY url')
      expect(rows.map((r) => r.url), `${at} のお気に入り板`).toEqual(e.favorite_boards)
    }
    if (e.state !== undefined) expect(d.engine.state, `${at} の状態`).toBe(e.state)
    if (e.phase !== undefined) expect(await d.state('phase'), `${at} の phase`).toBe(e.phase)
    if (e.pending !== undefined) expect(await d.count('FROM sync_records WHERE pending = 1'), `${at} の未送信`).toBe(e.pending)
    if (e.ops !== undefined) expect(await d.count('FROM sync_ops'), `${at} の sync_ops`).toBe(e.ops)
    if (e.records !== undefined) expect(await d.count('FROM sync_records'), `${at} のレコード数`).toBe(e.records)
    if (e.tombstones !== undefined) expect(await d.count('FROM sync_records WHERE deleted = 1'), `${at} の tombstone`).toBe(e.tombstones)
    if (e.needs_apply !== undefined) expect(await d.count('FROM sync_records WHERE needs_apply = 1'), `${at} の needs_apply`).toBe(e.needs_apply)
    if (e.state_rows !== undefined) expect(await d.count('FROM sync_state'), `${at} の sync_state`).toBe(e.state_rows)
    if (e.last_error !== undefined) expect(await d.state('last_error'), `${at} の last_error`).toBe(e.last_error)
    if (e.since !== undefined) expect(await d.state('since'), `${at} の since`).toBe(String(e.since))
    if (e.bad_counts !== undefined) expect(await d.state('bad_counts'), `${at} の bad_counts`).toBe(e.bad_counts === null ? null : canonicalJson(e.bad_counts))
    if (e.inflight !== undefined) expect((await d.state('push_inflight')) !== null, `${at} の push_inflight`).toBe(e.inflight)
    if (e.device_id !== undefined) expect(await d.state('device_id'), `${at} の device_id`).toBe(e.device_id)
    if (e.has_ticket !== undefined) expect(((await d.keys.load())?.ticket ?? null) !== null, `${at} の許可証`).toBe(e.has_ticket)
    if (e.keys !== undefined) expect((await d.keys.load()) !== null, `${at} の鍵`).toBe(e.keys)
    if (e.pending_confirm !== undefined) expect(await d.state('pending_confirm'), `${at} の pending_confirm`).toBe(canonicalJson(e.pending_confirm))
    if (e.trace !== undefined) expect(d.trace, `${at} の状態の順`).toEqual(e.trace)
    if (e.applied !== undefined) expect(d.last?.applied.favoriteThreads, `${at} の適用`).toBe(e.applied)
    if (e.pushed !== undefined) expect(d.last?.pushed, `${at} の送信数`).toBe(e.pushed)
    if (e.conflicts !== undefined) expect(d.last?.conflicts, `${at} の 409`).toBe(e.conflicts)
    if (e.skipped !== undefined) expect(d.last?.skipped ?? null, `${at} の skipped`).toBe(e.skipped)
    if (e.requests !== undefined) {
      const seen: Record<string, number> = {}
      for (const l of w.log.slice(w.mark)) if (l.device === name) seen[`${l.method} ${l.path}`] = (seen[`${l.method} ${l.path}`] ?? 0) + 1
      expect(seen, `${at} の通信`).toEqual(e.requests)
    }
  }
}

export async function runScenario(c: Scenario, make: MakeServer = makeFake): Promise<Record<string, string>> {
  const w = new World(make, c.server ?? {})
  for (const name of c.devices) w.devices.set(name, new Device(name, w, c.skew_ms?.[name] ?? 0))
  for (const [name, seed] of Object.entries(c.seed ?? {})) {
    const d = w.devices.get(name) as Device
    for (const f of seed.favorite_threads ?? []) await d.store.addFavoriteThread(thread(f), START - (f.added_ago_ms ?? 0))
  }
  for (const s of c.steps) await runStep(w, s, c)
  if (c.expected) await check(w, c.expected, c.name)
  const digests: Record<string, string> = {}
  for (const [name, d] of w.devices) digests[name] = await d.digest()
  return digests
}
