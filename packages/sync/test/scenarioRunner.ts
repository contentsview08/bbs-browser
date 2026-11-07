// packages/conformance/sync-client.json を流す枠。スマホ版の SyncScenarioTest.kt も同じファイルを同じ順で流し、同期の表の digest まで比べる
import { readdirSync, readFileSync } from 'node:fs'
import initSqlJs from 'sql.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { expect } from 'vitest'
import { LogStore, ngDiff, readNgRules, settingsNgStore, setSettingStatement, UserOps, type NgRuleData, type SqlDb } from '../../logstore/src/index'
import { ngPatternSyncable } from '../../../apps/desktop/src/utils/ng'
import type { ThreadSummary } from '../../connectors/src/index'
import { canonicalJson, deriveKeys, HISTORY_SHOWN, favoriteBoardAdapters, FavoriteThreadAdapter, hasLocalData, historyAdapters, ImageAdapter, NgAdapter, normalizeBoardUrl, PostAdapter, postIdOf, recordId, restoreThreadRead, SecretAdapter, SettingAdapter, settingOpsOf, settingsTableHost, SiteAdapter, syncMismatches, syncSummary, type SyncAdapter, openRecords, sealPayload, spaceId, SyncEngine, toBase64Url, toHex, utf8, type CycleResult, type SyncEngineState, type SyncKeyMaterial, type SyncKeyStore, type SyncGroup, type SyncRequest, type SyncResponse, type SyncTransport } from '../src/index'
import presets from '../../presets/sites.json'
import { FakeSyncServer, fakeSpaceIdOf, type ScenarioServer } from './fakeServer'

