// 利用者の操作の入口。データの更新と送信待ちを同じトランザクションで書く。プリセットや同期の適用はここを通らない
import type { ThreadSummary } from '@bbs-browser/connectors'
import { addFavoriteThreadStatement, removeFavoriteThreadStatement, type LogStore, type SqlDb, type SqlStatement } from './index'

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
}
