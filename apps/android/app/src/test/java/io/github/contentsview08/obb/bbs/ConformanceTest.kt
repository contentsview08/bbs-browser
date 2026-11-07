package io.github.contentsview08.obb.bbs

import io.github.contentsview08.obb.data.NgMatcher
import io.github.contentsview08.obb.data.NgRule
import io.github.contentsview08.obb.data.cookieFromJson
import io.github.contentsview08.obb.data.cookieToJson
import io.github.contentsview08.obb.data.favIncrease
import io.github.contentsview08.obb.data.ngMatchRanges
import io.github.contentsview08.obb.data.ngPatternError
import io.github.contentsview08.obb.data.nextRequest
import io.github.contentsview08.obb.data.normalizeForSearch
import io.github.contentsview08.obb.data.threadUnread
import io.github.contentsview08.obb.data.unreadFirstOrder
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// 解析の決まりは packages/conformance の JSON が正。PC 版のテスト(conformance.test.ts)も同じファイルを読む。
// JVM で動くので、Android の実機の正規表現・文字コード表が同じかは、このテストでは分からない
class ConformanceTest {
    private fun cases(file: String): List<JSONObject> {
        val text = javaClass.classLoader!!.getResourceAsStream(file)!!.readBytes().toString(Charsets.UTF_8)
        val a = JSONArray(text)
        return List(a.length()) { a.getJSONObject(it) }
    }

    /** 差を残しているケースは、書いてある差の値と比べる(差がなくなれば落ちて分かる) */
    private fun expectedOf(c: JSONObject): Any {
        val diff = c.optJSONObject("knownDiff")
        if (diff != null) assertTrue("${c.getString("name")}: 理由がない", diff.optString("reason").isNotEmpty())
        return plain(if (diff != null && diff.has("android")) diff.get("android") else c.get("expected"))
    }

    private fun plain(v: Any?): Any = when (v) {
        is JSONArray -> List(v.length()) { plain(v.get(it)) }
        is JSONObject -> v.keys().asSequence().associateWith { plain(v.get(it)) }
        is Int -> v
        is Boolean -> v
        else -> v.toString()
    }

    private fun check(file: String, actual: (JSONObject) -> Any) {
        val fails = ArrayList<String>()
        val all = cases(file)
        for (c in all) {
            val expected = expectedOf(c)
            val got = runCatching { actual(c) }.getOrElse { "例外: $it" }
            val cmp = if (expected is Map<*, *> && got is Map<*, *>) got.filterKeys { it in expected.keys } else got
            if (cmp != expected) fails += "${c.getString("name")}\n  入力: ${c.get("input")}\n  期待: $expected\n  結果: $cmp"
        }
        assertEquals("$file の ${all.size} 件のうち ${fails.size} 件が違う\n" + fails.joinToString("\n"), 0, fails.size)
    }

    private fun post(no: Int, body: String) = Post(no, "", "", "", null, body)

    @Test fun post_body() = check("post-body.json") { c ->
        val text = c.getString("input")
        val index = PostIndex.build(listOf(post(100000, text)))
        val i = index.info.getValue(100000)
        mapOf(
            "anchors" to i.spans.filterIsInstance<BodyToken.Anchor>().flatMap { it.nos },
            "urls" to i.spans.filterIsInstance<BodyToken.Url>().map { it.url },
            "ids" to i.spans.filterIsInstance<BodyToken.Id>().map { it.id },
            "images" to i.images,
            "image" to i.image,
            "video" to i.video,
            "youtube" to i.youtube.map { it.first },
            "link" to i.link,
            "cards" to i.links,
        )
    }

    @Test fun thread() = check("thread.json") { c ->
        val a = c.getJSONArray("input")
        val posts = List(a.length()) { a.getJSONObject(it).let { p -> post(p.getInt("no"), p.getString("body")) } }
        val index = PostIndex.build(posts)
        val trees = c.getJSONObject("expected").optJSONObject("tree")
        buildMap {
            put("replyCount", index.replyCount.entries.associate { it.key.toString() to it.value })
            if (trees != null) put("tree", trees.keys().asSequence().associateWith { index.tree(it.toInt()) })
        }
    }

    @Test fun url() = check("url.json") { c ->
        // お知らせスレの判定に今の時刻を使うのは PC と同じ
        when (val r = UrlRoute.parse(c.getString("input"))) {
            null -> mapOf("kind" to "none")
            // no の JSON の null は plain で "null" になる
            is UrlRoute.Itest -> buildMap { put("kind", "itest"); put("domain", r.domain); put("board", r.board); r.key?.let { put("key", it) }; put("no", r.no ?: "null") }
            is UrlRoute.BoardPage -> mapOf("kind" to "board", "site" to siteName(r.site), "boardUrl" to r.boardUrl)
            is UrlRoute.Thread -> mapOf(
                "kind" to "thread", "site" to siteName(r.site), "boardUrl" to r.thread.boardUrl, "key" to r.thread.key, "createdAtKnown" to (r.thread.createdAt != null), "no" to (r.no ?: "null"),
            )
        }
    }

    @Test fun post_target() = check("post-target.json") { c ->
        val i = c.getJSONObject("input")
        val path = boardPathOf(i.getString("boardUrl"))
        mapOf("bbs" to path.bbs, "postUrl" to path.postUrl, "threadUrl" to path.threadUrl(i.getString("key")))
    }

