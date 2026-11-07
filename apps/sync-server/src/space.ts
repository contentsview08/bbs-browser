// 領域 1 つの Durable Object。通番・保存・楽観ロック・領域ごとの回数を持つ。中身は暗号文のまま扱う
import { DurableObject } from 'cloudflare:workers'
import { DAY, HOUR, MINUTE, loadConfig, type Config, type Env } from './config'
import { failure, result, type ApiResult } from './http'
import { randomToken } from './encoding'
import { runtime } from './runtime'
import type { InputRecord, PushInput } from './validate'

const REQUESTS_KEPT = 64
const REQUESTS_TTL_MS = 7 * DAY

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
  full_pulls TEXT NOT NULL,
  reported_at INTEGER NOT NULL,
  reported_day INTEGER NOT NULL
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
CREATE TABLE requests (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  results TEXT NOT NULL,
  at INTEGER NOT NULL
);
`

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
  full_pulls: string
  reported_at: number
  reported_day: number
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

export interface SpaceInfo {
  exists: boolean
  epoch?: string
  created_at?: number
  last_used?: number
  used_bytes?: number
  record_count?: number
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
  }

  protected get config(): Config {
    return loadConfig(this.env)
  }

  protected meta(): Meta | null {
    if (this.hasSchema === null) this.hasSchema = this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length > 0
    if (!this.hasSchema) return null
    const rows = this.sql.exec('SELECT * FROM meta WHERE id = 1').toArray()
    return rows.length === 0 ? null : (rows[0] as unknown as Meta)
  }

  private expired(m: Meta, now: number, cfg: Config): boolean {
    if (now - m.last_used >= cfg.idleDeleteDays * DAY) return true
    return cfg.emptySpaceDays > 0 && m.ever_written === 0 && now - m.last_used >= cfg.emptySpaceDays * DAY
  }

  private async wipe(): Promise<void> {
    this.hasSchema = false
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
  }

  private async tellGone(spaceId: string, epoch: string): Promise<void> {
    try {
      await this.env.LEDGER.getByName('ledger').spaceGone(spaceId, epoch)
    } catch {
      // 台帳の alarm が照合して直す
    }
  }

  /** 認証を通った要求の入口。消えていれば 404、回数を超えれば 429、通れば最終使用を進める */
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
    const minute = Math.floor(now / MINUTE)
    const day = Math.floor(now / DAY)
    const minuteCount = m.minute === minute ? m.minute_count : 0
    const dayCount = m.day === day ? m.day_count : 0
    // 超えた要求は書かない。連打で書き込みの費用を増やさないため
    if (cfg.ratePerMinute > 0 && minuteCount >= cfg.ratePerMinute) return limited((minute + 1) * MINUTE - now)
    if (cfg.ratePerDay > 0 && dayCount >= cfg.ratePerDay) return limited((day + 1) * DAY - now)
    m.minute = minute
    m.minute_count = minuteCount + 1
    m.day = day
    m.day_count = dayCount + 1
    m.last_used = now
    this.sql.exec('UPDATE meta SET minute = ?, minute_count = ?, day = ?, day_count = ?, last_used = ? WHERE id = 1', minute, m.minute_count, day, m.day_count, now)
    return m
  }

  /** 日の変わり目と 1 時間ごとに台帳へ報告する。失敗しても同期を止めない */
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
      this.sql.exec('UPDATE meta SET reported_at = ?, reported_day = ? WHERE id = 1', now, day)
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
    this.sql.exec('UPDATE meta SET last_used = ? WHERE id = 1', now)
    m.last_used = now
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
      this.sql.exec(SCHEMA)
      this.sql.exec(
        `INSERT INTO meta (id, space_id, epoch, next, gc_floor, created_at, last_used, used_bytes, record_count, ever_written, minute, minute_count, day, day_count, full_pulls, reported_at, reported_day)
         VALUES (1, ?, ?, 0, 0, ?, ?, 0, 0, 0, 0, 0, 0, 0, '[]', ?, ?)`,
        spaceId, epoch, now, now, now, day,
      )
    })
    this.hasSchema = true
    await this.arm()
    return { epoch, created: true }
  }

  async head(ifNoneMatch: string | null): Promise<ApiResult> {
    const m = await this.enter()
    if ('status' in m) return m
    await this.report(m)
    const etag = `"${m.epoch}:${m.next}"`
    // Cloudflare は圧縮すると ETag を弱いものに書き換えるので、W/ を除いて比べる
    if (ifNoneMatch?.replace(/^W\//, '') === etag) return { status: 304, body: '', etag }
    return result(200, { version: m.next, epoch: m.epoch, gc_floor: m.gc_floor, ...paceOf(this.config) }, etag)
  }

  async usage(): Promise<ApiResult> {
    const m = await this.enter()
    if ('status' in m) return m
    await this.report(m)
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
      this.sql.exec('UPDATE meta SET full_pulls = ? WHERE id = 1', JSON.stringify(pulls))
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
    return result(200, { records: page, head: m.next, more, epoch: m.epoch, gc_floor: m.gc_floor, ...paceOf(cfg) })
  }

  async records(input: PushInput): Promise<ApiResult> {
    const m = await this.enter()
    if ('status' in m) return m
    const replay = this.replay(input.request_id, m)
    if (replay) {
      await this.report(m)
      return replay
    }
    const cfg = this.config
    let out: ReturnType<SpaceDO['applyPush']>
    try {
      out = this.ctx.storage.transactionSync(() => this.applyPush(input, m, cfg))
    } catch (e) {
      if (e instanceof QuotaExceeded) return failure(413, 'quota_exceeded')
      throw e
    }
    const after = this.meta() as Meta
    await this.report(after)
    return result(200, { results: out, epoch: after.epoch, gc_floor: after.gc_floor, ...paceOf(this.config) })
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

  private applyPush(input: PushInput, m: Meta, cfg: Config): unknown[] {
    const now = m.last_used
    let next = m.next
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
      bytes += r.ciphertext.length - (cur?.ciphertext.length ?? 0)
      if (!cur) count++
      this.sql.exec(
        `INSERT OR REPLACE INTO records (record_id, version, kind_tag, schema_version, deleted, nonce, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        r.record_id, next, r.kind_tag, r.schema_version, r.deleted ? 1 : 0, r.nonce, r.ciphertext, now,
      )
      const ok = { record_id: r.record_id, status: 200, version: next }
      results.push(ok)
      stored.push(ok)
    }
    // tombstone も数える。外す効果は片づけまで遅れる
    if (bytes > cfg.quotaBytes || count > cfg.quotaRecords) throw new QuotaExceeded()
    const written = next !== m.next ? 1 : m.ever_written
    this.sql.exec('UPDATE meta SET next = ?, used_bytes = ?, record_count = ?, ever_written = ? WHERE id = 1', next, bytes, count, written)
    this.sql.exec('INSERT INTO requests (request_id, results, at) VALUES (?, ?, ?)', input.request_id, JSON.stringify(stored), now)
    // 保存の枠の外で溜まらないよう、件数で切る
    this.sql.exec('DELETE FROM requests WHERE seq <= (SELECT MAX(seq) FROM requests) - ?', REQUESTS_KEPT)
    return results
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
    return { exists: true, epoch: m.epoch, created_at: m.created_at, last_used: m.last_used, used_bytes: m.used_bytes, record_count: m.record_count }
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
        this.sql.exec('DELETE FROM records WHERE deleted = 1 AND updated_at <= ?', cutoff)
        this.sql.exec('UPDATE meta SET gc_floor = MAX(gc_floor, ?), used_bytes = used_bytes - ?, record_count = record_count - ? WHERE id = 1', old.top, old.size, old.n)
      }
      this.sql.exec('DELETE FROM requests WHERE at <= ?', now - REQUESTS_TTL_MS)
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
    try {
      await this.housekeep()
    } finally {
      // 失敗しても次を仕掛ける。alarm の再試行には回数の上限がある
      await this.arm()
    }
  }
}
