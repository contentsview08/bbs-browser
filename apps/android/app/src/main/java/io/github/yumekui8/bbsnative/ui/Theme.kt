package io.github.yumekui8.bbsnative.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// 配色は専ブラの「インディゴ」に合わせる(暗い背景、青紫の差し色、未読・自分は青)
object Palette {
    val base = Color(0xFF0F1115)
    val surface = Color(0xFF161920)
    val surface2 = Color(0xFF1E222B)
    val border = Color(0xFF262B36)
    val textStrong = Color(0xFFE8EAF0)
    val textBody = Color(0xFFC9CDD8)
    val textMuted = Color(0xFF7D8494)
    val accent = Color(0xFF8B8FFF)
    val unread = Color(0xFF5B8DEF)
    val posterName = Color(0xFF5FB98A)
    val link = Color(0xFF6FA8FF)
    val heatWarm = Color(0xFFE8B04B)
    val heatHot = Color(0xFFF07A3C)
    val heatVeryHot = Color(0xFFEF4F4F)
}

@Composable
fun BbsTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.accent,
            onPrimary = Color(0xFF0F1115),
            background = Palette.base,
            onBackground = Palette.textBody,
            surface = Palette.surface,
            onSurface = Palette.textBody,
            surfaceVariant = Palette.surface2,
            onSurfaceVariant = Palette.textMuted,
            outline = Palette.border,
            secondaryContainer = Palette.surface2,
            onSecondaryContainer = Palette.textStrong,
        ),
        content = content,
    )
}
