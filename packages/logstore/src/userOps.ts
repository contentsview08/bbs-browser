// 利用者の操作の入口。データの更新と送信待ちを同じトランザクションで書く。プリセットや同期の適用はここを通らない
import type { Board, SiteConfig, ThreadSummary } from '@bbs-browser/connectors'
import {
  addFavoriteBoardStatement,
  addFavoriteThreadStatement,
  addSiteStatement,
  addUploadStatement,
  removeFavoriteBoardStatement,
  removeFavoriteThreadStatement,
  removeSiteStatements,
  removeUploadStatement,
  reorderFavoriteStatements,
  setSettingStatement,
  type LogStore,
  type SqlDb,
  type SqlStatement,
  type UploadRecord,
} from './index'
import { applyNgDiff, isEmptyNgDiff, ngRuleFromBody, ngRuleToBody, type NgDiff, type NgRuleData } from './ngRules'

/** 使っていないときは sync_state が空。読めないときも使っていない扱いにして、利用者の操作を止めない */
export async function isSyncEnabled(db: SqlDb): Promise<boolean> {
  try {
    const [row] = await db.select<{ value: string }>("SELECT value FROM sync_state WHERE key = 'enabled'")
    return row?.value === '1'
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
    private isOn: () => Promise<boolean> = () => isSyncEnabled(db),
  ) {}

  async favoriteThreadAdd(thread: ThreadSummary, now = Date.now()): Promise<void> {
    if (await this.isOn()) await this.db.batch([addFavoriteThreadStatement(thread, now), opStatement('favorite_thread_add', thread, now)])
    else await this.store.addFavoriteThread(thread, now)
  }

  async favoriteThreadRemove(thread: ThreadSummary, now = Date.now()): Promise<void> {
    if (await this.isOn()) await this.db.batch([removeFavoriteThreadStatement(thread), opStatement('favorite_thread_remove', thread, now)])
    else await this.store.removeFavoriteThread(thread)
  }

  async favoriteBoardAdd(board: Board, now = Date.now()): Promise<void> {
    if (await this.isOn()) await this.db.batch([addFavoriteBoardStatement(board), plainOp('favorite_board_add', board.url, { url: board.url }, now)])
    else await this.store.addFavorite(board)
  }

  async favoriteBoardRemove(url: string, now = Date.now()): Promise<void> {
    if (await this.isOn()) await this.db.batch([removeFavoriteBoardStatement(url), plainOp('favorite_board_remove', url, { url }, now)])
    else await this.store.removeFavorite(url)
  }

  async favoriteBoardReorder(urls: string[], now = Date.now()): Promise<void> {
    if (await this.isOn()) await this.db.batch([...reorderFavoriteStatements(urls), plainOp('favorite_board_order', 'order', { urls }, now)])
    else await this.store.reorderFavorites(urls)
  }

  async siteAdd(site: SiteConfig, now = Date.now()): Promise<void> {
    if (await this.isOn()) await this.db.batch([addSiteStatement(site), plainOp('site_add', site.menuUrl, { menu_url: site.menuUrl }, now)])
    else await this.store.addSite(site)
  }

  async siteRemove(menuUrl: string, now = Date.now()): Promise<void> {
    if (await this.isOn()) await this.db.batch([...removeSiteStatements(menuUrl), plainOp('site_remove', menuUrl, { menu_url: menuUrl }, now)])
    else await this.store.removeSite(menuUrl)
  }

  async uploadAdd(u: Omit<UploadRecord, 'uploadedAt'>, now = Date.now()): Promise<void> {
    if (await this.isOn()) await this.db.batch([addUploadStatement(u, now), plainOp('upload_add', u.url, { url: u.url }, now)])
    else await this.store.addUpload(u, now)
  }

  async uploadRemove(url: string, now = Date.now()): Promise<void> {
    if (await this.isOn()) await this.db.batch([removeUploadStatement(url), plainOp('upload_remove', url, { url }, now)])
    else await this.store.removeUpload(url)
  }

  /** 差分を今の DB の値に重ねて書く。積むのは upsert と remove だけで、drop は tombstone にならない。書いた結果を返す */
  async ngChange<T extends NgRuleData>(diff: NgDiff<T>, now = Date.now()): Promise<T[]> {
    const next = applyNgDiff(await readNgRules<T>(this.db), diff)
    if (isEmptyNgDiff(diff)) return next
    const write = setSettingStatement('ngRules', next)
    if (await this.isOn()) {
      await this.db.batch([
        write,
        ...diff.upsert.map((r) => plainOp('ng_diff', r.id, { id: r.id, rule: ngRuleToBody(r) }, now)),
        ...diff.remove.map((id) => plainOp('ng_diff', id, { id, rule: null }, now)),
      ])
    } else await this.db.execute(write.sql, write.params)
    return next
  }
}
