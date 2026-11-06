package io.github.contentsview08.obb.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class BadgeCountTest {
    @Test fun 札の数字にプラスを付けない() {
        assertEquals("1", badgeCount(1))
        assertEquals("999", badgeCount(999))
        assertEquals("999+", badgeCount(1000))
    }

    @Test fun 文字の大きさは倍率と行き来でき範囲に収まる() {
        assertEquals(15, fontSizeOf(1f, 15))
        assertEquals(1f, scaleOf(15, 15), 0f)
        assertEquals(8, fontSizeOf(scaleOf(8, 12), 12))
        assertEquals(32, fontSizeOf(5f, 15))
        assertEquals(8, fontSizeOf(0.1f, 15))
    }
}
