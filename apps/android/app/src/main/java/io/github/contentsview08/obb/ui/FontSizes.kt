package io.github.contentsview08.obb.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import kotlin.math.roundToInt

/** 文字の大きさの範囲(3 つで同じ)。設定は基準の大きさに掛ける倍率で持つ */
const val FONT_MIN = 8
const val FONT_MAX = 32

/** 倍率 → 文字の大きさ(1 ずつ) */
fun fontSizeOf(scale: Float, base: Int): Int = (scale * base).roundToInt().coerceIn(FONT_MIN, FONT_MAX)

/** 文字の大きさ → 倍率 */
fun scaleOf(size: Int, base: Int): Float = size.toFloat() / base

/** ピンチの途中の倍率。字の大きさは整数ずつ、範囲の中で変わる */
fun pinchedScale(start: Float, zoom: Float, base: Int): Float = scaleOf(fontSizeOf(start * zoom, base), base)

/** 端末の文字の倍率(基本の文字を掛ける前) */
val LocalDeviceFontScale = compositionLocalOf { 1f }

/** 中の字を基本の文字に連動させない(レス・スレ一覧の行・札・文字の大きさの窓) */
@Composable
fun WithoutBaseFont(content: @Composable () -> Unit) {
    val d = LocalDensity.current
    CompositionLocalProvider(LocalDensity provides Density(d.density, LocalDeviceFontScale.current), content = content)
}
