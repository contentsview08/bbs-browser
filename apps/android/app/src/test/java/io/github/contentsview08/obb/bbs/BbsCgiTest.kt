package io.github.contentsview08.obb.bbs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// bbs.cgi の応答の読み分けと、送る内容。読み違えると、書けたのに失敗と出たり、書けていないのに消えたりする
class BbsCgiTest {
    private val postUrl = "https://x.test/test/bbs.cgi"
    private val fields = mapOf("bbs" to "board", "MESSAGE" to "本文")

    private fun parse(html: String, resNumber: Int? = null) = parseBbsCgi(html, postUrl, fields, "https://x.test/r", resNumber)
    private inline fun <reified T : PostResult> parsed(html: String, resNumber: Int? = null): T {
        val r = parse(html, resNumber)
        assertTrue("結果が ${r::class.simpleName}", r is T)
        return r as T
    }

    @Test fun 目印のtrueは成功でレス番号を渡す() {
        val r = parsed<PostResult.Ok>("<html><!-- 2ch_X:true --><head><title>x</title></head><body>書きこみが終わりました。</body></html>", 12)
        assertEquals(12, r.resNumber)
        assertEquals("書きこみが終わりました。", r.message)
    }

    @Test fun 目印がなくても題名が書きこみましたなら成功() {
        val r = parsed<PostResult.Ok>("<html><head><title>書きこみました。</title></head><body></body></html>")
        assertEquals("書きこみました。", r.message)
        assertNull(r.resNumber)
    }

    @Test fun 目印がfalseなら題名が書きこみましたでも成功にしない() {
        parsed<PostResult.Error>("<!-- 2ch_X:false --><title>書きこみました</title><body>だめです</body>")
    }

    @Test fun エラーは本文を理由にする() {
        val r = parsed<PostResult.Error>("<!-- 2ch_X:error --><title>ＥＲＲＯＲ！</title><body>ＥＲＲＯＲ: 本文が\n長すぎます<br>もう一度</body>")
        assertEquals("ＥＲＲＯＲ: 本文が長すぎます\nもう一度", r.message)
    }

    @Test fun 本文がなければ題名読めなければ決まりの言葉() {
        assertEquals("ＥＲＲＯＲ", parsed<PostResult.Error>("<title>ＥＲＲＯＲ</title><body></body>").message)
        assertEquals(POST_FAILED, parsed<PostResult.Error>("").message)
    }

    @Test fun 確認は送り先と隠し項目を読み元の項目を残す() {
        val html = """<!-- 2ch_X:cookie --><title>書き込み確認</title><body>
            <form method=POST action="../test/bbs.cgi?guid=ON">
            <input type=hidden name="feature" value="a&amp;b">
            <input type='hidden' name=time value=123>
            <input type=submit name="submit" value="上記全てを承諾して書き込む">
            <input type=text name="ignored" value="x">
            <input type=submit value="名前なし">
            </form></body>"""
        val r = parse(html, null) as PostResult.Confirm
        assertEquals("https://x.test/test/bbs.cgi?guid=ON", r.url)
        assertEquals("https://x.test/r", r.referer)
        assertEquals(
            mapOf("bbs" to "board", "MESSAGE" to "本文", "feature" to "a&b", "time" to "123", "submit" to "上記全てを承諾して書き込む"),
            r.fields,
        )
    }

    @Test fun 確認の文面だけでも確認として読み送り先がなければ同じ先へ() {
        val r = parsed<PostResult.Confirm>("<body>内容を確かめて、承諾して書き込むを押してください</body>")
        assertEquals(postUrl, r.url)
        assertEquals(fields, r.fields)
    }

    @Test fun 認証のページがあれば認証待ちでコードを読む() {
        val r = parsed<PostResult.Auth>("<body>認証コード'abc123'を用いて https://x.test/auth-code で認証してください</body>")
        assertEquals("https://x.test/auth-code", r.url)
        assertEquals("abc123", r.code)
    }

    @Test fun 再認証のコードも読む() {
        assertEquals("zzz", parsed<PostResult.Auth>("<body>再認証コード'zzz'を https://x.test/auth-code で</body>").code)
    }

    @Test fun コードのない認証の案内() {
        val r = parsed<PostResult.Auth>("<body>ユーザー登録してください https://x.test/register</body>")
        assertEquals("https://x.test/register", r.url)
        assertNull(r.code)
    }

    @Test fun 認証と関係ないリンクはエラーのまま() {
        parsed<PostResult.Error>("<body>規制中です https://x.test/rule を見てください</body>")
    }

    // ── 送るところ ──

    private val thread = ThreadSummary("https://w1.test/board/", "1700000000", "", 0, 0, null)
    private fun answerPost(post: (Sent) -> io.github.contentsview08.obb.data.HttpResponse) = FakeServer { if (it.method == "POST") post(it) else res(404) }
    private fun posts(s: FakeServer) = s.sent.filter { it.method == "POST" }

