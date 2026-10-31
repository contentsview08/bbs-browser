package io.github.yumekui8.bbsnative.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
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
        // 薄い字・強調(送るボタン)・未読の札は、コントラスト比を満たすよう少し濃く(未読の札の字は濃い緑)
        c(0x111111), c(0x2B2B2B), c(0x747983), c(0x008C45), c(0xFFFFFF), wash(0x06C755, 0.12f),
        c(0x06C755), c(0x03230F), c(0x2A62C9), c(0x2E8B57), c(0x5B6472), c(0xC98A12), c(0xD9622B), c(0xD33A3A),
    ),
    // グレー(2ch Mate のグレーに近い形): 地は白い字がはっきり読める暗めの灰色、上下の帯はそれより明るい灰色、行の間は黒に近い線
    Scheme(
        "gray", "グレー", true,
        c(0x313131), c(0x575757), c(0x313131), c(0x3A3A3A), c(0x434343), c(0x232323), c(0x1A1A1A),
        c(0xF4F4F4), c(0xE2E2E2), c(0xA8A8A8), c(0xDCDCDC), c(0x1C1C1C), wash(0xFFFFFF, 0.10f),
        c(0xFF8FA3), c(0x2A0B12), c(0x9CC8FF), c(0x9FDDB8), c(0xC8D6E8), c(0xF2C14E), c(0xF2914B), c(0xFF6B6B),
    ),
    Scheme(
        "light-gray", "ライトグレー", false,
        c(0xECECEC), c(0xE2E2E3), c(0xF6F6F6), c(0xE4E4E5), c(0xD9D9DB), c(0xD2D2D4), c(0xB4B5B8),
        c(0x222222), c(0x3E3E40), c(0x7E7F83), c(0x4E5A68), c(0xFFFFFF), wash(0x4E5A68, 0.10f),
        c(0xC4473F), c(0xFFFFFF), c(0x2F64A8), c(0x4F7F6D), c(0x3B5576), c(0xA8721E), c(0xB25A2E), c(0xA83A3A),
    ),
    // ── 提案書(2026-10-31)から足した配色。どれも 字と地のコントラスト比 4.5 以上 ──
    // 紙(セピア): 読書アプリのような生成りの地にこげ茶の字
    Scheme(
        "sepia", "紙(セピア)", false,
        c(0xF4ECD8), c(0xE9DFC4), c(0xF8F2E3), c(0xEDE3C9), c(0xE2D6B6), c(0xDCCFAE), c(0xC4B48E),
        c(0x2E2418), c(0x3B2F20), c(0x7E6C50), c(0x8B5E34), c(0xFFFFFF), wash(0x8B5E34, 0.10f),
        c(0xC2410C), c(0xFFFFFF), c(0x2F5E9E), c(0x5B7F2A), c(0x6B4E2E), c(0xA86512), c(0xB4531A), c(0xA8321E),
    ),
    // Nord: 青みの灰色の地に淡い水色の強調。彩度が低く色がうるさくない
    Scheme(
        "nord", "Nord", true,
        c(0x2E3440), c(0x3B4252), c(0x353C4A), c(0x3B4252), c(0x434C5E), c(0x434C5E), c(0x4C566A),
        c(0xECEFF4), c(0xD8DEE9), c(0x8F9BB3), c(0x88C0D0), c(0x1E222A), wash(0x88C0D0, 0.14f),
        c(0xBF616A), c(0xFFFFFF), c(0x81A1C1), c(0xA3BE8C), c(0xB4C6DC), c(0xEBCB8B), c(0xD08770), c(0xBF616A),
    ),
    // ハイコントラスト: 真っ黒の地に真っ白の字、意味の色は彩度最大
    Scheme(
        "contrast", "ハイコントラスト", true,
        c(0x000000), c(0x000000), c(0x0B0B0B), c(0x161616), c(0x222222), c(0x5C5C5C), c(0x8A8A8A),
        c(0xFFFFFF), c(0xFFFFFF), c(0xD0D0D0), c(0xFFD400), c(0x000000), wash(0xFFD400, 0.18f),
        c(0xFF4D6D), c(0x000000), c(0x7CC4FF), c(0x7DFFB3), c(0xE6F0FF), c(0xFFD400), c(0xFF9F1C), c(0xFF4D6D),
    ),
    // 夜間(暖色): 青い色を使わない、オレンジがかった暗い配色。寝る前用
    Scheme(
        "night", "夜間(暖色)", true,
        c(0x1B1410), c(0x231A14), c(0x211812), c(0x2A1F18), c(0x33261D), c(0x3A2C22), c(0x4A382B),
        c(0xF2DFC8), c(0xE6D0B5), c(0xA98F74), c(0xFF9E57), c(0x241406), wash(0xFF9E57, 0.14f),
        c(0xFF6B5E), c(0x240A06), c(0xF0B37E), c(0xC9B458), c(0xE7C9A4), c(0xFFB347), c(0xFF8F4D), c(0xFF6B5E),
    ),
    // LINE ダーク: LINE のダークモードに近い。地は濃い紺、自分の吹き出しは深い緑
    Scheme(
        "line-dark", "LINE ダーク", true,
        c(0x1B2129), c(0x20262F), c(0x222831), c(0x2A313B), c(0x343C47), c(0x323A45), c(0x434C59),
        c(0xE9EDF2), c(0xD7DDE5), c(0x8A96A6), c(0x06C755), c(0x04210E), wash(0x06C755, 0.14f),
        c(0xFF5B5B), c(0x2A0707), c(0x6FB1FF), c(0x7FD0A0), c(0xAFC0D6), c(0xFFB020), c(0xFF8A3D), c(0xFF5B5B),
    ),
    // Discord ライト: 白い地に青紫の強調
    Scheme(
        "discord-light", "Discord ライト", false,
        c(0xFFFFFF), c(0xF2F3F5), c(0xF8F9FA), c(0xEBEDEF), c(0xE3E5E8), c(0xE3E5E8), c(0xC7CCD1),
        c(0x060607), c(0x2E3338), c(0x6D7581), c(0x5865F2), c(0xFFFFFF), wash(0x5865F2, 0.10f),
        c(0xED4245), c(0xFFFFFF), c(0x0068E0), c(0x3E8E5E), c(0x4E5D94), c(0xC27C0E), c(0xD9622B), c(0xD83C3E),
    ),
    // X(Twitter)ディム: 濃紺の地に青の強調。X の「ディム」と同じ色合い(未読は X のピンク)
    Scheme(
        "x-dim", "X(Twitter)ディム", true,
        c(0x15202B), c(0x15202B), c(0x192734), c(0x1E2732), c(0x273340), c(0x38444D), c(0x4A5864),
        c(0xF7F9F9), c(0xE1E6EA), c(0x8B98A5), c(0x1D9BF0), c(0xFFFFFF), wash(0x1D9BF0, 0.16f),
        c(0xF91880), c(0xFFFFFF), c(0x4FB2F5), c(0x00BA7C), c(0xA9C5DE), c(0xFFAD1F), c(0xF7853E), c(0xF4212E),
    ),
    // モノクロ: 灰色だけで作り、未読・自分の印だけに色を残す(色の役割の原則をいちばん素直に当てたもの)
    Scheme(
        "mono", "モノクロ", true,
        c(0x181818), c(0x202020), c(0x1E1E1E), c(0x262626), c(0x303030), c(0x2E2E2E), c(0x3E3E3E),
        c(0xEDEDED), c(0xDADADA), c(0x8C8C8C), c(0xE8E8E8), c(0x111111), wash(0xFFFFFF, 0.10f),
        c(0xFF6B81), c(0x2A0710), c(0xBDBDBD), c(0xB8B8B8), c(0xC9C9C9), c(0xBDBDBD), c(0xD6D6D6), c(0xF0F0F0),
    ),
    Scheme(
        "oled", "真っ黒", true,
        c(0x000000), c(0x0A0A0A), c(0x0A0A0A), c(0x141414), c(0x1C1C1C), c(0x222222), c(0x333333),
        c(0xE8E8E8), c(0xC8C8C8), c(0x7A7A7A), c(0x7AA2FF), c(0x000814), wash(0x7AA2FF, 0.14f),
        c(0xFF7A9C), c(0x200008), c(0x7FB0FF), c(0x5F9C8A), c(0x8FA8D0), c(0xD9B062), c(0xD9925F), c(0xD96A66),
    ),
)

