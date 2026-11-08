package io.github.contentsview08.obb.bbs

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

// hono-bbs の差分取得と書き込みの応答。通信はすべて偽の応答
class HonoBbsTest {
    private val key = "11111111-2222-3333-4444-555555555555"

    private fun apiOf(origin: String) = "https://api.${origin.removePrefix("https://")}/api/v1"
    private fun home(origin: String) = res(200, """<meta name="bbs-api" content="${apiOf(origin)}">""")
    private fun thread(origin: String) = ThreadSummary("$origin/boards/b/", key, "", 0, 0, null)

    private fun post(no: Int, content: String = "本文$no", deleted: Boolean = false) =
        """{"postNumber":$no,"posterName":"名無し","posterOptionInfo":"sage","authorId":"abc","content":"$content","isDeleted":$deleted,"createdAt":"2026-09-19T19:02:29.239Z"}"""

    @After fun reset() {
        HonoBbs.account = null
        HonoBbs.clearSessions()
    }

    // ── 差分取得 ──

    private val origin = "https://read.test"
    private val base = "${apiOf(origin)}/boards/b/threads/$key"

    private fun server(answer: (Sent) -> io.github.contentsview08.obb.data.HttpResponse) = FakeServer { if (it.url == "$origin/") home(origin) else answer(it) }

    @Test fun 初めて開くとスレタイと続きの位置が分かり日付を2chの形にする() {
        val s = server {
            if (it.url == base) res(200, """{"data":{"title":"スレタイ","isArchived":true}}""")
            else res(200, """{"data":[${post(1)},${post(2)}]}""")
        }
        val r = s.run { HonoBbs.fetchPosts(thread(origin), null) }
        assertEquals(FetchStatus.UPDATED, r.status)
        assertEquals("スレタイ", r.title)
        assertTrue(r.archived)
        assertEquals(listOf(1, 2), r.posts.map { it.no })
        assertEquals(DatCursor(0, 2, null), r.cursor)
        assertEquals(Post(1, "名無し", "sage", "2026/09/20(日) 04:02:29.239", "abc", "本文1"), r.posts[0])
    }

    @Test fun 差分は最後の番号の続きを頼み手元より前のレスは捨てる() {
        val s = server { res(200, """{"data":[${post(3)},${post(4)}]}""") }
        val r = s.run { HonoBbs.fetchPosts(thread(origin), DatCursor(0, 3, null)) }
        assertEquals(listOf(4), r.posts.map { it.no })
        assertEquals(DatCursor(0, 4, null), r.cursor)
        val req = s.sent.single { it.url.startsWith(base) }
        val mark = String(Base64.getUrlDecoder().decode(req.url.substringAfter("cursor=")))
        assertEquals(3, JSONObject(mark).getInt("postNumber"))
    }

    @Test fun ページをたどって全部つなぐ() {
        val s = server {
            if (it.url == base) res(200, """{"data":{"title":"t"}}""")
            else if (it.url.contains("cursor=NEXT")) res(200, """{"data":[${post(2)}],"nextCursor":null}""")
            else res(200, """{"data":[${post(1)}],"nextCursor":"NEXT"}""")
        }
        assertEquals(listOf(1, 2), s.run { HonoBbs.fetchPosts(thread(origin), null) }.posts.map { it.no })
    }

    @Test fun 新着がなければ位置を保つ() {
        val r = server { res(200, """{"data":[]}""") }.run { HonoBbs.fetchPosts(thread(origin), DatCursor(0, 5, null)) }
        assertEquals(FetchStatus.NOT_MODIFIED, r.status)
        assertEquals(DatCursor(0, 5, null), r.cursor)
    }

    @Test fun スレが消えたら手元のログと位置を残す() {
        val c = DatCursor(0, 5, null)
        val r = server { res(404) }.run { HonoBbs.fetchPosts(thread(origin), c) }
        assertEquals(FetchStatus.ARCHIVED, r.status)
        assertTrue(r.posts.isEmpty())
        assertEquals(c, r.cursor)
    }

    @Test(expected = IllegalStateException::class)
    fun サーバーのエラーは例外() {
        server { res(500) }.run { HonoBbs.fetchPosts(thread(origin), DatCursor(0, 5, null)) }
    }

