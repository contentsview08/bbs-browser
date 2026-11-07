package io.github.contentsview08.obb.bbs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

// dat の取得と差分。ここを間違えると、手元のログが消えるかレスの番号がずれる
class DatFetchTest {
    private val sjis = charset("windows-31j")
    private val thread = ThreadSummary("https://x.test/board/", "1700000000", "", 0, 0, null)
    private val datUrl = "https://x.test/board/dat/1700000000.dat"

    private fun line(body: String, title: String = "") = "名無し<>sage<>2026/01/01(木) 00:00:00.00 ID:abc<> $body <>$title\n"
    private fun bytes(s: String) = s.toByteArray(sjis)
    private fun cursor(n: Long = 100, count: Int = 2, lastModified: String? = "M1") = DatCursor(n, count, lastModified)

    private fun fetch(cursor: DatCursor?, t: ThreadSummary = thread, answer: (Sent) -> io.github.contentsview08.obb.data.HttpResponse): Pair<FetchResult, List<Sent>> {
        val s = FakeServer(answer)
        return s.run { TwoCh.fetchPosts(t, cursor) } to s.sent
    }

    @Test fun 初めての取得は全部読んで続きの位置を覚える() {
        val text = bytes(line("一", "スレタイ") + line("二"))
        val (r, sent) = fetch(null) { res(200, text, mapOf("last-modified" to "M1")) }
        assertEquals(FetchStatus.UPDATED, r.status)
        assertEquals(listOf(1, 2), r.posts.map { it.no })
        assertEquals("一", r.posts[0].body)
        assertEquals("abc", r.posts[0].id)
        assertEquals("2026/01/01(木) 00:00:00.00", r.posts[0].date)
        assertEquals("スレタイ", r.title)
        assertEquals(DatCursor(text.size.toLong(), 2, "M1"), r.cursor)
        assertEquals(listOf(datUrl), sent.map { it.url })
        assertFalse(sent[0].headers.containsKey("Range"))
    }

    @Test fun 書きかけの行は読まず位置にも入れない() {
        val done = bytes(line("一"))
        val (r, _) = fetch(null) { res(200, done + bytes("名無し<>sage<>書きかけ")) }
        assertEquals(1, r.posts.size)
        assertEquals(done.size.toLong(), r.cursor?.bytes)
    }

    @Test fun 崩れた行も1レスにして番号をずらさない() {
        val (r, _) = fetch(null) { res(200, bytes(line("一") + "崩れた行\n" + line("三"))) }
        assertEquals(listOf(1, 2, 3), r.posts.map { it.no })
        assertEquals("三", r.posts[2].body)
    }

    @Test fun 差分は1バイト手前から頼み番号と位置を続ける() {
        val added = bytes(line("三"))
        val (r, sent) = fetch(cursor()) { res(206, byteArrayOf(0x0a) + added, mapOf("last-modified" to "M2")) }
        assertEquals("bytes=99-", sent.single().headers["Range"])
        assertEquals("M1", sent.single().headers["If-Modified-Since"])
        assertEquals(FetchStatus.UPDATED, r.status)
        assertEquals(listOf(3), r.posts.map { it.no })
        assertEquals("三", r.posts[0].body)
        assertEquals(DatCursor(100L + added.size, 3, "M2"), r.cursor)
    }

    @Test fun 差分の書きかけの行は次に回す() {
        val added = bytes(line("三"))
        val (r, _) = fetch(cursor()) { res(206, byteArrayOf(0x0a) + added + bytes("名無し<>書きかけ")) }
        assertEquals(1, r.posts.size)
        assertEquals(DatCursor(100L + added.size, 3, "M1"), r.cursor)
    }

    @Test fun 差分に新着がなければ位置は動かない() {
        val (r, _) = fetch(cursor()) { res(206, byteArrayOf(0x0a)) }
        assertTrue(r.posts.isEmpty())
        assertEquals(DatCursor(100, 2, "M1"), r.cursor)
    }

    @Test fun 変わっていなければログに触らない() {
        val c = cursor()
        val (r, sent) = fetch(c) { res(304) }
        assertEquals(FetchStatus.NOT_MODIFIED, r.status)
        assertSame(c, r.cursor)
        assertEquals(1, sent.size)
    }

    @Test fun 先頭が改行でなければdatが作り直されたので全部読み直す() {
        val text = bytes(line("新一") + line("新二") + line("新三"))
        val (r, sent) = fetch(cursor()) { if (it.headers.containsKey("Range")) res(206, bytes("x")) else res(200, text) }
        assertEquals(2, sent.size)
        assertFalse(sent[1].headers.containsKey("Range"))
        assertEquals(FetchStatus.RESET, r.status)
        assertEquals(listOf(1, 2, 3), r.posts.map { it.no })
        assertEquals(DatCursor(text.size.toLong(), 3, null), r.cursor)
    }

