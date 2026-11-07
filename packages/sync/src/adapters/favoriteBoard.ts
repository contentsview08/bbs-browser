// お気に入り板と並び順。ID は favorite:<板>: と order:<板>:。sort は順序キーから計算した写し
import { SyncTables, type StoredRecord, type SyncOpRow, type SyncSqlDb } from '../engine/tables'
import { formatHlc } from '../hlc'
import { parseStrictJson } from '../json'
import { normalizeBoardUrl, recordId } from '../keys'
import { compareOrdered, isOrderKey, makeTombstone, orderKeyBetween, updateRecord, type SyncPayload } from '../merge'
import { checkPayload } from '../schema'
import { FAVORITE_KIND, type BoardResolver } from './favoriteThread'
import type { AdapterContext, ApplyPlan, OpEffect, OpTarget, SeedRow, SyncAdapter } from './types'

export const ORDER_KIND = 'order'
export const FAVORITE_BOARD_ADD = 'favorite_board_add'
export const FAVORITE_BOARD_REMOVE = 'favorite_board_remove'
export const FAVORITE_BOARD_ORDER = 'favorite_board_order'
export const AREA_FAVORITE_BOARDS = 'favoriteBoards'
const NAME_MAX = 256
const SEED_PRIORITY = 1
const SEED_WALL = 1
/** これを超えたらリストを振り直す。桁が増え続けないように */
export const ORDER_KEY_REBUILD = 256

const boardRefs = (board: string) => ({ ref_board: board, ref_thread: null, ref_detail: null, ref_local: null })

function targetOf(ctx: AdapterContext, kind: string, url: string): OpTarget | null {
  const board = normalizeBoardUrl(url)
  return board === null ? null : { record_id: recordId(ctx.keys.k_id, kind, url, ''), refs: boardRefs(board) }
}

const boardBody = (url: string, name: string): Record<string, unknown> => ({ board_url: url, ...(name !== '' && { board_name: name.slice(0, NAME_MAX) }) })

const tombstoneOf = (existing: SyncPayload | null, kind: string, stamp: string, ctx: AdapterContext) =>
  makeTombstone(existing ?? { kind, hlc: stamp, device_id: ctx.deviceId }, stamp, ctx.deviceId)

interface Keyed {
  id: string
  board: string
  key: string
}

/** 今のキーのうち、前後が変わらない最長の部分。キーが狭義に増える並びだけを残す */
function longestKept(keys: (string | null)[]): Set<number> {
  const tails: number[] = []
  const prev = keys.map(() => -1)
  keys.forEach((k, i) => {
    if (k === null) return
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((keys[tails[mid]] as string) < k) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]
    tails[lo] = i
  })
  const kept = new Set<number>()
  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) kept.add(i)
  return kept
}

/**
 * 新しい並びに必要なキー。動かなかった項目のキーは変えない(2 台が別の項目を動かしても、両方の結果が残る)。
 * 戻り値は位置 → 新しいキー
 */
export function planOrderKeys(keys: (string | null)[]): Map<number, string> {
  const kept = longestKept(keys)
  const out = new Map<number, string>()
  let prev: string | null = null
  for (let i = 0; i < keys.length; i++) {
    if (kept.has(i)) {
      prev = keys[i]
      continue
    }
    let next: string | null = null
    for (let j = i + 1; j < keys.length; j++) {
      if (kept.has(j)) {
        next = keys[j]
        break
      }
    }
    prev = orderKeyBetween(prev, next)
    out.set(i, prev)
  }
  if ([...out.values()].some((k) => k.length > ORDER_KEY_REBUILD)) {
    const all = new Map<number, string>()
    let k: string | null = null
    for (let i = 0; i < keys.length; i++) {
      k = orderKeyBetween(k, null)
      all.set(i, k)
    }
    return all
  }
  return out
}

export class FavoriteBoardAdapter implements SyncAdapter {
  readonly kind = FAVORITE_KIND
  readonly area = AREA_FAVORITE_BOARDS
  readonly ops = [FAVORITE_BOARD_ADD, FAVORITE_BOARD_REMOVE, FAVORITE_BOARD_ORDER]
  /** 適用で板か順序が変わった。sort の振り直しは周の最後に 1 回 */
  dirty = false
  private readonly tables: SyncTables

  constructor(private readonly db: SyncSqlDb, private readonly resolve: BoardResolver) {
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
    if (op.op === FAVORITE_BOARD_ORDER) return null
    const url = this.urlOf(op)
    return url === null ? null : targetOf(ctx, FAVORITE_KIND, url)
  }

