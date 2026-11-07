package io.github.contentsview08.obb.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class PastTabsTest {
    private val all = PAST_TABS.map { it.first }

    @Test fun 保存した並びのまま出す() = assertEquals(listOf("fav", "unread"), shownPastTabs("fav,unread"))

    @Test fun 知らないキーと重なりは外す() = assertEquals(listOf("posts", "history"), shownPastTabs("posts,zzz,history,posts"))

    // バックアップを手で書き換えても、履歴の画面からタブが消えない
    @Test fun 一つも残らなければ全部を出す() {
        assertEquals(all, shownPastTabs(""))
        assertEquals(all, shownPastTabs("zzz"))
    }

    @Test fun 板の設定のファビコンを読み書きする() {
        val m = BoardMeta(defaultName = "名前", icon = "https://example.com/a.png")
        val json = m.toJson()
        assertEquals("https://example.com/a.png", json.getString("icon"))
        assertEquals(m, BoardMeta.fromJson(JSONObject(json.toString())))
    }

    @Test fun バックアップでは配列のまま書いて戻せる() {
        val all = mapOf("pastTabs" to """["fav","unread"]""", "pastTabsPosition" to "footer")
        val file = exportedSettings(all, all.keys)
        assertEquals("fav", file.getJSONArray("pastTabs").getString(0))
        assertEquals("footer", file.getString("pastTabsPosition"))
        val back = restoredSettings(JSONObject(file.toString()), emptySet())
        assertEquals("""["fav","unread"]""", back["pastTabs"])
        assertEquals("footer", back["pastTabsPosition"])
    }

    @Test fun ファビコンだけでも空ではない() = assertEquals(false, BoardMeta(icon = "https://example.com/a.png").isEmpty)
}
