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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
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
 * 自分の配色の細かい色 1 つ。キー・並び・まとまりは PC 版・Web の ui/customScheme.ts の EXTRA_COLORS と同じ(JSON を受け渡すため)。
 * 選んでいなければ 6 色から作った値(bar・surface2 …)か、配色の決まりの色(mark*・toOwn・op …。Palette.extraOf)
 */
class ExtraColor(val key: String, val label: String, val group: String)

val EXTRA_COLORS = listOf(
    ExtraColor("bar", "上下の帯", "面・線"), ExtraColor("surface2", "重ねた面(札・入力欄)", "面・線"), ExtraColor("surface3", "選んだ面", "面・線"),
    ExtraColor("border", "線", "面・線"), ExtraColor("borderStrong", "濃い線", "面・線"),
    ExtraColor("textBody", "本文", "字"), ExtraColor("textMuted", "薄い字(日付・ID・補足)", "字"), ExtraColor("threadReadTitle", "読んだスレのスレタイ", "字"),
    ExtraColor("posterName", "名前", "字"), ExtraColor("link", "リンク・アンカー", "字"),
    ExtraColor("accentText", "強調の上の字", "強調・未読"), ExtraColor("unreadText", "未読の札の字", "強調・未読"),
    ExtraColor("newBadge", "スレ一覧の「新」の札", "強調・未読"), ExtraColor("newBadgeText", "「新」の札の字", "強調・未読"),
    ExtraColor("toOwn", "自分へのレス", "自分・主"), ExtraColor("op", "スレ主", "自分・主"),
    ExtraColor("heatWarm", "人気(少し)", "人気"), ExtraColor("heatHot", "人気(多い)", "人気"), ExtraColor("heatVeryHot", "人気(とても多い)", "人気"),
    ExtraColor("markFav", "お気に入りの印", "印"), ExtraColor("markDanger", "削除・NG・動画の印", "印"), ExtraColor("markNew", "新しい・画像の印", "印"),
    ExtraColor("markHot", "人気の印", "印"), ExtraColor("markLink", "リンク・ブラウザの印", "印"), ExtraColor("markPurple", "見た目・アップロードの印", "印"),
    ExtraColor("lineBg", "LINE 風のスレ表示の地", "LINE 風"), ExtraColor("lineOwnBg", "LINE 風の自分の吹き出し", "LINE 風"),
    ExtraColor("lineOwnText", "自分の吹き出しの字", "LINE 風"), ExtraColor("lineOwnLink", "自分の吹き出しのリンク", "LINE 風"),
)

private val HEX_RE = Regex("^#[0-9A-Fa-f]{6}$")
private val BASE_KEYS = setOf("base", "surface", "text", "accent", "unread", "own")

/**
 * 自分で作る配色。地・面・字・強調・未読・自分の 6 色を選び、ほかの色(帯・線・薄い字・既読の字など)は 6 色から作る。
 * 人気の色・リンク・名前の色は、もとにした配色のものを使う。細かい色(colors。EXTRA_COLORS のキー)を選べば、作った値の代わりにそれ。
 * 設定には JSON で入れる(PC 版とも同じ形で受け渡せるように。形は docs/color-scheme.md)
 */
