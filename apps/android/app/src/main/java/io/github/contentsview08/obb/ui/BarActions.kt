package io.github.contentsview08.obb.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.ChatBubbleOutline
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SpaceBar
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.VerticalAlignBottom
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.data.Prefs
import org.json.JSONArray
import org.json.JSONObject

/**
 * ツールバー(ヘッダー・フッター)に並べる部品(PC 版の utils/toolbar.ts の操作にあたる)。
 * 設定「ツールバー設定」で、部品を掴んでヘッダー・フッターの箱に入れて並べる。箱にない部品は ︙ のメニューにだけ出る(︙ にはいつも全部出る)。
 * 「チャット欄」と「空き」は残りの幅を埋める(fills)。チャット欄をフッターに置かなければ、書き込みは「書き込む」のボタンや返信から
 * 画面いっぱいの書き込み画面(ReplyFullSheet)で行う。
 * 保存は Prefs.barLayout(JSON v2: {"v": 2, "thread": {"header": [id...], "footer": [id...]}, "list": {...}})
 */
enum class ToolbarBar(val key: String, val label: String) { HEADER("header", "ヘッダー"), FOOTER("footer", "フッター") }

class ToolbarPartDef(val id: String, val name: String, val icon: ImageVector, /** 残りの幅を埋める(チャット欄・空き) */ val fills: Boolean = false)

/** スレ表示の部品 */
val THREAD_PARTS = listOf(
    ToolbarPartDef("replyField", "チャット欄", Icons.Filled.ChatBubbleOutline, fills = true),
    ToolbarPartDef("spacer", "空き", Icons.Filled.SpaceBar, fills = true),
    ToolbarPartDef("reply", "書き込む", Icons.Filled.Edit),
    ToolbarPartDef("search", "レス検索", Icons.Filled.Search),
    ToolbarPartDef("refresh", "更新", Icons.Filled.Refresh),
    ToolbarPartDef("favorite", "お気に入り", Icons.Filled.Bookmark),
    ToolbarPartDef("gallery", "画像一覧", Icons.Filled.PhotoLibrary),
    ToolbarPartDef("findNext", "次スレ", Icons.Filled.SkipNext),
    ToolbarPartDef("autoScroll", "実況", Icons.Filled.LiveTv),
    ToolbarPartDef("top", "先頭へ", Icons.Filled.VerticalAlignTop),
    ToolbarPartDef("bottom", "一番下へ", Icons.Filled.VerticalAlignBottom),
    ToolbarPartDef("openBoard", "板に戻る", Icons.AutoMirrored.Filled.List),
    ToolbarPartDef("share", "共有", Icons.Filled.Share),
    ToolbarPartDef("openBrowser", "ブラウザ", Icons.AutoMirrored.Filled.OpenInNew),
    ToolbarPartDef("style", "表示スタイル", Icons.Filled.Palette),
    ToolbarPartDef("delete", "ログ削除", Icons.Filled.Delete),
)

/** スレ一覧の部品(フッターの左にはいつもタブが並ぶ) */
val LIST_PARTS = listOf(
    ToolbarPartDef("spacer", "空き", Icons.Filled.SpaceBar, fills = true),
    ToolbarPartDef("search", "スレッド検索", Icons.Filled.Search),
    ToolbarPartDef("refresh", "更新", Icons.Filled.Refresh),
    ToolbarPartDef("newThread", "スレを立てる", Icons.Filled.EditNote),
    ToolbarPartDef("favorite", "お気に入り板", Icons.Filled.Star),
    ToolbarPartDef("style", "表示スタイル", Icons.Filled.Palette),
    ToolbarPartDef("top", "先頭へ", Icons.Filled.VerticalAlignTop),
    ToolbarPartDef("openBrowser", "ブラウザ", Icons.AutoMirrored.Filled.OpenInNew),
)

fun toolbarPartsOf(area: String): List<ToolbarPartDef> = if (area == "thread") THREAD_PARTS else LIST_PARTS
fun toolbarPart(area: String, id: String): ToolbarPartDef? = toolbarPartsOf(area).firstOrNull { it.id == id }

/** 既定の並び。スレ表示のフッターはチャット欄が幅を埋め、右端に更新 */
private fun defaultLayout(area: String): ToolbarLayout =
    if (area == "thread") ToolbarLayout(listOf("search"), listOf("replyField", "refresh")) else ToolbarLayout(listOf("search"), listOf("refresh"))

class ToolbarLayout(val header: List<String>, val footer: List<String>) {
    fun of(bar: ToolbarBar) = if (bar == ToolbarBar.HEADER) header else footer
    fun with(bar: ToolbarBar, ids: List<String>) = if (bar == ToolbarBar.HEADER) ToolbarLayout(ids, footer) else ToolbarLayout(header, ids)
    /** どの箱にも入っていない部品(︙ にだけ出る)。空きは何度でも入れられるので、いつも出す */
    fun unplaced(area: String): List<ToolbarPartDef> = toolbarPartsOf(area).filter { it.id == "spacer" || (it.id !in header && it.id !in footer) }
}

