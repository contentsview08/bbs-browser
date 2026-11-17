package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.ThreadSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** キーワード(1 つの言葉か正規表現に 1 つの帯。別名・板ごと)。PC 版の test/keywords.test.ts と同じ見本 */
class KeywordRuleTest {
    private fun thread(key: String, title: String, authorId: String? = null, board: String = "https://a/") =
        ThreadSummary(board, key, title, 10, 0, null, authorId = authorId)

    @Test fun 言葉は揺れをそろえて含むか_正規表現はそのまま_立てた人はID() {
        val rules = listOf(
            KeywordRule(id = "1", pattern = "ＡＢＣ"),
            KeywordRule(id = "2", pattern = "絵|イラスト", isRegex = true, label = "お絵描き"),
            KeywordRule(id = "3", kind = "author", pattern = "xyz"),
        )
        val m = KeywordMatcher(rules, "https://a/")
        assertEquals("1", m.hit(thread("k1", "abc の話"))?.id)
        assertEquals("2", m.hit(thread("k2", "イラスト置き場"))?.id)
        assertEquals("お絵描き", m.hit(thread("k2", "イラスト置き場"))?.displayLabel())
        assertEquals("3", m.hit(thread("k3", "無題", authorId = "xyz"))?.id)
        assertNull(m.hit(thread("k4", "無題")))
    }

    @Test fun 板限定と無効は効かない_別名がなければ言葉そのもの() {
        val rules = listOf(
            KeywordRule(id = "1", pattern = "実況", boardUrl = "https://b/"),
            KeywordRule(id = "2", pattern = "雑談", enabled = false),
            KeywordRule(id = "3", kind = "author", pattern = "id1"),
        )
        val m = KeywordMatcher(rules, "https://a/")
        assertNull(m.hit(thread("k1", "実況スレ")))
        assertNull(m.hit(thread("k2", "雑談スレ")))
        assertEquals("立てた人 id1", rules[2].displayLabel())
        assertEquals("実況", rules[0].displayLabel())
        assertTrue(KeywordMatcher(rules, "https://b/").hit(thread("k1", "実況スレ", board = "https://b/")) != null)
    }

    @Test fun まとまりは先の規則が勝ち_残りと運営のお知らせは最後() {
        val rules = listOf(KeywordRule(id = "1", pattern = "A"), KeywordRule(id = "2", pattern = "B"))
        val list = listOf(thread("1", "A と B"), thread("2", "B だけ"), thread("3", "ほか"), thread("4", "【運営】お知らせ A").copy(announcement = true))
        val g = KeywordMatcher(rules, null).groups(list)
        assertEquals(listOf("1", "2", null), g.map { it.first?.id })
        assertEquals(listOf("1"), g[0].second.map { it.key })
        assertEquals(listOf("2"), g[1].second.map { it.key })
        assertEquals(listOf("3", "4"), g[2].second.map { it.key })
    }

    @Test fun 前の形から写す_JSONの往復() {
        val legacy = KeywordRule.fromLegacy(listOf("実況", " ", "実況", "雑談"), listOf("id1"), now = 1000)
        assertEquals(listOf("実況", "雑談", "id1"), legacy.map { it.pattern })
        assertEquals(listOf("title", "title", "author"), legacy.map { it.kind })
        val json = KeywordRule.listToJson(legacy)
        assertEquals(legacy, KeywordRule.listFromJson(json))
        // 読めない正規表現は当たらないだけで落ちない
        assertNull(KeywordMatcher(listOf(KeywordRule(pattern = "(", isRegex = true)), null).hit(thread("k", "(")))
    }
}
