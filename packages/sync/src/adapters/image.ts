// 上げた画像の履歴。ID は image:::<URL>。テキストだけで、削除キーと手元のハッシュは送らない
import type { StoredRecord, SyncOpRow, SyncSqlDb } from '../engine/tables'
import { formatHlc } from '../hlc'
import { canonicalJson, parseStrictJson } from '../json'
import { recordId } from '../keys'
import { makeTombstone, updateRecord, type SyncPayload } from '../merge'
import { checkPayload } from '../schema'
import type { AdapterContext, ApplyPlan, OpTarget, SeedRow, SyncAdapter } from './types'

export const IMAGE_KIND = 'image'
export const UPLOAD_ADD = 'upload_add'
export const UPLOAD_REMOVE = 'upload_remove'
export const AREA_UPLOADS = 'uploads'
const NAME_MAX = 1024
const SEED_PRIORITY = 4

interface LocalRow {
  url: string
  name: string
  size: number
  uploaded_at: number
}

const targetOf = (ctx: AdapterContext, url: string): OpTarget => ({
  record_id: recordId(ctx.keys.k_id, IMAGE_KIND, null, '', url),
  refs: { ref_board: null, ref_thread: null, ref_detail: url, ref_local: null },
})

const bodyOf = (r: LocalRow): Record<string, unknown> => ({ url: r.url, file_name: r.name.slice(0, NAME_MAX), size: r.size, uploaded_at: r.uploaded_at })

export class ImageAdapter implements SyncAdapter {
  readonly kind = IMAGE_KIND
  readonly area = AREA_UPLOADS
  readonly ops = [UPLOAD_ADD, UPLOAD_REMOVE]
  readonly reconciles = false

  constructor(private readonly db: SyncSqlDb) {}

  private urlOf(op: SyncOpRow): string | null {
    try {
      const a = parseStrictJson(op.args ?? '') as { url?: unknown }
      return typeof a?.url === 'string' ? a.url : null
    } catch {
      return null
    }
  }

  target(op: SyncOpRow, ctx: AdapterContext): OpTarget | null {
    const url = this.urlOf(op)
    return url === null ? null : targetOf(ctx, url)
  }

  async fromOp(op: SyncOpRow, existing: SyncPayload | null, stamp: string, ctx: AdapterContext): Promise<SyncPayload | null> {
    if (op.op === UPLOAD_REMOVE) return makeTombstone(existing ?? { kind: IMAGE_KIND, hlc: stamp, device_id: ctx.deviceId }, stamp, ctx.deviceId)
    const [row] = await this.db.select<LocalRow>('SELECT url, name, size, uploaded_at FROM uploads WHERE url = $1', [this.urlOf(op)])
    return row ? updateRecord(existing, IMAGE_KIND, bodyOf(row), stamp, ctx.deviceId) : null
  }

  async seed(ctx: AdapterContext): Promise<SeedRow[]> {
    const rows = await this.db.select<LocalRow>('SELECT url, name, size, uploaded_at FROM uploads ORDER BY uploaded_at DESC, url')
    return rows.flatMap((r) => {
      const hlc = formatHlc(Math.max(1, Math.min(r.uploaded_at, ctx.now)), 0, ctx.deviceId)
      const payload = { kind: IMAGE_KIND, hlc, device_id: ctx.deviceId, body: bodyOf(r) }
      return checkPayload(payload) === null ? [] : [{ ...targetOf(ctx, r.url), priority: SEED_PRIORITY, payload }]
    })
  }

  detailOf(p: SyncPayload): string | null {
    return typeof p.body?.url === 'string' ? p.body.url : null
  }

  owns(r: StoredRecord): boolean {
    return r.ref_detail !== null
  }

  private async row(url: string | null): Promise<LocalRow | undefined> {
    const [row] = await this.db.select<LocalRow>('SELECT url, name, size, uploaded_at FROM uploads WHERE url = $1', [url])
    return row
  }

  async exists(r: StoredRecord): Promise<boolean> {
    return (await this.row(r.ref_detail)) !== undefined
  }

  async remove(r: StoredRecord): Promise<ApplyPlan> {
    const had = await this.exists(r)
    return { changed: had, statements: had ? [{ sql: 'DELETE FROM uploads WHERE url = $1', params: [r.ref_detail] }] : [] }
  }

  async localLines(): Promise<string[]> {
    const rows = await this.db.select<LocalRow>('SELECT url, name, size, uploaded_at FROM uploads')
    return rows.map((r) => canonicalJson([r.url, r.name, r.size, r.uploaded_at]))
  }

  /** with_account は 0 で足す(その端末のアカウントで消せるとは限らない)。INSERT OR REPLACE は hash と削除キーを消すので使わない */
  async apply(r: StoredRecord, ctx: AdapterContext): Promise<ApplyPlan> {
    if (r.payload.deleted === true) return r.payload.trim === true ? { statements: [], changed: false } : this.remove(r)
    const body = r.payload.body ?? {}
    const url = body.url as string
    const local = await this.row(url)
    const name = typeof body.file_name === 'string' ? body.file_name : (local?.name ?? '')
    const size = typeof body.size === 'number' ? body.size : (local?.size ?? 0)
    const uploadedAt = typeof body.uploaded_at === 'number' ? body.uploaded_at : (local?.uploaded_at ?? ctx.now)
    if (local && local.name === name && local.size === size && local.uploaded_at === uploadedAt) return { statements: [], changed: false }
    return {
      changed: true,
      statements: [
        { sql: 'UPDATE uploads SET name = $1, size = $2, uploaded_at = $3 WHERE url = $4', params: [name, size, uploadedAt, url] },
        { sql: 'INSERT OR IGNORE INTO uploads (url, name, size, uploaded_at, with_account) VALUES ($1, $2, $3, $4, 0)', params: [url, name, size, uploadedAt] },
      ],
    }
  }
}
