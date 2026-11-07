// 閲覧履歴と既読。閲覧履歴は last_view:<板>:<スレ>、既読は read_dev(スレ×端末)と read_reset(スレごと)
import { RESET_TOTAL_MAX } from '../config'
import type { StoredRecord, SyncOpRow, SyncSqlDb } from '../engine/tables'
import { formatHlc, parseHlc } from '../hlc'
import { canonicalJson, parseStrictJson } from '../json'
import { normalizeBoardUrl, recordId } from '../keys'
import { LAST_VIEWED_FIELD, makeTombstone, updateRecord, type SyncPayload } from '../merge'
import { DEV_KIND, makeReset, readPosition, recordRead, RESET_KIND, resetFloor, type ThreadRef } from '../read'
import { checkPayload } from '../schema'
import type { BoardResolver } from './favoriteThread'
import type { AdapterContext, ApplyPlan, OpEffect, OpTarget, SeedRow, SyncAdapter } from './types'

export const LAST_VIEW_KIND = 'last_view'
export const OP_READ = 'read'
export const OP_VIEW = 'view'
export const OP_VIEW_REMOVE = 'view_remove'
export const OP_LOG_DELETE = 'log_delete'
export const AREA_HISTORY = 'history'
export const AREA_READS = 'reads'
const TITLE_MAX = 1024
const NAME_MAX = 256
const SEED_PRIORITY = 5
const DAY_MS = 86_400_000
const KEY_TIME = /^[0-9]{10}$/

export interface HistoryHost {
  resolve: BoardResolver
  /** 保持日数。0 は消さない。これより古い履歴に手元の行を作っても、次の整理で消えるだけ */
  retentionDays: () => number
  /** リセットの id。ランダムな値 */
  newResetId: () => string
}

interface ThreadRow {
  board_url: string
  key: string
  title: string
  read_no: number
  read_at: number | null
  created_at: number | null
  fetched_at?: number | null
}

interface OpArgs {
  board_url: string
  key: string
}

const argsOf = (op: SyncOpRow): OpArgs | null => {
  try {
    const a = parseStrictJson(op.args ?? '') as Partial<OpArgs>
    return typeof a?.board_url === 'string' && typeof a.key === 'string' ? (a as OpArgs) : null
  } catch {
    return null
  }
}

function targetOf(ctx: AdapterContext, kind: string, boardUrl: string, key: string, detail?: string): OpTarget | null {
  const board = normalizeBoardUrl(boardUrl)
  if (board === null || key === '') return null
  return { record_id: recordId(ctx.keys.k_id, kind, boardUrl, key, detail), refs: { ref_board: board, ref_thread: key, ref_detail: detail ?? null, ref_local: null } }
}

/** 手元の URL は端末で違うことがあるので、キーで引いて正規化した値で比べる */
async function localRows(db: SyncSqlDb, board: string | null, key: string | null): Promise<ThreadRow[]> {
  if (board === null || key === null) return []
  const rows = await db.select<ThreadRow>('SELECT board_url, key, title, read_no, read_at, created_at FROM threads WHERE key = $1', [key])
  return rows.filter((r) => normalizeBoardUrl(r.board_url) === board)
}

/** 同じスレのリセットと全端末の記録。tombstone は読みとして数えない */
async function readRecords(db: SyncSqlDb, board: string, key: string): Promise<{ latest: SyncPayload | null; devs: SyncPayload[] }> {
  const rows = await db.select<{ kind: string; payload: string }>('SELECT kind, payload FROM sync_records WHERE kind IN ($1, $2) AND ref_board = $3 AND ref_thread = $4 AND deleted = 0 ORDER BY record_id', [RESET_KIND, DEV_KIND, board, key])
  const parsed = rows.map((r) => ({ kind: r.kind, p: parseStrictJson(r.payload) as SyncPayload }))
  return { latest: parsed.find((r) => r.kind === RESET_KIND)?.p ?? null, devs: parsed.filter((r) => r.kind === DEV_KIND).map((r) => r.p) }
}