    private fun siteName(s: UrlRoute.Site) = when (s) {
        UrlRoute.Site.TWOCH -> "2ch"
        UrlRoute.Site.HONO -> "hono"
        UrlRoute.Site.SHITARABA -> "shitaraba"
        UrlRoute.Site.MACHI -> "machi"
    }

    @Test fun subject_shape() = check("subject-shape.json") { c -> looksLikeSubject(c.getString("input")) }

    @Test fun encode() = check("encode.json") { c ->
        val i = c.getJSONObject("input")
        val fields = mapOf("v" to i.getString("value"))
        val bytes = when (i.getString("encoding")) {
            "euc-jp" -> encodeEucJpForm(fields)
            "utf-8" -> encodeUtf8Form(fields)
            else -> encodeShiftJisForm(fields)
        }
        String(bytes, Charsets.US_ASCII)
    }

    @Test fun charset() = check("charset.json") { c ->
        val i = c.getJSONObject("input")
        val hex = i.getString("hex")
        val bytes = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
        val fallback = when (i.optString("fallback")) {
            "utf-8" -> TextEncoding.UTF8
            "euc-jp" -> TextEncoding.EUC
            else -> TextEncoding.SJIS
        }
        when (detectEncoding(bytes, i.optString("contentType").ifEmpty { null }, fallback)) {
            TextEncoding.UTF8 -> "utf-8"
            TextEncoding.SJIS -> "shift_jis"
            TextEncoding.EUC -> "euc-jp"
        }
    }

    @Test fun search() = check("search.json") { c -> normalizeForSearch(c.getString("input")) }

    @Test fun ng() = check("ng.json") { c ->
        val i = c.getJSONObject("input")
        val pattern = i.getString("pattern")
        val isRegex = i.getBoolean("isRegex")
        val text = i.getString("text")
        val target = i.getString("target")
        val rule = NgRule(target, pattern, isRegex)
        val p = Post(1, if (target == "posterName") text else "", "", "", if (target == "posterId") text else null, if (target == "content") text else "")
        mapOf(
            "valid" to (ngPatternError(pattern, isRegex) == null),
            "match" to NgMatcher(listOf(rule)).post(p, null),
            "ranges" to ngMatchRanges(rule, text).map { listOf(it.first, it.last + 1) },
        )
    }

    @Test fun fav_new() = check("fav-new.json") { c ->
        val i = c.getJSONObject("input")
        favIncrease(i.getInt("now"), if (i.has("before")) i.getInt("before") else null, i.getInt("localCount"), i.getInt("readNo"))
    }

    @Test fun unread_first() = check("unread-first.json") { c ->
        val input = c.getJSONArray("input")
        val threads = (0 until input.length()).map { input.getJSONObject(it) }
        unreadFirstOrder(threads) { threadUnread(if (it.has("readNo")) it.getInt("readNo") else null, it.getInt("postCount")) > 0 }.map { it.getString("key") }
    }

    @Test fun post_redirect() = check("post-redirect.json") { c ->
        val i = c.getJSONObject("input")
        val n = nextRequest(i.getInt("status"), i.getString("url").toHttpUrl(), if (i.has("location")) i.getString("location") else null)
        if (n == null) mapOf("follow" to false)
        else mapOf("follow" to true, "url" to n.url.toString(), "method" to if (n.keepMethod) "POST" else "GET", "keepHeaders" to n.keepHeaders)
    }

    /** 保存して読み直した Cookie(次に起動したとき)が、その URL に付くか */
    @Test fun cookie() = check("cookie.json") { c ->
        val i = c.getJSONObject("input")
        val parsed = Cookie.parse(i.getString("url").toHttpUrl(), i.getString("setCookie"))?.takeIf { it.expiresAt > System.currentTimeMillis() }
        parsed != null && cookieFromJson(cookieToJson(parsed)).matches(i.getString("requestUrl").toHttpUrl())
    }

    @Test fun hono_account_site() = check("hono-account-site.json") { c -> HonoBbs.isAccountSite(c.getString("input")) }

    @Test fun site_domain() = check("site-domain.json") { c -> siteDomain(c.getString("input")) }

    @Test fun hono_relogin() = check("hono-relogin.json") { c ->
        val i = c.getJSONObject("input")
        HonoBbs.shouldRelogin(i.getInt("status"), i.getBoolean("sentAuth"))
    }

    @Test fun グロの言葉は検索と同じ揃え方で比べる() {
        val index = PostIndex.build(listOf(post(1, "写真"), post(2, ">>1 ぐろ注意")), grossWords = listOf("グロ"))
        assertEquals(setOf(1, 2), index.gross)
    }

    @Test fun アプリの中で開けるスレの判定() {
        assertTrue(UrlRoute.isThreadUrl("https://itest.5ch.net/test/read.cgi/x/1700000000/"))
        assertEquals(false, UrlRoute.isThreadUrl("https://itest.5ch.net/subback/x"))
        // サーバー名を探したあとも、レス番号を落とさない
        val itest = UrlRoute.parse("https://itest.5ch.net/test/read.cgi/x/1700000000/5") as UrlRoute.Itest
        assertEquals(5, (UrlRoute.parse(itest.realUrl("eagle.5ch.io")) as UrlRoute.Thread).no)
    }
}
