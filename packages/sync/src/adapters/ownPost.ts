// 自分のレスの印。ID は own_post:<板>:<スレ>:<no>。書き込みで付いた印も手で付けた印も同じレコードで、外すと tombstone
import type { StoredRecord, SyncOpRow, SyncSqlDb } from '../engine/tables'
import { formatHlc } from '../hlc'
import { canonicalJson, parseStrictJson } from '../json'
import { normalizeBoardUrl, recordId } from '../keys'
import { makeTombstone, updateRecord, type SyncPayload } from '../merge'
import { checkPayload } from '../schema'
import type { BoardResolver } from './favoriteThread'
import type { AdapterContext, ApplyPlan, OpTarget, SeedRow, SyncAdapter } from './types'

export const OWN_POST_KIND = 'own_post'
export const OWN_ADD = 'own_add'
export const OWN_REMOVE = 'own_remove'
export const AREA_OWN_POSTS = 'ownPosts'
/** 書き込み履歴と同じ系統なので同じ順で送る */
const SEED_PRIORITY = 3

interface LocalRow {
  board_url: string
  key: string
  no: number
  posted_at: number
}

interface OwnArgs {
  board_url: string
  key: string
  no: number
}

const COLUMNS = 'board_url, key, no, posted_at'

function targetOf(ctx: AdapterContext, a: OwnArgs): OpTarget | null {
  const board = normalizeBoardUrl(a.board_url)
  if (board === null || a.key === '' || !Number.isSafeInteger(a.no) || a.no < 0) return null
  const detail = String(a.no)
  return { record_id: recordId(ctx.keys.k_id, OWN_POST_KIND, a.board_url, a.key, detail), refs: { ref_board: board, ref_thread: a.key, ref_detail: detail, ref_local: null } }
}

const bodyOf = (r: LocalRow): Record<string, unknown> => ({ board_url: r.board_url, thread: r.key, no: r.no, posted_at: r.posted_at })

const argsOf = (op: SyncOpRow): OwnArgs | null => {
  try {
    const a = parseStrictJson(op.args ?? '') as Partial<OwnArgs>
    return typeof a?.board_url === 'string' && typeof a.key === 'string' && typeof a.no === 'number' ? (a as OwnArgs) : null
  } catch {
    return null
  }
}

/** tombstone は本文を持たないので、覚えた ref から番号を読む */
const noOf = (r: StoredRecord): number | null => {
  const n = Number(r.ref_detail)
  return r.ref_detail !== null && Number.isSafeInteger(n) ? n : null
}

export class OwnPostAdapter implements SyncAdapter {
  readonly kind = OWN_POST_KIND
  readonly area = AREA_OWN_POSTS
  readonly ops = [OWN_ADD, OWN_REMOVE]
  readonly reconciles = false

  constructor(private readonly db: SyncSqlDb, private readonly resolve: BoardResolver) {}

  target(op: SyncOpRow, ctx: AdapterContext): OpTarget | null {
    const a = argsOf(op)
    return a && targetOf(ctx, a)
  }

  /** スレのキーで引いてから板と番号を比べる(数の比較を WHERE に書かない。スマホの rawQuery は値を文字列で束ねる)。URL の揺れはここで吸収される */
  private async rowsOf(board: string | null, key: string | null, no: number | null): Promise<LocalRow[]> {
    if (board === null || key === null || no === null) return []
    const rows = await this.db.select<LocalRow>(`SELECT ${COLUMNS} FROM own_posts WHERE key = $1`, [key])
    return rows.filter((r) => Number(r.no) === no && normalizeBoardUrl(r.board_url) === board)
  }

  async fromOp(op: SyncOpRow, existing: SyncPayload | null, stamp: string, ctx: AdapterContext): Promise<SyncPayload | null> {
    const a = argsOf(op) as OwnArgs
    if (op.op === OWN_REMOVE) return makeTombstone(existing ?? { kind: OWN_POST_KIND, hlc: stamp, device_id: ctx.deviceId }, stamp, ctx.deviceId)
    const [row] = await this.rowsOf(normalizeBoardUrl(a.board_url), a.key, a.no)
    return row ? updateRecord(existing, OWN_POST_KIND, bodyOf(row), stamp, ctx.deviceId) : null
  }

  fill(ctx: AdapterContext): Promise<SeedRow[]> {
    return this.seed(ctx)
  }

  async seed(ctx: AdapterContext): Promise<SeedRow[]> {
    const rows = await this.db.select<LocalRow>(`SELECT ${COLUMNS} FROM own_posts ORDER BY posted_at DESC, board_url, key, no`)
    const seen = new Set<string>()
    return rows.flatMap((r) => {
      const t = targetOf(ctx, { board_url: r.board_url, key: r.key, no: r.no })
      if (!t || seen.has(t.record_id)) return []
      seen.add(t.record_id)
      const hlc = formatHlc(Math.max(1, Math.min(r.posted_at, ctx.now)), 0, ctx.deviceId)
      const payload = { kind: OWN_POST_KIND, hlc, device_id: ctx.deviceId, body: bodyOf(r) }
      return checkPayload(payload) === null ? [] : [{ ...t, priority: SEED_PRIORITY, payload }]
    })
  }

  detailOf(p: SyncPayload): string | null {
    return typeof p.body?.no === 'number' ? String(p.body.no) : null
  }

  owns(r: StoredRecord): boolean {
    return r.ref_detail !== null
  }

  async exists(r: StoredRecord): Promise<boolean> {
    return (await this.rowsOf(r.ref_board, r.ref_thread, noOf(r))).length > 0
  }

  async remove(r: StoredRecord): Promise<ApplyPlan> {
    const rows = await this.rowsOf(r.ref_board, r.ref_thread, noOf(r))
    return { changed: rows.length > 0, statements: rows.map((x) => ({ sql: 'DELETE FROM own_posts WHERE board_url = $1 AND key = $2 AND no = $3', params: [x.board_url, x.key, x.no] })) }
  }

  /** スレの行がなくても入れる(印はログと独立で、ログを消しても残る) */
  async apply(r: StoredRecord, ctx: AdapterContext): Promise<ApplyPlan> {
    if (r.payload.deleted === true) return r.payload.trim === true ? { statements: [], changed: false } : this.remove(r)
    const body = r.payload.body ?? {}
    const no = noOf(r)
    if (no === null || (await this.exists(r))) return { statements: [], changed: false }
    const resolved = this.resolve(body.board_url as string)
    if (!resolved) return { statements: [], changed: false }
    const postedAt = typeof body.posted_at === 'number' ? body.posted_at : ctx.now
    return {
      changed: true,
      statements: [{ sql: 'INSERT OR IGNORE INTO own_posts (board_url, key, no, posted_at) VALUES ($1, $2, $3, $4)', params: [resolved.boardUrl, r.ref_thread, no, postedAt] }],
    }
  }

  async localLines(): Promise<string[]> {
    const rows = await this.db.select<LocalRow>(`SELECT ${COLUMNS} FROM own_posts`)
    const lines = new Set<string>()
    for (const r of rows) {
      const board = normalizeBoardUrl(r.board_url)
      if (board !== null) lines.add(canonicalJson([board, r.key, r.no]))
    }
    return [...lines]
  }
}
