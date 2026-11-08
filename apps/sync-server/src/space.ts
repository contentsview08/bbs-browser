// 領域 1 つの Durable Object。通番・保存・楽観ロック・領域ごとの回数と 1 日の件数を持つ。中身は暗号文のまま扱う
import { DurableObject } from 'cloudflare:workers'
import { DAY, HOUR, MINUTE, loadConfig, type Config, type Env } from './config'
import { failure, result, type ApiResult } from './http'
import { randomToken } from './encoding'
import { runtime } from './runtime'
import type { InputRecord, PushInput } from './validate'

/** 覚えておく応答の写しの上限。片づけは TRIM_EVERY 件の採番ごとなので、その間に増える分を引いた数まで残す */
const REQUESTS_KEPT = 64
const TRIM_EVERY = 16
const REQUESTS_TTL_MS = 7 * DAY
/** 回数と最終使用をメモリで数え、DB へはこの間隔でまとめて写す */
const FLUSH_MS = 10 * MINUTE
/** 台帳へ知らせられなかったときの送り直しの間隔 */
const RETELL_MS = 5 * MINUTE
/** 作り方が変わったら上げる。既存の領域は最初に触ったときに migrate() で追いつく */
const DB_VERSION = 3
/** 台帳へ未通知の削除の印(KV)。meta ごと消えた後も残す必要があるので SQL の外に置く */
const UNTOLD_KEY = 'untold'

/** 通し番号を持たない(AUTOINCREMENT は 1 回の INSERT で sqlite_sequence にも 1 行書く)。並びは要求の後の version(head)で足りる */
const SCHEMA_REQUESTS = `
CREATE TABLE requests (
  request_id TEXT PRIMARY KEY,
  results TEXT NOT NULL,
  at INTEGER NOT NULL,
  head INTEGER NOT NULL
) WITHOUT ROWID;
`

const SCHEMA = `
CREATE TABLE meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  space_id TEXT NOT NULL,
  epoch TEXT NOT NULL,
  next INTEGER NOT NULL,
  gc_floor INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL,
  used_bytes INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  ever_written INTEGER NOT NULL,
  minute INTEGER NOT NULL,
  minute_count INTEGER NOT NULL,
  day INTEGER NOT NULL,
  day_count INTEGER NOT NULL,
  day_records INTEGER NOT NULL,
  full_pulls TEXT NOT NULL,
  reported_at INTEGER NOT NULL,
  reported_day INTEGER NOT NULL,
  db_version INTEGER NOT NULL
);
CREATE TABLE records (
  record_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL UNIQUE,
  kind_tag TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  deleted INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX records_tomb ON records (updated_at) WHERE deleted = 1;
${SCHEMA_REQUESTS}`

/** 端末はこの秒より早く試さない。超えた要求を繰り返させないため */
const limited = (waitMs: number) => result(429, { error: 'rate_limited', retry_after_sec: Math.ceil(waitMs / 1000) })

/** 指示があるときだけ応答に載せる。ない応答では端末の既定が効く */
const paceOf = (cfg: Config) => (cfg.paceHeadSec > 0 || cfg.pacePushSec > 0 ? { pace: { head_sec: cfg.paceHeadSec, push_sec: cfg.pacePushSec } } : {})

interface Meta {
  space_id: string
  epoch: string
  next: number
  gc_floor: number
  created_at: number
  last_used: number
  used_bytes: number
  record_count: number
  ever_written: number
  minute: number
  minute_count: number
  day: number
  day_count: number
  /** その日に受け付けたレコードの数。409 で書かなかったものは入れない */
  day_records: number
  full_pulls: string
  reported_at: number
  reported_day: number
  db_version: number
}

/** 要求ごとに変わる値。DB の行ではなくここで数え、間引いて DB に写す。実体が落ちたら DB の値から数え直す(回数が少し甘くなるだけ) */
interface Live {
  minute: number
  minute_count: number
  day: number
  day_count: number
  day_records: number
  last_used: number
  /** 最後に DB へ写した時刻 */
  flushed_at: number
  /** 写していない分の境目をまたいだ */
  minute_crossed: boolean
}

