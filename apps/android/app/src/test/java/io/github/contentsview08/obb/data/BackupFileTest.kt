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
    private val floats = setOf("mobileFontPx", "postLineHeight")

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

    // JSON は 2.0 を 2 と書くので、Int で保存すると getFloat が読めず既定の大きさに戻る
    @Test fun 小数の設定はきりのよい数でも小数のまま戻る() {
        val s = roundTrip(JSONObject().put("mobileFontPx", 16f).put("postLineHeight", 1.47f))
        assertEquals(16f, s["mobileFontPx"])
        assertEquals(1.47f, s["postLineHeight"])
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
        val b = parseBackup("""{"app":"OBB","version":1}""")
        assertNull(b.settings)
        assertTrue(b.boards.isEmpty() && b.threads.isEmpty() && b.sites.isEmpty() && b.uploads.isEmpty())
    }

    private fun assertRefused(text: String) {
        val e = runCatching { parseBackup(text) }.exceptionOrNull()
        assertTrue("$text → $e", e is IllegalArgumentException || e is JSONException)
    }

    @Test fun 別のファイルは戻さない() {
        assertRefused("""{"settings":{"mobileFontPx":2}}""")
        assertRefused("""{"app":"other","settings":{}}""")
        assertRefused("[]")
        assertRefused("not json")
        assertRefused("")
    }

    @Test fun 途中の行が壊れていれば全体を戻さない() {
        assertRefused("""{"app":"OBB","settings":{"a":1},"favoriteBoards":[{"url":"https://x.test/a/","name":"A"},{"url":"https://x.test/b/"}]}""")
        assertRefused("""{"app":"OBB","favoriteThreads":[{"boardUrl":"https://x.test/a/","title":"t"}]}""")
        assertRefused("""{"app":"OBB","sites":[1]}""")
    }

    @Test fun 新しい版のファイルは戻さない() {
        assertRefused("""{"app":"OBB","version":2,"settings":{}}""")
    }

    @Test fun 読めないNGがあれば全体を戻さない() {
        assertRefused("""{"app":"OBB","settings":{"ngRules":[{"target":"content"}]}}""")
    }

    @Test fun 印はOBBで上げた画像の履歴も戻る() {
        val u = UploadRecord("https://i.test/a.png", "a.png", 12, 1700000000000, true, "ab", "https://i.test/del")
        val u2 = UploadRecord("https://i.test/b.png", "b.png", 0, 1700000000001)
        val o = backupJson(JSONObject(), emptyList(), emptyList(), emptyList(), listOf(u, u2))
        assertEquals("OBB", o.getString("app"))
        // 削除ページの URL は秘密なので書き出さない。ほかは戻る
        assertFalse(o.toString().contains("i.test/del"))
        assertEquals(listOf(u.copy(deleteUrl = null), u2), parseBackup(o.toString(2)).uploads)
    }

    @Test fun 手で書かれた削除ページのURLは読める() {
        val b = parseBackup("""{"app":"OBB","uploads":[{"url":"https://i.test/a.png","uploadedAt":1,"deleteUrl":"https://i.test/del"}]}""")
        assertEquals("https://i.test/del", b.uploads[0].deleteUrl)
    }

    @Test fun 端末だけの状態と書きかけは書き出さず読み戻さない() {
        val all = mapOf("boardVisits" to "{\"u\":1}", "recentBoards" to "[]", "newThreadDrafts" to "{}", "postName" to "n")
        assertEquals(setOf("postName"), exportedSettings(all, all.keys).keys().asSequence().toSet())
        assertEquals(setOf("postName"), roundTrip(JSONObject().put("boardVisits", JSONObject().put("u", 1)).put("recentBoards", org.json.JSONArray()).put("newThreadDrafts", JSONObject()).put("postName", "n")).keys)
    }

    @Test fun 扱えないURLの板とスレとサイトは外して数える() {
        val b = parseBackup(
            """{"app":"OBB",
               "favoriteBoards":[{"url":"https://x.test/a/","name":"A"},{"url":"http://192.168.1.1/a/","name":"家"},{"url":"https://x.test/not-a-board","name":"形"},{"url":"https://may.2chan.net/b/","name":"ふたば"}],
               "favoriteThreads":[{"boardUrl":"https://x.test/a/","key":"1","title":"t"},{"boardUrl":"http://localhost/a/","key":"2","title":"t2"}],
               "sites":[{"url":"https://x.test/bbsmenu.json","name":"s"},{"url":"http://router.local/menu.json","name":"家"}]}""",
        )
        assertEquals(listOf("https://x.test/a/"), b.boards.map { it.url })
        assertEquals(listOf("1"), b.threads.map { it.key })
        assertEquals(listOf("https://x.test/bbsmenu.json"), b.sites.map { it.first })
        assertEquals(5, b.dropped)
    }

    @Test fun 板のURLは同期と同じく5chioにそろえる() {
        val b = parseBackup("""{"app":"OBB","favoriteBoards":[{"url":"https://mi.5ch.net/news4vip/","name":"A"}]}""")
        assertEquals(listOf("https://mi.5ch.io/news4vip/"), b.boards.map { it.url })
        assertEquals(0, b.dropped)
    }

    @Test fun JSONの項目はPCのファイルと同じくJSONのまま書いて文字列に戻す() {
        val ng = """[{"id":"1","target":"posterId","pattern":"abc","isRegex":false,"enabled":true,"expiresOnDate":"2030-01-01"}]"""
        val out = exportedSettings(mapOf("ngRules" to ng, "keywords" to "[\"a\"]", "swipeGestures" to "", "mobileFontPx" to 16f), setOf("ngRules", "keywords", "swipeGestures", "mobileFontPx"))
        assertEquals("abc", out.getJSONArray("ngRules").getJSONObject(0).getString("pattern"))
        assertEquals("a", out.getJSONArray("keywords").getString(0))
        assertFalse(out.has("swipeGestures"))
        val s = roundTrip(out)
        assertEquals("abc", org.json.JSONArray(s["ngRules"] as String).getJSONObject(0).getString("pattern"))
        assertEquals("[\"a\"]", s["keywords"])
        assertEquals(16f, s["mobileFontPx"])
    }

    @Test fun 書き出しは今ある項目だけで秘密の値を入れない() {
        val all = mapOf("honoPassword" to "p", "imgbbApiKey" to "k", "fontScale" to 1.2f, "postName" to "n")
        val out = exportedSettings(all, setOf("honoPassword", "imgbbApiKey", "postName"))
        assertEquals(setOf("postName"), out.keys().asSequence().toSet())
    }

    @Test fun 知らない項目の配列は戻さず知っている項目の配列は戻す() {
        val s = restoredSettings(JSONObject("""{"other":[1],"listTabs":["unread"],"boardMeta":{"u":{"alias":"a"}}}"""), emptySet())
        assertEquals(mapOf("listTabs" to """["unread"]""", "boardMeta" to """{"u":{"alias":"a"}}"""), s)
    }
}
