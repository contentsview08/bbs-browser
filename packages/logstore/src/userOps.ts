// 利用者の操作の入口。データの更新と送信待ちを同じトランザクションで書く。プリセットや同期の適用はここを通らない
import type { Board, SiteConfig, ThreadSummary } from '@bbs-browser/connectors'
import {
  addFavoriteBoardStatement,
  addOwnPostStatement,
  addPostHistoryStatement,
  deletePostHistoryStatement,
  deleteThreadStatements,
  markReadStatement,
  removeHistoryStatement,
  addFavoriteThreadStatement,
  addSiteStatement,
  addUploadStatement,
  removeFavoriteBoardStatement,
  removeFavoriteThreadStatement,
  removeOwnPostStatement,
  removeSiteStatements,
  removeUploadStatement,
  reorderFavoriteStatements,
  setSettingStatement,
  type LogStore,
  type PostHistoryEntry,
  type SqlDb,
  type SqlStatement,
  type UploadRecord,
} from './index'
import { applyNgDiff, isEmptyNgDiff, ngRuleFromBody, ngRuleToBody, type NgDiff, type NgRuleData } from './ngRules'

/** 1 回の削除で書くリセットの数。packages/sync の RESET_BATCH_MAX と同じ値 */
export const LOG_RESET_MAX = 2000
const LOG_DELETE_CHUNK = 200

/** 操作の種類。packages/sync の SYNC_GROUPS と同じ名前。logstore は同期の核に依存しない */
export type SyncOpGroup = 'history' | 'favorites' | 'sites' | 'posts' | 'images' | 'ng' | 'settings' | 'secret'

/**
 * この種類の変更を積むか。同期自体か種類のスイッチを切っている間は積まない。権限系は明示でオンにしたときだけ。
 * 使っていないときは sync_state が空。読めないときも使っていない扱いにして、利用者の操作を止めない
 */
export async function isSyncGroupOn(db: SqlDb, group: SyncOpGroup): Promise<boolean> {
  try {
    const rows = await db.select<{ key: string; value: string }>("SELECT key, value FROM sync_state WHERE key IN ('enabled', 'master', 'kinds')")
    const state = new Map(rows.map((r) => [r.key, r.value]))
    if (state.get('enabled') !== '1' || state.get('master') === '0') return false
    const kinds = state.has('kinds') ? (JSON.parse(state.get('kinds') as string) as Record<string, unknown>) : {}
    return kinds[group] === undefined ? group !== 'secret' : kinds[group] === true
  } catch {
    return false
  }
}

/** sync_ops には手元の識別だけを書く。スレタイなどはエンジンが処理するときに今のデータから読む */
function opStatement(op: string, thread: ThreadSummary, now: number): SqlStatement {
  return {
    sql: 'INSERT INTO sync_ops (op, target, num, args, at_ms) VALUES ($1, $2, NULL, $3, $4)',
    params: [op, `${thread.boardUrl}\t${thread.key}`, JSON.stringify({ board_url: thread.boardUrl, key: thread.key }), now],
  }
}

function plainOp(op: string, target: string, args: Record<string, unknown>, now: number): SqlStatement {
  return { sql: 'INSERT INTO sync_ops (op, target, num, args, at_ms) VALUES ($1, $2, NULL, $3, $4)', params: [op, target, JSON.stringify(args), now] }
}