data class CustomDef(
    val from: String, val base: Color, val surface: Color, val text: Color,
    val accent: Color, val unread: Color, val own: Color,
    /** 一緒に選んでいた差し色(設定 accent のキー)。書き出し・取り込みのときだけ添える。設定の customScheme には入れない */
    val accentPick: String = "",
    /** 細かい色(選んだものだけ) */
    val colors: Map<String, Color> = emptyMap(),
) {
    fun toJson(): String = JSONObject().apply {
        put("from", from)
        for ((k, c) in colors()) put(k, hex(c))
        if (colors.isNotEmpty()) put("colors", JSONObject().apply { for (e in EXTRA_COLORS) colors[e.key]?.let { put(e.key, hex(it)) } })
        if (accentPick.isNotEmpty()) put("accentPick", accentPick)
    }.toString()

    fun colors() = listOf("base" to base, "surface" to surface, "text" to text, "accent" to accent, "unread" to unread, "own" to own)

    fun with(key: String, c: Color) = when (key) {
        "base" -> copy(base = c); "surface" -> copy(surface = c); "text" -> copy(text = c)
        "accent" -> copy(accent = c); "unread" -> copy(unread = c); "own" -> copy(own = c)
        else -> copy(colors = colors + (key to c))
    }

    /** 細かい色を選び直す前に戻す(6 色から作った値・配色の決まりの色に) */
    fun without(key: String) = copy(colors = colors - key)

    companion object {
        fun parse(json: String): CustomDef? = runCatching {
            val o = JSONObject(json)
            fun c(k: String) = Color(android.graphics.Color.parseColor(o.getString(k)))
            // 細かい色は知っているキーの #RRGGBB だけ(知らないキー・読めない値は飛ばす。新しい版で足したキーが古い版に来ても落ちない)
            val extras = o.optJSONObject("colors")?.let { co ->
                EXTRA_COLORS.mapNotNull { e -> co.optString(e.key, "").trim().takeIf { HEX_RE.matches(it) }?.let { e.key to Color(android.graphics.Color.parseColor(it)) } }.toMap()
            } ?: emptyMap()
            // 知らない差し色は「テーマの色」に
            CustomDef(o.optString("from", "light-gray"), c("base"), c("surface"), c("text"), c("accent"), c("unread"), c("own"), o.optString("accentPick", "").takeIf { k -> ACCENTS.any { it.key == k } } ?: "", extras)
        }.getOrNull()

        /** 今ある配色から 6 色を写して始める */
        fun of(s: Scheme) = CustomDef(s.key, s.base, s.surface, s.textStrong, s.accent, s.unread, if (s.dark) Color(0xFF3EC7A0) else Color(0xFF1F9A78))
    }
}

fun hex(c: Color) = "#%06X".format(c.toArgb() and 0xFFFFFF)

/** 塗った面の上の字: 白と黒のうち、差の大きいほう */
private fun onColor(c: Color) = if (contrast(Color(0xFF111111), c) >= contrast(Color.White, c)) Color(0xFF111111) else Color.White

/** 6 色(と選んだ細かい色)から配色をまるごと作る。PC 版の customVars と同じ式 */
fun buildScheme(d: CustomDef): Scheme {
    val from = SCHEMES.firstOrNull { it.key == d.from } ?: SCHEMES[0]
    val dark = d.base.luminance() < 0.4f
    val o = d.colors
    return Scheme(
        "custom", "自分の配色", dark,
        d.base, o["bar"] ?: d.surface, d.surface, o["surface2"] ?: lerp(d.surface, d.text, 0.06f), o["surface3"] ?: lerp(d.surface, d.text, 0.12f),
        o["border"] ?: lerp(d.base, d.text, 0.14f), o["borderStrong"] ?: lerp(d.base, d.text, 0.26f),
        d.text, o["textBody"] ?: lerp(d.text, d.base, 0.10f), o["textMuted"] ?: lerp(d.text, d.base, 0.45f),
        d.accent, o["accentText"] ?: onColor(d.accent), d.accent.copy(alpha = 0.14f),
        d.unread, o["unreadText"] ?: onColor(d.unread),
        o["link"] ?: from.link, o["posterName"] ?: from.posterName, o["threadReadTitle"] ?: lerp(d.text, d.base, 0.35f),
        o["heatWarm"] ?: from.heatWarm, o["heatHot"] ?: from.heatHot, o["heatVeryHot"] ?: from.heatVeryHot,
        // Palette が先に見る色: 自分の色と、選んだ細かい色(own・toOwn・mark* など)
        extra = o + ("own" to d.own),
    )
}

