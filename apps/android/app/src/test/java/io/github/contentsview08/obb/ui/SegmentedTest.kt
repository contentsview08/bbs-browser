package io.github.contentsview08.obb.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SegmentedTest {
    @Test fun 等分で収まれば等分() {
        assertEquals(listOf(100f, 100f, 100f), fitSegments(listOf(40f, 90f, 60f), 300f))
    }

    @Test fun 等分で収まらなければ要る幅に余りを足す() {
        assertEquals(listOf(50f, 130f, 120f), fitSegments(listOf(40f, 120f, 110f), 300f))
    }

    @Test fun 合計でも収まらなければnull() {
        assertNull(fitSegments(listOf(150f, 160f), 300f))
    }
}
