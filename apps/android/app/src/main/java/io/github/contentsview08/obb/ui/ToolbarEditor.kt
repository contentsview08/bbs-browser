package io.github.contentsview08.obb.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.ui.draw.alpha
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
    PageLead("画面のヘッダーとフッターに出すボタン・タブと、その並びを決めます。変えたい画面を選んでください")
    androidx.compose.foundation.layout.Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        ScreenCard(vm, "thread", "スレッド表示画面", Modifier.weight(1f)) { open("bars_thread") }
        ScreenCard(vm, "list", "スレッド一覧画面", Modifier.weight(1f)) { open("bars_list") }
        ScreenCard(vm, "history", "履歴画面", Modifier.weight(1f)) { open("bars_history") }
    }
    Group("ボタンの見た目") {
        ChoiceRow("ボタンの大きさ", p.toolbarIconSize, listOf("s" to "小", "m" to "標準", "l" to "大")) { p.toolbarIconSize = it }
        ChoiceRow("ボタンの文字", p.toolbarLabel, listOf("none" to "出さない", "s" to "小", "m" to "標準")) { p.toolbarLabel = it }
    }
}

/**
 * 画面を選ぶ札。いまのヘッダー・フッターのボタンを小さく並べた画面の見本と、画面の名前
 * (設定の大項目の行と見分けがつくように、行ではなく画面の形にする)
 */
@Composable
private fun ScreenCard(vm: AppViewModel, area: String, name: String, modifier: Modifier, onClick: () -> Unit) {
    val p = vm.prefs
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)
    @Composable fun bar(ids: List<String>, tabs: List<String> = emptyList()) = Row(
        Modifier.fillMaxWidth().height(22.dp).background(Palette.bar).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        for (t in tabs) Text(t, color = Palette.textMuted, fontSize = 7.sp, maxLines = 1)
        Spacer(Modifier.weight(1f))
        for (id in ids.take(4)) toolbarPart(if (area == "history") "thread" else area, id)?.let { d ->
            if (d.fills) Box(Modifier.width(26.dp).height(12.dp).background(Palette.surface, androidx.compose.foundation.shape.RoundedCornerShape(6.dp)))
            else if (!d.tab) Icon(d.icon, null, tint = Palette.textMuted, modifier = Modifier.size(11.dp))
        }
    }
    Column(modifier.clip(shape).border(1.dp, Palette.border, shape).background(Palette.surface).clickable(onClick = onClick).padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(Modifier.fillMaxWidth().clip(androidx.compose.foundation.shape.RoundedCornerShape(6.dp)).border(1.dp, Palette.borderStrong, androidx.compose.foundation.shape.RoundedCornerShape(6.dp)).background(Palette.base)) {
            when (area) {
                "history" -> {
                    val tabs = shownPastTabs(p.pastTabs).map { k -> PAST_TABS.first { it.first == k }.second }
                    if (p.pastTabsPosition == "header") bar(emptyList(), tabs) else bar(emptyList())
                    MockLines()
                    if (p.pastTabsPosition != "header") bar(emptyList(), tabs) else bar(emptyList())
                }
                else -> {
                    val l = toolbarLayout(p, area)
                    bar(l.header)
                    MockLines()
                    bar(l.footer.filter { !it.startsWith("tab:") }, l.footer.filter { it.startsWith("tab:") }.mapNotNull { toolbarPart(area, it)?.name })
                }
            }
        }
        Text(name, Modifier.padding(top = 6.dp), color = Palette.textStrong, fontSize = 12.sp, maxLines = 1)
    }
}