/** 差し色の候補。明るい配色と暗い配色で濃さを変える(どちらの地でも、押せる所の字として 3:1 を超えるように) */
data class Accent(val key: String, val name: String, val light: Color, val dark: Color)

val ACCENTS = listOf(
    Accent("indigo", "藍", Color(0xFF4757C9), Color(0xFF8F9BF5)),
    Accent("blue", "青", Color(0xFF1F6FD1), Color(0xFF6AA9F0)),
    Accent("teal", "青緑", Color(0xFF0E8A7E), Color(0xFF4FCDBE)),
    Accent("green", "緑", Color(0xFF2E8B3E), Color(0xFF6CCB7A)),
    Accent("orange", "橙", Color(0xFFC8641A), Color(0xFFF29A55)),
    Accent("red", "朱", Color(0xFFC9423A), Color(0xFFF07B72)),
    Accent("pink", "桃", Color(0xFFC23F7E), Color(0xFFF08DBA)),
    Accent("purple", "紫", Color(0xFF7E4FC4), Color(0xFFB792F2)),
)

fun accentOf(key: String) = ACCENTS.firstOrNull { it.key == key }

fun schemeOf(key: String) =
    if (key == "custom") CustomSchemes.def?.let { buildScheme(it) } ?: SCHEMES[0]
    else SCHEMES.firstOrNull { it.key == key } ?: SCHEMES[0]

