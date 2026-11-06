package io.github.contentsview08.obb.bbs

import org.junit.Assert.assertEquals
import org.junit.Test

class PostLimitTest {
    private val setting = mapOf(
        "BBS_MESSAGE_COUNT" to "10", "BBS_LINE_NUMBER" to "1", "BBS_NAME_COUNT" to "4", "BBS_MAIL_COUNT" to "3", "BBS_SUBJECT_COUNT" to "5",
    )
    private fun over(body: String = "a", name: String = "", mail: String = "", subject: String? = null) =
        postLimitOver(postLimitsOf(setting), { it.length }, body, name, mail, subject)

    @Test fun reads_all_limits() {
        assertEquals(PostLimits(10, 2, 4, 3, 5), postLimitsOf(setting))
        assertEquals(PostLimits(lines = 7), postLimitsOf(mapOf("BBS_LINE_NUMBER" to "1", TwoCh.MAX_LINES_KEY to "7")))
    }

    @Test fun within_limits() = assertEquals(emptyList<String>(), over("a\nb", "abcd", "abc", "abcde"))

    @Test fun name_mail_subject_over() {
        assertEquals(listOf("名前が長すぎます(5 / 4 バイト)"), over(name = "abcde"))
        assertEquals(listOf("メールが長すぎます(4 / 3 バイト)"), over(mail = "abcd"))
        assertEquals(listOf("スレタイが長すぎます(6 / 5 バイト)"), over(subject = "abcdef"))
    }

    @Test fun body_over() {
        assertEquals(listOf("本文が長すぎます(11 / 10 バイト)"), over("a".repeat(11)))
        assertEquals(listOf("本文の行が多すぎます(3 / 2 行)"), over("a\nb\nc"))
    }

    @Test fun no_limits_no_error() = assertEquals(emptyList<String>(), postLimitOver(PostLimits(), { it.length }, "a".repeat(100), "a".repeat(100), "a"))
}
