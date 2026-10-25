package io.github.yumekui8.bbsnative.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// 配色は今の専ブラの「インディゴ」(apps/desktop/src/theme/theme.css の [data-scheme="indigo"] と app.css の暗い配色)と同じ値
object Palette {
    val base = Color(0xFF0C0E13)
    /** 上下の帯(ヘッダー・フッター) */
    val bar = Color(0xFF12151B)
    val surface = Color(0xFF12151B)
    val surface2 = Color(0xFF191D26)
    val surface3 = Color(0xFF212633)
    val border = Color(0xFF242933)
    val borderStrong = Color(0xFF333A47)
    val textStrong = Color(0xFFEEF0F5)
    val textBody = Color(0xFFC7CBD6)
    val textMuted = Color(0xFF656B7A)
    val accent = Color(0xFF7566E6)
    val accentWash = Color(0x247566E6)
    /** 未読(「ここから未読」・未読の数) */
    val unread = Color(0xFFE0729A)
    val unreadText = Color(0xFF2B0A17)
    /** 自分の書き込み */
    val own = Color(0xFF3EC7A0)
    val ownWash = Color(0x293EC7A0)
    /** スレ主 */
    val op = Color(0xFFF0B44C)
    val opWash = Color(0x29F0B44C)
    val link = Color(0xFF57A6FF)
    val posterName = Color(0xFF3F9D84)
    val threadReadTitle = Color(0xFFCFE2FF)
    val heatWarm = Color(0xFFF2B84B)
    val heatHot = Color(0xFFF2914B)
    val heatVeryHot = Color(0xFFEF5350)
    // 意味の色(差し色)
    val markFav = Color(0xFFF2C14E)
    val markDanger = Color(0xFFEF7470)
    val markNew = Color(0xFF5FC28A)
    val markVideo = Color(0xFFEF7470)
    val markImage = Color(0xFF5FC28A)
    val markHot = Color(0xFFF0954A)
    val markLink = Color(0xFF6AA9F0)
    val markPurple = Color(0xFFB48CF0)

    /** 書き込み数・被アンカー数の色(今の専ブラの heatClass と同じ段階)。null なら色を付けない */
    fun heat(count: Int): Color? = when {
        count >= 7 -> heatVeryHot
        count >= 5 -> heatHot
        count >= 3 -> heatWarm
        else -> null
    }
}

@Composable
fun BbsTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.accent,
            onPrimary = Color(0xFFF5F3FF),
            background = Palette.base,
            onBackground = Palette.textBody,
            surface = Palette.surface,
            onSurface = Palette.textBody,
            surfaceVariant = Palette.surface2,
            onSurfaceVariant = Palette.textMuted,
            surfaceContainerLow = Palette.surface,
            surfaceContainer = Palette.surface,
            surfaceContainerHigh = Palette.surface2,
            outline = Palette.border,
            outlineVariant = Palette.border,
            secondaryContainer = Palette.accentWash,
            onSecondaryContainer = Palette.textStrong,
        ),
        content = content,
    )
}
