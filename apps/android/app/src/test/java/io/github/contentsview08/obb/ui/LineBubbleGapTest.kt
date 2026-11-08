package io.github.contentsview08.obb.ui

import io.github.contentsview08.obb.data.POST_PAD_PX
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LineBubbleGapTest {
    @Test
    fun 既定はこれまでの吹き出しの間と同じ() {
        assertEquals(6f, lineBubbleGap(POST_PAD_PX), 0f)
    }

    @Test
    fun 余白0で吹き出しがほぼ接する() {
        assertEquals(1f, lineBubbleGap(0), 0f)
    }

    @Test
    fun 余白を増やすと吹き出しの間も増える() {
        for (pad in 0 until 40) assertTrue("$pad", lineBubbleGap(pad + 1) > lineBubbleGap(pad))
        assertEquals(44f, lineBubbleGap(40), 0f)
    }
}
