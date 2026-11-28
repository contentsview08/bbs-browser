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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DragIndicator
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/**
 * 「箱に部品を掴んで入れる」設定の部品(ツールバー設定・スレ一覧のタブ・履歴のタブで共通。PC 版の ChipDock と同じ考え方)。
 * 上に箱(1 つか 2 つ)、下に「使えるもの」。部品を長押しして掴み、箱に落とすと入る(箱の中で動かす・別の箱へ・箱の外へ出すと外す)。
 * 押すとメニュー(左へ・右へ・別の箱へ・外す / 箱に入れる)でも動かせる。部品には ⋮⋮ の印を付けて、掴めることが見て分かるように
 */
class DockItem(val id: String, val name: String, val icon: ImageVector?, /** 残りの幅を埋める(チャット欄・空き) */ val fills: Boolean = false)

class DockSpec(
    val key: String,
    val label: String,
    val items: List<DockItem>,
    /** 箱の左に固定で出るもの(題名・タブなど)。あれば幅を取るので、部品は右に寄る */
    val fixedLeading: String? = null,
    /** 空のときの案内 */
    val emptyHint: String? = null,
    /** これより少なくは外せない(履歴のタブは 1 つ残す) */
    val minItems: Int = 0,
    /** 部品を右に寄せる(ツールバー: 題名の右に並ぶ)。タブは左から */
    val alignEnd: Boolean = true,
    /** 残りの幅を取って左から並ぶまとまり(スレ一覧のフッターのタブ)。ほかの部品はその左右に(実際のフッターと同じ) */
    val flexGroup: ((DockItem) -> Boolean)? = null,
    /** 画面の見本の中で、下の帯(フッター)に置く */
    val atBottom: Boolean = false,
)

