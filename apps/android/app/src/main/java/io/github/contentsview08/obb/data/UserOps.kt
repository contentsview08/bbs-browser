package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.Board
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

    private fun plainOp(op: String, target: String, args: Map<String, Any?>, now: Long) = SqlStatement(
        "INSERT INTO sync_ops (op, target, num, args, at_ms) VALUES (?, ?, NULL, ?, ?)",
        listOf(op, target, canonicalJson(args), now),
    )

    /** 更新と送信待ちを同じトランザクションで書く。使っていないときは更新だけ */
    private fun write(changes: List<SqlStatement>, op: () -> List<SqlStatement>) {
        if (isOn()) sql.batch(changes + op()) else sql.batch(changes)
    }

    internal fun setFavoriteNow(board: Board, on: Boolean, now: Long) {
        val change = if (on) SqlStatement(FavoriteBoardSql.ADD, FavoriteBoardSql.addArgs(board)) else SqlStatement(FavoriteBoardSql.REMOVE, listOf(board.url))
        write(listOf(change)) { listOf(plainOp(if (on) "favorite_board_add" else "favorite_board_remove", board.url, mapOf("url" to board.url), now)) }
    }

    suspend fun setFavorite(board: Board, on: Boolean, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { setFavoriteNow(board, on, now) }

    internal fun reorderFavoritesNow(urls: List<String>, now: Long) {
        val changes = urls.mapIndexed { i, u -> SqlStatement(FavoriteBoardSql.REORDER, listOf(i.toLong(), u)) }
        write(changes) { listOf(plainOp("favorite_board_order", "order", mapOf("urls" to urls), now)) }
    }

    suspend fun reorderFavorites(urls: List<String>, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { reorderFavoritesNow(urls, now) }

    internal fun addSiteNow(menuUrl: String, name: String, now: Long) =
        write(listOf(SqlStatement(SiteSql.ADD, SiteSql.addArgs(menuUrl, name)))) { listOf(plainOp("site_add", menuUrl, mapOf("menu_url" to menuUrl), now)) }

    suspend fun addSite(menuUrl: String, name: String, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { addSiteNow(menuUrl, name, now) }

    internal fun removeSiteNow(menuUrl: String, now: Long) = write(listOf(SqlStatement(SiteSql.REMOVE_BOARDS, listOf(menuUrl)), SqlStatement(SiteSql.REMOVE, listOf(menuUrl)))) {
        listOf(plainOp("site_remove", menuUrl, mapOf("menu_url" to menuUrl), now))
    }

    suspend fun removeSite(menuUrl: String, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { removeSiteNow(menuUrl, now) }

    internal fun addUploadNow(u: UploadRecord, now: Long) =
        write(listOf(SqlStatement(UploadSql.ADD, UploadSql.addArgs(u, now).toList()))) { listOf(plainOp("upload_add", u.url, mapOf("url" to u.url), now)) }

    suspend fun addUpload(u: UploadRecord, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { addUploadNow(u, now) }

    /** バックアップから戻すのも利用者の操作 */
    suspend fun importUploads(list: List<UploadRecord>, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) {
        write(list.map { SqlStatement(UploadSql.IMPORT, UploadSql.importArgs(it).toList()) }) { list.map { plainOp("upload_add", it.url, mapOf("url" to it.url), now) } }
    }

    internal fun removeUploadNow(url: String, now: Long) =
        write(listOf(SqlStatement(UploadSql.REMOVE, listOf(url)))) { listOf(plainOp("upload_remove", url, mapOf("url" to url), now)) }

    /** NG の差分を積む。積むのは upsert と remove だけで、drop は tombstone にならない。今の値は Prefs にあるので、書くのは呼ぶ側 */
    internal fun ngChangeNow(diff: NgDiff, now: Long) {
        if (diff.upsert.isEmpty() && diff.remove.isEmpty() || !isOn()) return
        sql.batch(
            diff.upsert.map { plainOp("ng_diff", it.id, mapOf("id" to it.id, "rule" to ngRuleToBody(it)), now) } +
                diff.remove.map { plainOp("ng_diff", it, mapOf("id" to it, "rule" to null), now) },
        )
    }
}