  async fromOp(): Promise<SyncPayload | null> {
    return null
  }

  private async keys(): Promise<Keyed[]> {
    const rows = await this.tables.recordsOfKind(ORDER_KIND)
    return rows.flatMap((r) => {
      const key = r.payload.body?.key
      return r.payload.deleted !== true && r.ref_board !== null && !r.ref_thread && isOrderKey(key) ? [{ id: r.record_id, board: r.ref_board, key }] : []
    })
  }

  private orderEffect(url: string, key: string, ctx: AdapterContext): OpEffect | null {
    const target = targetOf(ctx, ORDER_KIND, url)
    return target && { target, make: (existing, stamp) => updateRecord(existing, ORDER_KIND, { board_url: url, key }, stamp, ctx.deviceId) }
  }

  async expand(op: SyncOpRow, ctx: AdapterContext): Promise<OpEffect[] | null> {
    if (op.op === FAVORITE_BOARD_ORDER) return this.expandOrder(op, ctx)
    const url = this.urlOf(op)
    const favorite = url === null ? null : targetOf(ctx, FAVORITE_KIND, url)
    const order = url === null ? null : targetOf(ctx, ORDER_KIND, url)
    if (url === null || !favorite || !order) return null
    if (op.op === FAVORITE_BOARD_REMOVE) {
      return [favorite, order].map((target, i) => ({ target, make: (existing, stamp) => tombstoneOf(existing, i === 0 ? FAVORITE_KIND : ORDER_KIND, stamp, ctx) }))
    }
    const [row] = await this.db.select<{ name: string }>('SELECT name FROM favorite_boards WHERE url = $1', [url])
    if (!row) return []
    const out: OpEffect[] = [{ target: favorite, make: (existing, stamp) => updateRecord(existing, FAVORITE_KIND, boardBody(url, row.name), stamp, ctx.deviceId) }]
    const keys = await this.keys()
    if (!keys.some((k) => k.board === favorite.refs.ref_board)) {
      const last = keys.reduce<string | null>((m, k) => (m === null || k.key > m ? k.key : m), null)
      out.push(this.orderEffect(url, orderKeyBetween(last, null), ctx) as OpEffect)
    }
    return out
  }

  private async expandOrder(op: SyncOpRow, ctx: AdapterContext): Promise<OpEffect[] | null> {
    let urls: string[]
    try {
      const a = parseStrictJson(op.args ?? '') as { urls?: unknown }
      if (!Array.isArray(a?.urls) || !a.urls.every((u) => typeof u === 'string')) return null
      urls = a.urls as string[]
    } catch {
      return null
    }
    const known = new Map((await this.keys()).map((k) => [k.board, k.key]))
    const items = urls.filter((u) => normalizeBoardUrl(u) !== null)
    const planned = planOrderKeys(items.map((u) => known.get(normalizeBoardUrl(u) as string) ?? null))
    return [...planned].flatMap(([i, key]) => {
      const effect = this.orderEffect(items[i], key, ctx)
      return effect ? [effect] : []
    })
  }

  async seed(ctx: AdapterContext): Promise<SeedRow[]> {
    const rows = await this.db.select<{ url: string; name: string }>('SELECT url, name FROM favorite_boards ORDER BY sort, name')
    const records = await this.tables.recordsOfKind(ORDER_KIND)
    const seen = new Set(records.map((r) => r.ref_board))
    let last = (await this.keys()).reduce<string | null>((m, k) => (m === null || k.key > m ? k.key : m), null)
    const hlc = formatHlc(SEED_WALL, 0, ctx.deviceId)
    const out: SeedRow[] = []
    for (const r of rows) {
      const favorite = targetOf(ctx, FAVORITE_KIND, r.url)
      const order = targetOf(ctx, ORDER_KIND, r.url)
      if (!favorite || !order) continue
      const payload = { kind: FAVORITE_KIND, hlc, device_id: ctx.deviceId, body: boardBody(r.url, r.name) }
      if (checkPayload(payload) === null) continue
      out.push({ ...favorite, priority: SEED_PRIORITY, payload })
      // 領域に順序があれば、種まきのキーで崩さない。手元だけの項目は末尾に足す
      if (seen.has(favorite.refs.ref_board)) continue
      last = orderKeyBetween(last, null)
      out.push({ ...order, priority: SEED_PRIORITY, payload: { kind: ORDER_KIND, hlc, device_id: ctx.deviceId, body: { board_url: r.url, key: last } } })
    }
    return out
  }

