package io.github.yumekui8.bbsnative.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * 配色 1 つ分。値は今の専ブラ(apps/desktop/src/theme/theme.css と app.css の [data-scheme])と同じ。
 * unread は --c-accent-self(未読・「ここから未読」)
 */
class Scheme(
    val key: String, val name: String, val dark: Boolean,
    val base: Color, val bar: Color, val surface: Color, val surface2: Color, val surface3: Color,
    val border: Color, val borderStrong: Color,
    val textStrong: Color, val textBody: Color, val textMuted: Color,
    val accent: Color, val accentText: Color, val accentWash: Color,
    val unread: Color, val unreadText: Color,
    val link: Color, val posterName: Color, val threadReadTitle: Color,
    val heatWarm: Color, val heatHot: Color, val heatVeryHot: Color,
)

private fun c(hex: Long) = Color(hex or 0xFF000000)
private fun wash(hex: Long, a: Float) = c(hex).copy(alpha = a)

/** 選べる配色(今のスマホ版の PICKABLE_SCHEMES と同じ並び。2ch クラシックはスマホでは出さない) */
val SCHEMES = listOf(
    Scheme(
        "indigo", "インディゴ", true,
        c(0x0C0E13), c(0x12151B), c(0x12151B), c(0x191D26), c(0x212633), c(0x242933), c(0x333A47),
        c(0xEEF0F5), c(0xC7CBD6), c(0x656B7A), c(0x7566E6), c(0xF5F3FF), wash(0x7566E6, 0.14f),
        c(0xE0729A), c(0x2B0A17), c(0x57A6FF), c(0x3F9D84), c(0xCFE2FF), c(0xF2B84B), c(0xF2914B), c(0xEF5350),
    ),
    Scheme(
        "amber-teal", "アンバー×ティール", true,
        c(0x14171F), c(0x171B26), c(0x171B26), c(0x1E2433), c(0x262E40), c(0x2A3247), c(0x3A4560),
        c(0xF2ECE2), c(0xD7D2C8), c(0x9A9488), c(0xE0993F), c(0x2B1804), wash(0xE0993F, 0.16f),
        c(0x7C93E8), c(0x0D1430), c(0x5EB8FF), c(0x4A9583), c(0xCFE2FF), c(0xE0993F), c(0xE2506E), c(0xC23B3B),
    ),
    Scheme(
        "soft-dark", "ダーク", true,
        c(0x1B1D22), c(0x202329), c(0x202329), c(0x262A31), c(0x2E333B), c(0x343A44), c(0x434A56),
        c(0xD4D7DD), c(0xB4B9C2), c(0x7D8491), c(0x8B93D9), c(0x15172A), wash(0x8B93D9, 0.14f),
        c(0xD08AA3), c(0x2B0A17), c(0x7FB0E8), c(0x5F9C8A), c(0xA9C4E8), c(0xD9B062), c(0xD9925F), c(0xD96A66),
    ),
    Scheme(
        "soft-light", "ライト", false,
        c(0xF0EDE8), c(0xE3E7EC), c(0xF7F5F1), c(0xE9E6E0), c(0xDFDBD4), c(0xD2CDC5), c(0xB8B2A8),
        c(0x2E2C29), c(0x45423D), c(0x85817A), c(0x4F6F8F), c(0xFFFFFF), wash(0x4F6F8F, 0.10f),
        c(0x2F74C0), c(0xFFFFFF), c(0x3A6AA8), c(0x5F8F7D), c(0x3A5F96), c(0xB57A2A), c(0xBB6236), c(0xB04242),
    ),
    Scheme(
        "discord-dark", "Discord ダーク", true,
        c(0x1A1A1E), c(0x1A1A1E), c(0x202024), c(0x242429), c(0x2C2C30), c(0x29292D), c(0x3B3B41),
        c(0xFBFBFB), c(0xE3E3E6), c(0x81828A), c(0x5865F2), c(0xFFFFFF), wash(0x5865F2, 0.22f),
        c(0xF23F43), c(0xFFFFFF), c(0x4D96EE), c(0xA9BBFF), c(0x81828A), c(0xF0B232), c(0xF57731), c(0xF23F43),
    ),
    Scheme(
        "line-light", "LINE ライト", false,
        c(0xF5F6F8), c(0xFFFFFF), c(0xFFFFFF), c(0xEEF0F3), c(0xE4E7EC), c(0xDFE2E7), c(0xC5CAD3),
        c(0x111111), c(0x2B2B2B), c(0x8B8F97), c(0x00A650), c(0xFFFFFF), wash(0x06C755, 0.12f),
        c(0x06C755), c(0xFFFFFF), c(0x2A62C9), c(0x2E8B57), c(0x5B6472), c(0xC98A12), c(0xD9622B), c(0xD33A3A),
    ),
    // グレー: ネズミ色の中くらいの灰色の地に、白に近い字。色みはほとんど持たせず、未読の印だけはっきりさせる
    Scheme(
        "gray", "グレー", true,
        c(0x55575B), c(0x4A4C50), c(0x606266), c(0x6A6C70), c(0x75777B), c(0x6E7074), c(0x84868A),
        c(0xF5F5F6), c(0xE6E6E8), c(0xB9BBBF), c(0xE4E8EE), c(0x1E2125), wash(0xFFFFFF, 0.14f),
        c(0xFF9DAE), c(0x2A0B12), c(0xC6DDFF), c(0xC3E6D4), c(0xD7DEE8), c(0xFFD27A), c(0xFFB077), c(0xFF8A85),
    ),
    Scheme(
        "light-gray", "ライトグレー", false,
        c(0xECECEC), c(0xE2E2E3), c(0xF6F6F6), c(0xE4E4E5), c(0xD9D9DB), c(0xD2D2D4), c(0xB4B5B8),
        c(0x222222), c(0x3E3E40), c(0x7E7F83), c(0x4E5A68), c(0xFFFFFF), wash(0x4E5A68, 0.10f),
        c(0xC4473F), c(0xFFFFFF), c(0x2F64A8), c(0x4F7F6D), c(0x3B5576), c(0xA8721E), c(0xB25A2E), c(0xA83A3A),
    ),
    Scheme(
        "oled", "真っ黒", true,
        c(0x000000), c(0x0A0A0A), c(0x0A0A0A), c(0x141414), c(0x1C1C1C), c(0x222222), c(0x333333),
        c(0xE8E8E8), c(0xC8C8C8), c(0x7A7A7A), c(0x7AA2FF), c(0x000814), wash(0x7AA2FF, 0.14f),
        c(0xFF7A9C), c(0x200008), c(0x7FB0FF), c(0x5F9C8A), c(0x8FA8D0), c(0xD9B062), c(0xD9925F), c(0xD96A66),
    ),
)

