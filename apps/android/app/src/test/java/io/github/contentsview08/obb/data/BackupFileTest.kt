package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.Board
import io.github.contentsview08.obb.bbs.ThreadSummary
import org.json.JSONException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BackupFileTest {
    private val floats = setOf("fontScale", "lineHeight")

    /** ファイルに書いて読み戻した設定 */
    private fun roundTrip(settings: JSONObject): Map<String, Any> {
        val text = backupJson(settings, emptyList(), emptyList(), emptyList()).toString(2)
        return restoredSettings(parseBackup(text).settings!!, floats)
    }

    @Test fun 書き出したものを読み戻せる() {
        val boards = listOf(Board("https://x.test/a/", "板「A」"))
        val threads = listOf(ThreadSummary("https://x.test/a/", "1700000000", "スレ \"1\"", 5, 0, 1700000000000))
        val sites = listOf("https://x.test/bbsmenu.json" to "サイト")
        val b = parseBackup(backupJson(JSONObject().put("postName", "名前"), boards, threads, sites).toString(2))
        assertEquals("名前", b.settings!!.getString("postName"))
        assertEquals(boards, b.boards)
        assertEquals(listOf(Triple("https://x.test/a/", "1700000000", "スレ \"1\"")), b.threads.map { Triple(it.boardUrl, it.key, it.title) })
        assertEquals(sites, b.sites)
    }

    // JSON は 2.0 を 2 と書くので、Int で保存すると getFloat が読めず既定の大きさに戻っていた
    @Test fun 小数の設定はきりのよい数でも小数のまま戻る() {
        val s = roundTrip(JSONObject().put("fontScale", 2f).put("lineHeight", 1.47f))
        assertEquals(2f, s["fontScale"])
        assertEquals(1.47f, s["lineHeight"])
    }

    @Test fun ほかの型はそのまま戻る() {
        val s = roundTrip(JSONObject().put("n", 3).put("on", false).put("name", "1"))
        assertEquals(3, s["n"])
        assertEquals(false, s["on"])
        assertEquals("1", s["name"])
    }

    @Test fun 知らない名前の小数も小数のまま() {
        assertEquals(1.5f, roundTrip(JSONObject().put("other", 1.5f))["other"])
    }

    @Test fun 手で足された秘密の値は戻さない() {
        val o = JSONObject().put("honoUser", "u").put("honoPassword", "p").put("imgbbApiKey", "k").put("imgurClientId", "c").put("lastBoardUrl", "l").put("postName", "n")
        assertEquals(setOf("postName"), roundTrip(o).keys)
    }

    @Test fun 読めない型は外す() {
        val s = restoredSettings(JSONObject("""{"a":null,"b":[1],"c":{"x":1},"d":"ok"}"""), emptySet())
        assertEquals(setOf("d"), s.keys)
    }

    @Test fun 整数の範囲を超える数は外す() {
        assertFalse("big" in restoredSettings(JSONObject("""{"big":9000000000}"""), emptySet()))
    }

    @Test fun 無い項目は空() {
        val b = parseBackup("""{"app":"bbs-native","version":1}""")
        assertNull(b.settings)
        assertTrue(b.boards.isEmpty() && b.threads.isEmpty() && b.sites.isEmpty())
    }

    private fun assertRefused(text: String) {
        val e = runCatching { parseBackup(text) }.exceptionOrNull()
        assertTrue("$text → $e", e is IllegalArgumentException || e is JSONException)
    }

    @Test fun 別のファイルは戻さない() {
        assertRefused("""{"settings":{"fontScale":2}}""")
        assertRefused("""{"app":"other","settings":{}}""")
        assertRefused("[]")
        assertRefused("not json")
        assertRefused("")
    }

    @Test fun 途中の行が壊れていれば全体を戻さない() {
        assertRefused("""{"app":"bbs-native","settings":{"a":1},"favoriteBoards":[{"url":"https://x.test/a/","name":"A"},{"url":"https://x.test/b/"}]}""")
        assertRefused("""{"app":"bbs-native","favoriteThreads":[{"boardUrl":"https://x.test/a/","title":"t"}]}""")
        assertRefused("""{"app":"bbs-native","sites":[1]}""")
    }
}
