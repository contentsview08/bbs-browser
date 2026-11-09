// スレのログ(取得済みのレス・既読位置・差分取得の Cursor)を SQLite に保存する。
// SQL の実行は SqlDb 越しに行うので、アプリでは tauri-plugin-sql、テストでは sql.js を差し込める。
//
// tauri-plugin-sql は接続プールを使うため、execute を並べても BEGIN/COMMIT が同じ接続で走る保証がない。
// execute では「途中で落ちても次の取得で正しい状態に戻る」順番で書き込む。一緒に書く必要があるものだけ batch を使う。

import type { Badge, Board, Cursor, FetchPostsResult, Post, SiteConfig, ThreadSummary } from '@bbs-browser/connectors'

/** プレースホルダーは $1, $2 …(tauri-plugin-sql の SQLite に合わせる) */
export interface SqlDb {
  execute(sql: string, params?: unknown[]): Promise<void>
  select<T>(sql: string, params?: unknown[]): Promise<T[]>
  /** まとめて 1 つのトランザクションで流す。どれかが失敗すれば全部戻る */
  batch(statements: SqlStatement[]): Promise<void>
}

export interface SqlStatement {
  sql: string
  params?: unknown[]
}

/** アップロードした画像 1 枚ぶん */
export interface UploadRecord {
  url: string
  name: string
  size: number
  uploadedAt: number
  /** catbox のアカウント(userhash)で上げたか。アカウントで上げたものだけ、サーバー上でも消せる */
  withAccount: boolean
  /** 中身の SHA-256(16 進)。同じ画像をもう一度貼ったら、上げずにこの URL を使う。昔の履歴にはない */
  hash?: string
  /** 置き場から消すためのページの URL(imgbb の delete_url)。ブラウザで開いて消す。ないものは置き場では消せない */
  deleteUrl?: string
}

export interface ThreadState {
  /** 手元に保存してあるレス数 */
  postCount: number
  readNo: number
  status: 'active' | 'archived'
}

export interface ThreadLog extends ThreadState {
  title: string
  posts: Post[]
  cursor: Cursor | null
}

/**
 * 取得の結果を、手元にあるログに当てはめた後のログを返す(DB を読み直さずに済ませるため)。
 * saveFetch が DB に書くのと同じ結果になる。
 * 変わらなかったとき('notModified')は before をそのまま返す(呼び出し側は同じものなら描き直さなくてよい)
 */
export function applyFetch(before: ThreadLog | null, thread: ThreadSummary, result: FetchPostsResult): ThreadLog {
  const base: ThreadLog = before ?? {
    title: result.title ?? thread.title,
    posts: [],
    cursor: null,
    postCount: 0,
    readNo: 0,
    status: 'active',
  }
  // 変わらなくても、dat 落ちと分かったら(過去ログから取ったスレ)印だけは付ける。
  // そのときは続きの印も受け取る(したらばは新着のないまま過去ログ倉庫に入ったことを印で返す。次から取りに行かないように)。
  // ふつうの変化なしの印は受け取らない(レスのない印を持つと、次から差分だけを取りに行く)
  if (result.status === 'notModified') {
    const status = result.archived ? 'archived' : base.status
    const cursor = result.archived && base.posts.length > 0 ? (result.cursor ?? base.cursor) : base.cursor
    return status === base.status && JSON.stringify(cursor) === JSON.stringify(base.cursor) ? base : { ...base, status, cursor }
  }
  if (result.status === 'archived') return base.status === 'archived' ? base : { ...base, status: 'archived' }
  let posts: Post[]
  // 同じ番号は後のものを残す(INSERT OR REPLACE と同じ)
  if (result.status === 'reset') posts = [...new Map(result.posts.map((p) => [p.no, p])).values()].sort((a, b) => a.no - b.no)
  else {
    // 同じ番号は新しいほうで置き換える(INSERT OR REPLACE と同じ)。ふつうは後ろに足すだけで済む
    const lastNo = base.posts.at(-1)?.no ?? 0
    if (result.posts.every((p, i) => p.no > lastNo && (i === 0 || p.no > result.posts[i - 1].no)))
      posts = base.posts.concat(result.posts)
    else {
      const byNo = new Map(base.posts.map((p) => [p.no, p]))
      for (const p of result.posts) byNo.set(p.no, p)
      posts = [...byNo.values()].sort((a, b) => a.no - b.no)
    }
  }
  return {
    ...base,
    title: result.title ?? base.title,
    posts,
    cursor: result.cursor,
    postCount: posts.length,
    status: result.archived ? 'archived' : 'active',
  }
}

/** お気に入りのスレ。ログがあれば、その既読・レス数・dat 落ちも付ける(なければ 0 と active) */
export interface FavoriteThreadEntry extends ThreadState {
  thread: ThreadSummary
}

