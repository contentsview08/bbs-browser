package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.Post
import io.github.contentsview08.obb.mergeRefreshed
import io.github.contentsview08.obb.sync.JdbcSyncSql
import io.github.contentsview08.obb.sync.adapters.restoreThreadRead
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// のぞいただけの行と、同期の既読の戻し・更新での取り込み・自動の整理
class PeekLogTest {
    private val board = "https://a.5ch.io/x/"
    private val key = "1800000000"

    private fun db(): JdbcSyncSql = JdbcSyncSql.open().also { d ->
        // ほかの端末(PC)が 120 まで読んだ記録だけが同期の表にある
        d.exec(
            "INSERT INTO sync_records (record_id, kind, kind_tag, schema_version, payload, hlc, ref_board, ref_thread, ref_detail) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)",
            listOf("r1", "read_dev", "t", """{"body":{"pos":120},"device_id":"pc","hlc":"0000000000001-0000-pc","kind":"read_dev"}""", "0000000000001-0000-pc", "a.5ch.io/x/", key, "pc"),
        )
    }

    /** saveFetch と同じ、のぞいて作られる行(既読も閲覧もない) */
    private fun peekRow(d: JdbcSyncSql, fetchedAt: Long = 1L) =
        d.exec("INSERT INTO threads (board_url, key, connector_id, title, post_count, fetched_at) VALUES (?, ?, '2ch-compat', 't', 150, ?)", listOf(board, key, fetchedAt))

    private fun readOf(d: JdbcSyncSql) = d.query("SELECT read_no, post_count FROM threads WHERE key = ?", listOf(key))

    @Test fun ログのないスレは同期の既読が戻る() {
        val d = db()
        assertTrue(restoreThreadRead(d, board, key, "2ch-compat", "t", null))
        assertEquals(120L, readOf(d).single()["read_no"])
    }

    @Test fun のぞいただけの行があっても同期の既読が戻る() {
        val d = db()
        peekRow(d)
        assertTrue(restoreThreadRead(d, board, key, "2ch-compat", "t", null))
        val rows = readOf(d)
        // 行は増やさず、取ったレスの数は残したまま既読だけ足す
        assertEquals(1, rows.size)
        assertEquals(120L, rows.single()["read_no"])
        assertEquals(150L, rows.single()["post_count"])
    }

    @Test fun 手元で読んだ行は同期の既読で書き換えない() {
        val d = db()
        d.exec("INSERT INTO threads (board_url, key, connector_id, title, read_no) VALUES (?, ?, '2ch-compat', 't', 30)", listOf(board, key))
        assertFalse(restoreThreadRead(d, board, key, "2ch-compat", "t", null))
        assertEquals(30L, readOf(d).single()["read_no"])
    }

    @Test fun のぞいただけの行は短い期間で整理に入る() {
        val d = JdbcSyncSql.open()
        peekRow(d, fetchedAt = 1_000L)
        d.exec("INSERT INTO threads (board_url, key, connector_id, title, read_no, fetched_at) VALUES (?, '2', '2ch-compat', 't', 5, 1000)", listOf(board))
        d.exec("INSERT INTO threads (board_url, key, connector_id, title, read_at, fetched_at) VALUES (?, '3', '2ch-compat', 't', 1000, 1000)", listOf(board))
        d.exec("INSERT INTO threads (board_url, key, connector_id, title, fetched_at) VALUES (?, '4', '2ch-compat', 't', 1000)", listOf(board))
        d.exec("INSERT INTO favorite_threads (board_url, key, connector_id, title, sort, added_at) VALUES (?, '4', '2ch-compat', 't', 0, 0)", listOf(board))
        val keys = d.query(ThreadLogSql.PRUNE_PEEKED, listOf("2000")).map { it["key"] }
        assertEquals(listOf(key), keys)
        assertTrue(d.query(ThreadLogSql.PRUNE_PEEKED, listOf("500")).isEmpty())
    }

    private fun p(no: Int) = Post(no, "", "", "", null, "b$no")

    @Test fun のぞいて先にDBへ入ったレスも更新で画面に入る() {
        val shown = (1..100).map(::p)
        val stored = (1..120).map(::p)
        val fetched = (121..130).map(::p)
        assertEquals((1..130).toList(), mergeRefreshed(shown, stored, fetched, reset = false)!!.map { it.no })
        // 新着がなくても、DB にだけあるレスは入る
        assertEquals((1..120).toList(), mergeRefreshed(shown, stored, emptyList(), reset = false)!!.map { it.no })
    }

    @Test fun 変わらなければ組み立て直さない() {
        val shown = (1..10).map(::p)
        assertNull(mergeRefreshed(shown, shown, emptyList(), reset = false))
    }

    @Test fun 重なって返ったレスは1つにする() {
        val shown = (1..10).map(::p)
        assertEquals((1..12).toList(), mergeRefreshed(shown, (1..11).map(::p), (10..12).map(::p), reset = false)!!.map { it.no })
    }

    @Test fun 取り直しは届いた分で置き換える() {
        assertEquals(listOf(1, 2), mergeRefreshed((1..10).map(::p), (1..10).map(::p), listOf(p(1), p(2), p(2)), reset = true)!!.map { it.no })
    }
}
