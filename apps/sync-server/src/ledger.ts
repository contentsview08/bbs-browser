// 領域の一覧・枠・作成元・nonce・監査を 1 つの実体で持つ。1 つの処理が順に走るので、枠の確認と予約を 1 つのトランザクションにできる
import { DurableObject } from 'cloudflare:workers'
import { DAY, HOUR, MINUTE, loadConfig, type Config, type Env } from './config'
import { toHex, utf8 } from './encoding'
import { failure, result, type ApiResult } from './http'
import { runtime } from './runtime'
import type { SpaceInfo } from './space'
import { isCount, isObject } from './validate'

const WEEK = 7 * DAY
const PENDING_STALE_MS = 5 * MINUTE
const MAX_BLOCK_DAYS = 14
const MAX_IDS = 1000
const PAGE_DEFAULT = 100
const PAGE_MAX = 500

const SCHEMA = `
CREATE TABLE IF NOT EXISTS spaces (
  space_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_access_day INTEGER NOT NULL,
  last_access_at INTEGER NOT NULL,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  req_recent INTEGER NOT NULL DEFAULT 0,
  source_mac TEXT,
  state TEXT NOT NULL,
  state_at INTEGER NOT NULL,
  epoch TEXT,
  slot_moved INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS spaces_idle ON spaces (state, last_access_at, space_id);
CREATE INDEX IF NOT EXISTS spaces_used ON spaces (used_bytes, space_id);
CREATE TABLE IF NOT EXISTS source_keys (week INTEGER PRIMARY KEY, key BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS source_events (id INTEGER PRIMARY KEY AUTOINCREMENT, mac TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS source_events_mac ON source_events (mac, at);
CREATE INDEX IF NOT EXISTS source_events_at ON source_events (at);
CREATE TABLE IF NOT EXISTS source_blocks (mac TEXT PRIMARY KEY, until INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS flags (name TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, at INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, key_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, status INTEGER);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, total INTEGER NOT NULL, done INTEGER NOT NULL, failures INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS job_items (job_id TEXT NOT NULL, space_id TEXT NOT NULL, epoch TEXT, PRIMARY KEY (job_id, space_id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS job_items_space ON job_items (space_id);
`

export interface UsageReport {
  space_id: string
  epoch: string
  last_access_at: number
  used_bytes: number
  record_count: number
  req_recent: number
}

export type ReserveResult = { ok: true } | { ok: false; error: 'capacity_full' | 'creation_closed' }

export interface AdminCall {
  keyId: string
  nonce: string
  action: string
  param: string
  query: Record<string, string>
  body: unknown
}

interface SpaceRow {
  space_id: string
  created_at: number
  last_access_day: number
  last_access_at: number
  used_bytes: number
  record_count: number
  req_recent: number
  source_mac: string | null
  state: string
  state_at: number
  epoch: string | null
  slot_moved: number
  [key: string]: SqlStorageValue
}

const publicRow = (r: SpaceRow) => ({
  space_id: r.space_id,
  created_at: r.created_at,
  last_access_day: r.last_access_day,
  last_access_at: r.last_access_at,
  used_bytes: r.used_bytes,
  record_count: r.record_count,
  req_recent: r.req_recent,
  source_mac: r.source_mac,
  state: r.state,
})