/** 自動 NG にユーザーが付けた印(荒らし・荒らしじゃない)。本文の鍵ごとに 1 つ */
export interface TrollMarkRecord {
  bodyKey: string
  /** true は荒らし、false は荒らしじゃない(自動 NG の誤判定) */
  troll: boolean
  body: string
  boardUrl: string
  /** 付けたときの自動 NG の理由(dup・repeat など)。自動 NG されていなかったレスなら undefined */
  reason?: string
  createdAt: number
}

/** サイトのアカウント(5ch の BE など) */
export interface AccountRecord {
  connectorId: string
  accountId: string
  user: string
  password: string
  autoLogin: boolean
}

/** 書き込み履歴の 1 件 */
export interface PostHistoryEntry {
  id: number
  /** 開き直せるよう ThreadSummary の形にしたスレ */
  thread: ThreadSummary
  /** レス番号。分からなかったときは undefined */
  no?: number
  name: string
  mail: string
  body: string
  postedAt: number
}

/** 履歴に出すスレ。開き直せるよう ThreadSummary の形で返す */
export interface HistoryEntry extends ThreadState {
  thread: ThreadSummary
  readAt: number
}

interface ThreadRow {
  board_url: string
  key: string
  connector_id: string
  title: string
  post_count: number
  read_no: number
  cursor: string | null
  status: 'active' | 'archived'
  created_at: number | null
  read_at: number | null
}

interface PostRow {
  no: number
  ref: number | null
  name: string
  mail: string
  date: string
  id: string | null
  body: string
  badges: string | null
}

/** 1 文の INSERT に詰めるレスの数(SQLite の変数の上限を超えないように) */
const CHUNK = 500

/** undefined は JSON で null になるが、sql.js では例外になるので揃えておく */
const nn = (v: unknown) => (v === undefined ? null : v)

/** 複数行の VALUES 句を $n 付きで作る */
function valuesClause(rows: number, cols: number): string {
  const groups: string[] = []
  for (let r = 0; r < rows; r++) {
    const ps = Array.from({ length: cols }, (_, c) => `$${r * cols + c + 1}`)
    groups.push(`(${ps.join(', ')})`)
  }
  return groups.join(', ')
}

/** スレの行から ThreadSummary を作る(スレタイとレス数は呼ぶ側が決める) */
function threadOfRow(r: { connector_id: string; board_url: string; key: string; created_at: number | null }, title: string, postCount: number): ThreadSummary {
  return {
    connectorId: r.connector_id,
    boardUrl: r.board_url,
    key: r.key,
    title,
    postCount,
    order: 0,
    createdAt: r.created_at === null ? undefined : new Date(r.created_at),
  }
}

export function addFavoriteThreadStatement(thread: ThreadSummary, now: number): SqlStatement {
  return {
    sql: `INSERT OR IGNORE INTO favorite_threads (board_url, key, connector_id, title, created_at, sort, added_at)
       VALUES ($1, $2, $3, $4, $5, (SELECT COALESCE(MAX(sort), 0) + 1 FROM favorite_threads), $6)`,
    params: [thread.boardUrl, thread.key, thread.connectorId, thread.title, nn(thread.createdAt?.getTime()), now],
  }
}

export function removeFavoriteThreadStatement(thread: ThreadSummary): SqlStatement {
  return { sql: 'DELETE FROM favorite_threads WHERE board_url = $1 AND key = $2', params: [thread.boardUrl, thread.key] }
}

export function addFavoriteBoardStatement(board: Board): SqlStatement {
  return {
    sql: `INSERT OR IGNORE INTO favorite_boards (url, connector_id, name, sort)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM favorite_boards))`,
    params: [board.url, board.connectorId, board.name],
  }
}

export const removeFavoriteBoardStatement = (url: string): SqlStatement => ({ sql: 'DELETE FROM favorite_boards WHERE url = $1', params: [url] })

export const reorderFavoriteStatements = (urls: string[]): SqlStatement[] => urls.map((url, i) => ({ sql: 'UPDATE favorite_boards SET sort = $1 WHERE url = $2', params: [i, url] }))

export function addSiteStatement(site: SiteConfig): SqlStatement {
  return {
    sql: `INSERT OR IGNORE INTO sites (menu_url, connector_id, name, sort)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM sites))`,
    params: [site.menuUrl, site.connectorId, site.name],
  }
}

export const removeSiteStatements = (menuUrl: string): SqlStatement[] => [
  { sql: 'DELETE FROM boards WHERE site_menu_url = $1', params: [menuUrl] },
  { sql: 'DELETE FROM sites WHERE menu_url = $1', params: [menuUrl] },
]

