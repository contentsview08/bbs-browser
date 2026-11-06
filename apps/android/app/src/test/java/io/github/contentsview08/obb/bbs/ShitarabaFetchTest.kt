package io.github.contentsview08.obb.bbs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// したらばの差分(番号で続きを頼む)。通信はすべて偽の応答
class ShitarabaFetchTest {
    private val euc = charset("EUC-JP")
    private val thread = ThreadSummary("https://jbbs.shitaraba.net/anime/1234/", "1700000000", "", 0, 0, null)
    private val raw = "https://jbbs.shitaraba.net/bbs/rawmode.cgi/anime/1234/1700000000/"

    private fun line(no: Int, body: String, title: String = "") = "$no<>名無し<>sage<>2026/01/01<> $body <>$title<>abc\n"

    @Test fun 初めては全部読む() {
        val s = FakeServer { res(200, (line(1, "一", "スレタイ") + line(2, "二")).toByteArray(euc)) }
        val r = s.run { Shitaraba.fetchPosts(thread, null) }
        assertEquals(raw, s.sent.single().url)
        assertEquals(FetchStatus.UPDATED, r.status)
        assertEquals("スレタイ", r.title)
        assertEquals("一", r.posts[0].body)
        assertEquals(DatCursor(0, 2, null), r.cursor)
    }

    @Test fun 差分は次の番号から頼む() {
        val s = FakeServer { res(200, line(6, "六").toByteArray(euc)) }
        val r = s.run { Shitaraba.fetchPosts(thread, DatCursor(0, 5, null)) }
        assertEquals("${raw}6-", s.sent.single().url)
        assertEquals(listOf(6), r.posts.map { it.no })
        assertEquals(DatCursor(0, 6, null), r.cursor)
    }

    @Test fun 新着なしは位置を保つ() {
        val r = FakeServer { res(200) }.run { Shitaraba.fetchPosts(thread, DatCursor(0, 5, null)) }
        assertEquals(FetchStatus.NOT_MODIFIED, r.status)
        assertEquals(DatCursor(0, 5, null), r.cursor)
    }

    @Test fun エラーのページはレスにしない() {
        val r = FakeServer { res(200, "<html>\n<body>メンテナンス中</body>\n</html>\n") }.run { Shitaraba.fetchPosts(thread, DatCursor(0, 5, null)) }
        assertEquals(FetchStatus.NOT_MODIFIED, r.status)
        assertTrue(r.posts.isEmpty())
    }

    @Test fun 過去ログ倉庫のスレはもう取りに行かない印を付ける() {
        val r = FakeServer { res(200, line(1, "一").toByteArray(euc), mapOf("error" to "STORAGE IN")) }.run { Shitaraba.fetchPosts(thread, null) }
        assertTrue(r.archived)
        assertEquals(true, r.cursor?.kako)
        val s = FakeServer { throw AssertionError("通信しないはず") }
        assertEquals(FetchStatus.NOT_MODIFIED, s.run { Shitaraba.fetchPosts(thread, r.cursor) }.status)
    }

    @Test fun スレがなければ手元のログを残す() {
        val c = DatCursor(0, 5, null)
        for (a in listOf(res(404), res(200, "", mapOf("error" to "THREAD NOT FOUND")))) {
            val r = FakeServer { a }.run { Shitaraba.fetchPosts(thread, c) }
            assertEquals(FetchStatus.ARCHIVED, r.status)
            assertEquals(c, r.cursor)
        }
    }

    @Test fun 書き込みの応答を読み分ける() {
        fun send(body: String, status: Int = 200) = FakeServer { res(status, body.toByteArray(euc)) }.run { Shitaraba.createPost(thread, PostInput("", "", "あ")) }
        assertTrue(send("<html><head><title>書きこみました</title></head><body></body></html>") is PostResult.Ok)
        assertEquals("ERROR: 本文がありません", (send("<html><head><title>x</title></head><body>ERROR: 本文がありません</body></html>") as PostResult.Error).message)
        assertEquals("HTTP 500", (send("", 500) as PostResult.Error).message)
    }
}