/** まだ処理していない読みを足す。下がった値を書いたあとで、読んだ位置へ戻る動きを見せない */
async function pendingRead(db: SyncSqlDb, boardUrl: string, key: string): Promise<number> {
  const [row] = await db.select<{ num: number | null }>("SELECT num FROM sync_ops WHERE op = 'read' AND target = $1", [`${boardUrl}\t${key}`])
  return row?.num ?? 0
}

const createdAtOf = (body: Record<string, unknown>, key: string): number | null =>
  typeof body.created_at === 'number' ? body.created_at : KEY_TIME.test(key) ? Number(key) * 1000 : null

/**
 * ログのないスレを開くとき、同期の表から既読と履歴を戻す(自動整理のあとに開き直すと既読が戻る)。
 * ログの削除はリセットを書くので、戻るのはリセットより後の読みだけになる
 */
export async function restoreThreadRead(db: SyncSqlDb, t: { boardUrl: string; key: string; connectorId: string; title: string; createdAt?: number | null }): Promise<boolean> {
  const board = normalizeBoardUrl(t.boardUrl)
  if (board === null || (await localRows(db, board, t.key)).length > 0) return false
  const { latest, devs } = await readRecords(db, board, t.key)
  const pos = readPosition(latest, devs)
  if (pos <= 0) return false
  const [view] = await db.select<{ payload: string }>("SELECT payload FROM sync_records WHERE kind = 'last_view' AND ref_board = $1 AND ref_thread = $2 AND deleted = 0", [board, t.key])
  const viewedAt = view ? ((parseStrictJson(view.payload) as SyncPayload).body?.[LAST_VIEWED_FIELD] as number | undefined) ?? null : null
  await db.execute(
    'INSERT OR IGNORE INTO threads (board_url, key, connector_id, title, created_at, read_no, read_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [t.boardUrl, t.key, t.connectorId, t.title, t.createdAt ?? null, pos, viewedAt],
  )
  return true
}

export class LastViewAdapter implements SyncAdapter {
  readonly kind = LAST_VIEW_KIND
  readonly area = AREA_HISTORY
  readonly ops = [OP_READ, OP_VIEW, OP_VIEW_REMOVE]
  readonly reconciles = false

  constructor(private readonly db: SyncSqlDb, private readonly host: HistoryHost) {}

  target(op: SyncOpRow, ctx: AdapterContext): OpTarget | null {
    const a = argsOf(op)
    return a && targetOf(ctx, LAST_VIEW_KIND, a.board_url, a.key)
  }

  async fromOp(): Promise<SyncPayload | null> {
    return null
  }

  private async boardName(boardUrl: string): Promise<string | null> {
    const [fav] = await this.db.select<{ name: string }>('SELECT name FROM favorite_boards WHERE url = $1', [boardUrl])
    if (fav?.name) return fav.name
    const [b] = await this.db.select<{ name: string }>('SELECT name FROM boards WHERE url = $1', [boardUrl])
    return b?.name || null
  }

  private bodyOf(r: ThreadRow, name: string | null, viewedAt: number): Record<string, unknown> {
    return {
      board_url: r.board_url,
      thread: r.key,
      ...(r.title !== '' && { title: r.title.slice(0, TITLE_MAX) }),
      ...(name !== null && { board_name: name.slice(0, NAME_MAX) }),
      ...(r.created_at !== null && { created_at: r.created_at }),
      [LAST_VIEWED_FIELD]: viewedAt,
    }
  }