export async function readNgRules<T extends NgRuleData = NgRuleData>(db: SqlDb): Promise<T[]> {
  const [row] = await db.select<{ value: string }>("SELECT value FROM settings WHERE key = 'ngRules'")
  if (!row) return []
  try {
    const v = JSON.parse(row.value) as unknown
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}

/** 同期の適用が NG を読み書きする口。PC の置き場は settings 表。読み直して重ねるので、適用が古い配列を書かない */
export function settingsNgStore(db: SqlDb) {
  return {
    read: async () => (await readNgRules(db)).map(ngRuleToBody),
    async apply(changes: ReadonlyMap<string, Record<string, unknown> | null>): Promise<NgRuleData[]> {
      const upsert = [...changes.values()].flatMap((b) => (b ? [ngRuleFromBody(b)] : []))
      const remove = [...changes].flatMap(([id, b]) => (b ? [] : [id]))
      const next = applyNgDiff(await readNgRules(db), { upsert, remove, drop: [] })
      const { sql, params } = setSettingStatement('ngRules', next)
      await db.execute(sql, params)
      return next
    },
  }
}

export class UserOps {
  constructor(
    private store: LogStore,
    private db: SqlDb = store.db,
    private isOn: (group: SyncOpGroup) => Promise<boolean> = (group) => isSyncGroupOn(db, group),
  ) {}

  /**
   * 送信待ちを含む書き込み。積んだら同期へ知らせ、選んだ間隔を待たずに早めに送らせる。
   * 読んだ位置(markRead)と開いた時刻(threadView)は読むたびに積むので知らせず、周期・窓の行き来・裏へ回る時に送る
   */
  private async put(statements: SqlStatement[]): Promise<void> {
    await this.db.batch(statements)
    if (statements.some((s) => s.sql.includes('sync_ops'))) this.store.notifySyncOps()
  }

  async favoriteThreadAdd(thread: ThreadSummary, now = Date.now()): Promise<void> {
    if (await this.isOn('favorites')) await this.put([addFavoriteThreadStatement(thread, now), opStatement('favorite_thread_add', thread, now)])
    else await this.store.addFavoriteThread(thread, now)
  }

  async favoriteThreadRemove(thread: ThreadSummary, now = Date.now()): Promise<void> {
    if (await this.isOn('favorites')) await this.put([removeFavoriteThreadStatement(thread), opStatement('favorite_thread_remove', thread, now)])
    else await this.store.removeFavoriteThread(thread)
  }

  async favoriteBoardAdd(board: Board, now = Date.now()): Promise<void> {
    if (await this.isOn('favorites')) await this.put([addFavoriteBoardStatement(board), plainOp('favorite_board_add', board.url, { url: board.url }, now)])
    else await this.store.addFavorite(board)
  }

  async favoriteBoardRemove(url: string, now = Date.now()): Promise<void> {
    if (await this.isOn('favorites')) await this.put([removeFavoriteBoardStatement(url), plainOp('favorite_board_remove', url, { url }, now)])
    else await this.store.removeFavorite(url)
  }

  async favoriteBoardReorder(urls: string[], now = Date.now()): Promise<void> {
    if (await this.isOn('favorites')) await this.put([...reorderFavoriteStatements(urls), plainOp('favorite_board_order', 'order', { urls }, now)])
    else await this.store.reorderFavorites(urls)
  }

  async siteAdd(site: SiteConfig, now = Date.now()): Promise<void> {
    if (await this.isOn('sites')) await this.put([addSiteStatement(site), plainOp('site_add', site.menuUrl, { menu_url: site.menuUrl }, now)])
    else await this.store.addSite(site)
  }

  async siteRemove(menuUrl: string, now = Date.now()): Promise<void> {
    if (await this.isOn('sites')) await this.put([...removeSiteStatements(menuUrl), plainOp('site_remove', menuUrl, { menu_url: menuUrl }, now)])
    else await this.store.removeSite(menuUrl)
  }

  /** 削除ページの URL は操作に書かない。エンジンが処理するときに今のデータから読む */
  async uploadAdd(u: Omit<UploadRecord, 'uploadedAt'>, now = Date.now()): Promise<void> {
    const ops = [
      ...((await this.isOn('images')) ? [plainOp('upload_add', u.url, { url: u.url }, now)] : []),
      ...(u.deleteUrl && (await this.isOn('secret')) ? [plainOp('secret_put', u.url, { url: u.url }, now)] : []),
    ]
    if (ops.length > 0) await this.put([addUploadStatement(u, now), ...ops])
    else await this.store.addUpload(u, now)
  }

  async uploadRemove(url: string, now = Date.now()): Promise<void> {
    const ops = [
      ...((await this.isOn('images')) ? [plainOp('upload_remove', url, { url }, now)] : []),
      ...((await this.isOn('secret')) ? [plainOp('secret_remove', url, { url }, now)] : []),
    ]
    if (ops.length > 0) await this.put([removeUploadStatement(url), ...ops])
    else await this.store.removeUpload(url)
  }

  /** 設定の保存と、許可リストの項目の送信待ちを同じトランザクションで書く */
  async settingsWrite(writes: { key: string; value: unknown; ops: { name: string; value: unknown }[] }[], now = Date.now()): Promise<void> {
    const changes = writes.map((w) => setSettingStatement(w.key, w.value))
    const on = writes.some((w) => w.ops.length > 0) && (await this.isOn('settings'))
    await this.put([...changes, ...(on ? writes.flatMap((w) => w.ops.map((o) => plainOp('setting', o.name, { name: o.name, value: o.value }, now))) : [])])
  }

  /** スクロールで何度も呼ばれるので、同じスレの読みは sync_ops の 1 行にまとめる。古い SQLite で通るよう UPDATE と INSERT OR IGNORE の 2 文にする */
  async markRead(thread: ThreadSummary, no: number, now = Date.now()): Promise<void> {
    if (!(await this.isOn('history'))) return this.store.markRead(thread, no, now)
    const target = `${thread.boardUrl}\t${thread.key}`
    await this.db.batch([
      markReadStatement(thread, no, now),
      { sql: "UPDATE sync_ops SET num = MAX(num, $1), at_ms = $2 WHERE op = 'read' AND target = $3", params: [no, now, target] },
      { sql: "INSERT OR IGNORE INTO sync_ops (op, target, num, args, at_ms) VALUES ('read', $1, $2, $3, $4)", params: [target, no, JSON.stringify({ board_url: thread.boardUrl, key: thread.key }), now] },
    ])
  }

  /** スレを開いたときの最終閲覧時刻。PC は読んだときだけ進むので、スマホの touch と共通テストが使う */
  async threadView(thread: ThreadSummary, now = Date.now()): Promise<void> {
    const change = { sql: 'UPDATE threads SET read_at = $1 WHERE board_url = $2 AND key = $3', params: [now, thread.boardUrl, thread.key] }
    if (await this.isOn('history')) await this.db.batch([change, opStatement('view', thread, now)])
    else await this.db.execute(change.sql, change.params)
  }

  /** 履歴から外す。ログと既読は残す。全端末の履歴から外れる */
  async historyRemove(thread: ThreadSummary, now = Date.now()): Promise<void> {
    const change = removeHistoryStatement(thread)
    if (await this.isOn('history')) await this.put([change, opStatement('view_remove', thread, now)])
    else await this.db.execute(change.sql, change.params)
  }

  /** ログの削除は全端末で未読に戻す操作を兼ねる。自動整理は store.pruneLogs を使い、ここを通らない */
  async deleteLogs(threads: ThreadSummary[], now = Date.now()): Promise<void> {
    if (!(await this.isOn('history'))) {
      for (const t of threads) await this.store.deleteThread(t)
      return
    }
    for (let i = 0; i < threads.length; i += LOG_DELETE_CHUNK) {
      const chunk = threads.slice(i, i + LOG_DELETE_CHUNK)
      await this.put(chunk.flatMap((t, j) => [...deleteThreadStatements(t), ...(i + j < LOG_RESET_MAX ? [opStatement('log_delete', t, now)] : [])]))
    }
  }

  async postAdd(thread: ThreadSummary, post: { no?: number; name: string; mail: string; body: string }, now = Date.now()): Promise<void> {
    if (!(await this.isOn('posts'))) return this.store.addPostHistory(thread, post, now)
    await this.put([addPostHistoryStatement(thread, post, now), plainOp('post_add', `${thread.boardUrl}\t${thread.key}\t${now}`, { board_url: thread.boardUrl, key: thread.key, posted_at: now, body: post.body }, now)])
  }

  /** 消した後は行がないので、ID を作るのに要る値を操作に書く */
  async postRemove(e: PostHistoryEntry, now = Date.now()): Promise<void> {
    if (!(await this.isOn('posts'))) return this.store.deletePostHistory(e.id)
    await this.put([deletePostHistoryStatement(e.id), plainOp('post_remove', `${e.thread.boardUrl}\t${e.thread.key}\t${e.postedAt}`, { board_url: e.thread.boardUrl, key: e.thread.key, posted_at: e.postedAt, body: e.body }, now)])
  }

  /** 自分のレスの印。書き込みで付いた印も手で付けた印も同じ経路。外すと全端末から外れる */
  async ownAdd(thread: ThreadSummary, no: number, now = Date.now()): Promise<void> {
    if (!(await this.isOn('posts'))) return this.store.addOwnPost(thread, no, now)
    await this.put([addOwnPostStatement(thread, no, now), plainOp('own_add', `${thread.boardUrl}\t${thread.key}\t${no}`, { board_url: thread.boardUrl, key: thread.key, no }, now)])
  }

  async ownRemove(thread: ThreadSummary, no: number, now = Date.now()): Promise<void> {
    if (!(await this.isOn('posts'))) return this.store.removeOwnPost(thread, no)
    await this.put([removeOwnPostStatement(thread, no), plainOp('own_remove', `${thread.boardUrl}\t${thread.key}\t${no}`, { board_url: thread.boardUrl, key: thread.key, no }, now)])
  }

  /** 差分を今の DB の値に重ねて書く。積むのは upsert と remove だけで、drop は tombstone にならない。書いた結果を返す */
  async ngChange<T extends NgRuleData>(diff: NgDiff<T>, now = Date.now()): Promise<T[]> {
    const next = applyNgDiff(await readNgRules<T>(this.db), diff)
    if (isEmptyNgDiff(diff)) return next
    const write = setSettingStatement('ngRules', next)
    if (await this.isOn('ng')) {
      await this.put([
        write,
        ...diff.upsert.map((r) => plainOp('ng_diff', r.id, { id: r.id, rule: ngRuleToBody(r) }, now)),
        ...diff.remove.map((id) => plainOp('ng_diff', id, { id, rule: null }, now)),
      ])
    } else await this.db.execute(write.sql, write.params)
    return next
  }
}