const SERVER = 'https://sync.test'
/** 最初から入っている掲示板・板。参加の確認で手元のデータに数えない(SyncController と同じ) */
const PRESET_URLS = [...presets.sites.map((x) => x.menu), ...presets.boards.map((x) => x.url)]
const START = 1_800_000_000_000
const migrations = readdirSync(new URL('../../logstore/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(new URL(`../../logstore/migrations/${f}`, import.meta.url), 'utf-8'))
const SQL = await initSqlJs()

export type Step = Record<string, any>
export interface Scenario {
  name: string
  devices: string[]
  server?: Record<string, unknown>
  seed?: Record<string, { favorite_threads?: Step[]; favorite_boards?: Step[]; sites?: Step[]; uploads?: Step[]; ng?: NgRuleData[]; threads?: Step[]; posts?: Step[]; settings?: Record<string, unknown> }>
  /** logRetentionDays。0 は消さない */
  retention_days?: number
  /** 移行の SQL が入れる 5ch とエッヂを残す。ふだんは空から始めて、各シナリオの件数を読みやすくする */
  keep_defaults?: boolean
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
  /** 権限系のレコードの数 */
  secrets?: number
}

/** シナリオの server の項目と時計を受け取って、相手のサーバーを作る */
export type MakeServer = (now: () => number, options: Record<string, unknown>) => ScenarioServer

const makeFake: MakeServer = (now, options) => new FakeSyncServer({ now, rate_per_minute: null, full_pull_per_hour: null, ...options })

class World {
  now = START
  server: ScenarioServer
  faults: Fault[] = []
  log: LogEntry[] = []
  /** 端末が送った本文の全部。権限系の値が平文で出ていないかを見る */
  sent: string[] = []
  mark = 0
  devices = new Map<string, Device>()
  /** 同期を始めるページを通した回数。人の操作の代わり */
  tickets = 0
  retentionDays = 0
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
  /** 道具の窓が開いたときに見ていた NG。窓は保存まで読み直さない */
  windows = new Map<string, NgRuleData[]>()
  constructor(readonly name: string, readonly world: World, readonly skew: number, keepDefaults: boolean) {
    this.sql = sqlDb(this.dbFail)
    if (!keepDefaults) this.sql.rawExec('DELETE FROM sites; DELETE FROM favorite_boards')
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
      const parsed = req.body ? (JSON.parse(req.body) as { request_id?: string; records?: { kind_tag?: string }[] }) : undefined
      const requestId = parsed?.request_id
      const secrets = parsed?.records?.filter((r) => r.kind_tag === 's').length
      w.log.push({ device: this.name, method: req.method, path: url.pathname, host: url.host, ...(requestId && { request_id: requestId }), ...(secrets && { secrets }) })
      if (req.body) w.sent.push(req.body)
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
  resetCount = 0
  adapters: SyncAdapter[] = []
  newEngine() {
    this.adapters = [
        new FavoriteThreadAdapter(this.sql.db, resolver(this.name)),
        ...favoriteBoardAdapters(this.sql.db, resolver(this.name)),
        new SiteAdapter(this.sql.db, (url) => (this.name === 'phone' && url.includes('2chan.net') ? null : '2ch-compat')),
        new ImageAdapter(this.sql.db),
        new SecretAdapter(this.sql.db),
        new NgAdapter({ ...settingsNgStore(this.sql.db), apply: async (c) => void (await settingsNgStore(this.sql.db).apply(c)), patternOk: ngPatternSyncable, today: dateOf }),
        new PostAdapter(this.sql.db, resolver(this.name)),
        new SettingAdapter(settingsTableHost(this.sql.db, this.name === 'phone' ? 'phone' : 'pc'), this.sql.db),
        ...historyAdapters(this.sql.db, { resolve: resolver(this.name), retentionDays: () => this.world.retentionDays, newResetId: () => `reset_${this.name}_${++this.resetCount}` }),
    ]
    this.engine = new SyncEngine({
      db: this.sql.db,
      keyStore: this.keys,
      transport: this.transport,
      serverUrl: SERVER,
      adapters: this.adapters,
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
    const boards = await this.sql.db.select('SELECT url, connector_id, name, sort FROM favorite_boards ORDER BY url')
    const sites = await this.sql.db.select('SELECT menu_url, connector_id, name, sort FROM sites ORDER BY menu_url')
    const uploads = await this.sql.db.select('SELECT url, name, size, uploaded_at, with_account, hash, delete_url FROM uploads ORDER BY url')
    const ng = await settingsNgStore(this.sql.db).read()
    const threads = await this.sql.db.select('SELECT board_url, key, connector_id, title, post_count, read_no, status, created_at, read_at FROM threads ORDER BY board_url, key')
    const posts = await this.sql.db.select('SELECT connector_id, board_url, key, thread_title, no, name, mail, body, posted_at FROM post_history ORDER BY posted_at, board_url, key, body')
    const own = await this.sql.db.select('SELECT board_url, key, no, posted_at FROM own_posts ORDER BY board_url, key, no')
    const records = await this.sql.db.select('SELECT record_id, kind, kind_tag, schema_version, payload, hlc, deleted, version, pending, priority, needs_apply, ref_board, ref_thread, ref_detail, tomb_at FROM sync_records ORDER BY record_id')
    const settings = [...(await settingsTableHost(this.sql.db, 'pc').read())].map(([k, v]) => [k, canonicalJson(v)]).sort(([a], [b]) => (a < b ? -1 : 1))
    // 端末の要約の文字列も比べる。画面に出す値が PC とスマホで同じ作りになるように
    const m = await this.keys.load()
    const summary = m ? (await syncSummary(this.sql.db, this.adapters, { keys: deriveKeys(m.k), deviceId: m.deviceId, now: this.now() })).text : ''
    return toHex(sha256(utf8(canonicalJson({ favorites, boards, sites, uploads, ng, threads, posts, own, settings, records, summary }))))
  }
}

/** 端末の日付の代わり。時差で結果が変わらないよう UTC で決める */
const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const board = (s: Step) => ({ url: s.url, name: s.name ?? '', connectorId: '2ch-compat' })
const site = (s: Step) => ({ menuUrl: s.url, name: s.name ?? '', connectorId: '2ch-compat' })
const upload = (s: Step) => ({ url: s.url, name: s.name ?? '', size: s.size ?? 0, withAccount: s.with_account === true, hash: s.hash, deleteUrl: s.delete_url })

/** 窓が見ている配列から新しい配列を作り、その窓の差分だけを保存する */
async function windowChange(d: Device, view: NgRuleData[], s: Step): Promise<NgRuleData[]> {
  const removed = new Set<string>(s.remove ?? [])
  const edits = new Map<string, NgRuleData>((s.edit ?? []).map((r: NgRuleData) => [r.id, r]))
  const after = [...view.filter((r) => !removed.has(r.id)).map((r) => edits.get(r.id) ?? r), ...(s.add ?? [])]
  await d.ops.ngChange(ngDiff(view, after, dateOf(d.now())), d.now())
  return after
}

/** 端末どうしで揃うはずの値。キーごとに持つので、違ったレコードと項目をそのまま読める */
async function snapshot(d: Device, full: boolean): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const recs = await d.sql.db.select<{ record_id: string; kind: string; payload: string; ref_board: string | null; ref_thread: string | null; ref_detail: string | null }>('SELECT record_id, kind, payload, ref_board, ref_thread, ref_detail FROM sync_records')
  for (const r of recs) {
    const k = `record ${r.kind} ${r.record_id.slice(0, 12)}`
    out[k] = r.payload
    // 削除だけを受けた端末は ref を知らない。比べずに、違いの見出しにだけ使う
    if (r.ref_board || r.ref_thread || r.ref_detail) out[`#${k}`] = `${r.ref_board ?? ''} ${r.ref_thread ?? ''} ${r.ref_detail ?? ''}`
  }
  const posts = await d.sql.db.select<{ board_url: string; key: string; thread_title: string; no: number | null; body: string; posted_at: number }>('SELECT board_url, key, thread_title, no, body, posted_at FROM post_history')
  for (const p of posts) {
    const board = normalizeBoardUrl(p.board_url) as string
    out[`書き込み履歴 ${board} ${p.key} ${postIdOf(board, p.key, p.posted_at, p.body)}`] = canonicalJson({ title: p.thread_title, no: p.no, posted_at: p.posted_at })
  }
  const threads = await d.sql.db.select<{ board_url: string; key: string; title: string; read_no: number; read_at: number | null }>('SELECT board_url, key, title, read_no, read_at FROM threads')
  for (const t of threads) {
    if (full || t.read_at !== null) out[`閲覧履歴 ${normalizeBoardUrl(t.board_url)} ${t.key}`] = canonicalJson({ read_at: t.read_at, title: t.title })
    if (full || t.read_no > 0) out[`既読 ${normalizeBoardUrl(t.board_url)} ${t.key}`] = String(t.read_no)
  }
  return out
}

/** 全部の端末を比べ、違いを 1 行ずつ出す。ログを消した端末は行がないので、full でなければ両方にあるものだけを手元の値として比べる */
export function diffSnapshots(an: string, a: Record<string, string>, bn: string, b: Record<string, string>, full: boolean, ignoreTombstones = false): string[] {
  const lines: string[] = []
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (a[k] === b[k] || k.startsWith('#')) continue
    if (ignoreTombstones && k.startsWith('record ') && [a[k], b[k]].every((v) => v === undefined || v.includes('"deleted":true'))) continue
    if (!full && !k.startsWith('record ') && !k.startsWith('書き込み履歴 ') && (a[k] === undefined || b[k] === undefined)) continue
    lines.push(`${k} ${a[`#${k}`] ?? b[`#${k}`] ?? ''}\n  ${an}: ${a[k] ?? '(ない)'}\n  ${bn}: ${b[k] ?? '(ない)'}`)
  }
  return lines
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

/** 共通シナリオと同じ移行 SQL を流した DB */
export const testDb = (): SqlDb => sqlDb([]).db

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
    case 'favorite_board_add':
      await d.ops.favoriteBoardAdd(board(s), d.now())
      break
    case 'favorite_board_remove':
      await d.ops.favoriteBoardRemove(s.url, d.now())
      break
    case 'favorite_board_order':
      await d.ops.favoriteBoardReorder(s.urls, d.now())
      break
    case 'site_add':
      await d.ops.siteAdd(site(s), d.now())
      break
    case 'site_remove':
      await d.ops.siteRemove(s.url, d.now())
      break
    case 'preset_site_add':
      await d.store.addSite(site(s))
      break
    case 'boards_cache':
      await d.store.replaceBoards(s.site, [{ url: s.url, name: 'x', connectorId: '2ch-compat' }])
      break
    case 'upload_add':
      await d.ops.uploadAdd(upload(s), d.now())
      break
    case 'upload_remove':
      await d.ops.uploadRemove(s.url, d.now())
      break
    case 'open': {
      const t = thread(s)
      await restoreThreadRead(d.sql.db, { boardUrl: t.boardUrl, key: t.key, connectorId: t.connectorId, title: t.title, createdAt: s.created_at ?? null })
      await d.sql.db.execute('INSERT OR IGNORE INTO threads (board_url, key, connector_id, title, created_at) VALUES ($1, $2, $3, $4, $5)', [t.boardUrl, t.key, t.connectorId, t.title, s.created_at ?? null])
      if (s.post_count !== undefined) await d.sql.db.execute('UPDATE threads SET post_count = $1 WHERE board_url = $2 AND key = $3', [s.post_count, t.boardUrl, t.key])
      break
    }
    case 'thread_row_raw':
      // 操作を通らずに増えた手元の行(種まきのあとに足された種類、戻したバックアップ)
      await d.sql.db.execute(
        'INSERT INTO threads (board_url, key, connector_id, title, post_count, read_no, created_at, read_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [s.board, s.key, '2ch-compat', s.title ?? '', s.post_count ?? 0, s.read_no ?? 0, s.created_at ?? null, s.read_ago_ms === undefined ? null : d.now() - s.read_ago_ms],
      )
      break
    case 'post_row_raw':
      await d.sql.db.execute(
        'INSERT INTO post_history (connector_id, board_url, key, thread_title, no, name, mail, body, posted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        ['2ch-compat', s.board, s.key, s.title ?? '', s.no ?? null, '', '', s.body, d.now() - (s.ago_ms ?? 0)],
      )
      break
    case 'sync_overlapped': {
      // 走っている周に別のきっかけが重なる
      const running = d.engine.runCycle({ manual: true })
      d.last = await d.engine.runCycle({ manual: true })
      await running
      break
    }
    case 'read':
      await d.ops.markRead(thread(s), s.no, d.now())
      break
    case 'view':
      await d.ops.threadView(thread(s), d.now())
      break
    case 'view_remove':
      await d.ops.historyRemove(thread(s), d.now())
      break
    case 'log_delete':
      await d.ops.deleteLogs((s.threads ?? [s]).map(thread), d.now())
      break
    case 'prune':
      await d.store.pruneLogs(d.now() - s.older_than_ms, (s.keep ?? []).map((k: Step) => ({ boardUrl: k.board, key: k.key })))
      break
    case 'post_add':
      await d.ops.postAdd(thread(s), { no: s.no, name: s.name ?? '', mail: s.mail ?? '', body: s.body }, d.now())
      break
    case 'post_remove': {
      const entry = (await d.store.listPostHistory()).find((e) => e.thread.key === s.key && e.body === s.body)
      if (entry) await d.ops.postRemove(entry, d.now())
      break
    }
    case 'clear_faults':
      w.faults = []
      for (const x of w.devices.values()) x.dbFail.length = 0
      break
    case 'sync_together':
      await Promise.all((s.devices as string[]).map((n) => (w.devices.get(n) as Device).sync()))
      break
    case 'settle': {
      // 新しい変更が出なくなるまで全端末を回す。止まらなければ下の確かめで落ちる
      const targets = s.devices ? (s.devices as string[]).map((n) => w.devices.get(n) as Device) : [...w.devices.values()]
      for (let round = 0; round < 400; round++) {
        let moved = false
        for (const x of targets) {
          const r = await x.sync()
          if (r.pulled > 0 || r.pushed > 0 || r.conflicts > 0) moved = true
        }
        w.now += 1000
        if (!moved) break
      }
      break
    }
    case 'converged': {
      const names: string[] = s.devices ?? [...w.devices.keys()]
      const snaps = await Promise.all(names.map((n) => snapshot(w.devices.get(n) as Device, s.full !== false)))
      for (let i = 1; i < names.length; i++) {
        const lines = diffSnapshots(names[0], snaps[0], names[i], snaps[i], s.full !== false, s.ignore_tombstones === true)
        expect(lines, `${c.name}: ${names[0]} と ${names[i]} の違い\n${lines.join('\n')}`).toEqual([])
      }
      break
    }
    case 'summary_same': {
      const names: string[] = s.devices ?? [...w.devices.keys()]
      const results = await Promise.all(names.map(async (n) => {
        const x = w.devices.get(n) as Device
        const m = (await x.keys.load()) as SyncKeyMaterial
        const ctx = { keys: deriveKeys(m.k), deviceId: m.deviceId, now: x.now() }
        return { sum: await syncSummary(x.sql.db, x.adapters, ctx), mis: await syncMismatches(x.sql.db, x.adapters, ctx) }
      }))
      for (let i = 0; i < names.length; i++) {
        expect(results[i].mis.differs, `${c.name}: ${names[i]} の手元と表の違い`).toEqual({})
        expect(results[i].mis.missing, `${c.name}: ${names[i]} の表にない手元の行`).toEqual({})
        expect(results[i].sum.kinds.map((k) => [k.kind, k.live, k.tombstones, k.hash]), `${c.name}: ${names[i]} の表の要約`).toEqual(results[0].sum.kinds.map((k) => [k.kind, k.live, k.tombstones, k.hash]))
        if (s.local !== false) expect(results[i].sum.local, `${c.name}: ${names[i]} の手元の要約`).toEqual(results[0].sum.local)
      }
      break
    }
    case 'setting_change': {
      const before = (await settingsTableHost(d.sql.db, 'pc').read()).get(s.name)
      const current = s.name === 'boardMeta' ? Object.fromEntries([...(await settingsTableHost(d.sql.db, 'pc').read())].filter(([k]) => k.startsWith('boardMeta/')).map(([k, v]) => [k.slice('boardMeta/'.length), v])) : before
      await d.ops.settingsWrite([{ key: s.name, value: s.value, ops: settingOpsOf(s.name, s.value, current) }], d.now())
      break
    }
    case 'setting_write_raw':
      await d.sql.db.batch([setSettingStatement(s.name, s.value)])
      break
    case 'ng_change':
      await windowChange(d, await readNgRules(d.sql.db), s)
      break
    case 'ng_prune': {
      const view = await readNgRules(d.sql.db)
      await d.ops.ngChange(ngDiff(view, view.filter((r) => !r.expiresOnDate || r.expiresOnDate >= dateOf(d.now())), dateOf(d.now())), d.now())
      break
    }
    case 'ng_window_open':
      d.windows.set(s.window, await readNgRules(d.sql.db))
      break
    case 'ng_window_change':
      d.windows.set(s.window, await windowChange(d, d.windows.get(s.window) as NgRuleData[], s))
      break
    case 'ng_write_raw':
      await d.sql.db.batch([setSettingStatement('ngRules', s.rules)])
      break
    case 'ng_import': {
      const view = await readNgRules(d.sql.db)
      await d.ops.ngChange(ngDiff(view, s.rules, dateOf(d.now()), { keepRemoved: true }), d.now())
      break
    }
    case 'pair_first':
      await d.engine.pair(keyOf(s.device), s.no_ticket ? null : await d.startPage(keyOf(s.device)))
      if (!s.no_sync) await d.sync()
      break
    case 'pair_join': {
      // QR とコピー用のコードの中身は K と許可証
      const from = (await (w.devices.get(s.from) as Device).keys.load()) as SyncKeyMaterial
      // 手元に送るものがあれば確認が出る(SyncController.join と同じ条件。サーバーは 1 つなので URL の違いは起きない)。
      // asks はその有無の期待、choice は答え。やめる(keep_local)なら鍵も書かず何も送らない
      const asks = await hasLocalData(d.sql.db, d.adapters, { keys: deriveKeys(from.k), deviceId: '', now: d.now() }, PRESET_URLS)
      if (s.asks !== undefined) expect(asks, `${c.name}: ${s.device} の参加の確認`).toBe(s.asks)
      if (asks && s.choice === 'keep_local') break
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
    case 'set_master':
      await d.engine.setMaster(s.on)
      break
    case 'set_kind':
      await d.engine.setKind(s.group as SyncGroup, s.on)
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
    case 'server_inject_secret': {
      // 別の端末が権限系を送った状態。corrupt は開けない暗号文
      const keys = deriveKeys((await d.keys.load() as SyncKeyMaterial).k)
      const id = recordId(keys.k_id, 'secret', null, '', s.url)
      await w.server.injectRecord(spaceId(keys.auth_token), { record_id: id, kind_tag: 's', schema_version: 1, deleted: false, nonce: toBase64Url(new Uint8Array(24)), ciphertext: toBase64Url(new Uint8Array(272)) })
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
      if (e.spaces_at_most !== undefined) expect(await w.server.spaceCount(), `${label}: サーバーの領域の数の上限`).toBeLessThanOrEqual(e.spaces_at_most)
      if (e.tickets !== undefined) expect(w.tickets, `${label}: 同期を始めるページを通した回数`).toBe(e.tickets)
      if (e.hosts !== undefined) expect([...new Set(w.log.map((l) => l.host))], `${label}: 通信先`).toEqual(e.hosts)
      if (e.request_id_repeated !== undefined) {
        const ids = w.log.flatMap((l) => (l.request_id ? [l.request_id] : []))
        expect(new Set(ids).size < ids.length, `${label}: 同じ request_id の送り直し`).toBe(e.request_id_repeated)
      }
      if (e.sent_lacks !== undefined) for (const text of e.sent_lacks) expect(w.sent.some((b) => b.includes(text)), `${label}: 送った本文に ${text} がない`).toBe(false)
      for (const [dev, v] of Object.entries<any>(e.of ?? {})) {
        const m = await (w.devices.get(dev) as Device).keys.load()
        const sp = m ? await w.server.space(spaceId(deriveKeys(m.k).auth_token)) : undefined
        if (v.exists !== undefined) expect(sp !== undefined, `${label}: ${dev} の領域`).toBe(v.exists)
        if (v.records !== undefined) expect(sp?.records.size, `${label}: ${dev} の領域のレコード数`).toBe(v.records)
        if (v.head !== undefined) expect(sp?.next, `${label}: ${dev} の領域の version`).toBe(v.head)
        if (v.gc_floor !== undefined) expect(sp?.gc_floor, `${label}: ${dev} の gc_floor`).toBe(v.gc_floor)
        const held = [...(sp?.records.values() ?? [])]
        if (v.s_records !== undefined) expect(held.filter((r) => r.kind_tag === 's').length, `${label}: ${dev} の領域の権限系のレコード数`).toBe(v.s_records)
        if (v.h_lacks !== undefined) {
          // 履歴系の鍵で開けるものに、権限系の値が混ざっていない
          const opened = openRecords(deriveKeys((m as SyncKeyMaterial).k), spaceId(deriveKeys((m as SyncKeyMaterial).k).auth_token), held.filter((r) => r.kind_tag === 'h') as never[])
          for (const text of v.h_lacks) expect(opened.records.some((r) => canonicalJson(r.payload).includes(text)), `${label}: ${dev} の履歴系に ${text} がない`).toBe(false)
        }
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
    if (e.favorite_board_order !== undefined) {
      const rows = await d.sql.db.select<{ url: string }>('SELECT url FROM favorite_boards ORDER BY sort, url')
      expect(rows.map((r) => r.url), `${at} のお気に入り板の並び`).toEqual(e.favorite_board_order)
    }
    if (e.favorite_board_rows !== undefined) {
      expect(await d.sql.db.select('SELECT url, connector_id, name FROM favorite_boards ORDER BY url'), `${at} のお気に入り板の行`).toEqual(e.favorite_board_rows)
    }
    if (e.sites !== undefined) {
      const rows = await d.sql.db.select<{ menu_url: string }>('SELECT menu_url FROM sites ORDER BY menu_url')
      expect(rows.map((r) => r.menu_url), `${at} のサイト`).toEqual(e.sites)
    }
    if (e.site_rows !== undefined) expect(await d.sql.db.select('SELECT menu_url, connector_id, name FROM sites ORDER BY menu_url'), `${at} のサイトの行`).toEqual(e.site_rows)
    if (e.boards_cached !== undefined) expect(await d.count('FROM boards'), `${at} の板一覧`).toBe(e.boards_cached)
    if (e.uploads !== undefined) expect(await d.sql.db.select('SELECT url, name, size, uploaded_at, with_account, hash, delete_url FROM uploads ORDER BY url'), `${at} の画像`).toEqual(e.uploads)
    if (e.ng_ids !== undefined) expect((await readNgRules(d.sql.db)).map((r) => r.id), `${at} の NG`).toEqual(e.ng_ids)
    if (e.ng_rules !== undefined) expect(await settingsNgStore(d.sql.db).read(), `${at} の NG の中身`).toEqual(e.ng_rules)
    if (e.read_no !== undefined) {
      const rows = await d.sql.db.select<{ key: string; read_no: number }>('SELECT key, read_no FROM threads ORDER BY key')
      expect(Object.fromEntries(rows.map((r) => [r.key, r.read_no])), `${at} の既読`).toEqual(e.read_no)
    }
    if (e.history !== undefined) {
      const rows = await d.sql.db.select<{ key: string }>('SELECT key FROM threads WHERE read_at IS NOT NULL ORDER BY read_at DESC, key')
      expect(rows.map((r) => r.key), `${at} の閲覧履歴`).toEqual(e.history)
    }
    if (e.screen_history !== undefined) {
      const rows = await d.store.history(HISTORY_SHOWN)
      expect(rows.map((h) => `${h.thread.key}:${h.readNo}`), `${at} の履歴の画面`).toEqual(e.screen_history)
    }
    if (e.screen_read !== undefined) {
      // 板の未読は スレ一覧のレス数 - この値
      for (const [boardUrl, want] of Object.entries<Record<string, number>>(e.screen_read)) {
        const st = await d.store.getThreadStates(boardUrl)
        expect(Object.fromEntries([...st].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, v.readNo])), `${at} の板の既読 ${boardUrl}`).toEqual(want)
      }
    }
    if (e.summary_notes !== undefined) {
      const m = (await d.keys.load()) as SyncKeyMaterial
      expect((await syncSummary(d.sql.db, d.adapters, { keys: deriveKeys(m.k), deviceId: m.deviceId, now: d.now() })).notes, `${at} の合わない理由`).toEqual(e.summary_notes)
    }
    if (e.thread_rows !== undefined) expect(await d.sql.db.select('SELECT board_url, key, connector_id, title, post_count, read_no, created_at, read_at FROM threads ORDER BY board_url, key'), `${at} のスレの行`).toEqual(e.thread_rows)
    if (e.post_rows !== undefined) expect(await d.sql.db.select('SELECT board_url, key, thread_title, no, name, mail, body, posted_at FROM post_history ORDER BY posted_at, body'), `${at} の書き込み履歴`).toEqual(e.post_rows)
    if (e.post_bodies !== undefined) {
      const rows = await d.sql.db.select<{ body: string }>('SELECT body FROM post_history ORDER BY posted_at, body')
      expect(rows.map((r) => r.body), `${at} の書き込み履歴の本文`).toEqual(e.post_bodies)
    }
    if (e.own_posts !== undefined) expect(await d.sql.db.select('SELECT key, no FROM own_posts ORDER BY key, no'), `${at} の自分のレス`).toEqual(e.own_posts)
    if (e.settings !== undefined) expect(Object.fromEntries([...(await settingsTableHost(d.sql.db, 'pc').read())].sort(([a], [b]) => (a < b ? -1 : 1))), `${at} の設定`).toEqual(e.settings)
    if (e.kinds !== undefined) {
      const rows = await d.sql.db.select<{ kind: string; n: number }>('SELECT kind, COUNT(*) AS n FROM sync_records GROUP BY kind')
      expect(Object.fromEntries(rows.map((r) => [r.kind, r.n])), `${at} の種類ごとのレコード数`).toEqual(e.kinds)
    }
    if (e.ops_lack !== undefined) {
      const rows = await d.sql.db.select<{ target: string; args: string | null }>('SELECT target, args FROM sync_ops')
      for (const text of e.ops_lack) expect(rows.some((r) => `${r.target} ${r.args}`.includes(text)), `${at} の sync_ops に ${text} がない`).toBe(false)
    }
    if (e.secrets_sent !== undefined) expect(w.log.slice(w.mark).filter((l) => l.device === name).reduce((n, l) => n + (l.secrets ?? 0), 0), `${at} の送った権限系の数`).toBe(e.secrets_sent)
    if (e.delete_urls !== undefined) {
      const rows = await d.sql.db.select<{ url: string; delete_url: string | null }>('SELECT url, delete_url FROM uploads ORDER BY url')
      expect(Object.fromEntries(rows.map((r) => [r.url, r.delete_url])), `${at} の削除ページ`).toEqual(e.delete_urls)
    }
    if (e.kinds_lack !== undefined) {
      const rows = await d.sql.db.select<{ kind: string }>('SELECT DISTINCT kind FROM sync_records')
      for (const k of e.kinds_lack) expect(rows.some((r) => r.kind === k), `${at} の表に ${k} がない`).toBe(false)
    }
    if (e.kinds_has !== undefined) {
      const rows = await d.sql.db.select<{ kind: string }>('SELECT DISTINCT kind FROM sync_records')
      for (const k of e.kinds_has) expect(rows.some((r) => r.kind === k), `${at} の表に ${k} がある`).toBe(true)
    }
    if (e.max_order_key !== undefined) {
      const rows = await d.sql.db.select<{ payload: string }>("SELECT payload FROM sync_records WHERE kind = 'order' AND deleted = 0")
      const longest = Math.max(0, ...rows.map((r) => ((JSON.parse(r.payload) as { body: { key: string } }).body.key).length))
      expect(longest, `${at} の順序キーの長さ`).toBeLessThanOrEqual(e.max_order_key)
    }
    if (e.record_lacks !== undefined) {
      const rows = await d.sql.db.select<{ payload: string }>('SELECT payload FROM sync_records')
      for (const text of e.record_lacks) expect(rows.some((r) => r.payload.includes(text)), `${at} のレコードに ${text} がない`).toBe(false)
    }
    if (e.applied_areas !== undefined) expect(Object.keys(d.last?.applied ?? {}).sort(), `${at} の適用の種類`).toEqual(e.applied_areas)
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
    if (e.applied !== undefined) expect(d.last?.applied.favoriteThreads === true, `${at} の適用`).toBe(e.applied)
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

let lastYield = Date.now()

/** 偽のサーバーと SQLite は待ちが起きないので、ときどき譲らないと vitest の通信が 60 秒で切れる */
async function yieldToEventLoop(): Promise<void> {
  if (Date.now() - lastYield < 1000) return
  await new Promise((resolve) => setTimeout(resolve))
  lastYield = Date.now()
}

export async function runScenario(c: Scenario, make: MakeServer = makeFake): Promise<Record<string, string>> {
  const w = new World(make, c.server ?? {})
  w.retentionDays = c.retention_days ?? 0
  for (const name of c.devices) w.devices.set(name, new Device(name, w, c.skew_ms?.[name] ?? 0, c.keep_defaults === true))
  for (const [name, seed] of Object.entries(c.seed ?? {})) {
    const d = w.devices.get(name) as Device
    for (const f of seed.favorite_threads ?? []) await d.store.addFavoriteThread(thread(f), START - (f.added_ago_ms ?? 0))
    for (const b of seed.favorite_boards ?? []) await d.store.addFavorite(board(b))
    for (const x of seed.sites ?? []) await d.store.addSite(site(x))
    for (const u of seed.uploads ?? []) await d.store.addUpload(upload(u), START - (u.ago_ms ?? 0))
    if (seed.ng) await d.store.setSetting('ngRules', seed.ng)
    for (const [k, v] of Object.entries(seed.settings ?? {})) await d.store.setSetting(k, v)
    for (const t of seed.threads ?? []) {
      await d.sql.db.execute(
        'INSERT INTO threads (board_url, key, connector_id, title, post_count, read_no, created_at, read_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [t.board, t.key, '2ch-compat', t.title ?? '', t.post_count ?? 0, t.read_no ?? 0, t.created_at ?? null, t.read_ago_ms === undefined ? null : START - t.read_ago_ms],
      )
    }
    for (const p of seed.posts ?? []) {
      await d.sql.db.execute(
        'INSERT INTO post_history (connector_id, board_url, key, thread_title, no, name, mail, body, posted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        ['2ch-compat', p.board, p.key, p.title ?? '', p.no ?? null, p.name ?? '', p.mail ?? '', p.body, START - (p.ago_ms ?? 0)],
      )
    }
  }
  for (const s of c.steps) {
    await runStep(w, s, c)
    await yieldToEventLoop()
  }
  if (c.expected) await check(w, c.expected, c.name)
  const digests: Record<string, string> = {}
  for (const [name, d] of w.devices) digests[name] = await d.digest()
  return digests
}
