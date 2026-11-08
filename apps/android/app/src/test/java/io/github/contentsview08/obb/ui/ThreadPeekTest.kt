package io.github.contentsview08.obb.ui

import io.github.contentsview08.obb.bbs.Post
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ThreadPeekTest {
    private fun posts(vararg nos: Int) = nos.map { Post(it, "名無し", "", "", null, "本文$it") }
    private fun range(n: Int) = posts(*(1..n).toList().toIntArray())

    @Test fun 開いたことがないスレは全部を並べて1番目から() {
        val p = peekPick(posts(3, 1, 2, 5, 4), readNo = null)
        assertEquals(PeekKind.FIRST, p.kind)
        assertEquals(listOf(1, 2, 3, 4, 5), p.posts.map { it.no })
        assertEquals(5, peekItemCount(p))
        assertEquals(0, peekStartIndex(p))
        assertEquals(PeekKind.FIRST, peekPick(emptyList(), null).kind)
    }

    @Test fun 新着があれば全部を並べて新着の見出しから() {
        val p = peekPick(posts(5, 3, 4, 1, 2), readNo = 3)
        assertEquals(PeekKind.NEW, p.kind)
        assertEquals(listOf(1, 2, 3, 4, 5), p.posts.map { it.no })
        assertEquals(2, p.newCount)
        assertEquals(3, p.newFrom)
        // 見出しは 4 番のレスの前(項目の 3 番目)。項目は見出しの分 1 つ多い
        assertEquals(3, peekStartIndex(p))
        assertEquals(6, peekItemCount(p))
    }

    @Test fun 新着が多くても切らない() {
        val p = peekPick(range(3000), readNo = 10)
        assertEquals(3000, p.posts.size)
        assertEquals(2990, p.newCount)
        assertEquals(11, p.posts[p.newFrom].no)
    }

    @Test fun 新着がなければ一番下() {
        val p = peekPick(range(5), readNo = 5)
        assertEquals(PeekKind.LAST, p.kind)
        assertEquals(5, p.posts.size)
        // 一番下の「新着はありません」の見出し
        assertEquals(5, peekStartIndex(p))
        assertEquals(6, peekItemCount(p))
    }

    @Test fun 同じ番号は1つにする() {
        assertEquals(listOf(1, 2), peekPick(posts(1, 2, 2), null).posts.map { it.no })
    }

    @Test fun 取りに行くか() {
        // 開いたことがない: 一覧のレス数より手元が少なければ全部を取る。分からなければ空のときだけ
        assertTrue(peekNeedsFetch(emptyList(), null, 0, false))
        assertTrue(peekNeedsFetch(range(3), null, 10, false))
        assertFalse(peekNeedsFetch(range(10), null, 10, false))
        assertFalse(peekNeedsFetch(range(3), null, 0, false))
        // 開いたことがある: 新着が手元にあれば取らない。なければ取る(dat 落ちは取らない)
        assertFalse(peekNeedsFetch(range(3), 2, 3, false))
        assertTrue(peekNeedsFetch(range(3), 3, 3, false))
        assertFalse(peekNeedsFetch(range(3), 3, 3, true))
    }

    @Test fun 本文は全文で長すぎるものだけ12行で切る() {
        assertEquals("a\nb", peekBody("\n\na\nb\n\n"))
        val long = (1..20).joinToString("\n")
        assertEquals((1..12).joinToString("\n") + "…", peekBody(long))
        val just = (1..12).joinToString("\n")
        assertEquals(just, peekBody(just))
    }

    @Test fun 押したときの位置() {
        assertNull(peekJumpNo(PeekKind.FIRST, 1))
        assertEquals(2, peekJumpNo(PeekKind.FIRST, 2))
        assertEquals(12, peekJumpNo(PeekKind.NEW, 12))
    }
}
