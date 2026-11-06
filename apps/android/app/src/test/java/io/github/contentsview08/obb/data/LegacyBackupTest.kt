package io.github.contentsview08.obb.data

import org.json.JSONException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LegacyBackupTest {
    private fun read(settings: JSONObject): JSONObject =
        parseBackup(JSONObject().put("app", "bbs-native").put("version", 1).put("settings", settings).toString(2)).settings!!

    @Test fun 古い印のファイルが読める() {
        val b = parseBackup(
            """{"app":"bbs-native","version":1,
               "favoriteBoards":[{"url":"https://x.test/a/","name":"A"}],
               "favoriteThreads":[{"boardUrl":"https://x.test/a/","key":"1","title":"t"}],
               "sites":[{"url":"https://x.test/bbsmenu.json","name":"s"}]}""",
        )
        assertEquals("A", b.boards.single().name)
        assertEquals("t", b.threads.single().title)
        assertEquals("s", b.sites.single().second)
    }

    @Test fun 文字はpxに直す() {
        val s = read(JSONObject().put("baseFontSplit", true).put("fontScale", 1.2f).put("bodyScale", 18f / 15).put("postHeadScale", 1f).put("listFontScale", 20f / 15).put("barFontScale", 1.5f))
        assertEquals(16.8, s.getDouble("mobileFontPx"), 0.001)
        assertEquals(18, s.getInt("postBodyPx"))
        assertFalse(s.has("postHeadPx"))
        assertEquals(20, s.getInt("listFontPx"))
        assertEquals(25.2, s.getDouble("barFontPx"), 0.001)
        assertFalse(s.has("fontScale") || s.has("bodyScale") || s.has("baseFontSplit"))
    }

    @Test fun 分ける前のファイルは基本の文字を本文などへ掛ける() {
        val s = read(JSONObject().put("fontScale", 1.2f).put("bodyScale", 1f))
        assertEquals(18, s.getInt("postBodyPx"))
        assertEquals(14, s.getInt("postHeadPx"))
        assertEquals(18, s.getInt("listFontPx"))
    }

    @Test fun 既定の大きさは決めていない値にする() {
        val s = read(JSONObject().put("baseFontSplit", true).put("lineHeight", POST_LINE_HEIGHT).put("postPad", 8).put("listPad", 0).put("headerHeight", 54).put("footerHeight", 60))
        assertFalse(s.has("postLineHeight"))
        assertEquals(-1, s.getInt("postPadPx"))
        assertEquals(0, s.getInt("listPadPx"))
        assertEquals(0, s.getInt("headerPx"))
        assertEquals(60, s.getInt("footerPx"))
    }

    @Test fun 名前と値をPCの形に直す() {
        val s = read(
            JSONObject().put("baseFontSplit", true).put("followSystem", false).put("listDensity", "compact").put("collapseBlankLines", false)
                .put("thumbSize", 120).put("showRefreshButton", false).put("ngStyle", "fold").put("font", "mplus-1p").put("thumbMode", "WIFI")
                .put("keywords", "a\n\nb\n").put("grossWords", "グロ").put("quickPhrases", "x").put("listTabs", "unread,count").put("presetsApplied", "p1,p2")
                .put("notifyFav", false).put("gesturesList", """{"right":"top"}""").put("boardMeta", """{"u":{"alias":"x"}}""").put("postName", "n"),
        )
        assertEquals(false, s.getBoolean("followOsTheme"))
        assertEquals("compact", s.getString("listShape"))
        assertEquals(false, s.getBoolean("tidyBlankLines"))
        assertEquals(120, s.getInt("postThumbSize"))
        assertEquals(false, s.getBoolean("showRefreshFab"))
        assertEquals("aborn", s.getString("ngMode"))
        assertEquals("m-plus-1p", s.getString("fontFamily"))
        assertEquals("wifi", s.getString("thumbLoad"))
        assertEquals(listOf("a", "b"), s.getJSONArray("keywords").let { a -> List(a.length()) { a.getString(it) } })
        assertEquals("count", s.getJSONArray("listTabs").getString(1))
        assertEquals(false, s.getJSONObject("notifyKinds").getBoolean("fav"))
        assertEquals(true, s.getJSONObject("notifyKinds").getBoolean("reply"))
        assertEquals("top", s.getJSONObject("swipeGestures").getJSONObject("list").getString("right"))
        assertEquals("x", s.getJSONObject("boardMeta").getJSONObject("u").getString("alias"))
        assertEquals("n", s.getString("postName"))
        for (k in listOf("followSystem", "ngStyle", "font", "thumbMode", "notifyFav", "gesturesList")) assertFalse(k, s.has(k))
    }

    @Test fun 今は無い値を読み替える() {
        val s = read(
            JSONObject().put("baseFontSplit", true).put("postStyle", "timeline").put("scheme", "sepia").put("darkScheme", "night").put("lightScheme", "light-gray")
                .put("heatStyle", "none").put("uploadHost", "0x0").put("idHeat", true).put("showThumbnails", true).put("thumbMode", "NEVER").put("sendDelay", 3),
        )
        assertEquals("discord", s.getString("postStyle"))
        assertEquals("light-gray", s.getString("scheme"))
        assertEquals("soft-dark", s.getString("darkScheme"))
        assertEquals("light-gray", s.getString("lightScheme"))
        assertEquals("left", s.getString("heatStyle"))
        assertEquals(Uploader.DEFAULT_HOST, s.getString("uploadHost"))
        assertEquals("color", s.getString("idStyle"))
        assertEquals("tap", s.getString("thumbLoad"))
        assertFalse(s.has("sendDelay") || s.has("idHeat") || s.has("showThumbnails"))
    }

    @Test fun NGはPCの項目名になり読み直せる() {
        val ng = """[{"target":"body","pattern":"a","isRegex":true,"enabled":false,"expiresOn":"2030-01-02","boardUrl":"https://x.test/a/","id":"i","createdAt":5},
                     {"target":"name","pattern":"b"},{"target":"id","pattern":"c"},{"target":"title","pattern":"d"}]"""
        val rules = read(JSONObject().put("ngRules", ng)).getJSONArray("ngRules").let { a -> List(a.length()) { NgRule.fromJson(a.getJSONObject(it)) } }
        assertEquals(listOf("content", "posterName", "posterId", "threadTitle"), rules.map { it.target })
        assertEquals("2030-01-02", rules[0].expiresOnDate)
        assertEquals("i", rules[0].id)
        assertEquals(5L, rules[0].createdAt)
        assertFalse(rules[0].enabled)
        assertTrue(rules[0].isRegex)
        assertFalse(rules[0].toJson().has("expiresOn"))
    }

    @Test fun 上げた画像は設定から履歴へ移す() {
        val ups = """[{"url":"https://i.test/a.png","t":10,"h":"ab","d":"https://i.test/del"},{"url":"https://i.test/b.png","t":9,"h":"","d":""}]"""
        val b = parseBackup(JSONObject().put("app", "bbs-native").put("settings", JSONObject().put("uploads", ups)).toString())
        assertEquals(listOf("a.png", "b.png"), b.uploads.map { it.name })
        assertEquals(10L, b.uploads[0].uploadedAt)
        assertEquals("ab", b.uploads[0].hash)
        assertEquals("https://i.test/del", b.uploads[0].deleteUrl)
        assertNull(b.uploads[1].hash)
        assertFalse(b.settings!!.has("uploads"))
    }

    @Test fun 読み直した値は保存する型になる() {
        val s = restoredSettings(read(JSONObject().put("baseFontSplit", true).put("fontScale", 1.2f).put("keywords", "a").put("bodyScale", 1.2f)), setOf("mobileFontPx"))
        assertEquals(16.8f, s["mobileFontPx"] as Float, 0.001f)
        assertEquals(18, s["postBodyPx"])
        assertEquals("""["a"]""", s["keywords"])
    }

    @Test fun 手で足された秘密の値は戻さない() {
        val s = restoredSettings(read(JSONObject().put("baseFontSplit", true).put("honoPassword", "p").put("imgbbApiKey", "k").put("postName", "n")), emptySet())
        assertEquals(setOf("postName"), s.keys)
    }

    @Test fun 壊れた行があれば全体を戻さない() {
        for (t in listOf(
            """{"app":"bbs-native","settings":{"ngRules":"[{\"pattern\":\"a\"}]"}}""",
            """{"app":"bbs-native","settings":{"ngRules":"not json"}}""",
            """{"app":"bbs-native","settings":{"uploads":"[{\"t\":1}]"}}""",
            """{"app":"bbs-native","sites":[1]}""",
        )) {
            val e = runCatching { parseBackup(t) }.exceptionOrNull()
            assertTrue("$t -> $e", e is JSONException || e is IllegalArgumentException)
        }
    }
}