    @Test fun 消されたレスは番号を残して中身を出さない() {
        val r = server { res(200, """{"data":[${post(6, "秘密", deleted = true)}]}""") }.run { HonoBbs.fetchPosts(thread(origin), DatCursor(0, 5, null)) }
        assertEquals(Post(6, "あぼーん", "", "2026/09/20(日) 04:02:29.239", null, "あぼーん"), r.posts.single())
    }

    // ── 書き込みの応答 ──

    private val input = PostInput("", "", "本文")
    private val writeUrl = "${apiOf(origin)}/boards/b/threads/$key/posts"

    private fun write(answer: (Sent) -> io.github.contentsview08.obb.data.HttpResponse): Pair<PostResult, FakeServer> {
        val s = server(answer)
        return s.run { HonoBbs.createPost(thread(origin), input) } to s
    }

    @Test fun 書けたらレス番号を読む() {
        val (r, s) = write { res(201, """{"data":{"postNumber":5}}""") }
        assertEquals(5, (r as PostResult.Ok).resNumber)
        val p = s.sent.single { it.method == "POST" }
        assertEquals(writeUrl, p.url)
        val sent = JSONObject(p.text)
        assertEquals("本文", sent.getString("content"))
        assertFalse(sent.has("posterName"))
        assertFalse(sent.has("posterOptionInfo"))
    }

    @Test fun 書けたのに応答が読めなくても失敗にしない() {
        assertNull((write { res(200, "OK") }.first as PostResult.Ok).resNumber)
    }

    @Test fun Turnstileが要ればつなぎのコードで案内する() {
        for (e in listOf("TURNSTILE_REQUIRED", "TURNSTILE_INVALID")) {
            val (r, s) = write {
                if (it.url.endsWith("/auth/turnstile/pair")) res(200, """{"data":{"url":"https://read.test/auth","code":"ABC"}}""")
                else res(403, """{"error":"$e","message":"m"}""")
            }
            val a = r as PostResult.Auth
            assertEquals("https://read.test/auth", a.url)
            assertEquals("ABC", a.code)
            assertEquals(1, s.sent.count { it.url == writeUrl })
        }
    }

    @Test fun 認証ページのURLがhttpでなければ開かずにエラーにする() {
        for (bad in listOf("javascript:alert(1)", "intent://x#Intent;end", "file:///etc/passwd")) {
            val (r, _) = write {
                if (it.url.endsWith("/auth/turnstile/pair")) res(200, """{"data":{"url":"$bad","code":"ABC"}}""")
                else res(403, """{"error":"TURNSTILE_REQUIRED"}""")
            }
            assertTrue(bad, r is PostResult.Error)
        }
    }

    @Test fun APIの場所はhttpのURLだけを信じる() {
        // 形が http(s) でないものは、ページを読めても既定の api.<ホスト> に戻す
        for ((i, bad) in listOf("javascript:alert(1)", "http", "httpx://api.evil.test/api/v1", "https://").withIndex()) {
            val origin = "https://meta$i.test"
            val s = FakeServer { res(200, """<meta name="bbs-api" content="$bad">""") }
            assertEquals(bad, apiOf(origin), s.run { HonoBbs.apiFor("$origin/boards/b/") })
        }
        val s = FakeServer { res(200, """<meta name="bbs-api" content="https://api.other.test/v1/">""") }
        assertEquals("https://api.other.test/v1", s.run { HonoBbs.apiFor("https://metaok.test/boards/b/") })
    }

    @Test fun つなぎのコードをもらえなくても認証の案内にする() {
        val (r, _) = write { if (it.url.endsWith("/pair")) res(500, "<html>") else res(403, """{"error":"TURNSTILE_REQUIRED"}""") }
        val a = r as PostResult.Auth
        assertEquals("${apiOf(origin)}/auth/turnstile", a.url)
        assertNull(a.code)
    }

    @Test fun エラーは理由を出す() {
        assertEquals("TOO_LONG: 長すぎます", (write { res(400, """{"error":"TOO_LONG","message":"長すぎます"}""") }.first as PostResult.Error).message)
        assertEquals("エラー: だめ", (write { res(400, """{"message":"だめ"}""") }.first as PostResult.Error).message)
    }