export function addUploadStatement(u: Omit<UploadRecord, 'uploadedAt'>, now: number): SqlStatement {
  return {
    sql: 'INSERT OR REPLACE INTO uploads (url, name, size, uploaded_at, with_account, hash, delete_url) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    params: [u.url, u.name, u.size, now, u.withAccount ? 1 : 0, u.hash ?? null, u.deleteUrl ?? null],
  }
}

export const removeUploadStatement = (url: string): SqlStatement => ({ sql: 'DELETE FROM uploads WHERE url = $1', params: [url] })

/** 既読位置は戻さない(読み返しても未読が増えないように) */
export function markReadStatement(thread: ThreadSummary, no: number, now: number): SqlStatement {
  return { sql: 'UPDATE threads SET read_no = MAX(read_no, $1), read_at = $2 WHERE board_url = $3 AND key = $4', params: [no, now, thread.boardUrl, thread.key] }
}

export const removeHistoryStatement = (thread: ThreadSummary): SqlStatement => ({ sql: 'UPDATE threads SET read_at = NULL WHERE board_url = $1 AND key = $2', params: [thread.boardUrl, thread.key] })

/** 同期を使っている間のログの削除。書き込み履歴が残るので、自分のレスの印も残す */
export const deleteThreadStatements = (thread: ThreadSummary): SqlStatement[] =>
  ['threads', 'posts'].map((table) => ({ sql: `DELETE FROM ${table} WHERE board_url = $1 AND key = $2`, params: [thread.boardUrl, thread.key] }))