private class DockDrag(val id: String, val from: String?, val fromIndex: Int, val size: IntSize) {
    var pos by mutableStateOf(Offset.Zero)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChipDock(
    docks: List<DockSpec>,
    palette: List<DockItem>,
    /** 箱 key に item を index の所へ入れる(ほかの箱にあれば呼ぶ側で外す) */
    onPlace: (dock: String, id: String, index: Int) -> Unit,
    onMove: (dock: String, from: Int, to: Int) -> Unit,
    onRemove: (dock: String, index: Int) -> Unit,
    /** item をその箱に入れてよいか(チャット欄はフッターだけ、など) */
    allowIn: (item: DockItem, dock: String) -> Boolean = { _, _ -> true },
    paletteTitle: String = "使えるもの",
    /** 部品の見た目(アイコンの大きさ・字)。null なら既定 */
    look: @Composable ((item: DockItem, placed: Boolean) -> Unit)? = null,
    /** 箱の中の部品は枠を付けず、実際の帯と同じ見た目で出す(スレ一覧のタブ) */
    plainPlaced: Boolean = false,
    /** 箱を、実際の画面の見本(上の帯・中身・下の帯)の形で描く。中身の所に出す字 */
    screenMock: String? = null,
) {
    val view = LocalView.current
    val dockBounds = remember { mutableStateMapOf<String, Rect>() }
    val chipBounds = remember { mutableStateMapOf<String, Rect>() } // "dock:index"
    var rootBounds by remember { mutableStateOf(Rect.Zero) }
    var dragging by remember { mutableStateOf<DockDrag?>(null) }
    fun itemOf(id: String) = (palette + docks.flatMap { it.items }).firstOrNull { it.id == id }

    fun drop(d: DockDrag) {
        val item = itemOf(d.id) ?: return
        val target = docks.firstOrNull { dk -> dockBounds[dk.key]?.inflate(16f)?.contains(d.pos) == true && allowIn(item, dk.key) }
        if (target == null) {
            val from = docks.firstOrNull { it.key == d.from }
            if (from != null && from.items.size > from.minItems) onRemove(from.key, d.fromIndex)
            return
        }
        var index = 0
        for (i in target.items.indices) {
            if (target.key == d.from && i == d.fromIndex) continue
            val b = chipBounds["${target.key}:$i"] ?: continue
            if (d.pos.x > b.center.x) index++
        }
        if (target.key == d.from) {
            if (index != d.fromIndex) onMove(target.key, d.fromIndex, index)
        } else {
            val from = docks.firstOrNull { it.key == d.from }
            if (from != null) {
                if (from.items.size <= from.minItems) return
                onRemove(from.key, d.fromIndex)
            }
            onPlace(target.key, d.id, index)
        }
        Haptics.tick(view)
    }

    @Composable
    fun Chip(item: DockItem, dock: DockSpec?, index: Int) {
        var menu by remember { mutableStateOf(false) }
        var bounds by remember { mutableStateOf(Rect.Zero) }
        val hidden = dragging?.let { it.from == dock?.key && it.fromIndex == index && it.id == item.id } == true
        val placedKey = dock?.let { "${it.key}:$index" }
        Box(
            Modifier
                .onGloballyPositioned { c -> bounds = c.boundsInRoot(); if (placedKey != null) chipBounds[placedKey] = bounds }
                .graphicsLayer { alpha = if (hidden) 0.25f else 1f }
                .pointerInput(item.id, dock?.key, index) {
                    detectDragGesturesAfterLongPress(
                        onDragStart = { o ->
                            Haptics.longPress(view)
                            dragging = DockDrag(item.id, dock?.key, index, IntSize(bounds.width.roundToInt(), bounds.height.roundToInt())).also { it.pos = bounds.topLeft + o }
                        },
                        onDragEnd = { dragging?.let { drop(it) }; dragging = null },
                        onDragCancel = { dragging = null },
                    ) { change, delta -> change.consume(); dragging?.let { it.pos += delta } }
                },
        ) {
            ChipFrame(item, placed = dock != null, plain = plainPlaced && dock != null, onClick = { menu = true }) { if (look != null) look(item, dock != null) else DefaultChipLook(item, placed = dock != null) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                if (dock != null) {
                    if (index > 0) DropdownMenuItem(text = { Text("左へ", fontSize = 14.sp) }, onClick = { menu = false; onMove(dock.key, index, index - 1) })
                    if (index < dock.items.lastIndex) DropdownMenuItem(text = { Text("右へ", fontSize = 14.sp) }, onClick = { menu = false; onMove(dock.key, index, index + 1) })
                    for (other in docks) if (other.key != dock.key && allowIn(item, other.key)) {
                        DropdownMenuItem(text = { Text("${other.label}へ", fontSize = 14.sp) }, onClick = { menu = false; if (dock.items.size > dock.minItems) { onRemove(dock.key, index); onPlace(other.key, item.id, Int.MAX_VALUE) } })
                    }
                    if (dock.items.size > dock.minItems) DropdownMenuItem(text = { Text("外す", color = Palette.heatVeryHot, fontSize = 14.sp) }, onClick = { menu = false; onRemove(dock.key, index) })
                } else {
                    for (dk in docks) if (allowIn(item, dk.key)) DropdownMenuItem(text = { Text(if (docks.size == 1) "入れる" else "${dk.label}に入れる", fontSize = 14.sp) }, onClick = { menu = false; onPlace(dk.key, item.id, Int.MAX_VALUE) })
                }
            }
        }
    }

    @Composable
    fun DockBox(dock: DockSpec) {
        val over = dragging?.let { d -> dockBounds[dock.key]?.inflate(16f)?.contains(d.pos) == true && itemOf(d.id)?.let { allowIn(it, dock.key) } == true } == true
        val mock = screenMock != null
        if (!mock) Text(dock.label, Modifier.padding(start = 16.dp, top = 8.dp, bottom = 4.dp), color = Palette.textMuted, fontSize = 12.sp)
        val shape = RoundedCornerShape(if (mock) 0.dp else 8.dp)
        val boxMod = Modifier.fillMaxWidth().then(if (mock) Modifier else Modifier.padding(horizontal = 12.dp)).heightIn(min = if (mock) 52.dp else 60.dp)
            .onGloballyPositioned { dockBounds[dock.key] = it.boundsInRoot() }
            .clip(shape).background(if (over) Palette.accentWash else Palette.bar)
            .border(BorderStroke(if (over) 2.dp else if (mock) 0.dp else 1.dp, if (over) Palette.accent else Palette.border), shape)
            .padding(horizontal = 6.dp, vertical = 4.dp)
        val group = dock.flexGroup
        val firstG = if (group == null) -1 else dock.items.indexOfFirst(group)
        if (dock.items.any { it.fills }) Row(boxMod, verticalAlignment = Alignment.CenterVertically) {
            // 幅を埋める部品(チャット欄・空き)があるときは 1 行(実際の帯と同じ)
            if (dock.fixedLeading != null) Text(dock.fixedLeading, Modifier.padding(start = 6.dp, end = 6.dp), color = Palette.textMuted, fontSize = 12.sp)
            for ((i, item) in dock.items.withIndex()) {
                if (item.fills) Box(Modifier.weight(1f).padding(horizontal = 2.dp), contentAlignment = Alignment.Center) { Chip(item, dock, i) }
                else Chip(item, dock, i)
            }
        } else if (group != null && firstG >= 0) Row(boxMod, verticalAlignment = Alignment.CenterVertically) {
            // タブのまとまりは残りの幅を取って左から。その左右にボタン(実際のスレ一覧のフッターと同じ)
            for (i in 0 until firstG) Chip(dock.items[i], dock, i)
            FlowRow(with(this) { Modifier.weight(1f) }, horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.Start), verticalArrangement = Arrangement.Center) {
                for ((i, item) in dock.items.withIndex()) if (i >= firstG && group(item)) Box(Modifier.align(Alignment.CenterVertically)) { Chip(item, dock, i) }
            }
            for ((i, item) in dock.items.withIndex()) if (i > firstG && !group(item)) Chip(item, dock, i)
        } else if (dock.fixedLeading != null) Row(boxMod, verticalAlignment = Alignment.CenterVertically) {
            // 題名などは左に固定し、部品は右に寄せて折り返す(実際のヘッダーと同じ並び)
            Text(dock.fixedLeading, Modifier.padding(start = 6.dp, end = 6.dp), color = Palette.textStrong, fontSize = 13.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
            FlowRow(with(this) { Modifier.weight(1f) }, horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.End), verticalArrangement = Arrangement.Center) {
                for ((i, item) in dock.items.withIndex()) Box(Modifier.align(Alignment.CenterVertically)) { Chip(item, dock, i) }
            }
        } else FlowRow(
            // 幅を埋める部品がなければ折り返す(多く入れても画面からはみ出さない)
            boxMod,
            horizontalArrangement = Arrangement.spacedBy(2.dp, if (dock.alignEnd) Alignment.End else Alignment.Start),
            verticalArrangement = Arrangement.Center,
        ) {
            if (dock.items.isEmpty() && dock.emptyHint != null) Text(dock.emptyHint, Modifier.align(Alignment.CenterVertically).padding(horizontal = 8.dp), color = Palette.textMuted, fontSize = 12.sp)
            for ((i, item) in dock.items.withIndex()) Box(Modifier.align(Alignment.CenterVertically)) { Chip(item, dock, i) }
        }
    }