    @Test fun 応答がJSONでなければHTTPの番号を出す() {
        assertEquals("書き込めませんでした(HTTP 502)", (write { res(502, "<html>") }.first as PostResult.Error).message)
    }

    @Test fun アカウントがなければ401でも1回しか送らない() {
        val (r, s) = write { res(401, """{"error":"UNAUTHORIZED","message":"だめ"}""") }
        assertTrue(r is PostResult.Error)
        assertEquals(1, s.sent.count { it.url == writeUrl })
    }

    // ── アカウント ──

    private val accountOrigin = "https://fake.red-edge.net"
    private val accountApi = apiOf(accountOrigin)

    @Test fun セッションが切れていたら1度だけログインし直して送り直す() {
        HonoBbs.account = HonoBbs.Account("user", "pass")
        var logins = 0
        var writes = 0
        val s = FakeServer {
            when {
                it.url == "$accountOrigin/" -> home(accountOrigin)
                it.url == "$accountApi/auth/login" -> res(200, """{"data":{"sessionId":"s${++logins}","expiresAt":"2099-01-01T00:00:00Z"}}""")
                ++writes == 1 -> res(401, "{}")
                else -> res(201, """{"data":{"postNumber":9}}""")
            }
        }
        val r = s.run { HonoBbs.createPost(thread(accountOrigin), input) }
        assertEquals(9, (r as PostResult.Ok).resNumber)
        val sentWrites = s.sent.filter { it.url.endsWith("/posts") }
        assertEquals(listOf("Bearer s1", "Bearer s2"), sentWrites.map { it.headers["Authorization"] })
    }

    @Test fun ログインし直しても401なら3回目は送らない() {
        HonoBbs.account = HonoBbs.Account("user", "pass")
        var logins = 0
        val s = FakeServer {
            when {
                it.url == "$accountOrigin/" -> home(accountOrigin)
                it.url == "$accountApi/auth/login" -> res(200, """{"data":{"sessionId":"s${++logins}","expiresAt":"2099-01-01T00:00:00Z"}}""")
                else -> res(401, """{"error":"UNAUTHORIZED","message":"だめ"}""")
            }
        }
        assertTrue(s.run { HonoBbs.createPost(thread(accountOrigin), input) } is PostResult.Error)
        assertEquals(2, s.sent.count { it.url.endsWith("/posts") })
    }

    @Test fun 許可のないサイトにはパスワードもセッションも送らない() {
        HonoBbs.account = HonoBbs.Account("user", "secret-pass")
        val other = "https://other.test"
        val s = FakeServer { if (it.url == "$other/") home(other) else res(201, """{"data":{"postNumber":1}}""") }
        s.run { HonoBbs.createPost(thread(other), input) }
        assertFalse(s.sent.any { it.url.endsWith("/auth/login") || it.text.contains("secret-pass") || it.headers.containsKey("Authorization") })
    }

    // ── API の場所 ──

    @Test fun 家の中や自分の端末を指すAPIの印は受けず決めつけにする() {
        val apis = listOf("http://127.0.0.1:8787/api/v1", "http://192.168.0.1/api", "http://localhost/api/v1", "http://router.lan/api", "http://[::1]/api", "http://0x7f.1/api", "http://2130706433/api")
        for ((i, api) in apis.withIndex()) {
            val web = "https://evil$i.example.com"
            val s = FakeServer { res(200, """<meta name="bbs-api" content="$api">""") }
            assertEquals(api, "https://api.evil$i.example.com/api/v1", s.run { HonoBbs.apiFor("$web/boards/b/") })
        }
    }

    @Test fun 同じホストとその下とほかの公開のサイトのAPIは受ける() {
        assertTrue(HonoBbs.apiBaseAllowed("http://localhost:5173", "http://localhost:8787/api/v1"))
        assertTrue(HonoBbs.apiBaseAllowed("https://bbs.example.com", "https://api.bbs.example.com/api/v1"))
        assertTrue(HonoBbs.apiBaseAllowed("https://bbs.example.com", "https://hono-bbs.x.workers.dev/api/v1"))
        assertFalse(HonoBbs.apiBaseAllowed("https://bbs.example.com", "javascript:alert(1)"))
        assertFalse(HonoBbs.apiBaseAllowed("https://bbs.example.com", "http://10.0.0.1/api/v1"))
    }
}
