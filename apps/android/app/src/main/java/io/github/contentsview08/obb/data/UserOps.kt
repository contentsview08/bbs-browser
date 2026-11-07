package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.Board
import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.sync.SyncConfig
import io.github.contentsview08.obb.sync.canonicalJson
import io.github.contentsview08.obb.sync.engine.SqlStatement
import io.github.contentsview08.obb.sync.adapters.SettingOp
import io.github.contentsview08.obb.sync.engine.SyncSql
import io.github.contentsview08.obb.sync.engine.parseSwitches
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// 利用者の操作の入口。データの更新と送信待ちを同じトランザクションで書く。プリセットや同期の適用はここを通らない

/** 1 回の削除で書くリセットの数。SyncConfig.RESET_BATCH_MAX と同じ値 */
const val LOG_RESET_MAX = SyncConfig.RESET_BATCH_MAX
private const val LOG_DELETE_CHUNK = 200

/**
 * この種類の変更を積むか。同期自体か種類のスイッチを切っている間は積まない。権限系は明示でオンにしたときだけ。
 * 使っていないときは sync_state が空。読めないときも使っていない扱いにして、利用者の操作を止めない
 */
internal fun isSyncGroupOn(sql: SyncSql, group: String): Boolean = try {
    val state = sql.query("SELECT key, value FROM sync_state WHERE key IN ('enabled', 'master', 'kinds')").associate { it["key"] as String to it["value"] as String }
    state["enabled"] == "1" && state["master"] != "0" && parseSwitches(state["kinds"])[group] == true
} catch (_: Exception) {
    false
}

class UserOps(private val sql: SyncSql, private val isOn: (String) -> Boolean = { isSyncGroupOn(sql, it) }) {
    /** sync_ops には手元の識別だけを書く。スレタイなどはエンジンが処理するときに今のデータから読む */
    private fun opStatement(op: String, t: ThreadSummary, now: Long) = SqlStatement(
        "INSERT INTO sync_ops (op, target, num, args, at_ms) VALUES (?, ?, NULL, ?, ?)",
        listOf(op, "${t.boardUrl}\t${t.key}", canonicalJson(mapOf("board_url" to t.boardUrl, "key" to t.key)), now),
    )