  private async localRows(r: StoredRecord): Promise<{ url: string; name: string }[]> {
    const rows = await this.db.select<{ url: string; name: string }>('SELECT url, name FROM favorite_boards')
    return rows.filter((x) => normalizeBoardUrl(x.url) === r.ref_board)
  }

  owns(r: StoredRecord): boolean {
    return r.ref_board !== null && !r.ref_thread
  }

  async exists(r: StoredRecord): Promise<boolean> {
    return (await this.localRows(r)).length > 0
  }

  async remove(r: StoredRecord): Promise<ApplyPlan> {
    const rows = await this.localRows(r)
    if (rows.length > 0) this.dirty = true
    return { changed: rows.length > 0, statements: rows.map((x) => ({ sql: 'DELETE FROM favorite_boards WHERE url = $1', params: [x.url] })) }
  }

  async apply(r: StoredRecord): Promise<ApplyPlan> {
    if (r.payload.deleted === true) return r.payload.trim === true ? { statements: [], changed: false } : this.remove(r)
    const body = r.payload.body ?? {}
    const name = typeof body.board_name === 'string' ? body.board_name : ''
    const rows = await this.localRows(r)
    if (rows.length > 0) {
      const stale = name === '' ? [] : rows.filter((x) => x.name !== name)
      return { changed: stale.length > 0, statements: stale.map((x) => ({ sql: 'UPDATE favorite_boards SET name = $1 WHERE url = $2', params: [name, x.url] })) }
    }
    const resolved = this.resolve(body.board_url as string)
    if (!resolved) return { statements: [], changed: false }
    this.dirty = true
    return {
      changed: true,
      statements: [
        {
          sql: 'INSERT OR IGNORE INTO favorite_boards (url, connector_id, name, sort) VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM favorite_boards))',
          params: [resolved.boardUrl, resolved.connectorId, name === '' ? resolved.boardUrl : name],
        },
      ],
    }
  }

  /** 並びまで比べる */
  async localLines(): Promise<string[]> {
    const rows = await this.db.select<{ url: string; sort: number }>('SELECT url, sort FROM favorite_boards')
    return rows.map((r) => `${r.sort}\t${normalizeBoardUrl(r.url)}`)
  }

  /** 順序のレコードで並べる。ない項目はある項目の後ろで、どの端末でも同じ順になるよう板 URL で決める */
  async afterApply(): Promise<ApplyPlan> {
    if (!this.dirty) return { statements: [], changed: false }
    this.dirty = false
    const rows = await this.db.select<{ url: string; sort: number }>('SELECT url, sort FROM favorite_boards ORDER BY sort, name')
    const keys = new Map((await this.keys()).map((k) => [k.board, k]))
    const ranked = rows.map((r) => {
      const board = normalizeBoardUrl(r.url) ?? r.url
      return { ...r, board, keyed: keys.get(board) }
    })
    ranked.sort((a, b) => {
      if (a.keyed && b.keyed) return compareOrdered(a.keyed, b.keyed)
      if (a.keyed || b.keyed) return a.keyed ? -1 : 1
      return a.board < b.board ? -1 : a.board > b.board ? 1 : 0
    })
    const statements = ranked.flatMap((r, i) => (r.sort === i ? [] : [{ sql: 'UPDATE favorite_boards SET sort = $1 WHERE url = $2', params: [i, r.url] }]))
    return { statements, changed: statements.length > 0 }
  }
}

/** 順序のレコードの写し先は favorite_boards.sort。行を持たないので exists は false で、起動時の照合のたびに並べ直す */
export class BoardOrderAdapter implements SyncAdapter {
  readonly kind = ORDER_KIND
  readonly area = AREA_FAVORITE_BOARDS
  readonly ops: string[] = []

  constructor(private readonly boards: FavoriteBoardAdapter) {}

  target(): OpTarget | null {
    return null
  }

  async fromOp(): Promise<SyncPayload | null> {
    return null
  }

  async seed(): Promise<SeedRow[]> {
    return []
  }

  owns(r: StoredRecord): boolean {
    return r.ref_board !== null && !r.ref_thread
  }

  async exists(): Promise<boolean> {
    return false
  }

  async apply(): Promise<ApplyPlan> {
    this.boards.dirty = true
    return { statements: [], changed: false }
  }

  async remove(): Promise<ApplyPlan> {
    this.boards.dirty = true
    return { statements: [], changed: false }
  }
}

export function favoriteBoardAdapters(db: SyncSqlDb, resolve: BoardResolver): SyncAdapter[] {
  const boards = new FavoriteBoardAdapter(db, resolve)
  return [boards, new BoardOrderAdapter(boards)]
}
