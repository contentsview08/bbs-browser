package io.github.contentsview08.obb.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class FontSizesTest {
    @Test fun ピンチは範囲の中で止まる() {
        assertEquals(8, fontSizeOf(pinchedScale(1f, 0.01f, 15), 15))
        assertEquals(32, fontSizeOf(pinchedScale(1f, 100f, 15), 15))
    }

    @Test fun ピンチの字は整数ずつ変わる() {
        assertEquals(20f / 15, pinchedScale(1f, 1.33f, 15), 0.0001f)
        assertEquals(1f, pinchedScale(1f, 1.02f, 15), 0.0001f)
    }
}