    @Test fun 書き込みはShiftJISで送りRefererとレス番号を扱う() {
        val s = answerPost { res(200, "<!-- 2ch_X:true --><body>ok</body>", mapOf("x-resnum" to "7")) }
        val r = s.run { TwoCh.createPost(thread, PostInput("", "sage", "あ\nい")) } as PostResult.Ok
        assertEquals(7, r.resNumber)
        val p = posts(s).single()
        assertEquals("https://w1.test/test/bbs.cgi", p.url)
        assertEquals("https://w1.test/test/read.cgi/board/1700000000/", p.headers["Referer"])
        val form = p.text.split('&').associate { it.substringBefore('=') to it.substringAfter('=') }
        assertEquals("board", form["bbs"])
        assertEquals("1700000000", form["key"])
        assertEquals("sage", form["mail"])
        assertEquals("%82%A0%0D%0A%82%A2", form["MESSAGE"])
    }

    @Test fun レス番号が0や読めないときは番号なし() {
        for (v in listOf("0", "x")) {
            val s = answerPost { res(200, "<!-- 2ch_X:true --><body>ok</body>", mapOf("x-resnum" to v)) }
            assertNull((s.run { TwoCh.createPost(thread, PostInput("", "", "a")) } as PostResult.Ok).resNumber)
        }
    }

    @Test fun 板がUTF8ならUTF8で送る() {
        val t = ThreadSummary("https://w2.test/board/", "1700000000", "", 0, 0, null)
        val s = FakeServer {
            if (it.method == "POST") res(200, "<!-- 2ch_X:true --><body>ok</body>")
            else if (it.url.endsWith("SETTING.TXT")) res(200, "BBS_TITLE=日本語の板\n") else res(404)
        }
        s.run { TwoCh.createPost(t, PostInput("", "", "あ")) }
        assertTrue(posts(s).single().text.contains("MESSAGE=%E3%81%82&"))
    }

    @Test fun 失敗しても送り直さない() {
        for (status in listOf(200, 403, 500, 503)) {
            val s = answerPost { res(status, "<body>だめ</body>") }
            assertEquals("だめ", (s.run { TwoCh.createPost(thread, PostInput("", "", "a")) } as PostResult.Error).message)
            assertEquals(1, posts(s).size)
        }
    }

    @Test fun 理由が読めないエラーはHTTPの番号を出す() {
        val s = answerPost { res(502) }
        assertEquals("HTTP 502", (s.run { TwoCh.createPost(thread, PostInput("", "", "a")) } as PostResult.Error).message)
    }

    @Test fun 空の200は書けたことにしない() {
        val s = answerPost { res(200) }
        assertEquals(POST_FAILED, (s.run { TwoCh.createPost(thread, PostInput("", "", "a")) } as PostResult.Error).message)
    }

    @Test fun 古いドメインの板でも新しいドメインへ送る() {
        val t = ThreadSummary("https://mi.5ch.net/x/", "1700000000", "", 0, 0, null)
        val s = answerPost { res(200, "<!-- 2ch_X:true --><body>ok</body>") }
        s.run { TwoCh.createPost(t, PostInput("", "", "a")) }
        val p = posts(s).single()
        assertEquals("https://mi.5ch.io/test/bbs.cgi", p.url)
        assertEquals("https://mi.5ch.io/test/read.cgi/x/1700000000/", p.headers["Referer"])
    }

    @Test fun 確認を承諾すると隠し項目を付けて確認の送り先へ() {
        val c = PostResult.Confirm("確認", "https://w1.test/test/bbs.cgi?guid=ON", mapOf("bbs" to "board", "feature" to "z"), "https://w1.test/r")
        val s = answerPost { res(200, "<!-- 2ch_X:true --><body>ok</body>") }
        assertTrue(s.run { TwoCh.submitConfirm(c) } is PostResult.Ok)
        val p = posts(s).single()
        assertEquals(c.url, p.url)
        assertEquals("https://w1.test/r", p.headers["Referer"])
        assertTrue(p.text.contains("feature=z"))
        assertFalse(p.text.contains("MESSAGE"))
    }

    @Test fun スレ立ては題名を送りキーを送らない() {
        val s = answerPost { res(200, "<!-- 2ch_X:true --><body>ok</body>") }
        s.run { TwoCh.createThread(Board(thread.boardUrl, ""), "題", PostInput("", "", "a")) }
        val p = posts(s).single()
        assertTrue(p.text.contains("subject=%91%E8"))
        assertFalse(p.text.contains("key="))
        assertEquals(thread.boardUrl, p.headers["Referer"])
    }
}
