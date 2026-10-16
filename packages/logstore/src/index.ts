// スレのログ(取得済みのレス・既読位置・差分取得の Cursor)を SQLite に保存する。
// SQL の実行は SqlDb 越しに行うので、アプリでは tauri-plugin-sql、テストでは sql.js を差し込める。
//
// tauri-plugin-sql は接続プールを使うため、BEGIN/COMMIT が同じ接続で走る保証がない。
// トランザクションに頼らず、「途中で落ちても次の取得で正しい状態に戻る」順番で書き込む。

import type { Board, Cursor, FetchPostsResult, Post, SiteConfig, ThreadSummary } from '@bbs-browser/connectors'

/** プレースホルダーは $1, $2 …(tauri-plugin-sql の SQLite に合わせる) */
export interface SqlDb {
  execute(sql: string, params?: unknown[]): Promise<void>
  select<T>(sql: string, params?: unknown[]): Promise<T[]>
}

/** アップロードした画像 1 枚ぶん */
export interface UploadRecord {
  url: string
  name: string
  size: number
  uploadedAt: number
  /** catbox のアカウント(userhash)で上げたか。アカウントで上げたものだけ、サーバー上でも消せる */
  withAccount: boolean
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
  name: string
  mail: string
  date: string
  id: string | null
  body: string
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

export class LogStore {
  constructor(private db: SqlDb) {}

  // ── サイトと板 ──

  async listSites(): Promise<SiteConfig[]> {
    const rows = await this.db.select<{ menu_url: string; connector_id: string; name: string }>(
      'SELECT menu_url, connector_id, name FROM sites ORDER BY sort, name',
    )
    return rows.map((r) => ({ menuUrl: r.menu_url, connectorId: r.connector_id, name: r.name }))
  }

  async addSite(site: SiteConfig): Promise<void> {
    await this.db.execute(
      `INSERT OR IGNORE INTO sites (menu_url, connector_id, name, sort)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM sites))`,
      [site.menuUrl, site.connectorId, site.name],
    )
  }

  async removeSite(menuUrl: string): Promise<void> {
    await this.db.execute('DELETE FROM boards WHERE site_menu_url = $1', [menuUrl])
    await this.db.execute('DELETE FROM sites WHERE menu_url = $1', [menuUrl])
  }

  // ── お気に入り板 ──

  async listFavorites(): Promise<Board[]> {
    const rows = await this.db.select<{ url: string; connector_id: string; name: string }>(
      'SELECT url, connector_id, name FROM favorite_boards ORDER BY sort, name',
    )
    return rows.map((r) => ({ url: r.url, connectorId: r.connector_id, name: r.name }))
  }

  async addFavorite(board: Board): Promise<void> {
    await this.db.execute(
      `INSERT OR IGNORE INTO favorite_boards (url, connector_id, name, sort)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM favorite_boards))`,
      [board.url, board.connectorId, board.name],
    )
  }

  /** お気に入り板を、渡した URL の並びにする */
  async reorderFavorites(urls: string[]): Promise<void> {
    for (const [i, url] of urls.entries()) {
      await this.db.execute('UPDATE favorite_boards SET sort = $1 WHERE url = $2', [i, url])
    }
  }

  // ── 画像のアップロード履歴 ──

  async addUpload(u: Omit<UploadRecord, 'uploadedAt'>, now = Date.now()): Promise<void> {
    await this.db.execute(
      'INSERT OR REPLACE INTO uploads (url, name, size, uploaded_at, with_account) VALUES ($1, $2, $3, $4, $5)',
      [u.url, u.name, u.size, now, u.withAccount ? 1 : 0],
    )
  }

  async listUploads(limit = 200): Promise<UploadRecord[]> {
    const rows = await this.db.select<{ url: string; name: string; size: number; uploaded_at: number; with_account: number }>(
      'SELECT url, name, size, uploaded_at, with_account FROM uploads ORDER BY uploaded_at DESC LIMIT $1',
      [limit],
    )
    return rows.map((r) => ({ url: r.url, name: r.name, size: r.size, uploadedAt: r.uploaded_at, withAccount: r.with_account === 1 }))
  }

  /** 履歴から消す(サーバー上のファイルを消すのは呼ぶ側) */
  async removeUpload(url: string): Promise<void> {
    await this.db.execute('DELETE FROM uploads WHERE url = $1', [url])
  }

  // ── ファビコンのキャッシュ ──

  async getFavicon(key: string): Promise<{ data: string; fetchedAt: number } | null> {
    const [row] = await this.db.select<{ data: string; fetched_at: number }>('SELECT data, fetched_at FROM favicons WHERE key = $1', [key])
    return row ? { data: row.data, fetchedAt: row.fetched_at } : null
  }

  async setFavicon(key: string, data: string, now = Date.now()): Promise<void> {
    await this.db.execute('INSERT OR REPLACE INTO favicons (key, data, fetched_at) VALUES ($1, $2, $3)', [key, data, now])
  }

