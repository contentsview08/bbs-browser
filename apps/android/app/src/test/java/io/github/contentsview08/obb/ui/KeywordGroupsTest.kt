package io.github.contentsview08.obb.ui

import io.github.contentsview08.obb.bbs.ThreadSummary
import org.junit.Assert.assertEquals
import org.junit.Test

class KeywordGroupsTest {
    private fun t(key: String, title: String, announcement: Boolean = false) =
        ThreadSummary("https://example.test/b/", key, title, 1, 0, null, announcement = announcement)

    private fun shape(groups: List<Pair<String?, List<ThreadSummary>>>) = groups.map { (k, ts) -> k to ts.map { it.key } }

    @Test fun 全角半角とカナとかなを同じに扱う() {
        val list = listOf(t("1", "グロ注意"), t("2", "ABC スレ"), t("3", "雑談"))
        assertEquals(listOf("ｸﾞﾛ" to listOf("1"), "ＡＢＣ" to listOf("2"), null to listOf("3")), shape(keywordGroups(list, listOf("ｸﾞﾛ", "ＡＢＣ"))))
        assertEquals(listOf("ぐろ" to listOf("1"), null to listOf("2", "3")), shape(keywordGroups(list, listOf("ぐろ"))))
    }

    @Test fun 先のキーワードに当たったスレは後に数えず_当たりのないキーワードは出さない() {
        val list = listOf(t("1", "猫と犬"), t("2", "犬"), t("3", "鳥"))
        assertEquals(listOf("猫" to listOf("1"), "犬" to listOf("2"), null to listOf("3")), shape(keywordGroups(list, listOf("猫", "犬", "魚"))))
    }

    @Test fun お知らせはキーワードの帯に入れず残りの最後に置く() {
        val list = listOf(t("1", "告知 その1", announcement = true), t("2", "告知 まとめ"), t("3", "雑談"), t("4", "告知 その2"))
        assertEquals(listOf("告知" to listOf("2", "4"), null to listOf("3", "1")), shape(keywordGroups(list, listOf("告知"))))
    }
}