export function addPostHistoryStatement(thread: ThreadSummary, post: { no?: number; name: string; mail: string; body: string }, now: number): SqlStatement {
  return {
    sql: `INSERT INTO post_history (connector_id, board_url, key, thread_title, no, name, mail, body, posted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    params: [thread.connectorId, thread.boardUrl, thread.key, thread.title, nn(post.no), post.name, post.mail, post.body, now],
  }
}

export const deletePostHistoryStatement = (id: number): SqlStatement => ({ sql: 'DELETE FROM post_history WHERE id = $1', params: [id] })

export const addOwnPostStatement = (thread: ThreadSummary, no: number, now: number): SqlStatement => ({
  sql: 'INSERT OR IGNORE INTO own_posts (board_url, key, no, posted_at) VALUES ($1, $2, $3, $4)',
  params: [thread.boardUrl, thread.key, no, now],
})

/** 印は書いた端末の URL の書き方のまま入る(同期で入る行は 5ch.io・https)ので、どの書き方の印も外す */
export const removeOwnPostStatement = (thread: ThreadSummary, no: number): SqlStatement => {
  const urls = boardUrlVariants(thread.boardUrl)
  return {
    sql: `DELETE FROM own_posts WHERE board_url IN (${urls.map((_, i) => `$${i + 3}`).join(', ')}) AND key = $1 AND no = $2`,
    params: [thread.key, no, ...urls],
  }
}

export const setSettingStatement = (key: string, value: unknown): SqlStatement => ({ sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', params: [key, JSON.stringify(value)] })

/** 同じ板の URL の書き方。行は書いた端末の URL のまま残るので、板の未読はどの書き方の行も読む */
export function boardUrlVariants(url: string): string[] {
  const m = /^https?:\/\/(.*)$/.exec(url)
  if (!m) return [url]
  const rest = m[1]
  const hosts = /(^|\.)5ch\.(io|net)\//.test(rest) ? [rest.replace('5ch.net/', '5ch.io/'), rest.replace('5ch.io/', '5ch.net/')] : [rest]
  return hosts.flatMap((h) => [`https://${h}`, `http://${h}`])
}

/**
 * SQL の中で、列の板の URL と同じ板の書き方を並べる(boardUrlVariants と同じ 4 通り)。
 * `board_url IN (…)` に使うと、主キーの索引のまま引ける
 */
function boardUrlVariantsSql(col: string): string {
  const canonical = `REPLACE(REPLACE(${col}, 'http://', 'https://'), '5ch.net/', '5ch.io/')`
  const net = `REPLACE(${canonical}, '5ch.io/', '5ch.net/')`
  return [canonical, `REPLACE(${canonical}, 'https://', 'http://')`, net, `REPLACE(${net}, 'https://', 'http://')`].join(', ')
}

export class LogStore {
  /** 利用者の操作が送信待ちを積んだときの知らせ。同期が間隔を待たずに早めに送るために使う */
  private readonly syncOpsListeners = new Set<() => void>()

  constructor(readonly db: SqlDb) {}

  /** 送信待ちが積まれたら呼ぶ。戻り値で外す */
  onSyncOps(f: () => void): () => void {
    this.syncOpsListeners.add(f)
    return () => void this.syncOpsListeners.delete(f)
  }

  /** UserOps が積んだ後に呼ぶ。知らせを受ける側の失敗で利用者の操作を失敗にしない */
  notifySyncOps(): void {
    for (const f of this.syncOpsListeners) {
      try {
        f()
      } catch {
        // 知らせは早めに送るためだけなので、捨てても周期の送信で送られる
      }
    }
  }

  // ── サイトと板 ──

  async listSites(): Promise<SiteConfig[]> {
    const rows = await this.db.select<{ menu_url: string; connector_id: string; name: string }>(
      'SELECT menu_url, connector_id, name FROM sites ORDER BY sort, name',
    )
    return rows.map((r) => ({ menuUrl: r.menu_url, connectorId: r.connector_id, name: r.name }))
  }

  async addSite(site: SiteConfig): Promise<void> {
    const { sql, params } = addSiteStatement(site)
    await this.db.execute(sql, params)
  }

  async removeSite(menuUrl: string): Promise<void> {
    for (const { sql, params } of removeSiteStatements(menuUrl)) await this.db.execute(sql, params)
  }

  async getBoards(menuUrl: string): Promise<Board[]> {
    const rows = await this.db.select<{ url: string; connector_id: string; name: string; category: string | null }>(
      'SELECT url, connector_id, name, category FROM boards WHERE site_menu_url = $1 ORDER BY sort',
      [menuUrl],
    )
    return rows.map((r) => ({ url: r.url, connectorId: r.connector_id, name: r.name, category: r.category ?? undefined }))
  }

  /** 板一覧はただのキャッシュなので、途中で落ちても次の取得で作り直せばよい */
  async replaceBoards(menuUrl: string, boards: Board[]): Promise<void> {
    await this.db.execute('DELETE FROM boards WHERE site_menu_url = $1', [menuUrl])
    for (let i = 0; i < boards.length; i += CHUNK) {
      const chunk = boards.slice(i, i + CHUNK)
      await this.db.execute(
        `INSERT OR REPLACE INTO boards (site_menu_url, url, connector_id, name, category, sort) VALUES ${valuesClause(chunk.length, 6)}`,
        chunk.flatMap((b, j) => [menuUrl, b.url, b.connectorId, b.name, nn(b.category), i + j]),
      )
    }
  }

  // ── お気に入り板 ──

  async listFavorites(): Promise<Board[]> {
    const rows = await this.db.select<{ url: string; connector_id: string; name: string }>(
      'SELECT url, connector_id, name FROM favorite_boards ORDER BY sort, name',
    )
    return rows.map((r) => ({ url: r.url, connectorId: r.connector_id, name: r.name }))
  }

  async addFavorite(board: Board): Promise<void> {
    const { sql, params } = addFavoriteBoardStatement(board)
    await this.db.execute(sql, params)
  }

  /** お気に入り板の名前を直す(掲示板側で板名が変わったとき。板の情報を取ったら写す) */
  async renameFavorite(url: string, name: string): Promise<void> {
    await this.db.execute('UPDATE favorite_boards SET name = $1 WHERE url = $2', [name, url])
  }

  /** お気に入り板を、渡した URL の並びにする */
  async reorderFavorites(urls: string[]): Promise<void> {
    for (const { sql, params } of reorderFavoriteStatements(urls)) await this.db.execute(sql, params)
  }

  async removeFavorite(url: string): Promise<void> {
    const { sql, params } = removeFavoriteBoardStatement(url)
    await this.db.execute(sql, params)
  }

  // ── 画像のアップロード履歴 ──

  async addUpload(u: Omit<UploadRecord, 'uploadedAt'>, now = Date.now()): Promise<void> {
    const { sql, params } = addUploadStatement(u, now)
    await this.db.execute(sql, params)
  }

  /** 同じ中身(hash)の画像を前に上げていれば、その URL(いちばん新しいもの) */
  async findUploadByHash(hash: string): Promise<string | undefined> {
    const [row] = await this.db.select<{ url: string }>('SELECT url FROM uploads WHERE hash = $1 ORDER BY uploaded_at DESC LIMIT 1', [hash])
    return row?.url
  }

  async listUploads(limit = 200): Promise<UploadRecord[]> {
    const rows = await this.db.select<{ url: string; name: string; size: number; uploaded_at: number; with_account: number; delete_url: string | null }>(
      'SELECT url, name, size, uploaded_at, with_account, delete_url FROM uploads ORDER BY uploaded_at DESC LIMIT $1',
      [limit],
    )
    return rows.map((r) => ({ url: r.url, name: r.name, size: r.size, uploadedAt: r.uploaded_at, withAccount: r.with_account === 1, deleteUrl: r.delete_url ?? undefined }))
  }

  /** 履歴から消す(サーバー上のファイルを消すのは呼ぶ側) */
  async removeUpload(url: string): Promise<void> {
    const { sql, params } = removeUploadStatement(url)
    await this.db.execute(sql, params)
  }

  // ── ファビコンのキャッシュ ──

  async getFavicon(key: string): Promise<{ data: string; fetchedAt: number } | null> {
    const [row] = await this.db.select<{ data: string; fetched_at: number }>('SELECT data, fetched_at FROM favicons WHERE key = $1', [key])
    return row ? { data: row.data, fetchedAt: row.fetched_at } : null
  }

  async setFavicon(key: string, data: string, now = Date.now()): Promise<void> {
    await this.db.execute('INSERT OR REPLACE INTO favicons (key, data, fetched_at) VALUES ($1, $2, $3)', [key, data, now])
  }

  // ── リンクのプレビュー(OGP) ──

  /** 覚えておいたプレビュー。data が null のものは「何も取れなかった」ページ */
  async getOgp(url: string): Promise<{ data: string | null; fetchedAt: number } | null> {
    const [row] = await this.db.select<{ data: string | null; fetched_at: number }>(
      'SELECT data, fetched_at FROM ogp_cache WHERE url = $1',
      [url],
    )
    return row ? { data: row.data, fetchedAt: row.fetched_at } : null
  }

  async setOgp(url: string, data: string | null, now = Date.now()): Promise<void> {
    await this.db.execute('INSERT OR REPLACE INTO ogp_cache (url, data, fetched_at) VALUES ($1, $2, $3)', [url, data, now])
  }

  /** 古いプレビューを捨てる(増え続けないように) */
  async pruneOgp(olderThan: number): Promise<void> {
    await this.db.execute('DELETE FROM ogp_cache WHERE fetched_at < $1', [olderThan])
  }

  // ── 設定 ──

  async getSettings(): Promise<Record<string, unknown>> {
    const rows = await this.db.select<{ key: string; value: string }>('SELECT key, value FROM settings')
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]))
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    const { sql, params } = setSettingStatement(key, value)
    await this.db.execute(sql, params)
  }

  // ── スレ ──

  /** スレ一覧に未読数を出すため、板の中で開いたことのあるスレの状態をまとめて返す */
  async getThreadStates(boardUrl: string): Promise<Map<string, ThreadState>> {
    const urls = boardUrlVariants(boardUrl)
    const rows = await this.db.select<ThreadRow>(
      `SELECT key, post_count, read_no, status FROM threads WHERE board_url IN (${urls.map((_, i) => `$${i + 1}`).join(', ')})`,
      urls,
    )
    const out = new Map<string, ThreadState>()
    for (const r of rows) {
      // 同じスレの行が別の書き方の URL で残っているときは、読んだ方を使う
      const had = out.get(r.key)
      if (!had || r.read_no > had.readNo) out.set(r.key, { postCount: r.post_count, readNo: r.read_no, status: r.status })
    }
    return out
  }

  async loadThread(thread: ThreadSummary): Promise<ThreadLog | null> {
    const [row] = await this.db.select<ThreadRow>('SELECT * FROM threads WHERE board_url = $1 AND key = $2', [
      thread.boardUrl,
      thread.key,
    ])
    if (!row) return null
    const posts = await this.db.select<PostRow>(
      'SELECT no, ref, name, mail, date, id, body, badges FROM posts WHERE board_url = $1 AND key = $2 ORDER BY no',
      [thread.boardUrl, thread.key],
    )
    return {
      title: row.title,
      postCount: row.post_count,
      readNo: row.read_no,
      status: row.status,
      cursor: row.cursor === null ? null : (JSON.parse(row.cursor) as Cursor),
      posts: posts.map(({ ref, badges, ...p }) => ({
        ...p,
        id: p.id ?? undefined,
        ...(ref !== null && { ref }),
        ...(badges !== null && { badges: JSON.parse(badges) as Badge[] }),
      })),
    }
  }

  /**
   * 取得結果を保存する。書き込む順番で一貫性を守る。
   * - reset: 先に cursor を NULL にしてからレスを消す(途中で落ちても、次は全件取得になる)
   * - updated: レスを書いてから cursor を進める(途中で落ちても、同じレスを取り直して上書きするだけ)
   */
  async saveFetch(thread: ThreadSummary, result: FetchPostsResult, now = Date.now()): Promise<void> {
    const where = [thread.boardUrl, thread.key]
    await this.db.execute(
      `INSERT OR IGNORE INTO threads (board_url, key, connector_id, title, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [...where, thread.connectorId, result.title ?? thread.title, nn(thread.createdAt?.getTime())],
    )

    if (result.status === 'notModified') {
      // 過去ログから取ったスレは、変わらなくても dat 落ちの印を付け直す(前に取ったときに付け損ねていても直るように)。
      // そのときは続きの印も書く(したらばは新着のないまま過去ログ倉庫に入ったことを印で返す)。レスを取ってあるスレだけ
      // (applyFetch と同じ決まり。前の印があるかで決めると、レスのないまま印だけ残ったスレに過去ログの印が付き、もう取りに行かなくなる)。
      // ふつうの変化なしの印は書かない(レスのない印を持つと、次から差分だけを取りに行く)
      const cursor = result.archived && result.cursor ? JSON.stringify(result.cursor) : null
      await this.db.execute(
        `UPDATE threads SET fetched_at = $1, status = CASE WHEN $2 = 1 THEN 'archived' ELSE status END,
           cursor = CASE WHEN $3 IS NOT NULL AND EXISTS (SELECT 1 FROM posts WHERE board_url = $4 AND key = $5) THEN $3 ELSE cursor END
         WHERE board_url = $4 AND key = $5`,
        [now, result.archived ? 1 : 0, cursor, ...where],
      )
      return
    }
    if (result.status === 'archived') {
      await this.db.execute(
        `UPDATE threads SET status = 'archived', fetched_at = $1 WHERE board_url = $2 AND key = $3`,
        [now, ...where],
      )
      return
    }

    if (result.status === 'reset') {
      await this.db.execute('UPDATE threads SET cursor = NULL WHERE board_url = $1 AND key = $2', where)
      await this.db.execute('DELETE FROM posts WHERE board_url = $1 AND key = $2', where)
    }

    for (let i = 0; i < result.posts.length; i += CHUNK) {
      const chunk = result.posts.slice(i, i + CHUNK)
      await this.db.execute(
        `INSERT OR REPLACE INTO posts (board_url, key, no, ref, name, mail, date, id, body, badges) VALUES ${valuesClause(chunk.length, 10)}`,
        chunk.flatMap((p) => [...where, p.no, nn(p.ref), p.name, p.mail, p.date, nn(p.id), p.body, p.badges?.length ? JSON.stringify(p.badges) : null]),
      )
    }

    await this.db.execute(
      `UPDATE threads SET
         cursor = $1,
         title = COALESCE($2, title),
         post_count = (SELECT COUNT(*) FROM posts WHERE board_url = $3 AND key = $4),
         status = $8,
         fetched_at = $5
       WHERE board_url = $6 AND key = $7`,
      [JSON.stringify(result.cursor), nn(result.title), ...where, now, ...where, result.archived ? 'archived' : 'active'],
    )
  }

  /**
   * スレのログ(レス・既読位置)を消す。自分のレスの印は残す(書き込み履歴が残るため。同期を使うときの
   * deleteThreadStatements とスマホ版のログの削除と同じ)
   */
  async deleteThread(thread: ThreadSummary): Promise<void> {
    const where = [thread.boardUrl, thread.key]
    // 先に threads を消す。途中で落ちても「ログのないスレ」になるだけで、次に開けば取り直す
    await this.db.execute('DELETE FROM threads WHERE board_url = $1 AND key = $2', where)
    await this.db.execute('DELETE FROM posts WHERE board_url = $1 AND key = $2', where)
  }

  /**
   * しばらく開いていないスレのログを消す(最後に読んだ時刻、なければ取った時刻が before より前のもの)。
   * お気に入りのスレ・自分が書き込んだスレと、keep のスレ(開いているタブ)は残す。消したスレの数を返す
   */
  async pruneLogs(before: number, keep: { boardUrl: string; key: string }[] = []): Promise<number> {
    const rows = await this.db.select<{ board_url: string; key: string; connector_id: string }>(
      `SELECT t.board_url, t.key, t.connector_id FROM threads t
       WHERE COALESCE(t.read_at, t.fetched_at, 0) < $1
         AND NOT EXISTS (SELECT 1 FROM favorite_threads f WHERE f.key = t.key AND f.board_url IN (${boardUrlVariantsSql('t.board_url')}))
         AND NOT EXISTS (SELECT 1 FROM own_posts o WHERE o.key = t.key AND o.board_url IN (${boardUrlVariantsSql('t.board_url')}))`,
      [before],
    )
    const kept = new Set(keep.map((k) => `${k.boardUrl}\t${k.key}`))
    const targets = rows.filter((r) => !kept.has(`${r.board_url}\t${r.key}`))
    for (const r of targets)
      await this.deleteThread({ connectorId: r.connector_id, boardUrl: r.board_url, key: r.key, title: '', postCount: 0, order: 0 })
    return targets.length
  }

  async markRead(thread: ThreadSummary, no: number, now = Date.now()): Promise<void> {
    const { sql, params } = markReadStatement(thread, no, now)
    await this.db.execute(sql, params)
  }

  async history(limit = 100): Promise<HistoryEntry[]> {
    const rows = await this.db.select<ThreadRow>(
      'SELECT * FROM threads WHERE read_at IS NOT NULL ORDER BY read_at DESC LIMIT $1',
      [limit],
    )
    return rows.map((r) => ({
      thread: threadOfRow(r, r.title, r.post_count),
      postCount: r.post_count,
      readNo: r.read_no,
      status: r.status,
      readAt: r.read_at!,
    }))
  }

  /** 自動 NG の判断軸のためのログ。最近取ったスレのレスから limit 件(スレの名前は「板の URL タブ キー」) */
  async corpusPosts(limit: number): Promise<{ thread: string; body: string }[]> {
    const rows = await this.db.select<{ board_url: string; key: string; body: string }>(
      // スレを先に新しい順に並べ、そのレスを limit 件読んだら止める(全レスの本文を読まない)。
      // 中の LIMIT -1 は、副問い合わせを外へ展開させないため(展開されると全レスを並べ替える)
      `SELECT p.board_url, p.key, p.body
       FROM (SELECT board_url, key FROM threads ORDER BY fetched_at DESC LIMIT -1) t
       CROSS JOIN posts p ON p.board_url = t.board_url AND p.key = t.key
       LIMIT $1`,
      [limit],
    )
    return rows.map((r) => ({ thread: `${r.board_url}\t${r.key}`, body: r.body }))
  }

  // ── 自分の書き込み ──

  async addOwnPost(thread: ThreadSummary, no: number, now = Date.now()): Promise<void> {
    const { sql, params } = addOwnPostStatement(thread, no, now)
    await this.db.execute(sql, params)
  }

  /** 自分の書き込みの印を外す(手で付けた印・書き込みで付いた印のどちらも) */
  async removeOwnPost(thread: ThreadSummary, no: number): Promise<void> {
    const { sql, params } = removeOwnPostStatement(thread, no)
    await this.db.execute(sql, params)
  }

  /** 同期で届いた印は板の URL の書き方(5ch.io / 5ch.net、http / https)が違うことがあるので、書き方によらず引く */
  async getOwnPosts(thread: ThreadSummary): Promise<number[]> {
    const urls = boardUrlVariants(thread.boardUrl)
    const rows = await this.db.select<{ no: number }>(
      `SELECT DISTINCT no FROM own_posts WHERE board_url IN (${urls.map((_, i) => `$${i + 1}`).join(', ')}) AND key = $${urls.length + 1} ORDER BY no`,
      [...urls, thread.key],
    )
    return rows.map((r) => r.no)
  }

  // ── お気に入りのスレ ──

  /** 並べた順(足した順。あとで並べ替えられるよう sort で持つ) */
  async listFavoriteThreads(): Promise<FavoriteThreadEntry[]> {
    const rows = await this.db.select<{
      board_url: string
      key: string
      connector_id: string
      title: string
      created_at: number | null
      post_count: number | null
      read_no: number | null
      status: 'active' | 'archived' | null
      log_title: string | null
    }>(
      // ログの行は、同じ書き方の URL の行を先に、なければ書き方の違う行のうち読んだ所の大きいもの。
      // SQLite は副問い合わせの ORDER BY で外の表の列を使えない(no such column)ので、2 つの副問い合わせを COALESCE でつなぐ
      `SELECT ff.board_url, ff.key, ff.connector_id, ff.title, ff.created_at,
              t.post_count, t.read_no, t.status, t.title AS log_title
       FROM (
         SELECT f.board_url, f.key, f.connector_id, f.title, f.created_at, f.sort,
           COALESCE(
             (SELECT t2.rowid FROM threads AS t2 WHERE t2.key = f.key AND t2.board_url = f.board_url LIMIT 1),
             (SELECT t2.rowid FROM threads AS t2 WHERE t2.key = f.key AND t2.board_url IN (${boardUrlVariantsSql('f.board_url')}) ORDER BY t2.read_no DESC LIMIT 1)
           ) AS log_rowid
         FROM favorite_threads AS f
       ) AS ff
       LEFT JOIN threads AS t ON t.rowid = ff.log_rowid
       ORDER BY ff.sort`,
    )
    return rows.map((r) => ({
      // ログのスレタイがあればそちら(URL から開いて足したスレは、足したときのスレタイが空のことがある)
      thread: threadOfRow(r, r.log_title || r.title, r.post_count ?? 0),
      postCount: r.post_count ?? 0,
      readNo: r.read_no ?? 0,
      status: r.status ?? 'active',
    }))
  }

  async addFavoriteThread(thread: ThreadSummary, now = Date.now()): Promise<void> {
    const { sql, params } = addFavoriteThreadStatement(thread, now)
    await this.db.execute(sql, params)
  }

  async removeFavoriteThread(thread: ThreadSummary): Promise<void> {
    const { sql, params } = removeFavoriteThreadStatement(thread)
    await this.db.execute(sql, params)
  }

  // ── 書き込みの下書き ──

  async getDraft(thread: ThreadSummary): Promise<string | undefined> {
    const [row] = await this.db.select<{ body: string }>('SELECT body FROM drafts WHERE board_url = $1 AND key = $2', [
      thread.boardUrl,
      thread.key,
    ])
    return row?.body
  }

  /** 空なら消す(書き込めたときや、本文を全部消したとき) */
  async setDraft(thread: ThreadSummary, body: string, now = Date.now()): Promise<void> {
    if (body.trim() === '') {
      await this.db.execute('DELETE FROM drafts WHERE board_url = $1 AND key = $2', [thread.boardUrl, thread.key])
      return
    }
    await this.db.execute('INSERT OR REPLACE INTO drafts (board_url, key, body, updated_at) VALUES ($1, $2, $3, $4)', [
      thread.boardUrl,
      thread.key,
      body,
      now,
    ])
  }

  // ── 自動 NG の印(荒らし・荒らしじゃない) ──

  async listTrollMarks(): Promise<TrollMarkRecord[]> {
    const rows = await this.db.select<{ body_key: string; label: number; body: string; board_url: string; reason: string | null; created_at: number }>(
      'SELECT body_key, label, body, board_url, reason, created_at FROM troll_marks ORDER BY created_at',
    )
    return rows.map((r) => ({
      bodyKey: r.body_key,
      troll: r.label === 1,
      body: r.body,
      boardUrl: r.board_url,
      reason: r.reason ?? undefined,
      createdAt: r.created_at,
    }))
  }

  /** 印を付ける(同じ本文に付け直したら置き換える) */
  async setTrollMark(mark: TrollMarkRecord): Promise<void> {
    await this.db.execute(
      'INSERT OR REPLACE INTO troll_marks (body_key, label, body, board_url, reason, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [mark.bodyKey, mark.troll ? 1 : 0, mark.body, mark.boardUrl, mark.reason ?? null, mark.createdAt],
    )
  }

  async removeTrollMark(bodyKey: string): Promise<void> {
    await this.db.execute('DELETE FROM troll_marks WHERE body_key = $1', [bodyKey])
  }

  // ── アカウント ──

  async listAccounts(): Promise<AccountRecord[]> {
    const rows = await this.db.select<{
      connector_id: string
      account_id: string
      user: string
      password: string
      auto_login: number
    }>('SELECT connector_id, account_id, user, password, auto_login FROM accounts ORDER BY connector_id, account_id')
    return rows.map((r) => ({
      connectorId: r.connector_id,
      accountId: r.account_id,
      user: r.user,
      password: r.password,
      autoLogin: r.auto_login !== 0,
    }))
  }

  async setAccount(a: AccountRecord, now = Date.now()): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO accounts (connector_id, account_id, user, password, auto_login, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [a.connectorId, a.accountId, a.user, a.password, a.autoLogin ? 1 : 0, now],
    )
  }

  async deleteAccount(connectorId: string, accountId: string): Promise<void> {
    await this.db.execute('DELETE FROM accounts WHERE connector_id = $1 AND account_id = $2', [connectorId, accountId])
  }

  // ── 書き込み履歴 ──

  async addPostHistory(
    thread: ThreadSummary,
    post: { no?: number; name: string; mail: string; body: string },
    now = Date.now(),
  ): Promise<void> {
    const { sql, params } = addPostHistoryStatement(thread, post, now)
    await this.db.execute(sql, params)
  }

  /** 新しい順 */
  async listPostHistory(limit = 1000): Promise<PostHistoryEntry[]> {
    const rows = await this.db.select<{
      id: number
      connector_id: string
      board_url: string
      key: string
      thread_title: string
      no: number | null
      name: string
      mail: string
      body: string
      posted_at: number
    }>('SELECT * FROM post_history ORDER BY posted_at DESC, id DESC LIMIT $1', [limit])
    return rows.map((r) => ({
      id: r.id,
      thread: { connectorId: r.connector_id, boardUrl: r.board_url, key: r.key, title: r.thread_title, postCount: 0, order: 0 },
      no: r.no ?? undefined,
      name: r.name,
      mail: r.mail,
      body: r.body,
      postedAt: r.posted_at,
    }))
  }

  async deletePostHistory(id: number): Promise<void> {
    const { sql, params } = deletePostHistoryStatement(id)
    await this.db.execute(sql, params)
  }
}

export * from './userOps'
export * from './ngRules'