  /** 読むと閲覧履歴と端末の記録の 2 つが変わる。ログを消した後に届いた読みでは閲覧履歴を作り直さない */
  async expand(op: SyncOpRow, ctx: AdapterContext): Promise<OpEffect[] | null> {
    const a = argsOf(op)
    const t = a && targetOf(ctx, LAST_VIEW_KIND, a.board_url, a.key)
    if (!a || !t) return null
    if (op.op === OP_VIEW_REMOVE) {
      return [{ target: t, make: (existing, stamp) => makeTombstone(existing ?? { kind: LAST_VIEW_KIND, hlc: stamp, device_id: ctx.deviceId }, stamp, ctx.deviceId, [LAST_VIEWED_FIELD]) }]
    }
    const [row] = await localRows(this.db, t.refs.ref_board, a.key)
    const name = row ? await this.boardName(row.board_url) : null
    const view: OpEffect = {
      target: t,
      make: (existing, stamp) => {
        if (!row) return null
        const before = existing?.body?.[LAST_VIEWED_FIELD]
        const viewedAt = Math.max(typeof before === 'number' ? before : 0, op.at_ms)
        return updateRecord(existing, LAST_VIEW_KIND, this.bodyOf(row, name, viewedAt), stamp, ctx.deviceId)
      },
    }
    if (op.op === OP_VIEW) return [view]
    const dev = targetOf(ctx, DEV_KIND, a.board_url, a.key, ctx.deviceId) as OpTarget
    const { latest } = await readRecords(this.db, t.refs.ref_board as string, a.key)
    const ref: ThreadRef = { board_url: row?.board_url ?? a.board_url, thread: a.key }
    return [view, { target: dev, make: (existing, stamp) => recordRead(existing, latest, ref, op.num ?? 0, stamp, ctx.deviceId) }]
  }

  async seed(ctx: AdapterContext): Promise<SeedRow[]> {
    const rows = await this.db.select<ThreadRow>('SELECT board_url, key, title, read_no, read_at, created_at FROM threads WHERE read_at IS NOT NULL ORDER BY read_at DESC, key')
    const names = new Map<string, string>()
    for (const b of await this.db.select<{ url: string; name: string }>('SELECT url, name FROM boards')) if (b.name) names.set(b.url, b.name)
    for (const b of await this.db.select<{ url: string; name: string }>('SELECT url, name FROM favorite_boards')) if (b.name) names.set(b.url, b.name)
    return rows.flatMap((r) => {
      const t = targetOf(ctx, LAST_VIEW_KIND, r.board_url, r.key)
      if (!t) return []
      const at = r.read_at as number
      const hlc = formatHlc(Math.max(1, Math.min(at, ctx.now)), 0, ctx.deviceId)
      const payload = { kind: LAST_VIEW_KIND, hlc, device_id: ctx.deviceId, body: this.bodyOf(r, names.get(r.board_url) ?? null, at) }
      return checkPayload(payload) === null ? [] : [{ ...t, priority: SEED_PRIORITY, payload }]
    })
  }

  owns(r: StoredRecord): boolean {
    return r.ref_thread !== null
  }

  async exists(r: StoredRecord): Promise<boolean> {
    return (await localRows(this.db, r.ref_board, r.ref_thread)).some((x) => x.read_at !== null)
  }

  /** ログは消さない。閲覧履歴の印だけを外す */
  async remove(r: StoredRecord): Promise<ApplyPlan> {
    const rows = (await localRows(this.db, r.ref_board, r.ref_thread)).filter((x) => x.read_at !== null)
    return { changed: rows.length > 0, statements: rows.map((x) => ({ sql: 'UPDATE threads SET read_at = NULL WHERE board_url = $1 AND key = $2', params: [x.board_url, x.key] })) }
  }

