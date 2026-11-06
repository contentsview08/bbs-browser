package io.github.contentsview08.obb.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

/**
 * 自分で作る配色。地・面・字・強調・未読・自分の 6 色だけを選び、ほかの色(帯・線・薄い字・既読の字など)は 6 色から作る。
 * 人気の色・リンク・名前の色は、もとにした配色のものを使う。設定には JSON で入れる(PC 版とも同じ形で受け渡せるように)
 */
data class CustomDef(
    val from: String, val base: Color, val surface: Color, val text: Color,
    val accent: Color, val unread: Color, val own: Color,
) {
    fun toJson(): String = JSONObject().apply {
        put("from", from)
        for ((k, c) in colors()) put(k, hex(c))
    }.toString()

    fun colors() = listOf("base" to base, "surface" to surface, "text" to text, "accent" to accent, "unread" to unread, "own" to own)

    fun with(key: String, c: Color) = when (key) {
        "base" -> copy(base = c); "surface" -> copy(surface = c); "text" -> copy(text = c)
        "accent" -> copy(accent = c); "unread" -> copy(unread = c); else -> copy(own = c)
    }

    companion object {
        fun parse(json: String): CustomDef? = runCatching {
            val o = JSONObject(json)
            fun c(k: String) = Color(android.graphics.Color.parseColor(o.getString(k)))
            CustomDef(o.optString("from", "light-gray"), c("base"), c("surface"), c("text"), c("accent"), c("unread"), c("own"))
        }.getOrNull()

        /** 今ある配色から 6 色を写して始める */
        fun of(s: Scheme) = CustomDef(s.key, s.base, s.surface, s.textStrong, s.accent, s.unread, if (s.dark) Color(0xFF3EC7A0) else Color(0xFF1F9A78))
    }
}

fun hex(c: Color) = "#%06X".format(c.toArgb() and 0xFFFFFF)

/** 塗った面の上の字: 白と黒のうち、差の大きいほう */
private fun onColor(c: Color) = if (contrast(Color(0xFF111111), c) >= contrast(Color.White, c)) Color(0xFF111111) else Color.White

/** 6 色から配色をまるごと作る */
fun buildScheme(d: CustomDef): Scheme {
    val from = SCHEMES.firstOrNull { it.key == d.from } ?: SCHEMES[0]
    val dark = d.base.luminance() < 0.4f
    return Scheme(
        "custom", "自分の配色", dark,
        d.base, d.surface, d.surface, lerp(d.surface, d.text, 0.06f), lerp(d.surface, d.text, 0.12f),
        lerp(d.base, d.text, 0.14f), lerp(d.base, d.text, 0.26f),
        d.text, lerp(d.text, d.base, 0.10f), lerp(d.text, d.base, 0.45f),
        d.accent, onColor(d.accent), d.accent.copy(alpha = 0.14f),
        d.unread, onColor(d.unread),
        from.link, from.posterName, lerp(d.text, d.base, 0.35f),
        from.heatWarm, from.heatHot, from.heatVeryHot,
    )
}

/** 設定に入っている自分の配色(なければ null)。schemeOf("custom") が読む */
object CustomSchemes {
    var def by mutableStateOf<CustomDef?>(null)
}

fun contrast(a: Color, b: Color): Float {
    val x = a.luminance(); val y = b.luminance()
    return (maxOf(x, y) + 0.05f) / (minOf(x, y) + 0.05f)
}

private val LABELS = mapOf("base" to "地", "surface" to "面(レス・帯)", "text" to "字", "accent" to "強調(ボタン・選んだ印)", "unread" to "未読", "own" to "自分の書き込み")

