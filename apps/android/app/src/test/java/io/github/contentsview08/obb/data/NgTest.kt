package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.Post
import org.junit.Assert.assertEquals
import org.junit.Test

class NgTest {
    private fun post(no: Int, body: String = "本文", name: String = "名無し", id: String? = "abc") = Post(no = no, name = name, mail = "", date = "", id = id, body = body)

    @Test fun 当たっているNGを種類ごとに返す() {
        val id = NgRule("id", "abc")
        val name = NgRule("name", "名無", isRegex = false)
        val body = NgRule("body", "^本", isRegex = true)
        val other = NgRule("id", "xyz")
        val hits = NgMatcher(listOf(id, name, body, other)).postHits(post(1), null)
        assertEquals(listOf(id), hits.id)
        assertEquals(listOf(name), hits.name)
        assertEquals(listOf(body), hits.body)
    }

    @Test fun 期限切れとほかの板のNGは当たらない() {
        val expired = NgRule("id", "abc", expiresOn = "2000-01-01")
        val otherBoard = NgRule("id", "abc", boardUrl = "https://b/")
        assertEquals(emptyList<NgRule>(), NgMatcher(listOf(expired, otherBoard)).postHits(post(1), "https://a/").id)
    }

    @Test fun 今日だけのNGは今日のあいだ当たる() {
        val r = NgRule("id", "abc", expiresOn = today())
        assertEquals(listOf(r), NgMatcher(listOf(r)).postHits(post(1), null).id)
    }

    @Test fun ちょうどのNGだけ押すだけで外す側に分ける() {
        val exact = NgRule("name", "名無し")
        val part = NgRule("name", "名無")
        val re = NgRule("name", "名無し", isRegex = true)
        assertEquals(listOf(exact) to listOf(part, re), splitNgHits(listOf(exact, part, re), "名無し"))
        // 本文は値を渡さず、いつも編集を開く
        assertEquals(emptyList<NgRule>() to listOf(exact), splitNgHits(listOf(exact), null))
    }

    private val nos = (1..10).toList()

    @Test fun 二つ以上続いたあぼーんをまとめる() {
        val ng = setOf(2, 3, 4, 7)
        val r = ngRuns(nos, 0) { if (it in ng) NgRunKind.RULE else null }
        assertEquals(mapOf(2 to NgRun(listOf(2, 3, 4), 0, 3)), r.runs)
        assertEquals(mapOf(2 to 2, 3 to 2, 4 to 2), r.firstOf)
    }

    @Test fun ここから未読の所で切る() {
        val ng = setOf(2, 3, 4, 5)
        val r = ngRuns(nos, 4) { if (it in ng) NgRunKind.RULE else null }
        assertEquals(setOf(2, 4), r.runs.keys)
    }

    @Test fun 飛ばすものは数えないがまとまりは切らない() {
        val kinds = mapOf(2 to NgRunKind.RULE, 3 to NgRunKind.SKIP, 4 to NgRunKind.AI)
        val r = ngRuns(nos, 0) { kinds[it] }
        assertEquals(NgRun(listOf(2, 3, 4), 1, 1), r.runs[2])
        // 飛ばすものだけでは、まとめて出す行がない
        assertEquals(emptyMap<Int, NgRun>(), ngRuns(nos, 0) { if (it in 2..5) NgRunKind.SKIP else null }.runs)
    }
}
