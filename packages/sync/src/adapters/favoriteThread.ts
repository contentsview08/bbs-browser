// お気に入りのスレ。ID は favorite:<板>:<キー>。お気に入り板は同じ kind で thread がない
import type { StoredRecord, SyncOpRow, SyncSqlDb } from '../engine/tables'
import { formatHlc } from '../hlc'
import { parseStrictJson } from '../json'
import { normalizeBoardUrl, recordId } from '../keys'
import { makeTombstone, updateRecord, type SyncPayload } from '../merge'
import { checkPayload } from '../schema'
import type { AdapterContext, ApplyPlan, OpTarget, SeedRow, SyncAdapter } from './types'

export const FAVORITE_KIND = 'favorite'
export const FAVORITE_THREAD_ADD = 'favorite_thread_add'
export const FAVORITE_THREAD_REMOVE = 'favorite_thread_remove'
export const AREA_FAVORITE_THREADS = 'favoriteThreads'
const TITLE_MAX = 1024
const SEED_PRIORITY = 1

export interface ResolvedBoard {
  boardUrl: string
  connectorId: string
}

/** 今の正しい URL とコネクタを親が決める。この端末で扱えない板は null(同期の表にだけ持つ) */
export type BoardResolver = (boardUrl: string) => ResolvedBoard | null

interface LocalRow {
  board_url: string
  key: string
  title: string
  created_at: number | null
  added_at: number
}

const TITLE_SQL = "COALESCE(NULLIF((SELECT t.title FROM threads AS t WHERE t.board_url = f.board_url AND t.key = f.key), ''), f.title) AS title"

function targetOf(ctx: AdapterContext, boardUrl: string, key: string): OpTarget | null {
  const board = normalizeBoardUrl(boardUrl)
  if (board === null || key === '') return null
  return { record_id: recordId(ctx.keys.k_id, FAVORITE_KIND, boardUrl, key), refs: { ref_board: board, ref_thread: key, ref_detail: null, ref_local: null } }
}

/** ID の入力に使った値を本文に持つ。スレタイの空は手元を残す印なので書かない */
function bodyOf(r: LocalRow): Record<string, unknown> {
  return {
    board_url: r.board_url,
    thread: r.key,
    ...(r.title !== '' && { title: r.title.slice(0, TITLE_MAX) }),
    ...(r.created_at !== null && { created_at: r.created_at }),
  }
}

export class FavoriteThreadAdapter implements SyncAdapter {
  readonly kind = FAVORITE_KIND
  readonly area = AREA_FAVORITE_THREADS
  readonly ops = [FAVORITE_THREAD_ADD, FAVORITE_THREAD_REMOVE]

  constructor(private readonly db: SyncSqlDb, private readonly resolve: BoardResolver) {}

  target(op: SyncOpRow, ctx: AdapterContext): OpTarget | null {
    try {
      const a = parseStrictJson(op.args ?? '') as { board_url?: unknown; key?: unknown }
      return typeof a?.board_url === 'string' && typeof a.key === 'string' ? targetOf(ctx, a.board_url, a.key) : null
    } catch {
      return null
    }
  }

  async fromOp(op: SyncOpRow, existing: SyncPayload | null, stamp: string, ctx: AdapterContext): Promise<SyncPayload | null> {
    if (op.op === FAVORITE_THREAD_REMOVE) return makeTombstone(existing ?? { kind: FAVORITE_KIND, hlc: stamp, device_id: ctx.deviceId }, stamp, ctx.deviceId)
    const a = parseStrictJson(op.args ?? '') as { board_url: string; key: string }
    const [row] = await this.db.select<LocalRow>(
      `SELECT f.board_url, f.key, ${TITLE_SQL}, f.created_at, f.added_at FROM favorite_threads AS f WHERE f.board_url = $1 AND f.key = $2`,
      [a.board_url, a.key],
    )
    return row ? updateRecord(existing, FAVORITE_KIND, bodyOf(row), stamp, ctx.deviceId) : null
  }

  async seed(ctx: AdapterContext): Promise<SeedRow[]> {
    const rows = await this.db.select<LocalRow>(`SELECT f.board_url, f.key, ${TITLE_SQL}, f.created_at, f.added_at FROM favorite_threads AS f ORDER BY f.sort, f.added_at`)
    return rows.flatMap((r) => {
      const t = targetOf(ctx, r.board_url, r.key)
      if (!t) return []
      const hlc = formatHlc(Math.max(1, Math.min(r.added_at, ctx.now)), 0, ctx.deviceId)
      const payload = { kind: FAVORITE_KIND, hlc, device_id: ctx.deviceId, body: bodyOf(r) }
      // 受け取る側の検査に落ちるものは送らない(長すぎるキーなど)。手元には残る
      return checkPayload(payload) === null ? [] : [{ ...t, priority: SEED_PRIORITY, payload }]
    })
  }

  /** 手元の URL は端末で違うことがあるので、キーで引いて正規化した値で比べる */
  private async localRows(r: StoredRecord): Promise<{ board_url: string; title: string }[]> {
    const rows = await this.db.select<{ board_url: string; title: string }>('SELECT board_url, title FROM favorite_threads WHERE key = $1', [r.ref_thread])
    return rows.filter((x) => normalizeBoardUrl(x.board_url) === r.ref_board)
  }

  owns(r: StoredRecord): boolean {
    return !!r.ref_thread
  }

  async exists(r: StoredRecord): Promise<boolean> {
    return (await this.localRows(r)).length > 0
  }

  async remove(r: StoredRecord): Promise<ApplyPlan> {
    const rows = await this.localRows(r)
    return {
      changed: rows.length > 0,
      statements: rows.map((x) => ({ sql: 'DELETE FROM favorite_threads WHERE board_url = $1 AND key = $2', params: [x.board_url, r.ref_thread] })),
    }
  }

  async apply(r: StoredRecord, ctx: AdapterContext): Promise<ApplyPlan> {
    // trim はサーバーから外すだけの印で、手元を消さない
    if (r.payload.deleted === true) return r.payload.trim === true ? { statements: [], changed: false } : this.remove(r)
    const body = r.payload.body ?? {}
    const title = typeof body.title === 'string' ? body.title : ''
    const rows = await this.localRows(r)
    if (rows.length > 0) {
      const stale = title === '' ? [] : rows.filter((x) => x.title !== title)
      return {
        changed: stale.length > 0,
        statements: stale.map((x) => ({ sql: 'UPDATE favorite_threads SET title = $1 WHERE board_url = $2 AND key = $3', params: [title, x.board_url, r.ref_thread] })),
      }
    }
    const resolved = this.resolve(body.board_url as string)
    if (!resolved) return { statements: [], changed: false }
    return {
      changed: true,
      statements: [
        {
          sql: `INSERT OR IGNORE INTO favorite_threads (board_url, key, connector_id, title, created_at, sort, added_at)
                VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(sort), 0) + 1 FROM favorite_threads), $6)`,
          params: [resolved.boardUrl, r.ref_thread, resolved.connectorId, title === '' ? r.ref_thread : title, typeof body.created_at === 'number' ? body.created_at : null, ctx.now],
        },
      ],
    }
  }
}