    @Test fun Rangeを無視した200と縮んだ416は全部読み直す() {
        val text = bytes(line("新一"))
        for (status in listOf(200, 416)) {
            val (r, sent) = fetch(cursor()) { if (it.headers.containsKey("Range")) res(status, text) else res(200, text) }
            assertEquals(2, sent.size)
            assertEquals(FetchStatus.RESET, r.status)
            assertEquals(1, r.posts.size)
        }
    }

    @Test fun 読み直しが空ならログを消さない() {
        val c = cursor()
        val (r, _) = fetch(c) { if (it.headers.containsKey("Range")) res(416) else res(200) }
        assertEquals(FetchStatus.NOT_MODIFIED, r.status)
        assertSame(c, r.cursor)
    }

    @Test fun 読み直しがエラーのページならログを消さない() {
        val c = cursor()
        val html = "<html>\n<body>しばらくお待ちください</body>\n</html>\n"
        val (r, _) = fetch(c) { if (it.headers.containsKey("Range")) res(416) else res(200, html) }
        assertEquals(FetchStatus.NOT_MODIFIED, r.status)
        assertTrue(r.posts.isEmpty())
        assertSame(c, r.cursor)
    }

    @Test(expected = IllegalStateException::class)
    fun 初めての取得がエラーのページならレスにしない() {
        fetch(null) { res(200, "<html>\n<body>しばらくお待ちください</body>\n</html>\n") }
    }

    @Test(expected = IllegalStateException::class)
    fun サーバーのエラーは例外でログに触らない() {
        fetch(cursor()) { res(500) }
    }

    @Test fun datが消えて過去ログもなければ手元のログを残す() {
        val c = cursor()
        val (r, _) = fetch(c) { res(404) }
        assertEquals(FetchStatus.ARCHIVED, r.status)
        assertTrue(r.posts.isEmpty())
        assertSame(c, r.cursor)
    }

    private val fiveCh = ThreadSummary("https://mi.5ch.io/x/", "1700000000", "", 0, 0, null)
    private val kakoUrl = "https://mi.5ch.io/x/oyster/1700/1700000000.dat"

    @Test fun datが消えたら過去ログから全部読む() {
        val text = bytes(line("一", "スレタイ"))
        val (r, sent) = fetch(cursor(), fiveCh) { if (it.url == kakoUrl) res(200, text) else res(404) }
        assertEquals(kakoUrl, sent.last().url)
        assertEquals(FetchStatus.RESET, r.status)
        assertTrue(r.archived)
        assertEquals(DatCursor(text.size.toLong(), 1, null, kako = true), r.cursor)
    }

    @Test fun datが302で返っても過去ログに回る() {
        // 5ch が本当に 302 を返すかは確かめられないので、返したときに過去ログへ行くことだけを固める
        val text = bytes(line("一", "スレタイ"))
        for (c in listOf<DatCursor?>(null, cursor())) {
            val (r, sent) = fetch(c, fiveCh) { if (it.url == kakoUrl) res(200, text) else res(302, "", mapOf("location" to "https://mi.5ch.io/x/kako/")) }
            assertEquals(listOf(datUrlOf(fiveCh), kakoUrl), sent.map { it.url })
            assertTrue(r.archived)
            assertEquals(1, r.posts.size)
        }
    }

    @Test fun datが302で過去ログもなければ手元のログを残す() {
        val c = cursor()
        val (r, _) = fetch(c) { res(302) }
        assertEquals(FetchStatus.ARCHIVED, r.status)
        assertSame(c, r.cursor)
    }

    private fun datUrlOf(t: ThreadSummary) = "${t.boardUrl}dat/${t.key}.dat"

    @Test fun 初めて開いたスレの過去ログは置き換えにしない() {
        val (r, _) = fetch(null, fiveCh) { if (it.url == kakoUrl) res(200, bytes(line("一"))) else res(404) }
        assertEquals(FetchStatus.UPDATED, r.status)
    }

    @Test fun 過去ログの場所がエラーのページならログを消さない() {
        val c = cursor()
        val (r, _) = fetch(c, fiveCh) { if (it.url == kakoUrl) res(200, "<html>\n<body>ありません</body>\n</html>\n") else res(404) }
        assertEquals(FetchStatus.ARCHIVED, r.status)
        assertTrue(r.posts.isEmpty())
        assertSame(c, r.cursor)
    }

    @Test fun 過去ログから取ったスレは取りに行かない() {
        val c = DatCursor(10, 1, null, kako = true)
        val (r, sent) = fetch(c) { throw AssertionError("通信しないはず") }
        assertEquals(FetchStatus.NOT_MODIFIED, r.status)
        assertTrue(r.archived)
        assertTrue(sent.isEmpty())
    }

    @Test fun 位置が0のカーソルは全部読む() {
        val (r, sent) = fetch(DatCursor(0, 0, null)) { res(200, bytes(line("一"))) }
        assertFalse(sent.single().headers.containsKey("Range"))
        assertEquals(FetchStatus.RESET, r.status)
    }

    @Test fun datの形の見分け() {
        assertTrue(looksLikeDat("\n名無し<><>日付<>本文<>\n"))
        assertFalse(looksLikeDat("<html>\n<>"))
        assertFalse(looksLikeDat(""))
    }
}
