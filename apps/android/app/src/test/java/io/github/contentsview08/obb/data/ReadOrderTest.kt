package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.sync.JdbcSyncSql
import io.github.contentsview08.obb.sync.engine.SqlStatement
import io.github.contentsview08.obb.sync.engine.SyncSql
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Test

// 既読の書き込み(UserOps.markRead)と一覧の読み(threadStates・history)を同じ 1 本の列に通すと、別々の launch から呼んでも呼んだ順に届く
class ReadOrderTest {
    private val t = ThreadSummary("https://a.5ch.io/x/", "1", "t", 50, 0, 1000)

    /** 書きに時間がかかる DB。列が 1 本でなければ、あとから呼んだ読みが先に終わる */
    private class Slow(private val db: JdbcSyncSql) : SyncSql by db {
        override fun batch(statements: List<SqlStatement>) {
            Thread.sleep(20)
            db.batch(statements)
        }
    }

    @Test fun 既読を書いた直後に一覧を読むと新しい既読が見える() = runBlocking {
        val db = JdbcSyncSql.open()
        db.script("INSERT INTO threads (board_url, key, connector_id, title, post_count, read_no, read_at) VALUES ('https://a.5ch.io/x/', '1', '2ch-compat', 't', 50, 0, 1)")
        val lane = Dispatchers.IO.limitedParallelism(1)
        val ops = UserOps(Slow(db), { false }, lane)
        for (no in 1..10) {
            val write = launch { ops.markRead(t, no, now = no.toLong()) }
            val states = async { withContext(lane) { db.query(ThreadLogSql.threadStates(1), listOf(t.boardUrl)).single()["read_no"] } }
            val history = async { withContext(lane) { db.query(ThreadLogSql.HISTORY, listOf(10)).single()["read_no"] } }
            assertEquals(no.toLong(), states.await())
            assertEquals(no.toLong(), history.await())
            write.join()
        }
        db.close()
    }
}
