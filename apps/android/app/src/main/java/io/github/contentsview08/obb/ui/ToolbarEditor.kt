package io.github.contentsview08.obb.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.History
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.data.PAST_TABS
import io.github.contentsview08.obb.data.shownPastTabs

/**
 * ボタンの配置(PC 版の「ボタンの配置」のスマホ版)。入口のページ: ボタンの見た目と、画面ごとのページへの行。
 * 画面ごとのページ(ToolbarAreaPage・HistoryTabsPage)で、実際の帯を写した箱に部品を掴んで入れる(ChipDock)
 */
@Composable
fun ToolbarPage(vm: AppViewModel, open: (String) -> Unit) {
    val p = vm.prefs
    PageLead("画面のヘッダーとフッターに出すボタン・タブと、その並びを決めます。画面を選ぶと、実際の帯の形の箱が出ます")
    Group("画面") {
        NavRowPublic(Icons.Filled.Forum, Color(0xFF3B82F6), "スレ表示", "ヘッダー・フッターのボタン・チャット欄") { open("bars_thread") }
        NavRowPublic(Icons.AutoMirrored.Filled.ViewList, Color(0xFF0EA5E9), "スレ一覧", "ヘッダーのボタン・フッターのタブとボタン") { open("bars_list") }
        NavRowPublic(Icons.Filled.History, Color(0xFF0D9488), "履歴", "タブの並び・置き場") { open("bars_history") }
    }
    Group("ボタンの見た目") {
        ChoiceRow("ボタンの大きさ", p.toolbarIconSize, listOf("s" to "小", "m" to "標準", "l" to "大")) { p.toolbarIconSize = it }
        ChoiceRow("ボタンの文字", p.toolbarLabel, listOf("none" to "出さない", "s" to "小", "m" to "標準")) { p.toolbarLabel = it }
    }
}

/** 画面ごとのボタンの配置(スレ表示・スレ一覧)。ヘッダー・フッターの箱と、使えるボタン */
@Composable
fun ToolbarAreaPage(vm: AppViewModel, area: String) {
    val p = vm.prefs
    PageLead(
        if (area == "list") "スレ一覧のヘッダーとフッターです。フッターにはタブ(並べ方・絞り込み)とボタンが並びます。部品を長押しして掴み、箱に落とすと入ります(押すとメニューでも動かせます)。箱にないボタンは ︙ のメニューにだけ出ます"
        else "スレ表示のヘッダーとフッターです。部品を長押しして掴み、箱に落とすと入ります(押すとメニューでも動かせます)。箱にないボタンは ︙ のメニューにだけ出ます。「チャット欄」「空き」は残りの幅を埋めるので、その右に置いたものは右端に寄ります",
    )
    val layout = toolbarLayout(p, area)
    fun item(id: String) = toolbarPart(area, id)?.let { DockItem(it.id, it.name, it.icon, it.fills) }
    Group {
        ChipDock(
            docks = listOf(
                DockSpec("header", "ヘッダー", layout.header.mapNotNull(::item), fixedLeading = "≡ 題名"),
                DockSpec("footer", "フッター", layout.footer.mapNotNull(::item), emptyHint = "ここに入れる"),
            ),
            palette = layout.unplaced(area).map { DockItem(it.id, it.name, it.icon, it.fills) },
            onPlace = { dock, id, index -> placeToolbarPart(p, area, id, ToolbarBar.entries.first { it.key == dock }, index) },
            onMove = { dock, from, to -> moveToolbarPart(p, area, ToolbarBar.entries.first { it.key == dock }, from, to) },
            onRemove = { dock, index -> removeToolbarPart(p, area, ToolbarBar.entries.first { it.key == dock }, index) },
            // チャット欄・空き・タブはフッターにだけ(ヘッダーは題名が幅を取る)
            allowIn = { item, dock -> !(dock == "header" && (item.fills || item.id.startsWith("tab:"))) },
            paletteTitle = "使える部品",
            plainPlaced = true,
            look = { item, placed -> ToolbarChipLook(vm, item, placed) },
        )
    }
}

/** 履歴の画面のタブ(並び・置き場) */
@Composable
fun HistoryTabsPage(vm: AppViewModel) {
    val p = vm.prefs
    PageLead("履歴の画面に出すタブと、その並び(左から)です。タブを長押しして掴み、箱に落とすと入ります(押すとメニューでも動かせます)。すべては外せません")
    Group {
        val on = shownPastTabs(p.pastTabs)
        fun item(k: String) = DockItem(k, PAST_TABS.first { it.first == k }.second, null)
        ChipDock(
            docks = listOf(DockSpec("tabs", if (p.pastTabsPosition == "header") "ヘッダーのタブ" else "フッターのタブ", on.map(::item), minItems = 1, alignEnd = false)),
            palette = PAST_TABS.filter { it.first !in on }.map { item(it.first) },
            onPlace = { _, id, index -> p.pastTabs = on.toMutableList().apply { add(index.coerceIn(0, size), id) }.joinToString(",") },
            onMove = { _, from, to -> p.pastTabs = on.toMutableList().apply { add(to, removeAt(from)) }.joinToString(",") },
            onRemove = { _, index -> if (on.size > 1) p.pastTabs = on.filterIndexed { i, _ -> i != index }.joinToString(",") },
            paletteTitle = "使えるタブ",
            plainPlaced = true,
            look = { it, _ -> Text(it.name, Modifier.padding(horizontal = 8.dp, vertical = 10.dp), color = Palette.textMuted, fontSize = 14.sp) },
        )
    }
    Group {
        ChoiceRow("タブの置き場", p.pastTabsPosition, listOf("footer" to "フッター(下)", "header" to "ヘッダー(上)")) { p.pastTabsPosition = it }
    }
}

/** 部品の見た目。タブは実際のフッターのタブと同じ(アイコン・名前・並べ方の矢印)、ボタンは帯と同じ大きさのアイコン */
@Composable
private fun ToolbarChipLook(vm: AppViewModel, item: DockItem, placed: Boolean) {
    val p = vm.prefs
    if (item.id.startsWith("tab:")) {
        Row(Modifier.heightIn(min = 40.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (item.icon != null) Icon(item.icon, null, tint = Palette.textMuted, modifier = Modifier.size(17.dp))
            Text(item.name, color = Palette.textMuted, fontSize = 14.sp)
            if (item.id !in setOf("tab:unread", "tab:visited", "tab:keyword")) Icon(Icons.Filled.ArrowDownward, null, tint = Palette.textMuted.copy(alpha = 0.5f), modifier = Modifier.size(14.dp))
        }
        return
    }
    if (item.fills && placed) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (item.icon != null) { Icon(item.icon, null, tint = Palette.textMuted, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)) }
            Text(item.name, color = Palette.textMuted, fontSize = 12.sp)
        }
        return
    }
    Column(Modifier.padding(horizontal = 4.dp, vertical = 2.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        if (item.icon != null) Icon(item.icon, item.name, tint = if (item.id == "reply") Palette.accent else Palette.textMuted, modifier = Modifier.size(toolbarIconDp(p).dp))
        if (!placed || toolbarLabelSp(p) > 0) Text(item.name, color = Palette.textMuted, fontSize = maxOf(10, toolbarLabelSp(p)).sp, maxLines = 1)
    }
}
