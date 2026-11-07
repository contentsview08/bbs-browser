// 書き込み履歴。ID は post:<板>:<スレ>:<post_id>。名前とメールは送らない(トリップが入るので)
import type { StoredRecord, SyncOpRow, SyncSqlDb } from '../engine/tables'
import { formatHlc } from '../hlc'
import { canonicalJson, parseStrictJson } from '../json'
import { normalizeBoardUrl, recordId } from '../keys'
import { makeTombstone, updateRecord, type SyncPayload } from '../merge'
import { fitPostBody, postIdOf } from '../post'
import { checkPayload } from '../schema'
import { utf8 } from '../bytes'
import type { BoardResolver } from './favoriteThread'
import type { AdapterContext, ApplyPlan, OpTarget, SeedRow, SyncAdapter } from './types'

export const POST_KIND = 'post'
export const POST_ADD = 'post_add'
export const POST_REMOVE = 'post_remove'
export const AREA_POSTS = 'posts'
const TITLE_MAX = 1024
const SEED_PRIORITY = 3
/** 平文の上限より手前。スレタイを落とせば収まるようにする(本文は切ってあるので ID が変わらない) */
const PLAIN_BYTES = 15000

interface LocalRow {
  id: number
  board_url: string
  key: string
  thread_title: string
  no: number | null
  body: string
  posted_at: number
}

interface PostArgs {
  board_url: string
  key: string
  posted_at: number
  body: string
}

const COLUMNS = 'id, board_url, key, thread_title, no, body, posted_at'

function targetOf(ctx: AdapterContext, a: PostArgs): OpTarget | null {
  const board = normalizeBoardUrl(a.board_url)
  if (board === null || a.key === '') return null
  const postId = postIdOf(board, a.key, a.posted_at, a.body)
  return { record_id: recordId(ctx.keys.k_id, POST_KIND, a.board_url, a.key, postId), refs: { ref_board: board, ref_thread: a.key, ref_detail: postId, ref_local: null } }
}

function bodyOf(r: LocalRow, postId: string, title: string): Record<string, unknown> {
  return {
    post_id: postId,
    board_url: r.board_url,
    thread: r.key,
    ...(title !== '' && { title: title.slice(0, TITLE_MAX) }),
    ...(r.no !== null && { no: r.no }),
    body: fitPostBody(r.body),
    posted_at: r.posted_at,
  }
}

function fitted(p: SyncPayload): SyncPayload {
  if (utf8(canonicalJson(p)).length <= PLAIN_BYTES || p.body?.title === undefined) return p
  const { title: _, ...rest } = p.body
  return { ...p, body: rest }
}

const argsOf = (op: SyncOpRow): PostArgs | null => {
  try {
    const a = parseStrictJson(op.args ?? '') as Partial<PostArgs>
    return typeof a?.board_url === 'string' && typeof a.key === 'string' && typeof a.posted_at === 'number' && typeof a.body === 'string' ? (a as PostArgs) : null
  } catch {
    return null
  }
}

export class PostAdapter implements SyncAdapter {
  readonly kind = POST_KIND
  readonly area = AREA_POSTS
  readonly ops = [POST_ADD, POST_REMOVE]
  readonly reconciles = false

  constructor(private readonly db: SyncSqlDb, private readonly resolve: BoardResolver) {}

  target(op: SyncOpRow, ctx: AdapterContext): OpTarget | null {
    const a = argsOf(op)
    return a && targetOf(ctx, a)
  }

  /** 同じ時刻の行は少ないので、時刻で引いてから ID で比べる。URL の揺れはここで吸収される */
  private async rowsOf(postId: unknown, postedAt: unknown): Promise<LocalRow[]> {
    if (typeof postId !== 'string' || typeof postedAt !== 'number') return []
    const rows = await this.db.select<LocalRow>(`SELECT ${COLUMNS} FROM post_history WHERE posted_at = $1 ORDER BY id`, [postedAt])
    return rows.filter((r) => {
      const board = normalizeBoardUrl(r.board_url)
      return board !== null && postIdOf(board, r.key, r.posted_at, r.body) === postId
    })
  }