  async apply(r: StoredRecord, ctx: AdapterContext): Promise<ApplyPlan> {
    if (r.payload.deleted === true) return r.payload.trim === true ? { statements: [], changed: false } : this.remove(r)
    const body = r.payload.body ?? {}
    const viewedAt = body[LAST_VIEWED_FIELD] as number
    const title = typeof body.title === 'string' ? body.title : ''
    const key = r.ref_thread as string
    const rows = await localRows(this.db, r.ref_board, key)
    if (rows.length > 0) {
      const statements = rows.flatMap((x) => {
        const created = x.created_at ?? (typeof body.created_at === 'number' ? body.created_at : null)
        if (x.read_at === viewedAt && (title === '' || x.title === title) && x.created_at === created) return []
        return [{ sql: 'UPDATE threads SET read_at = $1, title = $2, created_at = $3 WHERE board_url = $4 AND key = $5', params: [viewedAt, title === '' ? x.title : title, created, x.board_url, key] }]
      })
      return { statements, changed: statements.length > 0 }
    }
    return this.emptyRow(r, body, viewedAt, title, ctx)
  }

  /** 行がないのは整理やログの削除で普通に起きる。ある行の値だけを比べる */
  async differs(r: StoredRecord, ctx: AdapterContext): Promise<boolean> {
    if ((await localRows(this.db, r.ref_board, r.ref_thread)).length === 0) return false
    return (await this.apply(r, ctx)).changed
  }

