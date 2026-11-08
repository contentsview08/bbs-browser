package io.github.contentsview08.obb.bbs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

// まちBBS の offlaw.cgi の <ERROR>。通信はすべて偽の応答
class MachiFetchTest {
    private val thread = ThreadSummary("https://machi.to/tokyo/", "1700000000", "", 0, 0, null)

    @Test fun スレがないと言われたらdat落ち() {
        val r = FakeServer { res(200, "<ERROR>スレッドを発見できません</ERROR>".toByteArray(charset("Shift_JIS"))) }.run { Machi.fetchPosts(thread, null) }
        assertEquals(FetchStatus.ARCHIVED, r.status)
    }

    @Test fun それ以外のERRORはdat落ちにせずエラーにする() {
        val e = assertThrows(IllegalStateException::class.java) {
            FakeServer { res(200, "<ERROR>Server busy</ERROR>") }.run { Machi.fetchPosts(thread, null) }
        }
        assertTrue(e.message.orEmpty().contains("Server busy"))
    }
}