@Composable
private fun MockLines() = Column(Modifier.fillMaxWidth().height(56.dp).padding(6.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
    for (w in listOf(0.9f, 0.6f, 0.75f)) Box(Modifier.fillMaxWidth(w).height(5.dp).background(Palette.surface2, androidx.compose.foundation.shape.RoundedCornerShape(3.dp)))
}

/** 画面ごとのボタンの配置(スレッド表示画面・スレッド一覧画面)。実際の画面の形の見本に、部品をつかんで入れる */
@Composable
fun ToolbarAreaPage(vm: AppViewModel, area: String) {
    val p = vm.prefs
    PageLead(
        if (area == "list") "スレッド一覧画面のヘッダーとフッターです。フッターのタブ(並べ方・絞り込み)もボタンと同じように、どこにでも置けます。「左右の境目」より左は左に、右は右に寄ります。部品を長押しして掴み、箱に落とすと入ります(押すとメニューでも動かせます)。箱にないボタンは ︙ のメニューにだけ出ます"
        else "スレッド表示画面のヘッダーとフッターです。部品を長押しして掴み、箱に落とすと入ります(押すとメニューでも動かせます)。箱にないボタンは ︙ のメニューにだけ出ます。「チャット欄」「空き」は残りの幅を埋めるので、その右に置いたものは右端に寄ります",
    )
    val layout = toolbarLayout(p, area)
    fun item(id: String) = toolbarPart(area, id)?.let { DockItem(it.id, it.name, it.icon, it.fills) }
    Group {
        ChipDock(
            docks = listOf(
                DockSpec("header", "ヘッダー", layout.header.mapNotNull(::item), fixedLeading = if (area == "list") "≡  板の名前" else "≡  スレタイ"),
                DockSpec("footer", "フッター", layout.footer.mapNotNull(::item), emptyHint = "ここに入れる", atBottom = true),
            ),
            screenMock = if (area == "list") "ここにスレが並びます" else "ここにレスが並びます",
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
    PageLead("履歴画面に出すタブと、その並び(左から)です。タブを長押しして掴み、箱に落とすと入ります(押すとメニューでも動かせます)。すべては外せません")
    Group {
        val on = shownPastTabs(p.pastTabs)
        fun item(k: String) = DockItem(k, PAST_TABS.first { it.first == k }.second, null)
        ChipDock(
            docks = listOf(DockSpec("tabs", if (p.pastTabsPosition == "header") "ヘッダーのタブ" else "フッターのタブ", on.map(::item), minItems = 1, alignEnd = false, atBottom = p.pastTabsPosition != "header")),
            screenMock = "ここに履歴が並びます",
            palette = PAST_TABS.filter { it.first !in on }.map { item(it.first) },
            onPlace = { _, id, index -> p.pastTabs = on.toMutableList().apply { add(index.coerceIn(0, size), id) }.joinToString(",") },
            onMove = { _, from, to -> p.pastTabs = on.toMutableList().apply { add(to, removeAt(from)) }.joinToString(",") },
            onRemove = { _, index -> if (on.size > 1) p.pastTabs = on.filterIndexed { i, _ -> i != index }.joinToString(",") },
            paletteTitle = "使えるタブ",
            plainPlaced = true,
            look = { it, _ -> Text(it.name, Modifier.padding(horizontal = 8.dp, vertical = 10.dp), color = Palette.textMuted, fontSize = 14.sp, maxLines = 1) },
        )
    }
    Group {
        ChoiceRow("タブの置き場", p.pastTabsPosition, listOf("footer" to "フッター(下)", "header" to "ヘッダー(上)")) { p.pastTabsPosition = it }
    }
}

/** チャット欄の見本(ThreadFooter の欄と同じ寸法・色。押せない) */
@Composable
fun ReplyFieldLook(p: io.github.contentsview08.obb.data.Prefs) {
    val control = (p.footerHeight - 8).coerceIn(28, 40)
    val shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp)
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).heightIn(min = control.dp).background(Palette.surface, shape).border(1.dp, Palette.border, shape), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(control.dp), contentAlignment = Alignment.Center) { Icon(Icons.Filled.Add, null, tint = Palette.textMuted, modifier = Modifier.size(24.dp)) }
            Text("書き込む", Modifier.weight(1f).padding(end = 14.dp), color = Palette.textMuted, fontSize = 15.sp, maxLines = 1)
        }
        Spacer(Modifier.width(6.dp))
        Box(Modifier.size(control.dp).alpha(0.4f).background(Palette.accent, androidx.compose.foundation.shape.CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.AutoMirrored.Filled.Send, null, tint = Palette.accentText, modifier = Modifier.size(20.dp))
        }
    }
}

/** 部品の見た目。タブは実際のフッターのタブと同じ(アイコン・名前・並べ方の矢印)、ボタンは帯と同じ大きさのアイコン */
@Composable
private fun ToolbarChipLook(vm: AppViewModel, item: DockItem, placed: Boolean) {
    val p = vm.prefs
    if (item.id.startsWith("tab:")) {
        Row(Modifier.heightIn(min = 40.dp).padding(horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            if (item.icon != null) Icon(item.icon, null, tint = Palette.textMuted, modifier = Modifier.size(17.dp))
            // 実際のフッターと同じく、狭ければ名前を「…」で省く(並べ方の矢印は選んでいるタブにだけ出るので、ここでは出さない)
            if (!(placed && LocalChipCompact.current)) Text(item.name, Modifier.weight(1f, fill = false), color = Palette.textMuted, fontSize = 14.sp, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, softWrap = false)
        }
        return
    }
    // チャット欄は、実際のチャット欄と同じ見た目(＋・丸い欄・送るの丸)。置いたら、そのまま実際の帯の形が分かる
    if (item.id == "replyField" && placed) { ReplyFieldLook(p); return }
    if (item.fills && placed) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (item.icon != null) { Icon(item.icon, null, tint = Palette.textMuted, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)) }
            Text(item.name, color = Palette.textMuted, fontSize = 12.sp)
        }
        return
    }
    Column(Modifier.padding(horizontal = 4.dp, vertical = 2.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        if (item.icon != null) Icon(item.icon, item.name, tint = if (item.id == "reply") Palette.accent else Palette.textMuted, modifier = Modifier.size(toolbarIconDp(p).dp))
        if (!placed || (toolbarLabelSp(p) > 0 && !LocalChipCompact.current)) Text(item.name, color = Palette.textMuted, fontSize = maxOf(10, toolbarLabelSp(p)).sp, maxLines = 1)
    }
}
