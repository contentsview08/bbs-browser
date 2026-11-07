package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.sync.adapters.SettingAllowlist
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

// 設定の許可リストと、適用を画面へ写す判断
class SyncSettingsTest {
    private val allow = SettingAllowlist(File("../../../packages/sync/settings-allowlist.json").readText())
    private val prefsText = File("src/main/java/io/github/contentsview08/obb/data/Prefs.kt").readText()

    /** Prefs.kt の書き方を文字で読む。スマホの既定が PC の表と違うと、種まきで既定の値を送ってしまう */
    private fun defaultInPrefs(name: String, type: String): Any? {
        if (type == "words") {
            val m = Regex("""wordsPref\("$name", (emptyList\(\)|listOf\(([^)]*)\)), """).find(prefsText)!!
            return if (m.groupValues[1].startsWith("empty")) emptyList<String>() else Regex("\"([^\"]*)\"").findAll(m.groupValues[2]).map { it.groupValues[1] }.toList()
        }
        val raw = Regex("""by pref\("$name", ([^)]*)\)""").find(prefsText)!!.groupValues[1]
        return if (type == "bool") raw.toBooleanStrict() else raw.trim('"')
    }

    @Test fun 他の端末から来た家の中のアドレスは手元に入れない() {
        for (u in listOf("http://192.168.0.1/test/", "http://localhost/x/", "http://10.0.0.1/x/", "http://router.local/x/", "https://a.5ch.io:8443/x/", "http://[::1]/x/")) assertNull(u, resolveSyncBoard(u))
        assertEquals("https://a.5ch.io/x/", resolveSyncBoard("https://a.5ch.io/x/")?.boardUrl)
    }

    @Test fun Prefsの既定値が許可リストのスマホの既定値と同じ() {
        for (item in allow.items) assertEquals(item.name, allow.defaultOf(item, "phone"), defaultInPrefs(item.name, item.type))
    }

    @Test fun 秘密の項目は許可リストにない() {
        val names = allow.items.map { it.name }
        for (n in allow.never) assertFalse(n, n in names)
        for (n in listOf("postName", "postMail", "honoUser", "honoPassword", "imgbbApiKey", "imgurClientId", "defaultName", "defaultMail")) assertTrue(n, n in allow.never)
        assertFalse("defaultName" in allow.boardMetaFields)
    }

    @Test fun 板ごとの設定は許可された項目だけを送り手元の項目は残す() {
        val m = BoardMeta(alias = "別名", defaultName = "秘密", defaultMail = "sage", omitNoname = false, nonames = listOf("x"), icon = "https://a.test/i.png")
        val wire = allow.boardMetaToWire(m.syncFields())!!
        assertFalse(wire, wire.contains("秘密") || wire.contains("sage") || wire.contains("i.png"))
        assertEquals("""{"alias":"別名","nonames":["x"],"omitNoname":false}""", wire)
        val back = m.withSyncFields(mapOf("alias" to "次"))
        assertEquals("次", back.alias)
        assertNull(back.omitNoname)
        assertEquals(emptyList<String>(), back.nonames)
        assertEquals("秘密", back.defaultName)
        assertEquals("sage", back.defaultMail)
        assertTrue(BoardMeta(alias = "a").withSyncFields(emptyMap()).isEmpty)
    }

    @Test fun 言葉の設定はPCと同じ配列のJSONの文字列にする() {
        val joined = "グロ\n死体"
        val list = wordsOfJson(wordsJson(joined, "\n"))
        assertEquals(listOf("グロ", "死体"), list)
        assertEquals("""["グロ","死体"]""", allow.toWire("grossWords", list))
        assertEquals(list, allow.fromWire("grossWords", """["グロ","死体"]"""))
        assertNull(allow.fromWire("grossWords", "グロ"))
    }

    @Test fun 許可リストにない項目と範囲の外の値は操作にしない() {
        assertEquals(0, allow.opsOf("postName", "名無し", null).size)
        assertEquals(0, allow.opsOf("ngMode", "dim", "aborn").size)
        assertEquals(1, allow.opsOf("ngMode", "hide", "aborn").size)
    }

    @Test fun 溜めた変更は最後の値で1つの操作になる() {
        var value: Any? = "hide"
        val q = SettingOpQueue(allow) { value }
        assertFalse(q.note("postName", ""))
        assertTrue(q.note("ngMode", "aborn"))
        assertTrue(q.note("ngMode", "hide"))
        value = "aborn"
        val ops = q.drain()
        assertEquals(listOf("ngMode"), ops.map { it.name })
        assertEquals("aborn", ops[0].value)
        assertEquals(0, q.drain().size)
    }

    @Test fun 板ごとの設定は変わった板だけを操作にする() {
        val before = mapOf("https://a.test/x/" to mapOf("alias" to "a"), "https://b.test/y/" to mapOf<String, Any?>("alias" to "b"))
        val now = mapOf("https://a.test/x/" to mapOf("alias" to "a"), "https://b.test/y/" to mapOf<String, Any?>("alias" to "c"))
        val q = SettingOpQueue(allow) { now }
        q.note("boardMeta", before)
        val ops = q.drain()
        assertEquals(listOf("boardMeta/https://b.test/y/"), ops.map { it.name })
        assertEquals("""{"alias":"c"}""", ops[0].value)
    }

    @Test fun 開いているスレの既読は上がったときだけ上げる() {
        assertEquals(80, openReadNoAfterSync(50, 80))
        assertEquals(50, openReadNoAfterSync(50, 10))
        assertEquals(50, openReadNoAfterSync(50, null))
    }

    private fun entry(key: String, posts: Int, read: Int) = HistoryEntry(ThreadSummary("https://a.test/x/", key, key, posts, 0, null), read, 0)

    /** 一覧は DB の値のまま。リセットで下がれば未読に戻り、別の端末で読めば外れる */
    @Test fun 一覧の未読は適用の値で数え直す() {
        val before = listOf(entry("1", 100, 100), entry("2", 100, 40))
        assertEquals(listOf("2"), unreadEntries(before, emptyMap()).map { it.thread.key })
        val after = listOf(entry("1", 100, 0), entry("2", 100, 100))
        assertEquals(listOf("1"), unreadEntries(after, emptyMap()).map { it.thread.key })
    }

    @Test fun 未読を上にの並びは適用で変わった既読から決まる() {
        val keys = listOf("a", "b", "c")
        val posts = mapOf("a" to 10, "b" to 10, "c" to 10)
        fun order(states: Map<String, Int>) = unreadFirstOrder(keys) { threadUnread(states[it], posts.getValue(it)) > 0 }
        assertEquals(listOf("c", "a", "b"), order(mapOf("a" to 10, "b" to 10, "c" to 5)))
        // 別の端末でリセットされた a は未読に戻る。読んだことのない b は上げない
        assertEquals(listOf("a", "c", "b"), order(mapOf("a" to 0, "c" to 5)))
    }
}
