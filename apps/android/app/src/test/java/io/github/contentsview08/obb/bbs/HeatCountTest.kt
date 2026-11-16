package io.github.contentsview08.obb.bbs

import org.junit.Assert.assertEquals
import org.junit.Test

/** 人気の判定に使う被アンカー数(PostIndex.heatCount)。PC 版の countHeat と同じ決まり(test/heatCount.test.ts) */
class HeatCountTest {
    private fun post(no: Int, body: String, id: String? = null, name: String = "名無し") = Post(no, name, "", "", id, body)

    @Test
    fun sameIdCountsOnce() {
        val index = PostIndex.build(listOf(post(1, "元", "AAA"), post(2, ">>1", "BBB"), post(3, ">>1 また", "BBB"), post(4, ">>1 さらに", "BBB")))
        assertEquals(3, index.replyCount[1])
        assertEquals(1, index.heatCount[1])
    }

    @Test
    fun selfAnchorNotCounted() {
        val index = PostIndex.build(listOf(post(1, "元", "AAA"), post(2, ">>1 自分で補足", "AAA"), post(3, ">>1", "BBB"), post(4, ">>1", "CCC")))
        assertEquals(3, index.replyCount[1])
        assertEquals(2, index.heatCount[1])
    }

    @Test
    fun watchoiWhenNoId() {
        fun w(no: Int, body: String, w: String) = post(no, body, null, "名無し (ワッチョイ $w)")
        val index = PostIndex.build(listOf(w(1, "元", "1a2b-3c4d"), w(2, ">>1", "1a2b-3c4d"), w(3, ">>1", "ffff-0000"), w(4, ">>1", "ffff-0000")))
        assertEquals(1, index.heatCount[1])
    }

    @Test
    fun anonymousCountedEach() {
        val index = PostIndex.build(listOf(post(1, "元"), post(2, ">>1"), post(3, ">>1"), post(4, ">>1")))
        assertEquals(3, index.heatCount[1])
        assertEquals(true, index.matches(index.posts[0], Filter.POPULAR))
    }
}
