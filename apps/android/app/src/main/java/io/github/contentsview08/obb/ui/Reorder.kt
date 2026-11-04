package io.github.contentsview08.obb.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DragHandle
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex

/**
 * 掴んで並べ替えられる縦の並び(数十件までの、画面に収まる並び用。設定のタブ・お気に入り板など)。
 * row の 2 つ目の引数(掴むところ)を付けた所を掴んで上下に動かすと、隣の行の半分を越えるたびに onMove(元の番目, 新しい番目) を呼ぶ。
 * longPress = true なら長押ししてから掴む(行全体を掴むところにして、ふつうの押す・スクロールと両立させるとき)
 */
@Composable
fun <T> ReorderableColumn(
    items: List<T>,
    key: (T) -> Any,
    onMove: (from: Int, to: Int) -> Unit,
    modifier: Modifier = Modifier,
    longPress: Boolean = false,
    row: @Composable (item: T, handle: Modifier, dragging: Boolean) -> Unit,
) {
    var draggingKey by remember { mutableStateOf<Any?>(null) }
    var offset by remember { mutableFloatStateOf(0f) }
    val heights = remember { mutableStateMapOf<Any, Int>() }
    val view = LocalView.current
    val current by rememberUpdatedState(items)
    val move by rememberUpdatedState(onMove)

    /** 指が動いた分を足し、隣の行の半分を越えたら入れ替える */
    fun drag(k: Any, dy: Float) {
        offset += dy
        val list = current
        val i = list.indexOfFirst { key(it) == k }
        if (i < 0) return
        if (offset > 0 && i < list.lastIndex) {
            val h = heights[key(list[i + 1])] ?: return
            if (offset > h / 2f) { move(i, i + 1); offset -= h; Haptics.tick(view) }
        } else if (offset < 0 && i > 0) {
            val h = heights[key(list[i - 1])] ?: return
            if (-offset > h / 2f) { move(i, i - 1); offset += h; Haptics.tick(view) }
        }
    }

    Column(modifier) {
        for (item in items) {
            val k = key(item)
            key(k) {
                val dragging = draggingKey == k
                val handle = Modifier.pointerInput(k, longPress) {
                    val start = { _: androidx.compose.ui.geometry.Offset -> draggingKey = k; offset = 0f; Haptics.longPress(view) }
                    val end = { draggingKey = null; offset = 0f }
                    if (longPress) detectDragGesturesAfterLongPress(onDragStart = start, onDragEnd = end, onDragCancel = end) { change, d -> change.consume(); drag(k, d.y) }
                    else detectDragGestures(onDragStart = start, onDragEnd = end, onDragCancel = end) { change, d -> change.consume(); drag(k, d.y) }
                }
                Box(
                    Modifier.onSizeChanged { heights[k] = it.height }.zIndex(if (dragging) 1f else 0f)
                        .graphicsLayer {
                            translationY = if (dragging) offset else 0f
                            shadowElevation = if (dragging) 12f else 0f
                        }
                        .background(if (dragging) Palette.surface2 else Color.Transparent),
                ) { row(item, handle, dragging) }
            }
        }
    }
}

/** 掴むところの印(≡) */
@Composable
fun DragHandleIcon(modifier: Modifier) {
    Box(modifier.padding(12.dp)) { Icon(Icons.Filled.DragHandle, "掴んで並べ替える", tint = Palette.textMuted, modifier = Modifier.size(22.dp)) }
}
