// サイト(BBS メニュー)。ID は site:::<正規化したメニューの URL>。本文は生の URL を書く
import type { StoredRecord, SyncOpRow, SyncSqlDb } from '../engine/tables'
import { formatHlc } from '../hlc'
import { parseStrictJson } from '../json'
import { normalizeBoardUrl, recordId } from '../keys'
import { makeTombstone, updateRecord, type SyncPayload } from '../merge'
import { checkPayload } from '../schema'
import type { AdapterContext, ApplyPlan, OpTarget, SeedRow, SyncAdapter } from './types'

export const SITE_KIND = 'site'
export const SITE_ADD = 'site_add'
export const SITE_REMOVE = 'site_remove'
export const AREA_SITES = 'sites'
const NAME_MAX = 256
const SEED_PRIORITY = 1
const SEED_WALL = 1

/** この端末で扱えないサイトは null(同期の表にだけ持つ) */
export type SiteResolver = (menuUrl: string) => string | null

function targetOf(ctx: AdapterContext, menuUrl: string): OpTarget | null {
  const detail = normalizeBoardUrl(menuUrl)
  return detail === null ? null : { record_id: recordId(ctx.keys.k_id, SITE_KIND, null, '', detail), refs: { ref_board: null, ref_thread: null, ref_detail: detail, ref_local: null } }
}

const bodyOf = (menuUrl: string, name: string): Record<string, unknown> => ({ menu_url: menuUrl, ...(name !== '' && { name: name.slice(0, NAME_MAX) }) })

export class SiteAdapter implements SyncAdapter {
  readonly kind = SITE_KIND
  readonly area = AREA_SITES
  readonly ops = [SITE_ADD, SITE_REMOVE]
  readonly reconciles = false

  constructor(private readonly db: SyncSqlDb, private readonly resolve: SiteResolver) {}

  private urlOf(op: SyncOpRow): string | null {
    try {
      const a = parseStrictJson(op.args ?? '') as { menu_url?: unknown }
      return typeof a?.menu_url === 'string' ? a.menu_url : null
    } catch {
      return null
    }
  }

  target(op: SyncOpRow, ctx: AdapterContext): OpTarget | null {
    const url = this.urlOf(op)
    return url === null ? null : targetOf(ctx, url)
  }

  async fromOp(op: SyncOpRow, existing: SyncPayload | null, stamp: string, ctx: AdapterContext): Promise<SyncPayload | null> {
    if (op.op === SITE_REMOVE) return makeTombstone(existing ?? { kind: SITE_KIND, hlc: stamp, device_id: ctx.deviceId }, stamp, ctx.deviceId)
    const url = this.urlOf(op) as string
    const [row] = await this.db.select<{ name: string }>('SELECT name FROM sites WHERE menu_url = $1', [url])
    return row ? updateRecord(existing, SITE_KIND, bodyOf(url, row.name), stamp, ctx.deviceId) : null
  }

  async seed(ctx: AdapterContext): Promise<SeedRow[]> {
    const rows = await this.db.select<{ menu_url: string; name: string }>('SELECT menu_url, name FROM sites ORDER BY sort')
    const hlc = formatHlc(SEED_WALL, 0, ctx.deviceId)
    return rows.flatMap((r) => {
      const t = targetOf(ctx, r.menu_url)
      if (!t) return []
      const payload = { kind: SITE_KIND, hlc, device_id: ctx.deviceId, body: bodyOf(r.menu_url, r.name) }
      return checkPayload(payload) === null ? [] : [{ ...t, priority: SEED_PRIORITY, payload }]
    })
  }

  detailOf(p: SyncPayload): string | null {
    const url = p.body?.menu_url
    return typeof url === 'string' ? normalizeBoardUrl(url) : null
  }

  private async localRows(r: StoredRecord): Promise<{ menu_url: string; name: string }[]> {
    const rows = await this.db.select<{ menu_url: string; name: string }>('SELECT menu_url, name FROM sites')
    return rows.filter((x) => normalizeBoardUrl(x.menu_url) === r.ref_detail)
  }

  owns(r: StoredRecord): boolean {
    return r.ref_detail !== null
  }

  async exists(r: StoredRecord): Promise<boolean> {
    return (await this.localRows(r)).length > 0
  }

  async remove(r: StoredRecord): Promise<ApplyPlan> {
    const rows = await this.localRows(r)
    return {
      changed: rows.length > 0,
      statements: rows.flatMap((x) => [
        { sql: 'DELETE FROM boards WHERE site_menu_url = $1', params: [x.menu_url] },
        { sql: 'DELETE FROM sites WHERE menu_url = $1', params: [x.menu_url] },
      ]),
    }
  }

  async localLines(): Promise<string[]> {
    const rows = await this.db.select<{ menu_url: string }>('SELECT menu_url FROM sites')
    return rows.map((r) => String(normalizeBoardUrl(r.menu_url)))
  }

  async apply(r: StoredRecord): Promise<ApplyPlan> {
    if (r.payload.deleted === true) return r.payload.trim === true ? { statements: [], changed: false } : this.remove(r)
    const body = r.payload.body ?? {}
    const url = body.menu_url as string
    const name = typeof body.name === 'string' ? body.name : ''
    const rows = await this.localRows(r)
    if (rows.length > 0) {
      const stale = name === '' ? [] : rows.filter((x) => x.name !== name)
      return { changed: stale.length > 0, statements: stale.map((x) => ({ sql: 'UPDATE sites SET name = $1 WHERE menu_url = $2', params: [name, x.menu_url] })) }
    }
    const connector = this.resolve(url)
    if (connector === null) return { statements: [], changed: false }
    return {
      changed: true,
      statements: [
        {
          sql: 'INSERT OR IGNORE INTO sites (menu_url, connector_id, name, sort) VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM sites))',
          params: [url, connector, name === '' ? url : name],
        },
      ],
    }
  }
}