  async fromOp(op: SyncOpRow, existing: SyncPayload | null, stamp: string, ctx: AdapterContext): Promise<SyncPayload | null> {
    const a = argsOf(op) as PostArgs
    const postId = (targetOf(ctx, a) as OpTarget).refs.ref_detail as string
    if (op.op === POST_REMOVE) {
      // 手元の行を探すのに要る 2 つだけを残す(本文もスレタイも残さない)
      const tomb = makeTombstone(existing ?? { kind: POST_KIND, hlc: stamp, device_id: ctx.deviceId }, stamp, ctx.deviceId)
      return { ...tomb, body: { post_id: postId, posted_at: a.posted_at } }
    }
    const [row] = await this.rowsOf(postId, a.posted_at)
    return row ? fitted(updateRecord(existing, POST_KIND, bodyOf(row, postId, row.thread_title), stamp, ctx.deviceId)) : null
  }

  fill(ctx: AdapterContext): Promise<SeedRow[]> {
    return this.seed(ctx)
  }

  async seed(ctx: AdapterContext): Promise<SeedRow[]> {
    const rows = await this.db.select<LocalRow>(`SELECT ${COLUMNS} FROM post_history ORDER BY posted_at DESC, id DESC`)
    const seen = new Set<string>()
    return rows.flatMap((r) => {
      const t = targetOf(ctx, { board_url: r.board_url, key: r.key, posted_at: r.posted_at, body: r.body })
      if (!t || seen.has(t.record_id)) return []
      seen.add(t.record_id)
      const hlc = formatHlc(Math.max(1, Math.min(r.posted_at, ctx.now)), 0, ctx.deviceId)
      const payload = fitted({ kind: POST_KIND, hlc, device_id: ctx.deviceId, body: bodyOf(r, t.refs.ref_detail as string, r.thread_title) })
      return checkPayload(payload) === null ? [] : [{ ...t, priority: SEED_PRIORITY, payload }]
    })
  }

  detailOf(p: SyncPayload): string | null {
    return typeof p.body?.post_id === 'string' ? p.body.post_id : null
  }

  owns(r: StoredRecord): boolean {
    return r.ref_detail !== null
  }

  async exists(r: StoredRecord): Promise<boolean> {
    return (await this.rowsOf(r.ref_detail, r.payload.body?.posted_at)).length > 0
  }

  async remove(r: StoredRecord): Promise<ApplyPlan> {
    const rows = await this.rowsOf(r.ref_detail, r.payload.body?.posted_at)
    return { changed: rows.length > 0, statements: rows.map((x) => ({ sql: 'DELETE FROM post_history WHERE id = $1', params: [x.id] })) }
  }

  /** 自分のレスの印は own_post のレコードで別に届く。履歴から消しても印は消えない */
  async apply(r: StoredRecord): Promise<ApplyPlan> {
    if (r.payload.deleted === true) return r.payload.trim === true ? { statements: [], changed: false } : this.remove(r)
    const body = r.payload.body ?? {}
    const postId = body.post_id as string
    const postedAt = body.posted_at as number
    const title = typeof body.title === 'string' ? body.title : ''
    const no = typeof body.no === 'number' ? body.no : null
    const rows = await this.rowsOf(postId, postedAt)
    if (rows.length === 0) {
      const resolved = this.resolve(body.board_url as string)
      if (!resolved) return { statements: [], changed: false }
      return {
        changed: true,
        statements: [
          {
            sql: `INSERT INTO post_history (connector_id, board_url, key, thread_title, no, name, mail, body, posted_at) VALUES ($1, $2, $3, $4, $5, '', '', $6, $7)`,
            params: [resolved.connectorId, resolved.boardUrl, r.ref_thread, title, no, body.body, postedAt],
          },
        ],
      }
    }
    const [first, ...extra] = rows
    const newTitle = title === '' ? first.thread_title : title
    const newNo = no ?? first.no
    const changed = extra.length > 0 || newTitle !== first.thread_title || newNo !== first.no
    if (!changed) return { statements: [], changed: false }
    return {
      changed: true,
      statements: [
        ...extra.map((x) => ({ sql: 'DELETE FROM post_history WHERE id = $1', params: [x.id] })),
        { sql: 'UPDATE post_history SET thread_title = $1, no = $2 WHERE id = $3', params: [newTitle, newNo, first.id] },
      ],
    }
  }

  async localLines(): Promise<string[]> {
    const rows = await this.db.select<LocalRow>(`SELECT ${COLUMNS} FROM post_history`)
    const lines = new Set<string>()
    for (const r of rows) {
      const board = normalizeBoardUrl(r.board_url)
      if (board !== null) lines.add(canonicalJson([postIdOf(board, r.key, r.posted_at, r.body), r.no, r.thread_title]))
    }
    return [...lines]
  }
}
