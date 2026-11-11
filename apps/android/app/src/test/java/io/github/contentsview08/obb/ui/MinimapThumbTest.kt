package io.github.contentsview08.obb.ui

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

// ミニマップのつまみの色。PC・Web の test/minimapThumb.test.ts と同じ例(3 つで同じ決め方になっているか)
class MinimapThumbTest {
    private fun c(hex: Long) = Color(hex or 0xFF000000)
    private val darkMarks = listOf(c(0x5FC28A), c(0xEF7470), c(0x6AA9F0), c(0xA28BFF))
    private val lightMarks = listOf(c(0x24794A), c(0xC53631), c(0x2969C2), c(0x5A3CC0))

    @Test fun 差し色が印と近いテーマは青灰色() {
        // LINE ライト: 緑の差し色は画像の印(緑)と近い
        assertEquals(MinimapThumb.CALM_LIGHT, MinimapThumb.color(c(0x008C45), listOf(c(0xCC5F00), c(0xD6440F), c(0xCF2A2A)) + lightMarks + c(0x06C755), false))
        // Discord: 青紫の差し色は自分の印と近い
        assertEquals(MinimapThumb.CALM_DARK, MinimapThumb.color(c(0x5865F2), listOf(c(0xF0B232), c(0xF57731), c(0xF23F43)) + darkMarks + c(0xF23F43), true))
        // モノクロ: 灰色の差し色は灰色の人気の棒と近い
        assertEquals(MinimapThumb.CALM_DARK, MinimapThumb.color(c(0xE8E8E8), listOf(c(0xBDBDBD), c(0xD6D6D6), c(0xF0F0F0)) + darkMarks + c(0xFF6B81), true))
    }

    @Test fun 近くなければ差し色のまま() {
        assertEquals(c(0xDCDCDC), MinimapThumb.color(c(0xDCDCDC), listOf(c(0xF2C14E), c(0xF2914B), c(0xFF6B6B)) + darkMarks + c(0xFF8FA3), true))
    }

    @Test fun 青灰色はどの印とも近くない() {
        for (m in darkMarks + c(0x7C93E8) + c(0xBDBDBD)) assertFalse(MinimapThumb.near(MinimapThumb.CALM_DARK, m))
        for (m in lightMarks) assertFalse(MinimapThumb.near(MinimapThumb.CALM_LIGHT, m))
    }
}
