// 権限系(画像の削除ページの URL)。k_secret で暗号化する。スイッチがオンの端末だけが積み、読む。ID は secret:::<URL>
import type { StoredRecord, SyncOpRow, SyncSqlDb } from '../engine/tables'
import { SyncTables } from '../engine/tables'
import { SECRET_KIND } from '../engine/kinds'
import { formatHlc } from '../hlc'
import { parseStrictJson } from '../json'
import { recordId } from '../keys'
import { makeTombstone, updateRecord, type SyncPayload } from '../merge'
import { checkPayload } from '../schema'
import type { AdapterContext, ApplyPlan, OpTarget, SeedRow, SyncAdapter } from './types'

export const SECRET_PUT = 'secret_put'
export const SECRET_REMOVE = 'secret_remove'
const AREA = 'uploads'
const SEED_PRIORITY = 4

const targetOf = (ctx: AdapterContext, url: string): OpTarget => ({
  record_id: recordId(ctx.keys.k_id, SECRET_KIND, null, '', url),
  refs: { ref_board: null, ref_thread: null, ref_detail: url, ref_local: null },
})

export class SecretAdapter implements SyncAdapter {
  readonly kind = SECRET_KIND
  readonly area = AREA
  readonly ops = [SECRET_PUT, SECRET_REMOVE]
  readonly reconciles = false
  readonly seedsAll = false
  private readonly tables: SyncTables

  constructor(private readonly db: SyncSqlDb) {
    this.tables = new SyncTables(db)
  }

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

  /** 値は操作に書かず、ここで今のデータから読む(sync_ops に残さない) */
  async fromOp(op: SyncOpRow, existing: SyncPayload | null, stamp: string, ctx: AdapterContext): Promise<SyncPayload | null> {
    if (op.op === SECRET_REMOVE) return makeTombstone(existing ?? { kind: SECRET_KIND, hlc: stamp, device_id: ctx.deviceId }, stamp, ctx.deviceId)
    const [row] = await this.db.select<{ url: string; delete_url: string | null }>('SELECT url, delete_url FROM uploads WHERE url = $1', [this.urlOf(op)])
    return row?.delete_url ? updateRecord(existing, SECRET_KIND, { url: row.url, value: row.delete_url }, stamp, ctx.deviceId) : null
  }

  async seed(ctx: AdapterContext): Promise<SeedRow[]> {
    const rows = await this.db.select<{ url: string; delete_url: string; uploaded_at: number }>('SELECT url, delete_url, uploaded_at FROM uploads WHERE delete_url IS NOT NULL ORDER BY uploaded_at DESC, url')
    return rows.flatMap((r) => {
      const hlc = formatHlc(Math.max(1, Math.min(r.uploaded_at, ctx.now)), 0, ctx.deviceId)
      const payload = { kind: SECRET_KIND, hlc, device_id: ctx.deviceId, body: { url: r.url, value: r.delete_url } }
      return checkPayload(payload) === null ? [] : [{ ...targetOf(ctx, r.url), priority: SEED_PRIORITY, payload }]
    })
  }

  fill(ctx: AdapterContext): Promise<SeedRow[]> {
    return this.seed(ctx)
  }

  detailOf(p: SyncPayload): string | null {
    return typeof p.body?.url === 'string' ? p.body.url : null
  }

  owns(r: StoredRecord): boolean {
    return r.ref_detail !== null
  }

  /** 画像の行に付く値なので、大量削除の確認の数に入れない */
  async exists(): Promise<boolean> {
    return false
  }

  /** 手元の値は画像を消すときに一緒に消える */
  async remove(): Promise<ApplyPlan> {
    return { statements: [], changed: false }
  }

  /** 画像の行より先に届くことがあるので、周の最後にまとめて写す */
  async apply(): Promise<ApplyPlan> {
    return { statements: [], changed: false }
  }

  async differs(r: StoredRecord): Promise<boolean> {
    if (r.payload.deleted === true) return false
    const [row] = await this.db.select<{ delete_url: string | null }>('SELECT delete_url FROM uploads WHERE url = $1', [r.ref_detail])
    return row !== undefined && row.delete_url !== r.payload.body?.value
  }

  async afterApply(): Promise<ApplyPlan> {
    const statements = []
    for (const r of await this.tables.recordsOfKind(SECRET_KIND)) {
      if (r.needs_apply || !(await this.differs(r))) continue
      statements.push({ sql: 'UPDATE uploads SET delete_url = $1 WHERE url = $2', params: [r.payload.body?.value, r.ref_detail] })
    }
    return { statements, changed: statements.length > 0 }
  }
}
