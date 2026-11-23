package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.ThreadSummary
import org.junit.Assert.assertEquals
import org.junit.Test

class UnreadEntriesTest {
    private fun entry(key: String, local: Int, read: Int) = HistoryEntry(ThreadSummary("https://example.com/a/", key, key, local, 0, null), read, 0)
    private fun keys(l: List<HistoryEntry>) = l.map { it.thread.key }

    @Test fun remote_count_keeps_thread_with_new_posts() {
        // 手元 50・既読 50 でも、掲示板が 60 なら未読のまま
        val e = entry("1", 50, 50)
        assertEquals(listOf("1"), keys(unreadEntries(listOf(e), mapOf(e.thread.id to 60))))
    }

    @Test fun local_count_when_remote_unknown() {
        assertEquals(listOf("1"), keys(unreadEntries(listOf(entry("1", 50, 40), entry("2", 50, 50)), emptyMap())))
    }

    @Test fun read_up_to_remote_is_removed() {
        val e = entry("1", 50, 60)
        assertEquals(emptyList<String>(), keys(unreadEntries(listOf(e), mapOf(e.thread.id to 60))))
    }

    @Test fun local_count_wins_when_ahead_of_remote() {
        // 取得した直後は手元が掲示板の一覧より先に進んでいることがある。大きい方で数える(行・札と同じ)
        val e = entry("1", 70, 60)
        assertEquals(listOf("1"), keys(unreadEntries(listOf(e), mapOf(e.thread.id to 65))))
        assertEquals(70, unreadTotalOf(e, mapOf(e.thread.id to 65)))
    }

    @Test fun archived_uses_local_count() {
        // dat 落ち(-1)でも、手元に読み残しがあれば未読に残す。読み切っていれば外す
        val a = entry("a", 50, 40)
        val b = entry("b", 50, 50)
        assertEquals(listOf("a"), keys(unreadEntries(listOf(a, b), mapOf(a.thread.id to -1, b.thread.id to -1))))
    }

    @Test fun sorted_by_remote_unread() {
        val a = entry("a", 50, 50)
        val b = entry("b", 50, 45)
        assertEquals(listOf("a", "b"), keys(unreadEntries(listOf(b, a), mapOf(a.thread.id to 70))))
    }
}
