package io.github.contentsview08.obb.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import kotlin.math.roundToInt

/**
 * ツールバー設定(PC 版の「ボタンの配置」のスマホ版)。
 * 上に見た目(ボタンの大きさ・文字)、下に画面ごとの「ヘッダー」「フッター」の箱と「使えるボタン」。
 * 部品を長押しして掴み、箱に落として並べる(箱の中で動かす・別の箱へ・箱の外へ出すと外れる)。
 * 押すとメニュー(左へ・右へ・外す / ヘッダーへ・フッターへ)でも動かせる。
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
            ToolbarEditor(vm, area)
        }
    }
}

/** 掴んでいる部品 */
private class Dragging(val id: String, val from: ToolbarBar?, val fromIndex: Int, val size: androidx.compose.ui.unit.IntSize) {
    var pos by mutableStateOf(Offset.Zero)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ToolbarEditor(vm: AppViewModel, area: String) {
    val p = vm.prefs
    val layout = toolbarLayout(p, area)
    val view = LocalView.current
    /** 箱・部品の、画面(root)の中の位置。落とす先を決めるのに使う */
    val barBounds = remember { mutableStateMapOf<ToolbarBar, Rect>() }
    val chipBounds = remember { mutableStateMapOf<String, Rect>() } // "bar:index"
    var rootBounds by remember { mutableStateOf(Rect.Zero) }
    var dragging by remember { mutableStateOf<Dragging?>(null) }

    /** 落とす: 箱の上なら、その箱の中の位置(左から何番目か)へ。箱の外なら外す */
    fun drop(d: Dragging) {
        val bar = ToolbarBar.entries.firstOrNull { barBounds[it]?.let { b -> b.inflate(16f).contains(d.pos) } == true }
        if (bar == null) {
            if (d.from != null) removeToolbarPart(p, area, d.from, d.fromIndex)
            return
        }
        val l = toolbarLayout(p, area)
        val ids = l.of(bar)
        // 掴んだ部品の分を除いた並びで、指の x より左にある部品の数が入れる位置
        var index = 0
        for (i in ids.indices) {
            if (bar == d.from && i == d.fromIndex) continue
            val b = chipBounds["${bar.key}:$i"] ?: continue
            if (d.pos.x > b.center.x) index++
        }
        if (bar == d.from) {
            if (index != d.fromIndex) moveToolbarPart(p, area, bar, d.fromIndex, index)
        } else {
            if (d.from != null) removeToolbarPart(p, area, d.from, d.fromIndex)
            placeToolbarPart(p, area, d.id, bar, index)
        }
        Haptics.tick(view)
    }

    /** 部品 1 つ(箱の中・使えるボタンの両方)。長押しで掴む。押すとメニュー */
    @Composable
    fun Chip(def: ToolbarPartDef, bar: ToolbarBar?, index: Int, placedKey: String?) {
        var menu by remember { mutableStateOf(false) }
        var bounds by remember { mutableStateOf(Rect.Zero) }
        val hidden = dragging?.let { it.from == bar && it.fromIndex == index && it.id == def.id } == true
        Box(
            Modifier
                .onGloballyPositioned { c -> bounds = c.boundsInRoot(); if (placedKey != null) chipBounds[placedKey] = bounds }
                .graphicsLayer { alpha = if (hidden) 0.25f else 1f }
                .pointerInput(def.id, bar, index) {
                    detectDragGesturesAfterLongPress(
                        onDragStart = { o ->
                            Haptics.longPress(view)
                            dragging = Dragging(def.id, bar, index, androidx.compose.ui.unit.IntSize(bounds.width.roundToInt(), bounds.height.roundToInt())).also { it.pos = bounds.topLeft + o }
                        },
                        onDragEnd = { dragging?.let { drop(it) }; dragging = null },
                        onDragCancel = { dragging = null },
                    ) { change, delta -> change.consume(); dragging?.let { it.pos += delta } }
                },
        ) {
            ChipLook(def, vm, fills = def.fills, placed = bar != null) { menu = true }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                if (bar != null) {
                    val ids = layout.of(bar)
                    if (index > 0) DropdownMenuItem(text = { Text("左へ", fontSize = 14.sp) }, onClick = { menu = false; moveToolbarPart(p, area, bar, index, index - 1) })
                    if (index < ids.lastIndex) DropdownMenuItem(text = { Text("右へ", fontSize = 14.sp) }, onClick = { menu = false; moveToolbarPart(p, area, bar, index, index + 1) })
                    val other = if (bar == ToolbarBar.HEADER) ToolbarBar.FOOTER else ToolbarBar.HEADER
                    if (!def.fills || other == ToolbarBar.FOOTER) DropdownMenuItem(text = { Text("${other.label}へ", fontSize = 14.sp) }, onClick = { menu = false; removeToolbarPart(p, area, bar, index); placeToolbarPart(p, area, def.id, other, Int.MAX_VALUE) })
                    DropdownMenuItem(text = { Text("外す", color = Palette.heatVeryHot, fontSize = 14.sp) }, onClick = { menu = false; removeToolbarPart(p, area, bar, index) })
                } else {
                    // チャット欄・空きはフッターにだけ
                    if (!def.fills) DropdownMenuItem(text = { Text("ヘッダーに入れる", fontSize = 14.sp) }, onClick = { menu = false; placeToolbarPart(p, area, def.id, ToolbarBar.HEADER, Int.MAX_VALUE) })
                    DropdownMenuItem(text = { Text("フッターに入れる", fontSize = 14.sp) }, onClick = { menu = false; placeToolbarPart(p, area, def.id, ToolbarBar.FOOTER, Int.MAX_VALUE) })
                }
            }
        }
    }

