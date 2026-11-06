package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.sync.JdbcSyncSql
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlinx.coroutines.runBlocking

// 同期の表の移行と拾い
class SyncMigrationTest {
    private val t = ThreadSummary("https://a.5ch.io/x/", "1", "t", 0, 0, 1000)

    private fun oldDb(): JdbcSyncSql {
        val db = JdbcSyncSql.open("018")
        db.script("INSERT INTO threads (board_url, key, connector_id, title, post_count, read_no, status, read_at) VALUES ('https://a.5ch.io/x/', '100', '2ch-compat', 'スレ', 3, 2, 'active', 3)")
        db.script("INSERT INTO favorite_threads (board_url, key, connector_id, title, created_at, sort, added_at) VALUES ('https://a.5ch.io/x/', '100', '2ch-compat', 'スレ', 1, 1, 5)")
        db.script("INSERT INTO uploads (url, name, size, uploaded_at, with_account, hash, delete_url) VALUES ('https://i.test/a.png', 'a.png', 10, 20, 0, 'h', 'https://i.test/del')")
        return db
    }

    private fun tables(db: JdbcSyncSql) = db.query("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sync_%' AND name NOT LIKE 'sqlite_%' ORDER BY name")

    @Test fun 既存のDBに流しても既存の表が変わらない() {
        val db = oldDb()
        val before = tables(db)
        val rows = listOf("threads", "favorite_threads", "uploads").map { db.query("SELECT * FROM $it") }
        for (s in splitSql(File("../../../packages/logstore/migrations/018_sync.sql").readText())) db.script(s)
        assertEquals(before, tables(db))
        assertEquals(rows, listOf("threads", "favorite_threads", "uploads").map { db.query("SELECT * FROM $it") })
        assertEquals("ok", db.query("PRAGMA integrity_check")[0].values.first())
        assertEquals(0L, db.query("SELECT COUNT(*) AS n FROM sync_records")[0]["n"])
        db.close()
    }

    @Test fun 移行の文は古い端末のSQLiteでも通る書き方() {
        // minSdk 26 は SQLite 3.18。ON CONFLICT DO UPDATE(3.24)は通らない
        val sql = File("../../../packages/logstore/migrations/018_sync.sql").readText()
        assertTrue(!sql.contains("DO UPDATE", ignoreCase = true))
        for (f in File("src/main/java/io/github/contentsview08/obb/sync").walkTopDown().filter { it.extension == "kt" }) assertTrue(f.name, !f.readText().contains("DO UPDATE", ignoreCase = true))
    }

    @Test fun 同期が無効なら今と同じ行になり何も積まない() = runBlocking {
        val db = JdbcSyncSql.open()
        val ops = UserOps(db)
        ops.setFavoriteThread(t, "題", true, 5)
        assertEquals(listOf(mapOf("board_url" to t.boardUrl, "key" to "1", "connector_id" to "2ch-compat", "title" to "題", "created_at" to 1000L, "sort" to 1L, "added_at" to 5L)), db.query("SELECT board_url, key, connector_id, title, created_at, sort, added_at FROM favorite_threads"))
        assertEquals(0L, db.query("SELECT COUNT(*) AS n FROM sync_ops")[0]["n"])
        ops.setFavoriteThread(t, "題", false, 6)
        assertEquals(0L, db.query("SELECT COUNT(*) AS n FROM favorite_threads")[0]["n"])
        assertEquals(0L, db.query("SELECT COUNT(*) AS n FROM sync_ops")[0]["n"])
        db.close()
    }

    @Test fun 同期の表が読めなくても操作は通る() = runBlocking {
        val db = JdbcSyncSql.open()
        db.script("DROP TABLE sync_state")
        UserOps(db).setFavoriteThread(t, "題", true, 5)
        assertEquals(1L, db.query("SELECT COUNT(*) AS n FROM favorite_threads")[0]["n"])
        db.close()
    }

    @Test fun 有効なら更新と送信待ちが一緒に入る() = runBlocking {
        val db = JdbcSyncSql.open()
        db.script("INSERT INTO sync_state (key, value) VALUES ('enabled', '1')")
        UserOps(db).setFavoriteThread(t, "題", true, 5)
        val op = db.query("SELECT op, target, args, at_ms FROM sync_ops").single()
        assertEquals("favorite_thread_add", op["op"])
        assertEquals("https://a.5ch.io/x/\t1", op["target"])
        assertEquals("""{"board_url":"https://a.5ch.io/x/","key":"1"}""", op["args"])
        assertEquals(5L, op["at_ms"])
        assertEquals(1L, db.query("SELECT COUNT(*) AS n FROM favorite_threads")[0]["n"])
        db.close()
    }

    @Test fun 送信待ちが書けなければデータの更新も戻る() = runBlocking {
        val db = JdbcSyncSql.open()
        db.script("INSERT INTO sync_state (key, value) VALUES ('enabled', '1')")
        db.script("DROP TABLE sync_ops")
        val failed = runCatching { UserOps(db).setFavoriteThread(t, "題", true, 5) }.isFailure
        assertTrue(failed)
        assertEquals(0L, db.query("SELECT COUNT(*) AS n FROM favorite_threads")[0]["n"])
        db.close()
    }

    @Test fun 画面はお気に入りのスレをUserOps越しにだけ変える() {
        val direct = File("src/main/java").walkTopDown().filter { it.extension == "kt" }.flatMap { f -> f.readLines().filter { it.contains("setFavoriteThread(") && !it.contains("userOps.") && !it.contains("suspend fun setFavoriteThread") }.map { "${f.name}: $it" } }.toList()
        assertEquals(emptyList<String>(), direct)
    }
}