/** 選べる配色(自分の配色を作っていれば、最後に足す) */
fun allSchemes(): List<Scheme> = CustomSchemes.def?.let { SCHEMES + buildScheme(it) } ?: SCHEMES

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
    /** 設定で選んだ差し色(null ならテーマの色) */
    var accentPick by mutableStateOf<Accent?>(null)
    val accent get() = accentPick?.let { if (scheme.dark) it.dark else it.light } ?: scheme.accent
    val accentText get() = accentPick?.let { if (contrast(Color(0xFF111111), accent) >= contrast(Color.White, accent)) Color(0xFF111111) else Color.White } ?: scheme.accentText
    val accentWash get() = accentPick?.let { accent.copy(alpha = if (scheme.dark) 0.18f else 0.12f) } ?: scheme.accentWash
    /** 未読(「ここから未読」・未読の数) */
    val unread get() = scheme.unread
    val unreadText get() = scheme.unreadText
    /** 自分の書き込み */
    val own get() = if (scheme.key == "custom") CustomSchemes.def?.own ?: Color(0xFF1F9A78) else if (scheme.dark) Color(0xFF3EC7A0) else Color(0xFF1F9A78)
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
    /**
     * スレ表示の地。LINE 風のときだけ配色ごとに変える: LINE ライトは LINE のトーク画面のような空色(ライトとの見分け)、
     * グレーは濃い群青(灰色の吹き出しと白い字がはっきり見える)、ほかは配色の背景に青灰を少し混ぜる
     */
    fun threadBg(style: String) = when {
        style != "line" -> base
        scheme.key == "line-light" -> Color(0xFF9DB8DC)
        scheme.key == "gray" -> Color(0xFF1C2838)
        else -> lineBg
    }
    /** 地が空色(LINE ライトの LINE 風)で、吹き出しの外の字(名前・日付・ID)を白っぽくするか */
    fun onSky(style: String) = style == "line" && scheme.key == "line-light"
    /** 空色の地の上で読める字の色 */
    val skyText get() = Color(0xFFF4F8FC)
    val skyMuted get() = Color(0xE6FFFFFF)
    val lineBg get() = androidx.compose.ui.graphics.lerp(base, if (scheme.dark) Color(0xFF6F8FB8) else Color(0xFF7F9CC0), if (scheme.dark) 0.10f else 0.13f)
    // 暗い配色の吹き出しは、地より少しだけ明るい面(明るすぎると白い字との差が小さくなる)
    val lineBubble get() = if (scheme.dark) surface2 else Color.White
    /** 吹き出しの外の字(名前・日付)は、空色の地の上でも読める色に */
    val lineOwnBg get() = if (scheme.dark) Color(0xFF3F7D2C) else Color(0xFF8DE055)
    val lineOwnText get() = if (scheme.dark) Color(0xFFEEF7E8) else Color(0xFF10200A)

    /**
     * ID ごとの色。ID の文字から色相を決め、彩度と明るさは配色の明るさで固定する(どの色相でも地との差が同じくらいになるように)。
     * 暖色の赤〜橙は「書き込みの多い ID」の色と紛れるので避ける
     */
    fun idColor(id: String, sky: Boolean = false): Color {
        val h = ((id.hashCode().toLong() and 0xffffffffL) % 280 + 40).toFloat()
        // 空色の地の上では、白っぽい字と同じくらいの明るさの淡い色に
        if (sky) {
            var l = 0.8f
            var c = Color.hsl(h, 0.85f, l)
            while (c.luminance() < 0.7f && l < 0.97f) { l += 0.02f; c = Color.hsl(h, 0.85f, l) }
            return c
        }
        // 黄や緑は同じ明るさでも明るく見えるので、輝度が目安に入るまで明るさをずらす(明るい地で 3:1、暗い地で 3.5:1 を超える)
        var l = if (scheme.dark) 0.62f else 0.42f
        var c = Color.hsl(h, 0.6f, l)
        if (scheme.dark) while (c.luminance() < 0.28f && l < 0.9f) { l += 0.02f; c = Color.hsl(h, 0.6f, l) }
        else while (c.luminance() > 0.15f && l > 0.1f) { l -= 0.02f; c = Color.hsl(h, 0.6f, l) }
        return c
    }

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
    val font = io.github.yumekui8.bbsnative.data.Fonts.family
    fun androidx.compose.ui.text.TextStyle.tight() = copy(
        fontFamily = font ?: fontFamily,
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