    internal fun setFavoriteThreadNow(t: ThreadSummary, title: String, on: Boolean, now: Long) {
        val change = if (on) SqlStatement(FavoriteThreadSql.ADD, FavoriteThreadSql.addArgs(t, title, now)) else SqlStatement(FavoriteThreadSql.REMOVE, FavoriteThreadSql.removeArgs(t))
        if (isOn("favorites")) sql.batch(listOf(change, opStatement(if (on) "favorite_thread_add" else "favorite_thread_remove", t, now)))
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
    private fun write(group: String, changes: List<SqlStatement>, op: () -> List<SqlStatement>) {
        if (isOn(group)) sql.batch(changes + op()) else sql.batch(changes)
    }

    internal fun setFavoriteNow(board: Board, on: Boolean, now: Long) {
        val change = if (on) SqlStatement(FavoriteBoardSql.ADD, FavoriteBoardSql.addArgs(board)) else SqlStatement(FavoriteBoardSql.REMOVE, listOf(board.url))
        write("favorites", listOf(change)) { listOf(plainOp(if (on) "favorite_board_add" else "favorite_board_remove", board.url, mapOf("url" to board.url), now)) }
    }

    suspend fun setFavorite(board: Board, on: Boolean, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { setFavoriteNow(board, on, now) }

    internal fun reorderFavoritesNow(urls: List<String>, now: Long) {
        val changes = urls.mapIndexed { i, u -> SqlStatement(FavoriteBoardSql.REORDER, listOf(i.toLong(), u)) }
        write("favorites", changes) { listOf(plainOp("favorite_board_order", "order", mapOf("urls" to urls), now)) }
    }

    suspend fun reorderFavorites(urls: List<String>, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { reorderFavoritesNow(urls, now) }

    internal fun addSiteNow(menuUrl: String, name: String, now: Long) =
        write("sites", listOf(SqlStatement(SiteSql.ADD, SiteSql.addArgs(menuUrl, name)))) { listOf(plainOp("site_add", menuUrl, mapOf("menu_url" to menuUrl), now)) }

    suspend fun addSite(menuUrl: String, name: String, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { addSiteNow(menuUrl, name, now) }

    internal fun removeSiteNow(menuUrl: String, now: Long) = write("sites", listOf(SqlStatement(SiteSql.REMOVE_BOARDS, listOf(menuUrl)), SqlStatement(SiteSql.REMOVE, listOf(menuUrl)))) {
        listOf(plainOp("site_remove", menuUrl, mapOf("menu_url" to menuUrl), now))
    }

    suspend fun removeSite(menuUrl: String, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { removeSiteNow(menuUrl, now) }

    /** 削除ページの URL は操作に書かない。エンジンが処理するときに今のデータから読む */
    private fun uploadOps(u: UploadRecord, now: Long, images: Boolean, secret: Boolean): List<SqlStatement> =
        (if (images) listOf(plainOp("upload_add", u.url, mapOf("url" to u.url), now)) else emptyList()) +
            (if (secret && u.deleteUrl != null) listOf(plainOp("secret_put", u.url, mapOf("url" to u.url), now)) else emptyList())

    internal fun addUploadNow(u: UploadRecord, now: Long) =
        sql.batch(listOf(SqlStatement(UploadSql.ADD, UploadSql.addArgs(u, now).toList())) + uploadOps(u, now, isOn("images"), isOn("secret")))

    suspend fun addUpload(u: UploadRecord, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { addUploadNow(u, now) }

    /** バックアップから戻すのも利用者の操作 */
    suspend fun importUploads(list: List<UploadRecord>, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) {
        val images = isOn("images")
        val secret = isOn("secret")
        sql.batch(list.map { SqlStatement(UploadSql.IMPORT, UploadSql.importArgs(it).toList()) } + list.flatMap { uploadOps(it, now, images, secret) })
    }

    internal fun removeUploadNow(url: String, now: Long) = sql.batch(
        listOf(SqlStatement(UploadSql.REMOVE, listOf(url))) +
            (if (isOn("images")) listOf(plainOp("upload_remove", url, mapOf("url" to url), now)) else emptyList()) +
            (if (isOn("secret")) listOf(plainOp("secret_remove", url, mapOf("url" to url), now)) else emptyList()),
    )

    /** スクロールで何度も呼ばれるので、同じスレの読みは sync_ops の 1 行にまとめる。minSdk 26 の SQLite は 3.18 なので、更新と追加の 2 文に分ける */
    internal fun markReadNow(t: ThreadSummary, no: Long, now: Long) {
        val target = "${t.boardUrl}\t${t.key}"
        write("history", listOf(SqlStatement(ThreadLogSql.MARK_READ, listOf(no, now, t.boardUrl, t.key)))) {
            listOf(
                SqlStatement("UPDATE sync_ops SET num = MAX(num, ?), at_ms = ? WHERE op = 'read' AND target = ?", listOf(no, now, target)),
                SqlStatement("INSERT OR IGNORE INTO sync_ops (op, target, num, args, at_ms) VALUES ('read', ?, ?, ?, ?)", listOf(target, no, canonicalJson(mapOf("board_url" to t.boardUrl, "key" to t.key)), now)),
            )
        }
    }

    suspend fun markRead(t: ThreadSummary, no: Int, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { markReadNow(t, no.toLong(), now) }

    /** スレを開いたときの最終閲覧時刻 */
    internal fun threadViewNow(t: ThreadSummary, now: Long) =
        write("history", listOf(SqlStatement(ThreadLogSql.VIEW, listOf(now, t.boardUrl, t.key)))) { listOf(opStatement("view", t, now)) }

    suspend fun threadView(t: ThreadSummary, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { threadViewNow(t, now) }

    /** 履歴から外す。ログと既読は残す。全端末の履歴から外れる */
    internal fun historyRemoveNow(t: ThreadSummary, now: Long) =
        write("history", listOf(SqlStatement(ThreadLogSql.REMOVE_HISTORY, listOf(t.boardUrl, t.key)))) { listOf(opStatement("view_remove", t, now)) }

    suspend fun historyRemove(t: ThreadSummary, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { historyRemoveNow(t, now) }

    /** ログの削除は全端末で未読に戻す操作を兼ねる。自動整理は LogDb.pruneLogs を使い、ここを通らない */
    internal fun deleteLogsNow(threads: List<ThreadSummary>, now: Long) {
        val on = isOn("history")
        threads.chunked(LOG_DELETE_CHUNK).forEachIndexed { c, chunk ->
            val stmts = ArrayList<SqlStatement>()
            chunk.forEachIndexed { j, t ->
                for (del in ThreadLogSql.DELETE_LOG) stmts += SqlStatement(del, listOf(t.boardUrl, t.key))
                if (on && c * LOG_DELETE_CHUNK + j < LOG_RESET_MAX) stmts += opStatement("log_delete", t, now)
            }
            sql.batch(stmts)
        }
    }

    suspend fun deleteLogs(threads: List<ThreadSummary>, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { deleteLogsNow(threads, now) }

    internal fun postAddNow(t: ThreadSummary, title: String, no: Int?, name: String, mail: String, body: String, now: Long) =
        write("posts", listOf(SqlStatement(PostHistorySql.ADD, PostHistorySql.addArgs(t, title, no, name, mail, body, now)))) {
            listOf(plainOp("post_add", "${t.boardUrl}\t${t.key}\t$now", mapOf("board_url" to t.boardUrl, "key" to t.key, "posted_at" to now, "body" to body), now))
        }

    suspend fun postAdd(t: ThreadSummary, title: String, no: Int?, name: String, mail: String, body: String, now: Long = System.currentTimeMillis()) =
        withContext(Dispatchers.IO) { postAddNow(t, title, no, name, mail, body, now) }

    /** 消した後は行がないので、ID を作るのに要る値を操作に書く */
    internal fun postRemoveNow(e: PostHistoryEntry, now: Long) = write("posts", listOf(SqlStatement(PostHistorySql.REMOVE, listOf(e.id)))) {
        listOf(plainOp("post_remove", "${e.thread.boardUrl}\t${e.thread.key}\t${e.postedAt}", mapOf("board_url" to e.thread.boardUrl, "key" to e.thread.key, "posted_at" to e.postedAt, "body" to e.body), now))
    }

    suspend fun postRemove(e: PostHistoryEntry, now: Long = System.currentTimeMillis()) = withContext(Dispatchers.IO) { postRemoveNow(e, now) }

    /** 設定の変更を積む。スマホの今の値は Prefs にあるので、changes は共通テストが settings 表へ書く文 */
    internal fun settingsWriteNow(ops: List<SettingOp>, now: Long, changes: List<SqlStatement> = emptyList()) {
        val on = ops.isNotEmpty() && isOn("settings")
        val stmts = changes + if (on) ops.map { plainOp("setting", it.name, mapOf("name" to it.name, "value" to it.value), now) } else emptyList()
        if (stmts.isNotEmpty()) sql.batch(stmts)
    }

    /** NG の差分を積む。積むのは upsert と remove だけで、drop は tombstone にならない。今の値は Prefs にあるので、書くのは呼ぶ側 */
    internal fun ngChangeNow(diff: NgDiff, now: Long) {
        if (diff.upsert.isEmpty() && diff.remove.isEmpty() || !isOn("ng")) return
        sql.batch(
            diff.upsert.map { plainOp("ng_diff", it.id, mapOf("id" to it.id, "rule" to ngRuleToBody(it)), now) } +
                diff.remove.map { plainOp("ng_diff", it, mapOf("id" to it, "rule" to null), now) },
        )
    }
}
