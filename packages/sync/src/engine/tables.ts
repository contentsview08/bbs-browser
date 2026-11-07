// 同期の表の読み書き。値はプレースホルダーで渡す。PC のプラグインは数を f64 で束ねるので、TEXT の列には文字列を渡す
import { canonicalJson, parseStrictJson } from '../json'
import type { SyncPayload } from '../merge'
import type { LocalRecord } from '../rebase'

export interface SqlStatement {
  sql: string
  params?: unknown[]
}

/** logstore の SqlDb と同じ形。packages/sync はログの保存に依存しない */
export interface SyncSqlDb {
  execute(sql: string, params?: unknown[]): Promise<void>
  select<T>(sql: string, params?: unknown[]): Promise<T[]>
  batch(statements: SqlStatement[]): Promise<void>
}

export interface StoredRecord {
  record_id: string
  kind: string
  kind_tag: 'h' | 's'
  schema_version: number
  payload: SyncPayload
  hlc: string
  version: number
  pending: boolean
  priority: number
  needs_apply: boolean
  ref_board: string | null
  ref_thread: string | null
  ref_detail: string | null
  ref_local: number | null
  tomb_at: number | null
}

export interface SyncOpRow {
  seq: number
  op: string
  target: string
  num: number | null
  args: string | null
  at_ms: number
}

interface RecordRow extends Omit<StoredRecord, 'payload' | 'pending' | 'needs_apply'> {
  payload: string
  pending: number
  needs_apply: number
}

const COLUMNS = 'record_id, kind, kind_tag, schema_version, payload, hlc, deleted, version, pending, priority, needs_apply, ref_board, ref_thread, ref_detail, ref_local, tomb_at'

function fromRow(r: RecordRow): StoredRecord {
  return { ...r, payload: parseStrictJson(r.payload) as SyncPayload, pending: r.pending === 1, needs_apply: r.needs_apply === 1 }
}

export const isDeleted = (p: SyncPayload): boolean => p.deleted === true

export function asLocal(r: StoredRecord): LocalRecord {
  return { payload: r.payload, version: r.version, ...(r.tomb_at !== null && { tomb_at: r.tomb_at }) }
}

export function writeRecord(r: StoredRecord): SqlStatement {
  return {
    sql: `INSERT OR REPLACE INTO sync_records (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    params: [
      r.record_id, r.payload.kind, r.kind_tag, r.schema_version, canonicalJson(r.payload), r.payload.hlc, isDeleted(r.payload) ? 1 : 0, r.version,
      r.pending ? 1 : 0, r.priority, r.needs_apply ? 1 : 0, r.ref_board, r.ref_thread, r.ref_detail, r.ref_local, r.tomb_at,
    ],
  }
}

export const setState = (key: string, value: string): SqlStatement => ({ sql: 'INSERT OR REPLACE INTO sync_state (key, value) VALUES ($1, $2)', params: [key, value] })
export const delState = (key: string): SqlStatement => ({ sql: 'DELETE FROM sync_state WHERE key = $1', params: [key] })
export const delRecord = (id: string): SqlStatement => ({ sql: 'DELETE FROM sync_records WHERE record_id = $1', params: [id] })
export const delOp = (seq: number): SqlStatement => ({ sql: 'DELETE FROM sync_ops WHERE seq = $1', params: [seq] })
export const clearNeedsApply = (id: string): SqlStatement => ({ sql: 'UPDATE sync_records SET needs_apply = 0 WHERE record_id = $1', params: [id] })

export class SyncTables {
  constructor(readonly db: SyncSqlDb) {}

  async state(key: string): Promise<string | null> {
    const [row] = await this.db.select<{ value: string }>('SELECT value FROM sync_state WHERE key = $1', [key])
    return row?.value ?? null
  }

  async record(id: string): Promise<StoredRecord | null> {
    const [row] = await this.db.select<RecordRow>(`SELECT ${COLUMNS} FROM sync_records WHERE record_id = $1`, [id])
    return row ? fromRow(row) : null
  }

  async records(ids: readonly string[]): Promise<Map<string, StoredRecord>> {
    const out = new Map<string, StoredRecord>()
    if (ids.length === 0) return out
    const unique = [...new Set(ids)]
    const marks = unique.map((_, i) => `$${i + 1}`).join(', ')
    const rows = await this.db.select<RecordRow>(`SELECT ${COLUMNS} FROM sync_records WHERE record_id IN (${marks})`, unique)
    for (const r of rows) out.set(r.record_id, fromRow(r))
    return out
  }

  async allRecords(): Promise<StoredRecord[]> {
    return (await this.db.select<RecordRow>(`SELECT ${COLUMNS} FROM sync_records ORDER BY record_id`)).map(fromRow)
  }

  async recordsOfKind(kind: string): Promise<StoredRecord[]> {
    return (await this.db.select<RecordRow>(`SELECT ${COLUMNS} FROM sync_records WHERE kind = $1 ORDER BY record_id`, [kind])).map(fromRow)
  }

  async selectRecords(where: string, params: unknown[]): Promise<StoredRecord[]> {
    return (await this.db.select<RecordRow>(`SELECT ${COLUMNS} FROM sync_records WHERE ${where}`, params)).map(fromRow)
  }

  /** except は切っている種類。送信待ちのまま残し、送らない */
  async pendingRecords(limit: number, except: readonly string[] = []): Promise<StoredRecord[]> {
    const marks = except.map((_, i) => `$${i + 2}`).join(', ')
    const skip = except.length > 0 ? `AND kind NOT IN (${marks}) ` : ''
    return (await this.db.select<RecordRow>(`SELECT ${COLUMNS} FROM sync_records WHERE pending = 1 ${skip}ORDER BY priority, hlc, record_id LIMIT $1`, [limit, ...except])).map(fromRow)
  }

  /** 写す順を決めておく。afterId より後を返すので、飛ばした行を読み直さない */
  async toApply(kinds: readonly string[], afterId: string, limit: number): Promise<StoredRecord[]> {
    if (kinds.length === 0) return []
    const marks = kinds.map((_, i) => `$${i + 3}`).join(', ')
    const rows = await this.db.select<RecordRow>(
      `SELECT ${COLUMNS} FROM sync_records WHERE needs_apply = 1 AND record_id > $1 AND kind IN (${marks}) ORDER BY record_id LIMIT $2`,
      [afterId, limit, ...kinds],
    )
    return rows.map(fromRow)
  }

  async ops(names: readonly string[], limit: number): Promise<SyncOpRow[]> {
    if (names.length === 0) return []
    const marks = names.map((_, i) => `$${i + 2}`).join(', ')
    return this.db.select<SyncOpRow>(`SELECT seq, op, target, num, args, at_ms FROM sync_ops WHERE op IN (${marks}) ORDER BY seq LIMIT $1`, [limit, ...names])
  }
}