    Box(Modifier.fillMaxWidth().onGloballyPositioned { rootBounds = it.boundsInRoot() }) {
        Column(Modifier.fillMaxWidth()) {
            if (screenMock != null) {
                // 実際の画面の見本: 上の帯(ヘッダー)・中身・下の帯(フッター)を 1 枚の枠に
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).clip(RoundedCornerShape(18.dp)).border(2.dp, Palette.borderStrong, RoundedCornerShape(18.dp)).background(Palette.base)) {
                    for (dk in docks.filter { !it.atBottom }) DockBox(dk)
                    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (w in listOf(0.9f, 0.6f, 0.8f)) Box(Modifier.fillMaxWidth(w).height(10.dp).clip(RoundedCornerShape(5.dp)).background(Palette.surface2))
                        Text(screenMock, color = Palette.textMuted, fontSize = 11.sp)
                    }
                    for (dk in docks.filter { it.atBottom }) DockBox(dk)
                }
            } else for (dk in docks) DockBox(dk)
            Row(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.DragIndicator, null, tint = Palette.textMuted, modifier = Modifier.size(16.dp))
                Text("$paletteTitle ── 長押しして掴み、上の箱へ動かします(押すとメニューでも入れられます)", Modifier.padding(start = 4.dp), color = Palette.textMuted, fontSize = 12.sp)
            }
            FlowRow(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (item in palette) Chip(item, null, -1)
            }
            Spacer(Modifier.size(8.dp))
        }
        dragging?.let { d ->
            val item = itemOf(d.id) ?: return@let
            Box(
                Modifier.offset { IntOffset((d.pos.x - rootBounds.left - d.size.width / 2).roundToInt(), (d.pos.y - rootBounds.top - d.size.height / 2).roundToInt()) }
                    .graphicsLayer { shadowElevation = 16f; alpha = 0.92f },
            ) { ChipFrame(item, placed = true, onClick = {}) { if (look != null) look(item, true) else DefaultChipLook(item, placed = true) } }
        }
    }
}

/** 部品の枠。掴めることが分かるよう、左に ⋮⋮ の印。幅を埋めるものは横長の枠 */
@Composable
private fun ChipFrame(item: DockItem, placed: Boolean, plain: Boolean = false, onClick: () -> Unit, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(if (item.fills && placed) 10.dp else 8.dp)
    Row(
        Modifier.then(if (item.fills && placed) Modifier.fillMaxWidth().heightIn(min = 40.dp) else Modifier)
            .clip(shape).then(if (plain) Modifier else Modifier.background(Palette.surface).border(1.dp, if (placed) Palette.border else Palette.accent.copy(alpha = 0.5f), shape))
            .clickable(onClick = onClick).padding(start = 2.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.DragIndicator, "掴む", tint = if (placed) Palette.textMuted.copy(alpha = 0.6f) else Palette.accent, modifier = Modifier.size(16.dp))
        content()
    }
}

/** 既定の見た目: アイコンと名前 */
@Composable
private fun DefaultChipLook(item: DockItem, placed: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (item.icon != null) {
            Icon(item.icon, null, tint = Palette.textMuted, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(6.dp))
        }
        Text(item.name, color = if (placed) Palette.textStrong else Palette.textBody, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
