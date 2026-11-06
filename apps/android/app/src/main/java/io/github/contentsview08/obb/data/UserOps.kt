package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.sync.canonicalJson
import io.github.contentsview08.obb.sync.engine.SqlStatement
import io.github.contentsview08.obb.sync.engine.SyncSql
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// 利用者の操作の入口。データの更新と送信待ちを同じトランザクションで書く。プリセットや同期の適用はここを通らない

/** 使っていないときは sync_state が空。読めないときも使っていない扱いにして、利用者の操作を止めない */
internal fun isSyncEnabled(sql: SyncSql): Boolean = try {
    sql.query("SELECT value FROM sync_state WHERE key = 'enabled'").firstOrNull()?.get("value") == "1"
} catch (_: Exception) {
    false
}

class UserOps(private val sql: SyncSql, private val isOn: () -> Boolean = { isSyncEnabled(sql) }) {
    /** sync_ops には手元の識別だけを書く。スレタイなどはエンジンが処理するときに今のデータから読む */
    private fun opStatement(op: String, t: ThreadSummary, now: Long) = SqlStatement(
        "INSERT INTO sync_ops (op, target, num, args, at_ms) VALUES (?, ?, NULL, ?, ?)",
        listOf(op, "${t.boardUrl}\t${t.key}", canonicalJson(mapOf("board_url" to t.boardUrl, "key" to t.key)), now),
    )

    internal fun setFavoriteThreadNow(t: ThreadSummary, title: String, on: Boolean, now: Long) {
        val change = if (on) SqlStatement(FavoriteThreadSql.ADD, FavoriteThreadSql.addArgs(t, title, now)) else SqlStatement(FavoriteThreadSql.REMOVE, FavoriteThreadSql.removeArgs(t))
        if (isOn()) sql.batch(listOf(change, opStatement(if (on) "favorite_thread_add" else "favorite_thread_remove", t, now)))
        else sql.exec(change.sql, change.args)
    }

    suspend fun setFavoriteThread(t: ThreadSummary, title: String, on: Boolean, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) {
        setFavoriteThreadNow(t, title, on, now)
    }
}