/** 配色の見本: 上の帯・スレ一覧の行(読んだ・まだ開いていない)・レス・書き込み欄を、その配色で小さく描く */
@Composable
fun SchemePreview(s: Scheme, own: Color, accent: Color = s.accent, accentText: Color = s.accentText) {
    Column(Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(8.dp)).border(1.dp, Palette.border, RoundedCornerShape(8.dp)).background(s.base)) {
        Row(Modifier.fillMaxWidth().background(s.bar).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("ニュー速", color = s.textStrong, fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.weight(1f))
            Text("︙", color = s.textMuted)
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(s.border))
        Row(Modifier.fillMaxWidth().height(androidx.compose.foundation.layout.IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(s.unread))
            Column(Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 8.dp)) {
                Text("読んだスレのスレタイ", color = s.threadReadTitle, fontSize = 14.sp)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("3 時間前", color = s.textMuted, fontSize = 11.sp, modifier = Modifier.weight(1f))
                    Text("+12", color = s.unreadText, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.background(s.unread, RoundedCornerShape(50)).padding(horizontal = 6.dp, vertical = 1.dp))
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(s.border))
        Text("まだ開いていないスレ", Modifier.padding(horizontal = 15.dp, vertical = 8.dp), color = s.textStrong, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        Box(Modifier.fillMaxWidth().height(1.dp).background(s.border))
        Row(Modifier.fillMaxWidth().height(androidx.compose.foundation.layout.IntrinsicSize.Min).background(s.surface)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(own))
            Column(Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("12  ", color = s.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    Text("名無し", color = s.posterName, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    Text("  10/31 12:34  ID:AbCd", color = s.textMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                }
                Text(">>10 ", color = s.link, fontSize = 14.sp)
                Text("本文はこの字の色で出ます。", color = s.textBody, fontSize = 14.sp)
            }
        }
        Row(Modifier.fillMaxWidth().background(s.bar).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("書き込む", Modifier.weight(1f).background(s.surface, RoundedCornerShape(10.dp)).border(1.dp, s.border, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 8.dp), color = s.textMuted, fontSize = 13.sp)
            Spacer(Modifier.width(8.dp))
            Box(Modifier.size(34.dp).background(accent, CircleShape), contentAlignment = Alignment.Center) { Text("➤", color = accentText, fontSize = 14.sp) }
        }
    }

}

/** 設定の「自分の配色」のページ: 見本・6 色・コントラストの判定・使う・JSON をコピー */
@Composable
fun CustomSchemeEditor(prefs: io.github.contentsview08.obb.data.Prefs) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val def = CustomDef.parse(prefs.customScheme) ?: CustomDef.of(schemeOf(prefs.scheme).takeIf { it.key != "custom" } ?: SCHEMES[0])
    fun save(d: CustomDef) { prefs.customScheme = d.toJson() }
    val s = buildScheme(def)
    var editing by remember { mutableStateOf<String?>(null) }

    SchemePreview(s, def.own)

    Column(Modifier.padding(horizontal = 16.dp).clip(RoundedCornerShape(8.dp)).background(Palette.surface).border(1.dp, Palette.border, RoundedCornerShape(8.dp))) {
        for ((k, c) in def.colors()) {
            Row(Modifier.fillMaxWidth().clickable { editing = k }.heightIn(min = 50.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(26.dp).background(c, RoundedCornerShape(6.dp)).border(1.dp, Palette.borderStrong, RoundedCornerShape(6.dp)))
                Spacer(Modifier.width(12.dp))
                Text(LABELS[k] ?: k, Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
                Text(hex(c), color = Palette.textMuted, fontSize = 13.sp, fontFamily = FontFamily.Monospace)
            }
        }
    }

    // コントラストの判定(本文 4.5、そのほか 3 が目安)
    val checks = listOf(
        Triple("本文 / 地", contrast(s.textBody, s.base), 4.5f),
        Triple("本文 / 面", contrast(s.textBody, s.surface), 4.5f),
        Triple("薄い字 / 地", contrast(s.textMuted, s.base), 3f),
        Triple("強調の上の字", contrast(s.accentText, s.accent), 3f),
        Triple("強調 / 地", contrast(s.accent, s.base), 3f),
        Triple("未読の札の字", contrast(s.unreadText, s.unread), 3f),
    )
    Column(Modifier.padding(16.dp)) {
        Text("読みやすさ(コントラスト比)", color = Palette.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        for ((label, r, th) in checks) Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, Modifier.weight(1f), color = Palette.textBody, fontSize = 13.sp)
            Text("%.1f".format(r), color = if (r >= th) Palette.textMuted else Palette.markDanger, fontSize = 13.sp, fontFamily = FontFamily.Monospace)
            Text(if (r >= th) "  ok" else "  低い(${th} 以上に)", color = if (r >= th) Palette.markNew else Palette.markDanger, fontSize = 12.sp)
        }
    }

    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val using = prefs.scheme == "custom" && !prefs.followOsTheme
        Text(
            if (using) "使っています" else "この配色を使う",
            Modifier.clip(RoundedCornerShape(6.dp)).background(if (using) Palette.surface2 else Palette.accent)
                .clickable(enabled = !using) { save(def); prefs.followOsTheme = false; prefs.scheme = "custom" }.padding(horizontal = 16.dp, vertical = 10.dp),
            color = if (using) Palette.textMuted else Palette.accentText, fontSize = 14.sp, fontWeight = FontWeight.Bold,
        )
        Text(
            "JSON をコピー",
            Modifier.clip(RoundedCornerShape(6.dp)).border(1.dp, Palette.border, RoundedCornerShape(6.dp))
                .clickable { copyText(context, def.toJson()) }.padding(horizontal = 16.dp, vertical = 10.dp),
            color = Palette.textStrong, fontSize = 14.sp,
        )
    }
    Text("もとにする配色を選ぶと、6 色をその配色の色に戻します", Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp), color = Palette.textMuted, fontSize = 12.sp)
    Row(Modifier.fillMaxWidth().horizontalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (sc in SCHEMES) Column(Modifier.clickable { save(CustomDef.of(sc)) }, horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(34.dp).background(sc.base, RoundedCornerShape(6.dp)).border(if (sc.key == def.from) 2.dp else 1.dp, if (sc.key == def.from) Palette.accent else Palette.border, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
                Box(Modifier.size(12.dp).background(sc.accent, CircleShape))
            }
            Text(sc.name, color = Palette.textMuted, fontSize = 10.sp, maxLines = 1, modifier = Modifier.width(56.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }

    editing?.let { k ->
        ColorDialog(LABELS[k] ?: k, def.colors().first { it.first == k }.second, onDismiss = { editing = null }) { save(def.with(k, it)) }
    }
}

/** 色を選ぶ小さな画面: 色相・鮮やかさ・明るさのスライダーと、#RRGGBB の欄。動かすとその場で配色に当たる */
@Composable
private fun ColorDialog(title: String, initial: Color, onDismiss: () -> Unit, onChange: (Color) -> Unit) {
    val hsl = remember { FloatArray(3).also { androidx.core.graphics.ColorUtils.colorToHSL(initial.toArgb(), it) } }
    var h by remember { mutableStateOf(hsl[0]) }
    var sat by remember { mutableStateOf(hsl[1]) }
    var l by remember { mutableStateOf(hsl[2]) }
    var text by remember { mutableStateOf(hex(initial)) }
    fun emit() { val c = Color.hsl(h, sat, l); text = hex(c); onChange(c) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                Box(Modifier.fillMaxWidth().height(40.dp).background(Color.hsl(h, sat, l), RoundedCornerShape(6.dp)).border(1.dp, Palette.border, RoundedCornerShape(6.dp)))
                val colors = SliderDefaults.colors(thumbColor = Palette.accent, activeTrackColor = Palette.accent)
                Text("色相", color = Palette.textMuted, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp))
                Slider(h, { h = it; emit() }, valueRange = 0f..360f, colors = colors)
                Text("鮮やかさ", color = Palette.textMuted, fontSize = 12.sp)
                Slider(sat, { sat = it; emit() }, colors = colors)
                Text("明るさ", color = Palette.textMuted, fontSize = 12.sp)
                Slider(l, { l = it; emit() }, colors = colors)
                androidx.compose.material3.OutlinedTextField(
                    text, { v ->
                        text = v
                        runCatching { Color(android.graphics.Color.parseColor(v.trim())) }.getOrNull()?.let { c ->
                            val a = FloatArray(3); androidx.core.graphics.ColorUtils.colorToHSL(c.toArgb(), a)
                            h = a[0]; sat = a[1]; l = a[2]; onChange(c)
                        }
                    },
                    singleLine = true, label = { Text("#RRGGBB") },
                )
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("閉じる") } },
    )
}