  private async emptyRow(r: StoredRecord, body: Record<string, unknown>, viewedAt: number, title: string, ctx: AdapterContext): Promise<ApplyPlan> {
    const none = { statements: [], changed: false }
    const key = r.ref_thread as string
    const days = this.host.retentionDays()
    if (days > 0 && ctx.now - viewedAt > days * DAY_MS) return none
    const resolved = this.host.resolve(body.board_url as string)
    if (!resolved) return none
    const { latest, devs } = await readRecords(this.db, r.ref_board as string, key)
    // ログを消した後に届いた、それより前の閲覧で履歴の行を作り直さない
    if (latest && parseHlc(latest.hlc).wall >= viewedAt) return none
    return {
      changed: true,
      statements: [
        {
          sql: `INSERT OR IGNORE INTO threads (board_url, key, connector_id, title, created_at, read_no, read_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          params: [resolved.boardUrl, key, resolved.connectorId, title === '' ? key : title, createdAtOf(body, key), readPosition(latest, devs), viewedAt],
        },
      ],
    }
  }

  async localLines(): Promise<string[]> {
    const rows = await this.db.select<ThreadRow>('SELECT board_url, key, title, read_no, read_at, created_at FROM threads WHERE read_at IS NOT NULL')
    return rows.map((r) => canonicalJson([normalizeBoardUrl(r.board_url), r.key, r.read_at]))
  }
}

/** read_dev と read_reset の適用は同じ。手元の値はどちらも readPosition の結果で、下げることもある */
abstract class ReadAdapterBase {
  readonly area = AREA_READS
  readonly reconciles = false

  constructor(protected readonly db: SyncSqlDb) {}

  owns(r: StoredRecord): boolean {
    return r.ref_board !== null && r.ref_thread !== null
  }

  async exists(r: StoredRecord): Promise<boolean> {
    return (await localRows(this.db, r.ref_board, r.ref_thread)).length > 0
  }

  async remove(): Promise<ApplyPlan> {
    return { statements: [], changed: false }
  }

  async apply(r: StoredRecord): Promise<ApplyPlan> {
    // 外した記録を除いて計算すると手元の既読が下がる
    if (r.payload.trim === true) return { statements: [], changed: false }
    const key = r.ref_thread as string
    const rows = await localRows(this.db, r.ref_board, key)
    if (rows.length === 0) return { statements: [], changed: false }
    const { latest, devs } = await readRecords(this.db, r.ref_board as string, key)
    const pos = readPosition(latest, devs)
    const statements = []
    for (const x of rows) {
      const next = Math.max(pos, await pendingRead(this.db, x.board_url, key))
      if (x.read_no !== next) statements.push({ sql: 'UPDATE threads SET read_no = $1 WHERE board_url = $2 AND key = $3', params: [next, x.board_url, key] })
    }
    return { statements, changed: statements.length > 0 }
  }

  async localLines(): Promise<string[]> {
    return []
  }
}

/** 端末の記録は LastViewAdapter の read の操作で作る。種まきと適用だけを受け持つ */
export class ReadDevAdapter extends ReadAdapterBase implements SyncAdapter {
  readonly kind = DEV_KIND
  readonly ops: string[] = []
  readonly seedsAll = false

  target(): OpTarget | null {
    return null
  }

  async fromOp(): Promise<SyncPayload | null> {
    return null
  }

  /** 古い読みが未読に戻す操作に勝たないよう、HLC は読んだ時刻のまま */
  async seed(ctx: AdapterContext): Promise<SeedRow[]> {
    const rows = await this.db.select<ThreadRow>('SELECT board_url, key, title, read_no, read_at, created_at, fetched_at FROM threads WHERE read_no > 0 ORDER BY read_at DESC, key')
    return rows.flatMap((r) => {
      const t = targetOf(ctx, DEV_KIND, r.board_url, r.key, ctx.deviceId)
      if (!t) return []
      const at = r.read_at ?? r.fetched_at ?? 1
      const hlc = formatHlc(Math.max(1, Math.min(at, ctx.now)), 0, ctx.deviceId)
      const payload = { kind: DEV_KIND, hlc, device_id: ctx.deviceId, body: { board_url: r.board_url, thread: r.key, base_reset_id: null, pos: r.read_no, steps: [{ at: hlc, pos: r.read_no }] } }
      return checkPayload(payload) === null ? [] : [{ ...t, priority: SEED_PRIORITY, payload }]
    })
  }

  detailOf(p: SyncPayload): string | null {
    return p.device_id
  }

  /** 手元の行のあるスレの既読。端末で同じ行があれば同じ値になる */
  override async localLines(): Promise<string[]> {
    const rows = await this.db.select<ThreadRow>('SELECT board_url, key, title, read_no, read_at, created_at FROM threads WHERE read_no > 0')
    return rows.map((r) => canonicalJson([normalizeBoardUrl(r.board_url), r.key, r.read_no]))
  }
}

/** ログの削除は全端末で未読に戻す操作。上限を超えた分は手元からだけ消える(設計は docs/sync-client.md の 4 章) */
export class ReadResetAdapter extends ReadAdapterBase implements SyncAdapter {
  readonly kind = RESET_KIND
  readonly ops = [OP_LOG_DELETE]

  constructor(db: SyncSqlDb, private readonly host: HistoryHost) {
    super(db)
  }

  target(op: SyncOpRow, ctx: AdapterContext): OpTarget | null {
    const a = argsOf(op)
    return a && targetOf(ctx, RESET_KIND, a.board_url, a.key)
  }

  async fromOp(): Promise<SyncPayload | null> {
    return null
  }

  async expand(op: SyncOpRow, ctx: AdapterContext): Promise<OpEffect[] | null> {
    const a = argsOf(op)
    const t = a && targetOf(ctx, RESET_KIND, a.board_url, a.key)
    if (!a || !t) return null
    const { latest, devs } = await readRecords(this.db, t.refs.ref_board as string, a.key)
    if (!latest) {
      const [row] = await this.db.select<{ n: number }>('SELECT COUNT(*) AS n FROM sync_records WHERE kind = $1', [RESET_KIND])
      if (Number(row?.n ?? 0) >= RESET_TOTAL_MAX) return null
    }
    const ref: ThreadRef = { board_url: a.board_url, thread: a.key }
    const id = this.host.newResetId()
    return [{ target: t, floor: resetFloor(latest, devs), make: (existing, stamp) => makeReset(existing, ref, id, 0, stamp, ctx.deviceId) }]
  }

  async seed(): Promise<SeedRow[]> {
    return []
  }
}

export function historyAdapters(db: SyncSqlDb, host: HistoryHost): SyncAdapter[] {
  return [new LastViewAdapter(db, host), new ReadDevAdapter(db), new ReadResetAdapter(db, host)]
}

