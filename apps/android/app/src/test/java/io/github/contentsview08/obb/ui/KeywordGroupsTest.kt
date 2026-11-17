package io.github.contentsview08.obb.ui

import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.data.KeywordMatcher
import io.github.contentsview08.obb.data.KeywordRule
import org.junit.Assert.assertEquals
import org.junit.Test

/** スレ一覧のキーワードのまとまり(data/KeywordRule.kt の KeywordMatcher.groups。前の形の言葉の並びから作った規則で) */
class KeywordGroupsTest {
    private fun t(key: String, title: String, announcement: Boolean = false) =
        ThreadSummary("https://example.test/b/", key, title, 1, 0, null, announcement = announcement)

    private fun groups(list: List<ThreadSummary>, keywords: List<String>, authors: List<String> = emptyList()) =
        KeywordMatcher(KeywordRule.fromLegacy(keywords, authors), "https://example.test/b/").groups(list).map { (r, ts) -> r?.displayLabel() to ts.map { it.key } }

    @Test fun 全角半角とカナとかなを同じに扱う() {
        val list = listOf(t("1", "グロ注意"), t("2", "ABC スレ"), t("3", "雑談"))
        assertEquals(listOf("ｸﾞﾛ" to listOf("1"), "ＡＢＣ" to listOf("2"), null to listOf("3")), groups(list, listOf("ｸﾞﾛ", "ＡＢＣ")))
        assertEquals(listOf("ぐろ" to listOf("1"), null to listOf("2", "3")), groups(list, listOf("ぐろ")))
    }

    @Test fun 先のキーワードに当たったスレは後に数えず_当たりのないキーワードは出さない() {
        val list = listOf(t("1", "猫と犬"), t("2", "犬"), t("3", "鳥"))
        assertEquals(listOf("猫" to listOf("1"), "犬" to listOf("2"), null to listOf("3")), groups(list, listOf("猫", "犬", "魚")))
    }

    @Test fun お知らせはキーワードの帯に入れず残りの最後に置く() {
        val list = listOf(t("1", "告知 その1", announcement = true), t("2", "告知 まとめ"), t("3", "雑談"), t("4", "告知 その2"))
        assertEquals(listOf("告知" to listOf("2", "4"), null to listOf("3", "1")), groups(list, listOf("告知")))
    }

    @Test fun 立てた人のキーワードはスレタイのキーワードの後に_IDが同じスレだけ() {
        val list = listOf(
            ThreadSummary("https://example.test/b/", "1", "猫", 1, 0, null, authorId = "abcd"),
            ThreadSummary("https://example.test/b/", "2", "雑談", 1, 0, null, authorId = "abcd"),
            ThreadSummary("https://example.test/b/", "3", "雑談", 1, 0, null, authorId = "abcde"),
        )
        assertEquals(listOf("猫" to listOf("1"), "立てた人 abcd" to listOf("2"), null to listOf("3")), groups(list, listOf("猫"), listOf("abcd")))
    }
}
