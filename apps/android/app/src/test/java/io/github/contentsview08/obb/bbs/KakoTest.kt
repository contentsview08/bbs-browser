package io.github.contentsview08.obb.bbs

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

// dat 落ちしたスレの過去ログ倉庫(kako)。PC 版の kako.test.ts と同じことを確かめる。
// 置き場の URL の決まりは packages/conformance/kako-url.json が正(ConformanceTest は別の作業で直しているので、ここで読む)
class KakoTest {
    private val sjis = charset("windows-31j")
    private val kako = "名無し<><>2026/10/16 ID:a<> 一つ目 <>過去ログのスレ\n名無し<><>2026/10/16 ID:b<> 二つ目 <>\n".toByteArray(sjis)
    private val edge = ThreadSummary("https://bbs.eddibb.cc/liveedge/", "1792148654", "", 0, 0, null)
    private val dat = "https://bbs.eddibb.cc/liveedge/dat/1792148654.dat"
    private val gz = "https://bbs.eddibb.cc/liveedge/kako/1792/17921/1792148654.dat.gz"
    private val plain = "https://bbs.eddibb.cc/liveedge/kako/1792/17921/1792148654.dat"

    private fun gzip(b: ByteArray): ByteArray = ByteArrayOutputStream().also { o -> GZIPOutputStream(o).use { it.write(b) } }.toByteArray()

    private fun fetch(cursor: DatCursor?, t: ThreadSummary = edge, routes: Map<String, ByteArray>): Pair<FetchResult, List<String>> {
        val s = FakeServer { routes[it.url]?.let { b -> res(200, b) } ?: res(404) }
        return s.run { TwoCh.fetchPosts(t, cursor) } to s.sent.map { it.url }
    }

    @Test fun 置き場のURLの決まり() {
        val text = javaClass.classLoader!!.getResourceAsStream("kako-url.json")!!.readBytes().toString(Charsets.UTF_8)
        val a = JSONArray(text)
        val fails = ArrayList<String>()
        for (i in 0 until a.length()) {
            val c = a.getJSONObject(i)
            val input = c.getJSONObject("input")
            val e = c.getJSONArray("expected")
            val expected = List(e.length()) { e.getString(it) }
            val got = kakoDatUrls(input.getString("boardUrl"), input.getString("key"))
            if (got != expected) fails += "${c.getString("name")}\n  期待: $expected\n  結果: $got"
        }
        assertEquals("kako-url.json の ${a.length()} 件のうち ${fails.size} 件が違う\n" + fails.joinToString("\n"), 0, fails.size)
    }

    @Test fun gzipのまま届いたら解いて読みそこで止まる() {
        val (r, sent) = fetch(null, routes = mapOf(gz to gzip(kako), plain to kako))
        assertEquals(listOf(dat, gz), sent)
        assertEquals(FetchStatus.UPDATED, r.status)
        assertTrue(r.archived)
        assertEquals("過去ログのスレ", r.title)
        assertEquals(listOf("一つ目", "二つ目"), r.posts.map { it.body })
        assertEquals(DatCursor(kako.size.toLong(), 2, null, kako = true), r.cursor)
    }

    @Test fun 解かれて届いたdat_gzはそのまま読む() {
        val (r, _) = fetch(null, routes = mapOf(gz to kako))
        assertEquals(2, r.posts.size)
        assertTrue(r.archived)
    }

    @Test fun dat_gzがなければdatを探す() {
        val (r, sent) = fetch(DatCursor(10, 1, null), routes = mapOf(plain to kako))
        assertEquals(listOf(gz, plain), sent.takeLast(2))
        assertEquals(FetchStatus.RESET, r.status)
        assertEquals(2, r.posts.size)
    }

    @Test fun 壊れたgzipは次の候補へ回る() {
        val (r, _) = fetch(null, routes = mapOf(gz to gzip(kako).copyOf(12), plain to kako))
        assertEquals(2, r.posts.size)
    }

    @Test fun 全部なければdat落ちで手元のログを残す() {
        val c = DatCursor(10, 1, null)
        val (r, sent) = fetch(c, routes = emptyMap())
        assertEquals(listOf(dat, gz, plain), sent)
        assertEquals(FetchStatus.ARCHIVED, r.status)
        assertTrue(r.posts.isEmpty())
        assertSame(c, r.cursor)
    }

    @Test fun 五ちゃんはoysterから順に全部試す() {
        val t = ThreadSummary("https://mi.5ch.io/news4vip/", "1792148654", "", 0, 0, null)
        val (r, sent) = fetch(null, t, emptyMap())
        assertEquals(
            listOf(
                "https://mi.5ch.io/news4vip/dat/1792148654.dat",
                "https://mi.5ch.io/news4vip/oyster/1792/1792148654.dat",
                "https://mi.5ch.io/news4vip/kako/1792/17921/1792148654.dat.gz",
                "https://mi.5ch.io/news4vip/kako/1792/17921/1792148654.dat",
            ),
            sent,
        )
        assertEquals(FetchStatus.ARCHIVED, r.status)
    }

    @Test fun 九桁のキーは頭3桁の下を探す() {
        val (_, sent) = fetch(null, edge.copy(key = "123456789"), emptyMap())
        assertEquals(
            listOf("https://bbs.eddibb.cc/liveedge/kako/123/123456789.dat.gz", "https://bbs.eddibb.cc/liveedge/kako/123/123456789.dat"),
            sent.drop(1),
        )
    }

    @Test fun 解いた後が上限を超えるものは止める() {
        val big = gzip(ByteArray(1024 * 1024))
        assertNull(gunzip(big, 1000))
        assertEquals(1024 * 1024, gunzip(big)?.size)
    }
}
