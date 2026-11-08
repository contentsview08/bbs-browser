package io.github.contentsview08.obb.ui

import io.github.contentsview08.obb.bbs.Post
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ThreadPeekTest {
    private fun posts(vararg nos: Int) = nos.map { Post(it, "名無し", "", "", null, "本文$it") }

    @Test fun 開いたことがないスレは頭の3レス() {
        val p = peekPick(posts(1, 2, 3, 4, 5), readNo = null)
        assertEquals(PeekKind.FIRST, p.kind)
        assertEquals(listOf(1, 2, 3), p.posts.map { it.no })
    }

    @Test fun 開いたことがないスレのレスが足りなければそのまま() {
        val p = peekPick(posts(1), readNo = null)
        assertEquals(PeekKind.FIRST, p.kind)
        assertEquals(listOf(1), p.posts.map { it.no })
        assertEquals(PeekKind.FIRST, peekPick(emptyList(), null).kind)
    }

    @Test fun 新着があれば既読の次から() {
        val p = peekPick(posts(5, 3, 4, 1, 2), readNo = 3)
        assertEquals(PeekKind.NEW, p.kind)
        assertEquals(listOf(4, 5), p.posts.map { it.no })
        assertEquals(2, p.newCount)
    }

    @Test fun 新着が多ければ頭だけ出して数は全部() {
        val p = peekPick(posts(*(1..200).toList().toIntArray()), readNo = 10)
        assertEquals(PEEK_NEW_MAX, p.posts.size)
        assertEquals(11, p.posts.first().no)
        assertEquals(190, p.newCount)
    }

    @Test fun 新着がなければ最後の数レス() {
        val p = peekPick(posts(1, 2, 3, 4, 5), readNo = 5)
        assertEquals(PeekKind.LAST, p.kind)
        assertEquals(listOf(3, 4, 5), p.posts.map { it.no })
    }

    @Test fun 取りに行くか() {
        // 開いたことがない: 頭がそろっていなければ取る。レス数が分かっていて、それだけあれば取らない
        assertTrue(peekNeedsFetch(emptyList(), null, 0, false))
        assertTrue(peekNeedsFetch(posts(1), null, 10, false))
        assertFalse(peekNeedsFetch(posts(1, 2, 3), null, 10, false))
        assertFalse(peekNeedsFetch(posts(1, 2), null, 2, false))
        // 開いたことがある: 新着が手元にあれば取らない。なければ取る(dat 落ちは取らない)
        assertFalse(peekNeedsFetch(posts(1, 2, 3), 2, 3, false))
        assertTrue(peekNeedsFetch(posts(1, 2, 3), 3, 3, false))
        assertFalse(peekNeedsFetch(posts(1, 2, 3), 3, 3, true))
    }

    @Test fun 本文は頭の数行で続きは三点() {
        assertEquals("a\nb", peekBody("\n\na\nb\n\n", 4))
        assertEquals("1\n2\n3\n4…", peekBody("1\n2\n3\n4\n5", 4))
        assertEquals("1\n2\n3\n4", peekBody("1\n2\n3\n4", 4))
    }

    @Test fun 押したときの位置() {
        assertNull(peekJumpNo(PeekKind.FIRST, 1))
        assertEquals(2, peekJumpNo(PeekKind.FIRST, 2))
        assertEquals(12, peekJumpNo(PeekKind.NEW, 12))
    }
}