/** 細かい色のいまの値。選んでいればそれ、選んでいなければ 6 色から作った値か配色の決まりの色(画面に見せる・色選びの始まりの色) */
fun extraValue(d: CustomDef, key: String): Color {
    d.colors[key]?.let { return it }
    val s = buildScheme(d.copy(colors = emptyMap()))
    return when (key) {
        "bar" -> s.bar; "surface2" -> s.surface2; "surface3" -> s.surface3; "border" -> s.border; "borderStrong" -> s.borderStrong
        "textBody" -> s.textBody; "textMuted" -> s.textMuted; "threadReadTitle" -> s.threadReadTitle; "posterName" -> s.posterName; "link" -> s.link
        "accentText" -> s.accentText; "unreadText" -> s.unreadText
        "heatWarm" -> s.heatWarm; "heatHot" -> s.heatHot; "heatVeryHot" -> s.heatVeryHot
        else -> Palette.extraOf(s, key)
    }
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
private fun labelOf(key: String) = LABELS[key] ?: EXTRA_COLORS.firstOrNull { it.key == key }?.label ?: key

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

/** 設定の「自分の配色」のページ: 見本・6 色・細かい色・コントラストの判定・使う・JSON をコピー・JSON を貼り付け */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun CustomSchemeEditor(prefs: io.github.contentsview08.obb.data.Prefs) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val def = CustomDef.parse(prefs.customScheme) ?: CustomDef.of(schemeOf(prefs.scheme).takeIf { it.key != "custom" } ?: SCHEMES[0])
    fun save(d: CustomDef) { prefs.customScheme = d.toJson() }
    val s = buildScheme(def)
    var editing by remember { mutableStateOf<String?>(null) }
    /** コピー・貼り付けの結果 */
    var notice by remember { mutableStateOf<String?>(null) }

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

    // 細かい色(帯・線・字・印・人気・LINE 風 …)。選んでいなければ 6 色から作った値。ふだんは畳んでおく(選んでいれば開いておく)
    var moreOpen by remember { mutableStateOf(def.colors.isNotEmpty()) }
    Row(Modifier.fillMaxWidth().clickable { moreOpen = !moreOpen }.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("細かい色", Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Medium)
        if (def.colors.isNotEmpty()) Text("${def.colors.size} 色を選んでいます  ", color = Palette.textMuted, fontSize = 12.sp)
        Icon(if (moreOpen) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = Palette.textMuted)
    }
    if (moreOpen) {
        Text(
            "選んでいない色は、6 色から作った色(人気・印などは配色の決まりの色)です。選んだ色は「戻す」で元に戻せます",
            Modifier.padding(start = 16.dp, end = 16.dp, bottom = 4.dp), color = Palette.textMuted, fontSize = 12.sp,
        )
        for ((group, items) in EXTRA_COLORS.groupBy { it.group }) {
            Text(group, Modifier.padding(start = 16.dp, top = 10.dp, bottom = 4.dp), color = Palette.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Column(Modifier.padding(horizontal = 16.dp).clip(RoundedCornerShape(8.dp)).background(Palette.surface).border(1.dp, Palette.border, RoundedCornerShape(8.dp))) {
                for (e in items) {
                    val c = extraValue(def, e.key)
                    val picked = e.key in def.colors
                    Row(Modifier.fillMaxWidth().clickable { editing = e.key }.heightIn(min = 46.dp).padding(start = 14.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(22.dp).background(c, RoundedCornerShape(6.dp)).border(1.dp, Palette.borderStrong, RoundedCornerShape(6.dp)))
                        Spacer(Modifier.width(12.dp))
                        Text(e.label, Modifier.weight(1f), color = if (picked) Palette.textStrong else Palette.textBody, fontSize = 14.sp)
                        Text(hex(c), color = Palette.textMuted, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                        if (picked) Text("戻す", Modifier.clip(RoundedCornerShape(6.dp)).clickable { save(def.without(e.key)) }.padding(horizontal = 8.dp, vertical = 8.dp), color = Palette.accent, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        else Spacer(Modifier.width(8.dp))
                    }
                }
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

    // 狭い画面では 2 段に折り返す
    androidx.compose.foundation.layout.FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val using = prefs.scheme == "custom" && !prefs.followOsTheme
        Text(
            if (using) "使っています" else "この配色を使う",
            Modifier.clip(RoundedCornerShape(6.dp)).background(if (using) Palette.surface2 else Palette.accent)
                // 自分の配色の「強調」が差し色の役目をするので、別に選んだ差し色は外す
                .clickable(enabled = !using) { save(def); prefs.followOsTheme = false; prefs.scheme = "custom"; prefs.accent = "" }.padding(horizontal = 16.dp, vertical = 10.dp),
            color = if (using) Palette.textMuted else Palette.accentText, fontSize = 14.sp, fontWeight = FontWeight.Bold,
        )
        Text(
            "JSON をコピー",
            Modifier.clip(RoundedCornerShape(6.dp)).border(1.dp, Palette.border, RoundedCornerShape(6.dp))
                .clickable { copyText(context, def.copy(accentPick = prefs.accent).toJson()); notice = "JSON をコピーしました" }.padding(horizontal = 16.dp, vertical = 10.dp),
            color = Palette.textStrong, fontSize = 14.sp,
        )
        // 別の端末・PC 版で「JSON をコピー」したものを取り込む
        Text(
            "JSON を貼り付け",
            Modifier.clip(RoundedCornerShape(6.dp)).border(1.dp, Palette.border, RoundedCornerShape(6.dp))
                .clickable {
                    val clip = runCatching {
                        context.getSystemService(android.content.ClipboardManager::class.java).primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()?.trim()
                    }.getOrNull()
                    val got = clip?.let { CustomDef.parse(it) }
                    // 一緒に書き出した差し色も戻す(なければテーマの色。差し色が残ると、取り込んだ「強調」の色が隠れる)
                    if (got != null) { save(got.copy(accentPick = "")); prefs.accent = got.accentPick }
                    notice = if (got != null) "配色を取り込みました" else "クリップボードに配色の JSON がありません"
                }.padding(horizontal = 16.dp, vertical = 10.dp),
            color = Palette.textStrong, fontSize = 14.sp,
        )
    }
    notice?.let { Text(it, Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp), color = Palette.textMuted, fontSize = 12.sp) }
    if (prefs.accent.isNotEmpty()) Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("差し色を選んでいるので、アプリでは「強調」の代わりに差し色が使われます。", Modifier.weight(1f), color = Palette.markDanger, fontSize = 12.sp)
        Text("テーマの色に戻す", Modifier.clickable { prefs.accent = "" }.padding(start = 8.dp), color = Palette.accent, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
    Text("もとにする配色を選ぶと、6 色をその配色の色に戻します(細かい色はそのまま)", Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp), color = Palette.textMuted, fontSize = 12.sp)
    Row(Modifier.fillMaxWidth().horizontalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (sc in SCHEMES) Column(Modifier.clickable { save(CustomDef.of(sc).copy(colors = def.colors)) }, horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(34.dp).background(sc.base, RoundedCornerShape(6.dp)).border(if (sc.key == def.from) 2.dp else 1.dp, if (sc.key == def.from) Palette.accent else Palette.border, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
                Box(Modifier.size(12.dp).background(sc.accent, CircleShape))
            }
            Text(sc.name, color = Palette.textMuted, fontSize = 10.sp, maxLines = 1, modifier = Modifier.width(56.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }

    editing?.let { k ->
        val initial = if (k in BASE_KEYS) def.colors().first { it.first == k }.second else extraValue(def, k)
        ColorDialog(labelOf(k), initial, onDismiss = { editing = null }) { save(def.with(k, it)) }
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