    /** 箱(ヘッダー・フッター)。中の部品を左から並べる。空なら案内 */
    @Composable
    fun BarBox(bar: ToolbarBar) {
        val ids = layout.of(bar)
        val over = dragging?.let { d -> barBounds[bar]?.inflate(16f)?.contains(d.pos) == true } == true
        Text(bar.label, Modifier.padding(start = 16.dp, top = 8.dp, bottom = 4.dp), color = Palette.textMuted, fontSize = 12.sp)
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp).heightIn(min = 56.dp)
                .onGloballyPositioned { barBounds[bar] = it.boundsInRoot() }
                .clip(RoundedCornerShape(8.dp)).background(Palette.bar)
                .border(BorderStroke(if (over) 2.dp else 1.dp, if (over) Palette.accent else Palette.border), RoundedCornerShape(8.dp))
                .padding(horizontal = 6.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (bar == ToolbarBar.HEADER) Text("≡ 題名", Modifier.weight(1f).padding(start = 6.dp), color = Palette.textMuted, fontSize = 12.sp)
            else if (area == "list") Text("タブ", Modifier.weight(1f).padding(start = 6.dp), color = Palette.textMuted, fontSize = 12.sp)
            else if (ids.none { toolbarPart(area, it)?.fills == true }) Spacer(Modifier.weight(1f))
            if (ids.isEmpty() && bar == ToolbarBar.FOOTER && area == "thread") Text("ここに入れる", Modifier.padding(end = 8.dp), color = Palette.textMuted, fontSize = 12.sp)
            for ((i, id) in ids.withIndex()) {
                val def = toolbarPart(area, id) ?: continue
                if (def.fills) Box(Modifier.weight(1f).padding(horizontal = 2.dp), contentAlignment = Alignment.Center) { Chip(def, bar, i, "${bar.key}:$i") }
                else Chip(def, bar, i, "${bar.key}:$i")
            }
        }
    }

    Box(Modifier.fillMaxWidth().onGloballyPositioned { rootBounds = it.boundsInRoot() }) {
        Column(Modifier.fillMaxWidth()) {
            BarBox(ToolbarBar.HEADER)
            BarBox(ToolbarBar.FOOTER)
            Text("使えるボタン(長押しで掴む)", Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp), color = Palette.textMuted, fontSize = 12.sp)
            FlowRow(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (def in layout.unplaced(area)) Chip(def, null, -1, null)
            }
            Spacer(Modifier.size(8.dp))
        }
        // 掴んでいる部品は指に付いて動く
        dragging?.let { d ->
            val def = toolbarPart(area, d.id) ?: return@let
            Box(
                Modifier.offset { IntOffset((d.pos.x - rootBounds.left - d.size.width / 2).roundToInt(), (d.pos.y - rootBounds.top - d.size.height / 2).roundToInt()) }
                    .graphicsLayer { shadowElevation = 16f; alpha = 0.92f },
            ) { ChipLook(def, vm, fills = def.fills, placed = true) {} }
        }
    }
}

/** 部品の見た目(帯に出るときと同じ大きさのアイコンと名前。チャット欄・空きは枠で表す) */
@Composable
private fun ChipLook(def: ToolbarPartDef, vm: AppViewModel, fills: Boolean, placed: Boolean, onClick: () -> Unit) {
    val p = vm.prefs
    if (fills && placed) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(10.dp)).background(Palette.surface)
                .border(1.dp, Palette.border, RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(def.icon, null, tint = Palette.textMuted, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(def.name, color = Palette.textMuted, fontSize = 12.sp)
        }
    } else {
        Column(
            Modifier.clip(RoundedCornerShape(8.dp)).background(if (placed) androidx.compose.ui.graphics.Color.Transparent else Palette.surface)
                .border(1.dp, if (placed) androidx.compose.ui.graphics.Color.Transparent else Palette.border, RoundedCornerShape(8.dp))
                .clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(def.icon, def.name, tint = if (def.id == "reply") Palette.accent else Palette.textMuted, modifier = Modifier.size(toolbarIconDp(p).dp))
            // 使えるボタンの方は、名前がないと何か分からないのでいつも出す
            if (!placed || toolbarLabelSp(p) > 0) Text(def.name, color = Palette.textMuted, fontSize = maxOf(10, toolbarLabelSp(p)).sp, maxLines = 1)
        }
    }
}