fun schemeOf(key: String) = SCHEMES.firstOrNull { it.key == key } ?: SCHEMES[0]

/**
 * 画面の色。いまの配色(scheme)から読む。配色を変えると、色を読んでいる所がすべて描き直される
 * (組み立て済みのレスの文字列は、ViewModel が組み立て直す)
 */
object Palette {
    var scheme by mutableStateOf(SCHEMES[0])
    val dark get() = scheme.dark

    val base get() = scheme.base
    /** 上下の帯(ヘッダー・フッター) */
    val bar get() = scheme.bar
    val surface get() = scheme.surface
    val surface2 get() = scheme.surface2
    val surface3 get() = scheme.surface3
    val border get() = scheme.border
    val borderStrong get() = scheme.borderStrong
    val textStrong get() = scheme.textStrong
    val textBody get() = scheme.textBody
    val textMuted get() = scheme.textMuted
    val accent get() = scheme.accent
    val accentText get() = scheme.accentText
    val accentWash get() = scheme.accentWash
    /** 未読(「ここから未読」・未読の数) */
    val unread get() = scheme.unread
    val unreadText get() = scheme.unreadText
    /** 自分の書き込み */
    val own get() = if (scheme.dark) Color(0xFF3EC7A0) else Color(0xFF1F9A78)
    val ownWash get() = own.copy(alpha = 0.16f)
    /** スレ主 */
    val op get() = if (scheme.dark) Color(0xFFF0B44C) else Color(0xFFB7791F)
    val opWash get() = op.copy(alpha = 0.16f)
    val link get() = scheme.link
    val posterName get() = scheme.posterName
    val threadReadTitle get() = scheme.threadReadTitle
    val heatWarm get() = scheme.heatWarm
    val heatHot get() = scheme.heatHot
    val heatVeryHot get() = scheme.heatVeryHot
    // 意味の色(差し色)。明るい配色では少し濃くする
    val markFav get() = if (scheme.dark) Color(0xFFF2C14E) else Color(0xFFC9961A)
    val markDanger get() = if (scheme.dark) Color(0xFFEF7470) else Color(0xFFD14B47)
    val markNew get() = if (scheme.dark) Color(0xFF5FC28A) else Color(0xFF2E9A5E)
    val markVideo get() = markDanger
    val markImage get() = markNew
    val markHot get() = if (scheme.dark) Color(0xFFF0954A) else Color(0xFFD9732A)
    val markLink get() = if (scheme.dark) Color(0xFF6AA9F0) else Color(0xFF3A7BD5)
    val markPurple get() = if (scheme.dark) Color(0xFFB48CF0) else Color(0xFF8457C9)

