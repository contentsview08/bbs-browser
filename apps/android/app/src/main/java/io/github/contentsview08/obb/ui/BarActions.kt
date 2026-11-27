package io.github.contentsview08.obb.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Bookmark
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
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.VerticalAlignBottom
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.ui.graphics.vector.ImageVector
import io.github.contentsview08.obb.data.Prefs
import org.json.JSONObject

/**
 * スレ表示・スレ一覧の操作ボタンの置き場(PC 版の utils/toolbar.ts の Placement のスマホ版)。
 * ︙ のメニューにはいつも全部出る。ヘッダーの右・フッターの右に置いたものだけ、帯にもボタンとして並ぶ(ChMate のツールバーのように)。
 * 設定の「ボタンの配置」で変える。保存は Prefs.barLayout(JSON: {"thread": {id: 置き場}, "list": {...}}。変えたものだけ)
 */
enum class BarPlace(val key: String, val label: String) {
    HEADER("header", "ヘッダーの右"),
    FOOTER("footer", "フッターの右"),
    MENU("menu", "︙ の中だけ"),
    /** 書き込み欄だけ: フッターに欄として広げる(チャットの形)。ほかの置き場ならボタンになり、押すと書き込みのパネルが上に出る */
    FIELD("field", "フッターの欄"),
}

class BarActionDef(val id: String, val name: String, val icon: ImageVector, val default: BarPlace)

/** スレ表示の操作(並べる順。更新の既定は showRefreshFab に従う) */
val THREAD_BAR_ACTIONS = listOf(
    BarActionDef("reply", "書き込み欄", Icons.Filled.Edit, BarPlace.FIELD),
    BarActionDef("search", "レス検索", Icons.Filled.Search, BarPlace.HEADER),
    BarActionDef("refresh", "更新", Icons.Filled.Refresh, BarPlace.FOOTER),
    BarActionDef("favorite", "お気に入りのスレ", Icons.Filled.Bookmark, BarPlace.MENU),
    BarActionDef("gallery", "画像一覧", Icons.Filled.PhotoLibrary, BarPlace.MENU),
    BarActionDef("findNext", "次スレを探す", Icons.Filled.SkipNext, BarPlace.MENU),
    BarActionDef("autoScroll", "実況モード", Icons.Filled.LiveTv, BarPlace.MENU),
    BarActionDef("top", "先頭へ", Icons.Filled.VerticalAlignTop, BarPlace.MENU),
    BarActionDef("bottom", "一番下へ", Icons.Filled.VerticalAlignBottom, BarPlace.MENU),
    BarActionDef("openBoard", "板に戻る", Icons.AutoMirrored.Filled.List, BarPlace.MENU),
    BarActionDef("share", "共有", Icons.Filled.Share, BarPlace.MENU),
    BarActionDef("openBrowser", "ブラウザで開く", Icons.AutoMirrored.Filled.OpenInNew, BarPlace.MENU),
    BarActionDef("style", "表示スタイル", Icons.Filled.Palette, BarPlace.MENU),
    BarActionDef("delete", "ログを削除して閉じる", Icons.Filled.Delete, BarPlace.MENU),
)

/** スレ一覧の操作(並べる順) */
val LIST_BAR_ACTIONS = listOf(
    BarActionDef("search", "スレッド検索", Icons.Filled.Search, BarPlace.HEADER),
    BarActionDef("refresh", "更新", Icons.Filled.Refresh, BarPlace.FOOTER),
    BarActionDef("newThread", "スレを立てる", Icons.Filled.EditNote, BarPlace.MENU),
    BarActionDef("favorite", "お気に入り板", Icons.Filled.Star, BarPlace.MENU),
    BarActionDef("style", "表示スタイル", Icons.Filled.Palette, BarPlace.MENU),
    BarActionDef("top", "先頭へ", Icons.Filled.VerticalAlignTop, BarPlace.MENU),
    BarActionDef("openBrowser", "ブラウザで開く", Icons.AutoMirrored.Filled.OpenInNew, BarPlace.MENU),
)

fun barActionsOf(area: String): List<BarActionDef> = if (area == "thread") THREAD_BAR_ACTIONS else LIST_BAR_ACTIONS

/** 操作の並び(設定で動かした順。保存にないもの(あとで増えたもの)は既定の順で後ろに)。帯に並ぶ順もこの順 */
fun barOrder(prefs: Prefs, area: String): List<BarActionDef> {
    val defs = barActionsOf(area)
    val saved = runCatching { JSONObject(prefs.barLayout).optJSONArray("${area}_order") }.getOrNull()
    val ids = saved?.let { a -> List(a.length()) { a.getString(it) } } ?: emptyList()
    val byId = defs.associateBy { it.id }
    return ids.mapNotNull { byId[it] } + defs.filter { it.id !in ids }
}

fun moveBarAction(prefs: Prefs, area: String, from: Int, to: Int) {
    val ids = barOrder(prefs, area).map { it.id }.toMutableList()
    if (from !in ids.indices || to !in ids.indices) return
    ids.add(to, ids.removeAt(from))
    val all = runCatching { JSONObject(prefs.barLayout) }.getOrDefault(JSONObject())
    all.put("${area}_order", org.json.JSONArray(ids))
    prefs.barLayout = all.toString()
}

/** 操作 id → 置き場。保存してあるものに既定を足す。スレ表示の更新は、前からある「更新ボタンを出す」(showRefreshFab)を既定にする */
fun barPlacements(prefs: Prefs, area: String): Map<String, BarPlace> {
    val saved = runCatching { JSONObject(prefs.barLayout).optJSONObject(area) }.getOrNull()
    return barActionsOf(area).associate { d ->
        val fromSaved = saved?.optString(d.id, "")?.takeIf { it.isNotEmpty() }?.let { k -> BarPlace.entries.firstOrNull { it.key == k } }
        val def = if (area == "thread" && d.id == "refresh" && !prefs.showRefreshFab) BarPlace.MENU else d.default
        d.id to (fromSaved ?: def)
    }
}

fun setBarPlacement(prefs: Prefs, area: String, id: String, place: BarPlace) {
    val all = runCatching { JSONObject(prefs.barLayout) }.getOrDefault(JSONObject())
    val o = all.optJSONObject(area) ?: JSONObject()
    o.put(id, place.key)
    all.put(area, o)
    prefs.barLayout = all.toString()
    // スレ表示の更新は、前からある設定と合わせておく(古い版へ戻しても同じ見え方)
    if (area == "thread" && id == "refresh") prefs.showRefreshFab = place == BarPlace.FOOTER
}