interface RecordRow {
  record_id: string
  version: number
  kind_tag: string
  schema_version: number
  deleted: number
  nonce: string
  ciphertext: string
  updated_at: number
  [key: string]: SqlStorageValue
}

interface StoredResult {
  record_id: string
  status: number
  version?: number
}

interface Untold {
  space_id: string
  epoch: string
}

export interface SpaceInfo {
  exists: boolean
  epoch?: string
  created_at?: number
  last_used?: number
  used_bytes?: number
  record_count?: number
  /** 今日受け付けたレコードの数。日が変わっていれば 0 */
  records_today?: number
}

class QuotaExceeded extends Error {}

const toWire = (r: RecordRow) => ({
  record_id: r.record_id,
  version: r.version,
  kind_tag: r.kind_tag,
  schema_version: r.schema_version,
  deleted: r.deleted === 1,
  nonce: r.nonce,
  ciphertext: r.ciphertext,
  updated_at: r.updated_at,
})

const NOT_FOUND: ApiResult = failure(404, 'space_not_found')

export class SpaceDO extends DurableObject<Env> {
  protected sql: SqlStorage
  /** 無ければ書かない。ランダムなトークンで空の領域を保存させないため */
  private hasSchema: boolean | null = null
  private live: Live | null = null
  /** この実体が書いた行の数(索引の更新を含む)。費用の見積もりとテストで使う */
  protected writtenRows = 0

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
  }

  protected get config(): Config {
    return loadConfig(this.env)
  }

  /** 書き込みの SQL はすべてここを通す。行数を数えるため */
  private write(sql: string, ...args: SqlStorageValue[]): number {
    const n = this.sql.exec(sql, ...args).rowsWritten
    this.writtenRows += n
    return n
  }

  protected meta(): Meta | null {
    if (this.hasSchema === null) {
      const table = this.sql.exec<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray()[0]
      this.hasSchema = table !== undefined
      if (table) this.migrate(table.sql)
    }
    if (!this.hasSchema) return null
    const rows = this.sql.exec('SELECT * FROM meta WHERE id = 1').toArray()
    if (rows.length === 0) return null
    const m = rows[0] as unknown as Meta
    // DB より新しい値はメモリにある
    if (this.live) Object.assign(m, { minute: this.live.minute, minute_count: this.live.minute_count, day: this.live.day, day_count: this.live.day_count, day_records: this.live.day_records, last_used: this.live.last_used })
    return m
  }

  /** 古い作りの領域を今の作りに直す。1 回だけ流れ、途中で落ちても次に触ったときにやり直す */
  private migrate(metaSql: string): void {
    // 版 1 には db_version の列がない
    const v = metaSql.includes('db_version') ? (this.sql.exec<{ v: number }>('SELECT db_version AS v FROM meta').toArray()[0]?.v ?? DB_VERSION) : 1
    if (v >= DB_VERSION) return
    this.ctx.storage.transactionSync(() => {
      if (v < 2) {
        // requests の通し番号をやめる。残っていた応答の写しは捨てる(その再送は 409 で今の値が返り、端末がマージしても変わらない)
        this.write('ALTER TABLE meta ADD COLUMN db_version INTEGER NOT NULL DEFAULT 1')
        this.write('DROP TABLE requests')
        this.write(SCHEMA_REQUESTS)
      }
      // 版 3 で 1 日の件数の列。その日の分は数え直しになる(1 日だけ上限が甘くなる)
      if (v < 3) this.write('ALTER TABLE meta ADD COLUMN day_records INTEGER NOT NULL DEFAULT 0')
      this.write('UPDATE meta SET db_version = ? WHERE id = 1', DB_VERSION)
    })
  }

  private expired(m: Meta, now: number, cfg: Config): boolean {
    if (now - m.last_used >= cfg.idleDeleteDays * DAY) return true
    return cfg.emptySpaceDays > 0 && m.ever_written === 0 && now - m.last_used >= cfg.emptySpaceDays * DAY
  }

  private async wipe(): Promise<void> {
    this.hasSchema = false
    this.live = null
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
  }

  /** テストで差し替えて失敗を起こす */
  protected async tell(spaceId: string, epoch: string): Promise<void> {
    await this.env.LEDGER.getByName('ledger').spaceGone(spaceId, epoch)
  }

  /** 届かなければ印を残して alarm で送り直す。届かないままだと台帳の枠が放置削除の期限まで塞がる */
  private async tellGone(spaceId: string, epoch: string): Promise<void> {
    try {
      await this.tell(spaceId, epoch)
    } catch {
      const untold: Untold = { space_id: spaceId, epoch }
      await this.ctx.storage.put(UNTOLD_KEY, untold)
      await this.ctx.storage.setAlarm(runtime.now() + RETELL_MS)
    }
  }

  /** 未通知の削除を台帳へ送り直す。alarm から呼ぶ */
  private async retell(): Promise<void> {
    const untold = await this.ctx.storage.get<Untold>(UNTOLD_KEY)
    if (!untold) return
    try {
      await this.tell(untold.space_id, untold.epoch)
      await this.ctx.storage.delete(UNTOLD_KEY)
    } catch {
      await this.ctx.storage.setAlarm(runtime.now() + RETELL_MS)
    }
  }

  /** 最終使用を今にする(メモリだけ)。回数は数えない */
  private touch(m: Meta, now: number): void {
    if (!this.live) this.live = { minute: m.minute, minute_count: m.minute_count, day: m.day, day_count: m.day_count, day_records: m.day_records, last_used: m.last_used, flushed_at: m.last_used, minute_crossed: false }
    this.live.last_used = now
    m.last_used = now
  }

  /** 認証を通った要求の入口。消えていれば 404、回数を超えれば 429、通れば回数と最終使用を進める(メモリだけ。DB へは flushIfDue か書き込みの相乗りで) */
  private async enter(): Promise<Meta | ApiResult> {
    const cfg = this.config
    const now = runtime.now()
    const m = this.meta()
    if (!m) return NOT_FOUND
    if (this.expired(m, now, cfg)) {
      await this.wipe()
      await this.tellGone(m.space_id, m.epoch)
      return NOT_FOUND
    }
    this.touch(m, now)
    const live = this.live as Live
    const minute = Math.floor(now / MINUTE)
    const day = Math.floor(now / DAY)
    const minuteCount = live.minute === minute ? live.minute_count : 0
    const dayCount = live.day === day ? live.day_count : 0
    const dayRecords = live.day === day ? live.day_records : 0
    // 超えた要求は数えない。連打で書き込みの費用を増やさないため
    if (cfg.ratePerMinute > 0 && minuteCount >= cfg.ratePerMinute) return limited((minute + 1) * MINUTE - now)
    // 日の上限の待ちは 1 時間で丸める。端末は 10 分おきに試すので、日の境目まで黙って止めない
    if (cfg.ratePerDay > 0 && dayCount >= cfg.ratePerDay) return limited(Math.min(HOUR, (day + 1) * DAY - now))
    if (live.minute !== minute) live.minute_crossed = true
    live.minute = minute
    live.minute_count = minuteCount + 1
    live.day = day
    live.day_count = dayCount + 1
    live.day_records = dayRecords
    Object.assign(m, { minute, minute_count: live.minute_count, day, day_count: live.day_count, day_records: dayRecords })
    return m
  }

  /** 回数と最終使用を DB に写す。m は台帳を待つ間に古くなっていることがあるので、メモリの値を優先する */
  private flush(m: Meta): void {
    const cur = this.live ?? m
    this.write('UPDATE meta SET minute = ?, minute_count = ?, day = ?, day_count = ?, day_records = ?, last_used = ? WHERE id = 1', cur.minute, cur.minute_count, cur.day, cur.day_count, cur.day_records, cur.last_used)
    this.flushed(cur.last_used)
  }

  private flushed(now: number): void {
    if (!this.live) return
    this.live.flushed_at = now
    this.live.minute_crossed = false
  }

  /** 分の境目をまたいだか、前回から FLUSH_MS たっていれば写す。確認のたびに行を書かないため */
  private flushIfDue(m: Meta): void {
    const live = this.live
    if (!live) return
    if (live.minute_crossed || m.last_used - live.flushed_at >= FLUSH_MS) this.flush(m)
  }

  /** 日の変わり目と 1 時間ごとに台帳へ報告する。失敗しても同期を止めない。報告の時刻を書くときに回数と最終使用も一緒に写す */
  private async report(m: Meta): Promise<void> {
    const now = m.last_used
    const day = Math.floor(now / DAY)
    if (m.reported_day === day && now - m.reported_at < HOUR) return
    try {
      await this.env.LEDGER.getByName('ledger').report({
        space_id: m.space_id,
        epoch: m.epoch,
        last_access_at: now,
        used_bytes: m.used_bytes,
        record_count: m.record_count,
        req_recent: m.day_count,
      })
      m.reported_at = now
      m.reported_day = day
      // 台帳を待つ間にほかの要求が回数を進めているので、m ではなく今の値を書く。消されたか作り直されていれば書かない
      const cur = this.meta()
      if (!cur || cur.epoch !== m.epoch) return
      // 回数と最終使用もこの 1 行に乗せる
      this.write('UPDATE meta SET reported_at = ?, reported_day = ?, minute = ?, minute_count = ?, day = ?, day_count = ?, day_records = ?, last_used = ? WHERE id = 1', now, day, cur.minute, cur.minute_count, cur.day, cur.day_count, cur.day_records, cur.last_used)
      this.flushed(cur.last_used)
    } catch {
      // 次の要求でまた試す
    }
  }

  /** 作成済みなら最終使用を進めて返す。無ければ null */
  async existing(): Promise<{ epoch: string } | null> {
    const m = this.meta()
    if (!m) return null
    const now = runtime.now()
    if (this.expired(m, now, this.config)) {
      await this.wipe()
      await this.tellGone(m.space_id, m.epoch)
      return null
    }
    this.touch(m, now)
    this.flushIfDue(m)
    await this.report(m)
    return { epoch: m.epoch }
  }

  async create(spaceId: string): Promise<{ epoch: string; created: boolean }> {
    const cur = await this.existing()
    if (cur) return { ...cur, created: false }
    const now = runtime.now()
    const epoch = randomToken(16)
    const day = Math.floor(now / DAY)
    this.ctx.storage.transactionSync(() => {
      this.write(SCHEMA)
      this.write(
        `INSERT INTO meta (id, space_id, epoch, next, gc_floor, created_at, last_used, used_bytes, record_count, ever_written, minute, minute_count, day, day_count, day_records, full_pulls, reported_at, reported_day, db_version)
         VALUES (1, ?, ?, 0, 0, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, '[]', ?, ?, ?)`,
        spaceId, epoch, now, now, now, day, DB_VERSION,
      )
    })
    this.hasSchema = true
    this.live = null
    // 作り直しは台帳の行を入れ直すので、前の領域の未通知の印は要らない
    await this.ctx.storage.delete(UNTOLD_KEY)
    await this.arm()
    return { epoch, created: true }
  }

  async head(ifNoneMatch: string | null): Promise<ApiResult> {
    const m = await this.enter()
    if ('status' in m) return m
    await this.report(m)
    const etag = `"${m.epoch}:${m.next}"`
    // Cloudflare は圧縮すると ETag を弱いものに書き換えるので、W/ を除いて比べる
    // 変化なしの確認は一番多い要求なので、行を書かない(回数と最終使用はメモリに残る)
    if (ifNoneMatch?.replace(/^W\//, '') === etag) return { status: 304, body: '', etag }
    this.flushIfDue(m)
    return result(200, { version: m.next, epoch: m.epoch, gc_floor: m.gc_floor, ...paceOf(this.config) }, etag)
  }

  async usage(): Promise<ApiResult> {
    const m = await this.enter()
    if ('status' in m) return m
    await this.report(m)
    this.flushIfDue(m)
    const cfg = this.config
    return result(200, { used_bytes: m.used_bytes, record_count: m.record_count, quota_bytes: cfg.quotaBytes, quota_records: cfg.quotaRecords, epoch: m.epoch, gc_floor: m.gc_floor })
  }

  async changes(since: number): Promise<ApiResult> {
    const m = await this.enter()
    if ('status' in m) return m
    const cfg = this.config
    const now = m.last_used
    // 空の領域の全件は重くない。使い始めの端末を止めないよう数えない
    if (since === 0 && cfg.fullPullPerHour > 0 && m.record_count > 0) {
      const pulls = (JSON.parse(m.full_pulls) as number[]).filter((at) => now - at < HOUR)
      if (pulls.length >= cfg.fullPullPerHour) return limited(HOUR)
      pulls.push(now)
      m.full_pulls = JSON.stringify(pulls)
      this.write('UPDATE meta SET full_pulls = ?, minute = ?, minute_count = ?, day = ?, day_count = ?, day_records = ?, last_used = ? WHERE id = 1', m.full_pulls, m.minute, m.minute_count, m.day, m.day_count, m.day_records, now)
      this.flushed(now)
    }
    const page: ReturnType<typeof toWire>[] = []
    let bytes = 0
    let more = false
    for (const r of this.sql.exec<RecordRow>('SELECT * FROM records WHERE version > ? ORDER BY version LIMIT ?', since, cfg.pageRecords + 1)) {
      bytes += r.ciphertext.length + r.nonce.length
      if (page.length > 0 && (page.length >= cfg.pageRecords || bytes > cfg.pageBytes)) {
        more = true
        break
      }
      page.push(toWire(r))
    }
    await this.report(m)
    this.flushIfDue(m)
    return result(200, { records: page, head: m.next, more, epoch: m.epoch, gc_floor: m.gc_floor, ...paceOf(cfg) })
  }

  async records(input: PushInput): Promise<ApiResult> {
    const m = await this.enter()
    if ('status' in m) return m
    // 見たことのない version を土台にした要求は端末の不具合。採番を進めずに断る
    if ((input.records as InputRecord[]).some((r) => r.base_version > m.next)) {
      this.flushIfDue(m)
      return failure(400, 'bad_request')
    }
    const replay = this.replay(input.request_id, m)
    if (replay) {
      await this.report(m)
      this.flushIfDue(m)
      return replay
    }
    const cfg = this.config
    // 送られた件数で先に決め、途中まで書かない。超えた要求は 1 行も書かない。待ちは日の上限と同じく 1 時間で丸める
    if (cfg.recordsPerDay > 0 && m.day_records + input.records.length > cfg.recordsPerDay) {
      this.flushIfDue(m)
      return limited(Math.min(HOUR, (m.day + 1) * DAY - m.last_used))
    }
    let out: ReturnType<SpaceDO['applyPush']>
    try {
      out = this.ctx.storage.transactionSync(() => this.applyPush(input, m, cfg))
    } catch (e) {
      if (e instanceof QuotaExceeded) {
        this.flushIfDue(m)
        return failure(413, 'quota_exceeded')
      }
      throw e
    }
    Object.assign(m, { next: out.next, used_bytes: out.bytes, record_count: out.count, ever_written: out.written, day_records: out.day_records })
    if (this.live) this.live.day_records = out.day_records
    this.flushed(m.last_used)
    await this.report(m)
    return result(200, { results: out.results, epoch: m.epoch, gc_floor: m.gc_floor, ...paceOf(cfg) })
  }

  /** 同じ request_id は採番し直さない。409 のレコードは今の値を入れる(端末はマージするだけ) */
  private replay(requestId: string, m: Meta): ApiResult | null {
    const rows = this.sql.exec<{ results: string }>('SELECT results FROM requests WHERE request_id = ?', requestId).toArray()
    if (rows.length === 0) return null
    const stored = JSON.parse(rows[0].results) as StoredResult[]
    const results: unknown[] = []
    for (const s of stored) {
      if (s.status === 200) {
        results.push(s)
        continue
      }
      const cur = this.sql.exec<RecordRow>('SELECT * FROM records WHERE record_id = ?', s.record_id).toArray()
      // 片づけで消えていたら初めての要求として扱う。自分の値は 409 で返り、マージしても変わらない
      if (cur.length === 0) return null
      results.push({ record_id: s.record_id, status: 409, record: toWire(cur[0]) })
    }
    return result(200, { results, epoch: m.epoch, gc_floor: m.gc_floor })
  }

  /** トランザクションの中で呼ぶ。m は書き換えず、新しい値を返す(途中で失敗しても m が崩れないように) */
  private applyPush(input: PushInput, m: Meta, cfg: Config): { results: unknown[]; next: number; bytes: number; count: number; written: number; day_records: number } {
    const now = m.last_used
    let next = m.next
    let dayRecords = m.day_records
    let bytes = m.used_bytes
    let count = m.record_count
    let conflictBytes = 0
    const results: unknown[] = []
    const stored: StoredResult[] = []
    for (const r of input.records as InputRecord[]) {
      const cur = this.sql.exec<RecordRow>('SELECT * FROM records WHERE record_id = ?', r.record_id).toArray()[0]
      if (cur && cur.version > r.base_version) {
        // 上限を超える分は結果に入れない。端末は送信待ちのまま次の回で送り直す
        conflictBytes += cur.ciphertext.length + 256
        if (conflictBytes > cfg.conflictBytes) continue
        results.push({ record_id: r.record_id, status: 409, record: toWire(cur) })
        stored.push({ record_id: r.record_id, status: 409 })
        continue
      }
      next++
      dayRecords++
      bytes += r.ciphertext.length - (cur?.ciphertext.length ?? 0)
      if (!cur) count++
      // 置き換えは行の更新で(INSERT OR REPLACE は削除と挿入で索引も 2 度書く)
      this.write(
        `INSERT INTO records (record_id, version, kind_tag, schema_version, deleted, nonce, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (record_id) DO UPDATE SET version = excluded.version, kind_tag = excluded.kind_tag, schema_version = excluded.schema_version, deleted = excluded.deleted, nonce = excluded.nonce, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
        r.record_id, next, r.kind_tag, r.schema_version, r.deleted ? 1 : 0, r.nonce, r.ciphertext, now,
      )
      const ok = { record_id: r.record_id, status: 200, version: next }
      results.push(ok)
      stored.push(ok)
    }
    // tombstone も数える。外す効果は片づけまで遅れる
    if (bytes > cfg.quotaBytes || count > cfg.quotaRecords) throw new QuotaExceeded()
    const written = next !== m.next ? 1 : m.ever_written
    // 回数と最終使用もこの 1 行に乗せる
    this.write(
      'UPDATE meta SET next = ?, used_bytes = ?, record_count = ?, ever_written = ?, minute = ?, minute_count = ?, day = ?, day_count = ?, day_records = ?, last_used = ? WHERE id = 1',
      next, bytes, count, written, m.minute, m.minute_count, m.day, m.day_count, dayRecords, now,
    )
    // 採番しなかった要求(すべて 409)は覚えない。送り直しても 409 で今の値が返り、写しと同じ応答になる。
    // 覚えると片づけ(通番の区切りで動く)に掛からず、409 を繰り返す端末で行が増え続ける
    if (next !== m.next) this.write('INSERT INTO requests (request_id, results, at, head) VALUES (?, ?, ?, ?)', input.request_id, JSON.stringify(stored), now, next)
    // 保存の枠の外で溜まらないよう件数で切る。毎回ではなく、通番が TRIM_EVERY の区切りを越えたときだけ(実体が落ちても区切りは変わらない)
    if (Math.floor(next / TRIM_EVERY) !== Math.floor(m.next / TRIM_EVERY)) {
      this.write('DELETE FROM requests WHERE head < (SELECT head FROM requests ORDER BY head DESC LIMIT 1 OFFSET ?)', REQUESTS_KEPT - TRIM_EVERY - 1)
    }
    return { results, next, bytes, count, written, day_records: dayRecords }
  }

  /** 端末からの領域の削除 */
  async remove(): Promise<ApiResult> {
    const m = await this.enter()
    if ('status' in m) return m
    await this.wipe()
    await this.tellGone(m.space_id, m.epoch)
    return result(200, { deleted: true })
  }

  /** 押し出し。確かめて消すまでの間に要求が割り込まないよう、同期の処理の中で決める */
  async evictIfIdle(cutoff: number): Promise<{ gone: boolean; last_used?: number }> {
    const m = this.meta()
    if (!m) return { gone: true }
    if (m.last_used > cutoff) return { gone: false, last_used: m.last_used }
    await this.wipe()
    return { gone: true }
  }

  /** 管理者の削除。epoch があれば、その後に作り直された領域に触らない */
  async adminWipe(epoch: string | null): Promise<void> {
    const m = this.meta()
    if (!m) return
    if (epoch !== null && m.epoch !== epoch) return
    await this.wipe()
  }

  info(): SpaceInfo {
    const m = this.meta()
    if (!m) return { exists: false }
    return { exists: true, epoch: m.epoch, created_at: m.created_at, last_used: m.last_used, used_bytes: m.used_bytes, record_count: m.record_count, records_today: m.day === Math.floor(runtime.now() / DAY) ? m.day_records : 0 }
  }

  /** 放置削除と片づけ。alarm から呼ぶ */
  async housekeep(): Promise<void> {
    const m = this.meta()
    if (!m) return
    const cfg = this.config
    const now = runtime.now()
    if (this.expired(m, now, cfg)) {
      await this.wipe()
      await this.tellGone(m.space_id, m.epoch)
      return
    }
    this.ctx.storage.transactionSync(() => {
      const cutoff = now - cfg.tombGcDays * DAY
      const old = this.sql.exec<{ n: number; top: number | null; size: number | null }>('SELECT COUNT(*) AS n, MAX(version) AS top, SUM(LENGTH(ciphertext)) AS size FROM records WHERE deleted = 1 AND updated_at <= ?', cutoff).one()
      if (old.n > 0) {
        this.write('DELETE FROM records WHERE deleted = 1 AND updated_at <= ?', cutoff)
        this.write('UPDATE meta SET gc_floor = MAX(gc_floor, ?), used_bytes = used_bytes - ?, record_count = record_count - ? WHERE id = 1', old.top, old.size, old.n)
      }
      this.write('DELETE FROM requests WHERE at <= ?', now - REQUESTS_TTL_MS)
    })
  }

  private async arm(): Promise<void> {
    const m = this.meta()
    if (!m) return
    const cfg = this.config
    const now = runtime.now()
    const deadlines = [m.last_used + cfg.idleDeleteDays * DAY]
    if (cfg.emptySpaceDays > 0 && m.ever_written === 0) deadlines.push(m.last_used + cfg.emptySpaceDays * DAY)
    const tomb = this.sql.exec<{ at: number | null }>('SELECT MIN(updated_at) AS at FROM records WHERE deleted = 1').one().at
    if (tomb !== null) deadlines.push(tomb + cfg.tombGcDays * DAY)
    await this.ctx.storage.setAlarm(Math.max(now + MINUTE, Math.min(...deadlines)))
  }

  override async alarm(): Promise<void> {
    await this.retell()
    try {
      await this.housekeep()
    } finally {
      // 失敗しても次を仕掛ける。alarm の再試行には回数の上限がある
      await this.arm()
    }
  }
}
