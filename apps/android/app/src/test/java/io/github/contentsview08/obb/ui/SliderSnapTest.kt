package io.github.contentsview08.obb.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class SliderSnapTest {
    @Test fun 目盛りの少し下や上の値でも同じ目盛りになる() {
        for (n in 16..28) {
            val tick = n / 20f
            assertEquals(tick, snapTo(Math.nextDown(tick), 20), 0f)
            assertEquals(tick, snapTo(Math.nextUp(tick), 20), 0f)
        }
    }

    @Test fun 整数の目盛りも切り捨てない() {
        assertEquals(64, snapInt(63.99999f, 8))
        assertEquals(176, snapInt(175.99998f, 8))
        assertEquals(7, snapInt(6.9999995f))
    }

    @Test fun パーセントは105をずらさない() {
        for (n in 80..140 step 5) assertEquals(n, percent(n / 100f))
        assertEquals(105, percent(1.05f))
    }
}
