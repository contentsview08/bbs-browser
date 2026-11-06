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

    @Test fun sorted_by_remote_unread() {
        val a = entry("a", 50, 50)
        val b = entry("b", 50, 45)
        assertEquals(listOf("a", "b"), keys(unreadEntries(listOf(b, a), mapOf(a.thread.id to 70))))
    }
}
