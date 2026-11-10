package io.github.contentsview08.obb.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ThinScrollbarTest {
    @Test fun 全部見えていればバーを出さない() {
        assertNull(scrollbarSpan(0, 0, 100f, 5, 1000, 0, atTop = true, atEnd = true))
        assertNull(scrollbarSpan(0, 0, 100f, 0, 1000, 0, atTop = true, atEnd = false))
    }

    @Test fun 端ではつまみも端に付ける() {
        assertEquals(0f, scrollbarSpan(0, 0, 100f, 100, 1000, 0, atTop = true, atEnd = false)!!.first, 0f)
        assertEquals(1f, scrollbarSpan(95, -20, 100f, 100, 1000, 0, atTop = false, atEnd = true)!!.first, 0f)
    }

    @Test fun 真ん中あたりは平均の高さから見積もる() {
        // 100 件 × 100px、画面 1000px。45 件目の頭が上端なら、送れる 9000px のうち 4500px
        val (pos, len) = scrollbarSpan(45, 0, 100f, 100, 1000, 0, atTop = false, atEnd = false)!!
        assertEquals(0.5f, pos, 0.001f)
        assertEquals(0.1f, len, 0.001f)
        // 項目の途中まで送っていれば、その分も足す
        assertEquals(4550f / 9000f, scrollbarSpan(45, -50, 100f, 100, 1000, 0, atTop = false, atEnd = false)!!.first, 0.001f)
    }
}