    /**
     * LINE 風の地と吹き出し(今のスマホ版の [data-post-style='line']): 地は配色の背景に青灰を少し混ぜ(明 13%・暗 10%)、
     * 吹き出しは面の色、自分の吹き出しは明るい緑(暗い配色では深い緑)
     */
    val lineBg get() = androidx.compose.ui.graphics.lerp(base, if (scheme.dark) Color(0xFF6F8FB8) else Color(0xFF7F9CC0), if (scheme.dark) 0.10f else 0.13f)
    val lineBubble get() = if (scheme.dark) surface3 else Color.White
    val lineOwnBg get() = if (scheme.dark) Color(0xFF3F7D2C) else Color(0xFF8DE055)
    val lineOwnText get() = if (scheme.dark) Color(0xFFEEF7E8) else Color(0xFF10200A)

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
    val p = Palette
    val scheme = if (p.dark) {
        darkColorScheme(
            primary = p.accent, onPrimary = p.accentText, background = p.base, onBackground = p.textBody,
            surface = p.surface, onSurface = p.textBody, surfaceVariant = p.surface2, onSurfaceVariant = p.textMuted,
            surfaceContainerLow = p.surface, surfaceContainer = p.surface, surfaceContainerHigh = p.surface2, surfaceContainerHighest = p.surface3,
            outline = p.border, outlineVariant = p.border, secondaryContainer = p.accentWash, onSecondaryContainer = p.textStrong,
        )
    } else {
        lightColorScheme(
            primary = p.accent, onPrimary = p.accentText, background = p.base, onBackground = p.textBody,
            surface = p.surface, onSurface = p.textBody, surfaceVariant = p.surface2, onSurfaceVariant = p.textMuted,
            surfaceContainerLow = p.surface, surfaceContainer = p.surface, surfaceContainerHigh = p.surface2, surfaceContainerHighest = p.surface3,
            outline = p.border, outlineVariant = p.border, secondaryContainer = p.accentWash, onSecondaryContainer = p.textStrong,
        )
    }
    // 角の丸みは控えめに(ダイアログ・メニュー・下から出る画面も)
    val shapes = androidx.compose.material3.Shapes(
        extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(3.dp),
        small = androidx.compose.foundation.shape.RoundedCornerShape(5.dp),
        medium = androidx.compose.foundation.shape.RoundedCornerShape(6.dp),
        large = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
        extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
    )
    // 字の上下に Android が足す余白(includeFontPadding)を外す。字の上側の余白が大きく見えていた
    val base = androidx.compose.material3.Typography()
    fun androidx.compose.ui.text.TextStyle.tight() = copy(
        platformStyle = androidx.compose.ui.text.PlatformTextStyle(includeFontPadding = false),
        lineHeightStyle = androidx.compose.ui.text.style.LineHeightStyle(
            androidx.compose.ui.text.style.LineHeightStyle.Alignment.Center, androidx.compose.ui.text.style.LineHeightStyle.Trim.Both,
        ),
    )
    val typography = androidx.compose.material3.Typography(
        displayLarge = base.displayLarge.tight(), displayMedium = base.displayMedium.tight(), displaySmall = base.displaySmall.tight(),
        headlineLarge = base.headlineLarge.tight(), headlineMedium = base.headlineMedium.tight(), headlineSmall = base.headlineSmall.tight(),
        titleLarge = base.titleLarge.tight(), titleMedium = base.titleMedium.tight(), titleSmall = base.titleSmall.tight(),
        bodyLarge = base.bodyLarge.tight(), bodyMedium = base.bodyMedium.tight(), bodySmall = base.bodySmall.tight(),
        labelLarge = base.labelLarge.tight(), labelMedium = base.labelMedium.tight(), labelSmall = base.labelSmall.tight(),
    )
    MaterialTheme(colorScheme = scheme, shapes = shapes, typography = typography, content = content)
}
