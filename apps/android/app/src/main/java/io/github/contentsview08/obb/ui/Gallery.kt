package io.github.contentsview08.obb.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage

/**
 * スレの画像一覧。押すとビューアー(閉じるとこの一覧に戻る)。
 * 長押しで選び始め、そのままなぞると、なぞった範囲をまとめて選ぶ(写真アプリと同じ)。選んでいる間は、押すと選ぶ・外す。
 * 選んだ画像は下の帯からまとめて保存できる
 */
@Composable
fun GalleryPanel(images: List<String>, onOpen: (String) -> Unit, save: (List<String>) -> Unit, onDismiss: () -> Unit) {
    val view = androidx.compose.ui.platform.LocalView.current
    var selected by remember { mutableStateOf<Set<Int>>(emptySet()) }
    val selecting = selected.isNotEmpty()
    val grid = rememberLazyGridState()

    /** 指の位置にある画像の番目(なければ null) */
    fun indexAt(p: Offset): Int? = grid.layoutInfo.visibleItemsInfo.firstOrNull { item ->
        p.x >= item.offset.x && p.x < item.offset.x + item.size.width && p.y >= item.offset.y && p.y < item.offset.y + item.size.height
    }?.index

    CenterPanel(if (selecting) "${selected.size} 枚を選択中" else "このスレの画像(${images.size})", { if (selecting) selected = emptySet() else onDismiss() }) {
        if (images.isEmpty()) { Hint("画像はありません"); return@CenterPanel }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            @Composable fun btn(label: String, strong: Boolean = false, onClick: () -> Unit) = Text(
                label,
                Modifier.clip(RoundedCornerShape(6.dp)).background(if (strong) Palette.accent else Color.Transparent)
                    .border(1.dp, if (strong) Palette.accent else Palette.border, RoundedCornerShape(6.dp))
                    .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 7.dp),
                color = if (strong) Palette.accentText else Palette.accent, fontSize = 13.sp, fontWeight = FontWeight.Bold,
            )
            if (selecting) {
                btn("保存(${selected.size})", strong = true) { save(selected.sorted().map { images[it] }); selected = emptySet() }
                btn("全部を選ぶ") { selected = images.indices.toSet() }
                btn("やめる") { selected = emptySet() }
            } else {
                btn("全部保存(${images.size} 枚)") { save(images) }
                Text("長押しでなぞって選べます", Modifier.align(Alignment.CenterVertically), color = Palette.textMuted, fontSize = 11.sp)
            }
        }
        Spacer(Modifier.size(6.dp))
        // なぞって選ぶ: 長押しした画像を起点に、指のある画像までの範囲を、長押しした画像を選んだか外したかに合わせて入れる・外す
        var anchor by remember { mutableStateOf(-1) }
        var adding by remember { mutableStateOf(true) }
        var base by remember { mutableStateOf<Set<Int>>(emptySet()) }
        LazyVerticalGrid(
            GridCells.Fixed(3), Modifier.fillMaxWidth().heightIn(max = 560.dp)
                .pointerInput(images) {
                    detectDragGesturesAfterLongPress(
                        onDragStart = { p ->
                            val i = indexAt(p) ?: return@detectDragGesturesAfterLongPress
                            Haptics.longPress(view)
                            anchor = i
                            base = selected
                            adding = i !in selected
                            selected = if (adding) selected + i else selected - i
                        },
                        onDragEnd = { anchor = -1 }, onDragCancel = { anchor = -1 },
                    ) { change, _ ->
                        if (anchor < 0) return@detectDragGesturesAfterLongPress
                        val i = indexAt(change.position) ?: return@detectDragGesturesAfterLongPress
                        val range = (minOf(anchor, i)..maxOf(anchor, i)).toSet()
                        val next = if (adding) base + range else base - range
                        if (next != selected) { selected = next; Haptics.tick(view) }
                    }
                },
            state = grid, contentPadding = PaddingValues(8.dp),
        ) {
            itemsIndexed(images) { i, url ->
                val on = i in selected
                Box(
                    Modifier.padding(3.dp).aspectRatio(1f).clip(RoundedCornerShape(4.dp)).background(Palette.surface2)
                        .pointerInput(i, selecting) {
                            detectTapGestures { if (selecting) selected = if (i in selected) selected - i else selected + i else onOpen(url) }
                        },
                ) {
                    StoredImage(url, Modifier.matchParentSize().padding(if (on) 8.dp else 0.dp).clip(RoundedCornerShape(4.dp)))
                    if (selecting) Box(
                        Modifier.align(Alignment.TopEnd).padding(5.dp).size(22.dp).clip(CircleShape)
                            .background(if (on) Palette.accent else Color.Black.copy(alpha = 0.3f)).border(2.dp, Color.White, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) { if (on) Icon(Icons.Filled.Check, null, tint = Palette.accentText, modifier = Modifier.size(14.dp)) }
                }
            }
        }
    }
}