export class LedgerDO extends DurableObject<Env> {
  protected sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(SCHEMA)
    ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(runtime.now() + HOUR)
    })
  }

  private get config(): Config {
    return loadConfig(this.env)
  }

  /** テストで差し替えて途中の失敗を起こす */
  protected space(id: string): DurableObjectStub<import('./space').SpaceDO> {
    return this.env.SPACE.getByName(id)
  }

  protected async wipeSpace(id: string, epoch: string | null): Promise<void> {
    await this.space(id).adminWipe(epoch)
  }

  protected async evictSpace(id: string, cutoff: number): Promise<{ gone: boolean; last_used?: number }> {
    return await this.space(id).evictIfIdle(cutoff)
  }

  // ── 作成元 ──

  private weekKeys(now: number): { week: number; key: ArrayBuffer }[] {
    const week = Math.floor(now / WEEK)
    this.sql.exec('DELETE FROM source_keys WHERE week < ?', week - 1)
    if (this.sql.exec('SELECT 1 FROM source_keys WHERE week = ?', week).toArray().length === 0) {
      this.sql.exec('INSERT INTO source_keys (week, key) VALUES (?, ?)', week, crypto.getRandomValues(new Uint8Array(32)).buffer)
    }
    return this.sql.exec<{ week: number; key: ArrayBuffer }>('SELECT week, key FROM source_keys ORDER BY week DESC').toArray()
  }

  /** 今週の鍵の値を先頭に、今週と先週の鍵で計算する。IP はここで HMAC になり、保存されない */
  private async sourceMacs(ip: string, now: number): Promise<string[]> {
    const keys = this.weekKeys(now)
    const out: string[] = []
    for (const k of keys) {
      const key = await crypto.subtle.importKey('raw', k.key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      out.push(toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(ip)))))
    }
    return out
  }

  // ── 作成の予約 ──

  /** 同時の作成で枠を超えないよう、確認と予約を 1 つのトランザクションで行う */
  async reserve(spaceId: string, ip: string): Promise<ReserveResult> {
    const cfg = this.config
    const now = runtime.now()
    // HMAC は非同期なので先に計算する。トランザクションの中で待たない
    const macs = await this.sourceMacs(ip, now)
    const cutoff = now - cfg.evictIdleDays * DAY
    let tries = 0
    let eventId = 0
    const pick = (): string | null => {
      const row = this.sql.exec<{ space_id: string }>("SELECT space_id FROM spaces WHERE state = 'active' AND last_access_at <= ? ORDER BY last_access_at, space_id LIMIT 1", cutoff).toArray()[0]
      if (!row) return null
      this.sql.exec("UPDATE spaces SET state = 'deleting', slot_moved = 1, state_at = ? WHERE space_id = ?", now, row.space_id)
      return row.space_id
    }
    const first = this.ctx.storage.transactionSync((): ReserveResult | { verify: string } => {
      if (cfg.creationClosed || this.sql.exec("SELECT 1 FROM flags WHERE name = 'creation_closed'").toArray().length > 0) return { ok: false, error: 'creation_closed' }
      const [thisWeek, lastWeek] = [macs[0], macs[1] ?? macs[0]]
      if (this.sql.exec('SELECT 1 FROM source_blocks WHERE until > ? AND mac IN (?, ?)', now, thisWeek, lastWeek).toArray().length > 0) return { ok: false, error: 'creation_closed' }
      const cur = this.sql.exec<SpaceRow>('SELECT * FROM spaces WHERE space_id = ?', spaceId).toArray()[0]
      // 領域の Durable Object は無いと答えたので、台帳の行だけが残っている。作り直しは枠を増やさない
      if (cur && cur.state !== 'deleting') {
        this.sql.exec("UPDATE spaces SET state = 'pending', state_at = ?, epoch = NULL WHERE space_id = ?", now, spaceId)
        return { ok: true }
      }
      if (cur && cur.slot_moved === 0) {
        // 管理者の削除の途中に作り直された。枠は持ったままで、消す対象から外す
        this.sql.exec('DELETE FROM job_items WHERE space_id = ?', spaceId)
        this.sql.exec("UPDATE spaces SET state = 'pending', state_at = ?, epoch = NULL WHERE space_id = ?", now, spaceId)
        return { ok: true }
      }
      if (cur) this.sql.exec('DELETE FROM spaces WHERE space_id = ?', spaceId)
      if (cfg.sourceLimit > 0) {
        const n = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM source_events WHERE at > ? AND mac IN (?, ?)', now - cfg.sourceWindowDays * DAY, thisWeek, lastWeek).one().n
        if (n >= cfg.sourceLimit) return { ok: false, error: 'creation_closed' }
      }
      const used = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM spaces WHERE state IN ('active', 'pending') OR (state = 'deleting' AND slot_moved = 0)").one().n
      let verify: string | null = null
      if (used >= cfg.spaceLimit) {
        verify = pick()
        if (!verify) return { ok: false, error: 'capacity_full' }
      }
      this.sql.exec(
        "INSERT INTO spaces (space_id, created_at, last_access_day, last_access_at, source_mac, state, state_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
        spaceId, now, Math.floor(now / DAY), now, macs[0], now,
      )
      eventId = this.sql.exec<{ id: number }>('INSERT INTO source_events (mac, at) VALUES (?, ?) RETURNING id', macs[0], now).one().id
      return verify ? { verify } : { ok: true }
    })
    if ('ok' in first) return first
    let candidate = first.verify
    for (;;) {
      tries++
      let outcome: { gone: boolean; last_used?: number }
      try {
        outcome = await this.evictSpace(candidate, cutoff)
      } catch {
        // 確かめられない領域は消さない。alarm がやり直す
        outcome = { gone: false }
      }
      const step = this.ctx.storage.transactionSync((): ReserveResult | { verify: string } => {
        if (outcome.gone) {
          // 候補の所有者が同時に作り直していれば行は pending に入れ直されている。それを消すと枠が 1 つ増える
          this.sql.exec("DELETE FROM spaces WHERE space_id = ? AND state = 'deleting'", candidate)
          return { ok: true }
        }
        if (outcome.last_used !== undefined) {
          // 報告が遅れていた。台帳を直して次の候補へ
          this.sql.exec("UPDATE spaces SET state = 'active', slot_moved = 0, state_at = ?, last_access_at = ?, last_access_day = ? WHERE space_id = ? AND state = 'deleting'", now, outcome.last_used, Math.floor(outcome.last_used / DAY), candidate)
        } else {
          this.sql.exec("UPDATE spaces SET state = 'active', slot_moved = 0, state_at = ? WHERE space_id = ? AND state = 'deleting'", now, candidate)
        }
        const next = tries < cfg.evictVerifyMax ? pick() : null
        if (next) return { verify: next }
        this.sql.exec("DELETE FROM spaces WHERE space_id = ? AND state = 'pending'", spaceId)
        this.sql.exec('DELETE FROM source_events WHERE id = ?', eventId)
        return { ok: false, error: 'capacity_full' }
      })
      if ('ok' in step) return step
      candidate = step.verify
    }
  }

  confirm(spaceId: string, epoch: string): void {
    const now = runtime.now()
    const n = this.sql.exec("UPDATE spaces SET state = 'active', epoch = ?, state_at = ? WHERE space_id = ?", epoch, now, spaceId).rowsWritten
    if (n === 0) {
      this.sql.exec("INSERT INTO spaces (space_id, created_at, last_access_day, last_access_at, state, state_at, epoch) VALUES (?, ?, ?, ?, 'active', ?, ?)", spaceId, now, Math.floor(now / DAY), now, now, epoch)
    }
  }

  /** 予約の後に領域を作れなかったとき、枠を返す */
  cancel(spaceId: string): void {
    this.sql.exec("DELETE FROM spaces WHERE space_id = ? AND state = 'pending'", spaceId)
  }

  /** 古い epoch の知らせは無視する。作り直された領域の枠を消さないため */
  spaceGone(spaceId: string, epoch: string): void {
    this.sql.exec('DELETE FROM spaces WHERE space_id = ? AND epoch = ?', spaceId, epoch)
  }

  /** 実体が消えた後に台帳の行を外す */
  forget(spaceId: string): void {
    this.sql.exec('DELETE FROM spaces WHERE space_id = ?', spaceId)
  }

  report(r: UsageReport): void {
    const day = Math.floor(r.last_access_at / DAY)
    const n = this.sql.exec(
      "UPDATE spaces SET last_access_at = MAX(last_access_at, ?), last_access_day = MAX(last_access_day, ?), used_bytes = ?, record_count = ?, req_recent = ?, epoch = ? WHERE space_id = ? AND state IN ('active', 'pending')",
      r.last_access_at, day, r.used_bytes, r.record_count, r.req_recent, r.epoch, r.space_id,
    ).rowsWritten
    if (n > 0) return
    // 行が無ければ台帳の抜け。実在する領域なので数に入れる
    if (this.sql.exec('SELECT 1 FROM spaces WHERE space_id = ?', r.space_id).toArray().length > 0) return
    const now = runtime.now()
    this.sql.exec(
      "INSERT INTO spaces (space_id, created_at, last_access_day, last_access_at, used_bytes, record_count, req_recent, state, state_at, epoch) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
      r.space_id, now, day, r.last_access_at, r.used_bytes, r.record_count, r.req_recent, now, r.epoch,
    )
  }

  // ── 管理 API ──

  /** nonce の確認と監査を同じ処理の中で行い、再送を通さない。署名は Worker が確かめ済み */
  async admin(call: AdminCall): Promise<ApiResult | null> {
    const now = runtime.now()
    const cfg = this.config
    this.sql.exec('DELETE FROM nonces WHERE at <= ?', now - cfg.adminNonceTtlSec * 1000)
    if (this.sql.exec('SELECT 1 FROM nonces WHERE nonce = ?', call.nonce).toArray().length > 0) return null
    this.sql.exec('INSERT INTO nonces (nonce, at) VALUES (?, ?)', call.nonce, now)
    const auditId = this.sql.exec<{ id: number }>('INSERT INTO audit (at, key_id, action, target) VALUES (?, ?, ?, ?) RETURNING id', now, call.keyId, call.action, this.auditTarget(call)).one().id
    let out: ApiResult
    try {
      out = await this.route(call, cfg, now)
    } catch {
      out = failure(500, 'internal')
    }
    this.sql.exec('UPDATE audit SET status = ? WHERE id = ?', out.status, auditId)
    return out
  }

  private auditTarget(call: AdminCall): string {
    if (call.param) return call.param
    if (isObject(call.body)) {
      if (Array.isArray(call.body.ids)) return `count:${call.body.ids.length}`
      if (isCount(call.body.expected_count)) return `count:${call.body.expected_count}`
      if (typeof call.body.value === 'string') return call.body.value
      if (typeof call.body.open === 'boolean') return call.body.open ? 'open' : 'closed'
    }
    return ''
  }

  private async route(call: AdminCall, cfg: Config, now: number): Promise<ApiResult> {
    switch (call.action) {
      case 'spaces.list':
        return this.listSpaces(call.query)
      case 'spaces.get':
        return await this.getSpace(call.param)
      case 'spaces.delete':
        return await this.deleteOne(call.param, cfg, now)
      case 'spaces.delete_many':
        return await this.deleteMany(call.body, cfg, now)
      case 'spaces.delete_all':
        return await this.deleteAll(call.body, cfg, now)
      case 'jobs.get':
        return this.getJob(call.param)
      case 'capacity':
        return result(200, this.capacity(cfg))
      case 'creation':
        return this.setCreation(call.body, cfg)
      case 'signals':
        return result(200, this.signals(now))
      case 'sources.block':
        return this.blockSource(call.body, now)
      case 'sources.unblock':
        this.sql.exec('DELETE FROM source_blocks WHERE mac = ?', call.param)
        return result(200, { unblocked: true })
      case 'audit':
        return this.auditList(call.query)
      default:
        return failure(404, 'not_found')
    }
  }

  private listSpaces(query: Record<string, string>): ApiResult {
    const limit = pageLimit(query.limit)
    if (limit === null) return failure(400, 'bad_request')
    const sort = query.sort ?? 'last_access'
    const m = query.cursor === undefined ? null : /^([0-9]{1,16}):([0-9a-f]{64})$/.exec(query.cursor)
    if (query.cursor !== undefined && !m) return failure(400, 'bad_request')
    const v = m ? Number(m[1]) : -1
    const id = m ? m[2] : ''
    let rows: SpaceRow[]
    if (sort === 'last_access') {
      rows = this.sql.exec<SpaceRow>('SELECT * FROM spaces WHERE last_access_at > ? OR (last_access_at = ? AND space_id > ?) ORDER BY last_access_at, space_id LIMIT ?', v, v, id, limit + 1).toArray()
    } else if (sort === 'created') {
      rows = this.sql.exec<SpaceRow>('SELECT * FROM spaces WHERE created_at > ? OR (created_at = ? AND space_id > ?) ORDER BY created_at, space_id LIMIT ?', v, v, id, limit + 1).toArray()
    } else if (sort === 'used_bytes') {
      rows = this.sql.exec<SpaceRow>('SELECT * FROM spaces WHERE used_bytes > ? OR (used_bytes = ? AND space_id > ?) ORDER BY used_bytes, space_id LIMIT ?', v, v, id, limit + 1).toArray()
    } else {
      return failure(400, 'bad_request')
    }
    const page = rows.slice(0, limit)
    const last = page[page.length - 1]
    const key = sort === 'last_access' ? 'last_access_at' : sort === 'created' ? 'created_at' : 'used_bytes'
    return result(200, { spaces: page.map(publicRow), next_cursor: rows.length > limit ? `${last[key]}:${last.space_id}` : null })
  }

  private async getSpace(id: string): Promise<ApiResult> {
    const row = this.sql.exec<SpaceRow>('SELECT * FROM spaces WHERE space_id = ?', id).toArray()[0]
    if (!row) return failure(404, 'not_found')
    const live: SpaceInfo = await this.space(id).info()
    return result(200, { ...publicRow(row), live: { exists: live.exists, last_used: live.last_used ?? null, used_bytes: live.used_bytes ?? null, record_count: live.record_count ?? null, records_today: live.records_today ?? null } })
  }

  private startJob(kind: string, rows: { space_id: string; epoch: string | null }[], now: number): string {
    const id = crypto.randomUUID()
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO jobs (id, kind, state, total, done, failures, created_at, updated_at) VALUES (?, ?, 'running', ?, 0, 0, ?, ?)", id, kind, rows.length, now, now)
      for (const r of rows) {
        this.sql.exec('INSERT INTO job_items (job_id, space_id, epoch) VALUES (?, ?, ?)', id, r.space_id, r.epoch)
        this.sql.exec("UPDATE spaces SET state = 'deleting', slot_moved = 0, state_at = ? WHERE space_id = ?", now, r.space_id)
      }
    })
    return id
  }

  private jobView(id: string): { id: string; kind: string; state: string; total: number; done: number; failures: number } | null {
    const j = this.sql.exec<{ id: string; kind: string; state: string; total: number; done: number; failures: number }>('SELECT id, kind, state, total, done, failures FROM jobs WHERE id = ?', id).toArray()[0]
    return j ?? null
  }

  private async deleteOne(id: string, cfg: Config, now: number): Promise<ApiResult> {
    const row = this.sql.exec<SpaceRow>('SELECT * FROM spaces WHERE space_id = ?', id).toArray()[0]
    if (!row) return failure(404, 'not_found')
    const job = this.startJob('one', [{ space_id: id, epoch: row.epoch }], now)
    await this.tick(cfg, now)
    return result(200, { job: this.jobView(job) })
  }

  private async deleteMany(body: unknown, cfg: Config, now: number): Promise<ApiResult> {
    if (!isObject(body) || Object.keys(body).sort().join() !== 'expected_count,ids') return failure(400, 'bad_request')
    const ids = body.ids
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS || !ids.every((x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)) || !isCount(body.expected_count)) return failure(400, 'bad_request')
    const rows: { space_id: string; epoch: string | null }[] = []
    for (const id of new Set(ids as string[])) {
      const r = this.sql.exec<SpaceRow>("SELECT * FROM spaces WHERE space_id = ? AND state = 'active'", id).toArray()[0]
      if (r) rows.push({ space_id: r.space_id, epoch: r.epoch })
    }
    if (rows.length !== body.expected_count) return result(409, { error: 'count_mismatch', actual: rows.length })
    const job = this.startJob('many', rows, now)
    await this.tick(cfg, now)
    return result(202, { job: this.jobView(job) })
  }

  private async deleteAll(body: unknown, cfg: Config, now: number): Promise<ApiResult> {
    if (!isObject(body) || Object.keys(body).sort().join() !== 'confirm,expected_count') return failure(400, 'bad_request')
    if (!isCount(body.expected_count) || typeof body.confirm !== 'string') return failure(400, 'bad_request')
    const rows = this.sql.exec<{ space_id: string; epoch: string | null }>("SELECT space_id, epoch FROM spaces WHERE state = 'active'").toArray()
    if (rows.length !== body.expected_count) return result(409, { error: 'count_mismatch', actual: rows.length })
    if (body.confirm !== `DELETE ALL ${rows.length} SPACES`) return failure(400, 'bad_confirm')
    const job = this.startJob('all', rows, now)
    await this.tick(cfg, now)
    return result(202, { job: this.jobView(job) })
  }

  private getJob(id: string): ApiResult {
    const j = this.jobView(id)
    return j ? result(200, { job: j }) : failure(404, 'not_found')
  }

  private capacity(cfg: Config) {
    const n = (state: string) => this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM spaces WHERE state = ?', state).one().n
    const used = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM spaces WHERE state IN ('active', 'pending') OR (state = 'deleting' AND slot_moved = 0)").one().n
    const flagged = this.sql.exec("SELECT 1 FROM flags WHERE name = 'creation_closed'").toArray().length > 0
    return { limit: cfg.spaceLimit, used, active: n('active'), pending: n('pending'), deleting: n('deleting'), creation_open: !cfg.creationClosed && !flagged, creation_closed_by_env: cfg.creationClosed, read_only: cfg.readOnly }
  }

  private setCreation(body: unknown, cfg: Config): ApiResult {
    if (!isObject(body) || Object.keys(body).join() !== 'open' || typeof body.open !== 'boolean') return failure(400, 'bad_request')
    if (body.open) this.sql.exec("DELETE FROM flags WHERE name = 'creation_closed'")
    else this.sql.exec("INSERT OR REPLACE INTO flags (name, value) VALUES ('creation_closed', '1')")
    return result(200, this.capacity(cfg))
  }

  private signals(now: number) {
    return {
      sources: this.sql.exec('SELECT mac, COUNT(*) AS created FROM source_events GROUP BY mac ORDER BY created DESC LIMIT 50').toArray(),
      hourly: this.sql.exec('SELECT at / ? AS hour, COUNT(*) AS created FROM source_events GROUP BY hour ORDER BY hour DESC LIMIT 168', HOUR).toArray(),
      top_usage: this.sql.exec("SELECT space_id, used_bytes, record_count FROM spaces WHERE state = 'active' ORDER BY used_bytes DESC LIMIT 20").toArray(),
      top_requests: this.sql.exec("SELECT space_id, req_recent FROM spaces WHERE state = 'active' ORDER BY req_recent DESC LIMIT 20").toArray(),
      unused: this.sql.exec("SELECT space_id, created_at FROM spaces WHERE state = 'active' AND record_count = 0 AND created_at <= ? ORDER BY created_at LIMIT 50", now - DAY).toArray(),
    }
  }

  private blockSource(body: unknown, now: number): ApiResult {
    if (!isObject(body)) return failure(400, 'bad_request')
    for (const k of Object.keys(body)) if (k !== 'value' && k !== 'days') return failure(400, 'bad_request')
    if (typeof body.value !== 'string' || !/^[0-9a-f]{64}$/.test(body.value)) return failure(400, 'bad_request')
    const days = body.days === undefined ? 7 : body.days
    // 鍵が捨てられると比べられなくなるので、鍵の寿命より長くしない
    if (!isCount(days) || days < 1 || days > MAX_BLOCK_DAYS) return failure(400, 'bad_request')
    const until = now + days * DAY
    this.sql.exec('INSERT OR REPLACE INTO source_blocks (mac, until) VALUES (?, ?)', body.value, until)
    return result(200, { blocked: true, until })
  }

  private auditList(query: Record<string, string>): ApiResult {
    const limit = pageLimit(query.limit)
    if (limit === null) return failure(400, 'bad_request')
    if (query.cursor !== undefined && !/^[0-9]{1,16}$/.test(query.cursor)) return failure(400, 'bad_request')
    const cursor = query.cursor === undefined ? Number.MAX_SAFE_INTEGER : Number(query.cursor)
    const rows = this.sql.exec<{ id: number }>('SELECT id, at, key_id, action, target, status FROM audit WHERE id < ? ORDER BY id DESC LIMIT ?', cursor, limit + 1).toArray()
    const page = rows.slice(0, limit)
    return result(200, { entries: page, next_cursor: rows.length > limit ? page[page.length - 1].id : null })
  }

  // ── 少しずつ進める処理 ──

  private async tick(cfg: Config, now: number): Promise<boolean> {
    const items = this.sql.exec<{ job_id: string; space_id: string; epoch: string | null }>("SELECT i.job_id, i.space_id, i.epoch FROM job_items i JOIN jobs j ON j.id = i.job_id WHERE j.state = 'running' LIMIT ?", cfg.jobBatch).toArray()
    for (const it of items) {
      try {
        await this.wipeSpace(it.space_id, it.epoch)
      } catch {
        this.sql.exec('UPDATE jobs SET failures = failures + 1, updated_at = ? WHERE id = ?', now, it.job_id)
        continue
      }
      this.ctx.storage.transactionSync(() => {
        const removed = this.sql.exec('DELETE FROM job_items WHERE job_id = ? AND space_id = ?', it.job_id, it.space_id).rowsWritten
        if (removed === 0) return
        this.sql.exec("DELETE FROM spaces WHERE space_id = ? AND state = 'deleting'", it.space_id)
        this.sql.exec('UPDATE jobs SET done = done + 1, updated_at = ? WHERE id = ?', now, it.job_id)
      })
    }
    this.sql.exec("UPDATE jobs SET state = 'done', updated_at = ? WHERE state = 'running' AND NOT EXISTS (SELECT 1 FROM job_items i WHERE i.job_id = jobs.id)", now)
    const left = this.sql.exec("SELECT 1 FROM jobs WHERE state = 'running' LIMIT 1").toArray().length > 0
    if (left) await this.ctx.storage.setAlarm(now + 1000)
    return left
  }

  /** 途中で落ちた予約と押し出しを直し、台帳と実体のずれを埋める */
  private async reconcile(cfg: Config, now: number): Promise<void> {
    const stale = this.sql.exec<SpaceRow>("SELECT * FROM spaces WHERE state = 'pending' AND state_at <= ? LIMIT 50", now - PENDING_STALE_MS).toArray()
    for (const r of stale) {
      const live = await this.space(r.space_id).info()
      if (live.exists) this.sql.exec("UPDATE spaces SET state = 'active', epoch = ?, state_at = ? WHERE space_id = ? AND state = 'pending'", live.epoch as string, now, r.space_id)
      else this.sql.exec("DELETE FROM spaces WHERE space_id = ? AND state = 'pending'", r.space_id)
    }
    const moved = this.sql.exec<SpaceRow>("SELECT * FROM spaces WHERE state = 'deleting' AND slot_moved = 1 AND state_at <= ? LIMIT 50", now - PENDING_STALE_MS).toArray()
    for (const r of moved) {
      const outcome = await this.evictSpace(r.space_id, now - cfg.evictIdleDays * DAY)
      if (outcome.gone) this.sql.exec("DELETE FROM spaces WHERE space_id = ? AND state = 'deleting'", r.space_id)
      else this.sql.exec("UPDATE spaces SET state = 'active', slot_moved = 0, state_at = ? WHERE space_id = ? AND state = 'deleting'", now, r.space_id)
    }
    const quiet = this.sql.exec<SpaceRow>("SELECT * FROM spaces WHERE state = 'active' AND last_access_at <= ? LIMIT 50", now - cfg.idleDeleteDays * DAY).toArray()
    for (const r of quiet) {
      const live = await this.space(r.space_id).info()
      if (!live.exists) this.sql.exec("DELETE FROM spaces WHERE space_id = ? AND state = 'active'", r.space_id)
      else if (live.last_used !== undefined && live.last_used > r.last_access_at) this.sql.exec('UPDATE spaces SET last_access_at = ?, last_access_day = ? WHERE space_id = ?', live.last_used, Math.floor(live.last_used / DAY), r.space_id)
    }
  }

  private purge(cfg: Config, now: number): void {
    const windowStart = now - cfg.sourceWindowDays * DAY
    this.sql.exec('DELETE FROM source_events WHERE at <= ?', windowStart)
    this.sql.exec('UPDATE spaces SET source_mac = NULL WHERE source_mac IS NOT NULL AND created_at <= ?', windowStart)
    this.sql.exec('DELETE FROM source_blocks WHERE until <= ?', now)
    this.sql.exec('DELETE FROM nonces WHERE at <= ?', now - cfg.adminNonceTtlSec * 1000)
    this.sql.exec('DELETE FROM audit WHERE at <= ?', now - cfg.auditDays * DAY)
    this.sql.exec('DELETE FROM source_keys WHERE week < ?', Math.floor(now / WEEK) - 1)
    this.sql.exec("DELETE FROM jobs WHERE state = 'done' AND updated_at <= ?", now - 30 * DAY)
  }

  async housekeep(): Promise<void> {
    const cfg = this.config
    const now = runtime.now()
    this.purge(cfg, now)
    await this.reconcile(cfg, now)
    await this.tick(cfg, now)
  }

  override async alarm(): Promise<void> {
    try {
      await this.housekeep()
    } finally {
      // 失敗しても次を仕掛ける。alarm の再試行には回数の上限がある
      const running = this.sql.exec("SELECT 1 FROM jobs WHERE state = 'running' LIMIT 1").toArray().length > 0
      await this.ctx.storage.setAlarm(runtime.now() + (running ? 1000 : HOUR))
    }
  }
}

function pageLimit(raw: string | undefined): number | null {
  if (raw === undefined) return PAGE_DEFAULT
  if (!/^[0-9]{1,3}$/.test(raw)) return null
  const n = Number(raw)
  return n >= 1 && n <= PAGE_MAX ? n : null
}
