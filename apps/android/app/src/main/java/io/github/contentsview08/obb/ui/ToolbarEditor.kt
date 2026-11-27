package io.github.contentsview08.obb.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel

/**
 * ツールバー設定(PC 版の「ボタンの配置」のスマホ版)。
 * 上に見た目(ボタンの大きさ・文字)、下に画面ごとの「ヘッダー」「フッター」の箱と「使えるボタン」(ChipDock)。
 * 「チャット欄」「空き」は残りの幅を埋めるので、その右に置いたものは右に寄る
 */
@Composable
fun ToolbarPage(vm: AppViewModel) {
    val p = vm.prefs
    PageLead("ヘッダーとフッターに出すボタンと、その並びを決めます。ボタンを長押しして掴み、箱に落として並べます(押すとメニューでも動かせます)。箱にないボタンは ︙ のメニューにだけ出ます(︙ にはいつも全部出ます)。「チャット欄」「空き」は残りの幅を埋めるので、その右に置いたものは右端に寄ります")
    Group("見た目") {
        ChoiceRow("ボタンの大きさ", p.toolbarIconSize, listOf("s" to "小", "m" to "標準", "l" to "大")) { p.toolbarIconSize = it }
        ChoiceRow("ボタンの文字", p.toolbarLabel, listOf("none" to "出さない", "s" to "小", "m" to "標準")) { p.toolbarLabel = it }
    }
    for ((area, title) in listOf("thread" to "スレ表示", "list" to "スレ一覧")) {
        Group(title, note = if (area == "list") "フッターの左にはいつもスレ一覧のタブが並びます。ボタンはその右に" else null) {
            val layout = toolbarLayout(p, area)
            fun item(id: String) = toolbarPart(area, id)?.let { DockItem(it.id, it.name, it.icon, it.fills) }
            ChipDock(
                docks = listOf(
                    DockSpec("header", "ヘッダー", layout.header.mapNotNull(::item), fixedLeading = "≡ 題名"),
                    DockSpec("footer", "フッター", layout.footer.mapNotNull(::item), fixedLeading = if (area == "list") "タブ" else null, emptyHint = if (area == "thread") "ここに入れる" else null),
                ),
                palette = layout.unplaced(area).map { DockItem(it.id, it.name, it.icon, it.fills) },
                onPlace = { dock, id, index -> placeToolbarPart(p, area, id, ToolbarBar.entries.first { it.key == dock }, index) },
                onMove = { dock, from, to -> moveToolbarPart(p, area, ToolbarBar.entries.first { it.key == dock }, from, to) },
                onRemove = { dock, index -> removeToolbarPart(p, area, ToolbarBar.entries.first { it.key == dock }, index) },
                // チャット欄・空きはフッターにだけ(ヘッダーは題名が幅を取る)
                allowIn = { item, dock -> !(item.fills && dock == "header") },
                paletteTitle = "使えるボタン",
                look = { item, placed -> ToolbarChipLook(vm, item, placed) },
            )
        }
    }
}

/** ツールバーの部品の見た目(帯に出るときと同じ大きさのアイコン。名前は、箱の外ではいつも、箱の中では設定で字を出すときだけ) */
@Composable
private fun ToolbarChipLook(vm: AppViewModel, item: DockItem, placed: Boolean) {
    val p = vm.prefs
    if (item.fills && placed) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (item.icon != null) { Icon(item.icon, null, tint = Palette.textMuted, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)) }
            Text(item.name, color = Palette.textMuted, fontSize = 12.sp)
        }
        return
    }
    Column(Modifier.padding(start = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        if (item.icon != null) Icon(item.icon, item.name, tint = if (item.id == "reply") Palette.accent else Palette.textMuted, modifier = Modifier.size(toolbarIconDp(p).dp))
        if (!placed || toolbarLabelSp(p) > 0) Text(item.name, color = Palette.textMuted, fontSize = maxOf(10, toolbarLabelSp(p)).sp, maxLines = 1)
    }
}