/** 保存してある並び。前の形(v1: 操作 → 置き場、と並び)からは読み替える */
fun toolbarLayout(prefs: Prefs, area: String): ToolbarLayout {
    val all = runCatching { JSONObject(prefs.barLayout) }.getOrNull() ?: return defaultLayout(area)
    val known = toolbarPartsOf(area).map { it.id }.toSet()
    fun ids(a: JSONArray?): List<String>? = a?.let { arr -> List(arr.length()) { arr.getString(it) }.filter { it in known } }
    if (all.optInt("v") == 2) {
        val o = all.optJSONObject(area) ?: return defaultLayout(area)
        return ToolbarLayout(ids(o.optJSONArray("header")) ?: emptyList(), ids(o.optJSONArray("footer")) ?: emptyList())
    }
    // v1 からの読み替え(0.1.14 のあとの試しの版だけ。置き場 header/footer と並び <area>_order)
    val places = all.optJSONObject(area) ?: return defaultLayout(area).let { d ->
        if (area == "thread" && !prefs.showRefreshFab) ToolbarLayout(d.header, d.footer - "refresh") else d
    }
    val order = ids(all.optJSONArray("${area}_order")) ?: emptyList()
    val ordered = order + toolbarPartsOf(area).map { it.id }.filter { it !in order }
    fun placeOf(id: String): String = places.optString(id, "").ifEmpty { if (id == "search") "header" else if (id == "refresh") (if (area == "thread" && !prefs.showRefreshFab) "menu" else "footer") else "menu" }
    val header = ordered.filter { it != "replyField" && it != "spacer" && placeOf(it) == "header" }
    val footer = ordered.filter { it != "replyField" && it != "spacer" && placeOf(it) == "footer" }
    return ToolbarLayout(header, if (area == "thread" && prefs.replyChat) listOf("replyField") + footer else footer)
}

fun saveToolbarLayout(prefs: Prefs, area: String, layout: ToolbarLayout) {
    val all = runCatching { JSONObject(prefs.barLayout).takeIf { it.optInt("v") == 2 } }.getOrNull() ?: JSONObject().put("v", 2)
    // 両方の画面を v2 の形で持つ(片方だけ新しい形にならないように)
    for (a in listOf("thread", "list")) if (!all.has(a) || a == area) {
        val l = if (a == area) layout else toolbarLayout(prefs, a)
        all.put(a, JSONObject().put("header", JSONArray(l.header)).put("footer", JSONArray(l.footer)))
    }
    prefs.barLayout = all.toString()
}

/** 部品を箱に入れる(index の所。ほかの箱にあれば外してから)。空き以外は 1 つだけ */
fun placeToolbarPart(prefs: Prefs, area: String, id: String, bar: ToolbarBar, index: Int) {
    var l = toolbarLayout(prefs, area)
    if (id != "spacer") l = ToolbarLayout(l.header.filter { it != id }, l.footer.filter { it != id })
    val ids = l.of(bar).toMutableList()
    ids.add(index.coerceIn(0, ids.size), id)
    saveToolbarLayout(prefs, area, l.with(bar, ids))
}

/** 箱の中で動かす(from → to) */
fun moveToolbarPart(prefs: Prefs, area: String, bar: ToolbarBar, from: Int, to: Int) {
    val l = toolbarLayout(prefs, area)
    val ids = l.of(bar).toMutableList()
    if (from !in ids.indices || to !in ids.indices) return
    ids.add(to, ids.removeAt(from))
    saveToolbarLayout(prefs, area, l.with(bar, ids))
}

/** 箱から外す(index の所の 1 つ) */
fun removeToolbarPart(prefs: Prefs, area: String, bar: ToolbarBar, index: Int) {
    val l = toolbarLayout(prefs, area)
    val ids = l.of(bar).toMutableList()
    if (index !in ids.indices) return
    ids.removeAt(index)
    saveToolbarLayout(prefs, area, l.with(bar, ids))
}

/** ボタンの大きさ(設定「ツールバー設定」)。アイコンの dp */
fun toolbarIconDp(prefs: Prefs): Int = when (prefs.toolbarIconSize) { "s" -> 20; "l" -> 28; else -> 24 }
/** ボタンの文字の大きさ(sp)。0 なら出さない */
fun toolbarLabelSp(prefs: Prefs): Int = when (prefs.toolbarLabel) { "s" -> 10; "m" -> 11; else -> 0 }

/**
 * ツールバーのボタン(アイコンと、設定で出すなら下に名前)。帯の高さは字を出すと少し増える。
 * 押せる範囲はアイコンの周りを広く取る(44dp 以上)
 */
@Composable
fun ToolbarButton(def: ToolbarPartDef, prefs: Prefs, modifier: Modifier = Modifier, tint: Color = Palette.textMuted, enabled: Boolean = true, onClick: () -> Unit) {
    val icon = toolbarIconDp(prefs)
    val label = toolbarLabelSp(prefs)
    Column(
        modifier.clip(RoundedCornerShape(8.dp)).clickable(enabled = enabled, onClick = onClick)
            .widthIn(min = (icon + 20).dp).heightIn(min = (icon + 20).dp).padding(horizontal = 6.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
    ) {
        Icon(def.icon, def.name, tint = tint, modifier = Modifier.size(icon.dp))
        if (label > 0) Text(def.name, color = tint, fontSize = label.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, lineHeight = (label + 2).sp)
    }
}