  async removeFavorite(url: string): Promise<void> {
    await this.db.execute('DELETE FROM favorite_boards WHERE url = $1', [url])
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

  // ── 設定 ──

  async getSettings(): Promise<Record<string, unknown>> {
    const rows = await this.db.select<{ key: string; value: string }>('SELECT key, value FROM settings')
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]))
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [key, JSON.stringify(value)])
  }

  // ── スレ ──

  /** スレ一覧に未読数を出すため、板の中で開いたことのあるスレの状態をまとめて返す */
  async getThreadStates(boardUrl: string): Promise<Map<string, ThreadState>> {
    const rows = await this.db.select<ThreadRow>(
      'SELECT key, post_count, read_no, status FROM threads WHERE board_url = $1',
      [boardUrl],
    )
    return new Map(rows.map((r) => [r.key, { postCount: r.post_count, readNo: r.read_no, status: r.status }]))
  }

  async loadThread(thread: ThreadSummary): Promise<ThreadLog | null> {
    const [row] = await this.db.select<ThreadRow>('SELECT * FROM threads WHERE board_url = $1 AND key = $2', [
      thread.boardUrl,
      thread.key,
    ])
    if (!row) return null
    const posts = await this.db.select<PostRow>(
      'SELECT no, name, mail, date, id, body FROM posts WHERE board_url = $1 AND key = $2 ORDER BY no',
      [thread.boardUrl, thread.key],
    )
    return {
      title: row.title,
      postCount: row.post_count,
      readNo: row.read_no,
      status: row.status,
      cursor: row.cursor === null ? null : (JSON.parse(row.cursor) as Cursor),
      posts: posts.map((p) => ({ ...p, id: p.id ?? undefined })),
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
      await this.db.execute('UPDATE threads SET fetched_at = $1 WHERE board_url = $2 AND key = $3', [now, ...where])
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
        `INSERT OR REPLACE INTO posts (board_url, key, no, name, mail, date, id, body) VALUES ${valuesClause(chunk.length, 8)}`,
        chunk.flatMap((p) => [...where, p.no, p.name, p.mail, p.date, nn(p.id), p.body]),
      )
    }

    await this.db.execute(
      `UPDATE threads SET
         cursor = $1,
         title = COALESCE($2, title),
         post_count = (SELECT COUNT(*) FROM posts WHERE board_url = $3 AND key = $4),
         status = 'active',
         fetched_at = $5
       WHERE board_url = $6 AND key = $7`,
      [JSON.stringify(result.cursor), nn(result.title), ...where, now, ...where],
    )
  }

  // ── 自分の書き込み ──

  async addOwnPost(thread: ThreadSummary, no: number, now = Date.now()): Promise<void> {
    await this.db.execute('INSERT OR IGNORE INTO own_posts (board_url, key, no, posted_at) VALUES ($1, $2, $3, $4)', [
      thread.boardUrl,
      thread.key,
      no,
      now,
    ])
  }

  async getOwnPosts(thread: ThreadSummary): Promise<number[]> {
    const rows = await this.db.select<{ no: number }>(
      'SELECT no FROM own_posts WHERE board_url = $1 AND key = $2 ORDER BY no',
      [thread.boardUrl, thread.key],
    )
    return rows.map((r) => r.no)
  }

  /** スレのログ(レス・既読位置・自分の書き込みの印)をまとめて消す */
  async deleteThread(thread: ThreadSummary): Promise<void> {
    const where = [thread.boardUrl, thread.key]
    // 先に threads を消す。途中で落ちても「ログのないスレ」になるだけで、次に開けば取り直す
    await this.db.execute('DELETE FROM threads WHERE board_url = $1 AND key = $2', where)
    await this.db.execute('DELETE FROM posts WHERE board_url = $1 AND key = $2', where)
    await this.db.execute('DELETE FROM own_posts WHERE board_url = $1 AND key = $2', where)
  }

  /** 既読位置は戻さない(読み返しても未読が増えないように) */
  async markRead(thread: ThreadSummary, no: number, now = Date.now()): Promise<void> {
    await this.db.execute(
      'UPDATE threads SET read_no = MAX(read_no, $1), read_at = $2 WHERE board_url = $3 AND key = $4',
      [no, now, thread.boardUrl, thread.key],
    )
  }

  async history(limit = 100): Promise<HistoryEntry[]> {
    const rows = await this.db.select<ThreadRow>(
      'SELECT * FROM threads WHERE read_at IS NOT NULL ORDER BY read_at DESC LIMIT $1',
      [limit],
    )
    return rows.map((r) => ({
      thread: {
        connectorId: r.connector_id,
        boardUrl: r.board_url,
        key: r.key,
        title: r.title,
        postCount: r.post_count,
        order: 0,
        createdAt: r.created_at === null ? undefined : new Date(r.created_at),
      },
      postCount: r.post_count,
      readNo: r.read_no,
      status: r.status,
      readAt: r.read_at!,
    }))
  }
}
