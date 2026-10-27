package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import io.github.yumekui8.bbsnative.bbs.Post
import io.github.yumekui8.bbsnative.bbs.PostIndex
import kotlinx.coroutines.launch

/**
 * ミニマップ(今のスマホ版の Minimap と同じ)。スレ全体を縦に縮めて、人気レス(真ん中の横棒)・
 * 自分のレス(左の塗ったひし形)・自分への返信(左の枠だけのひし形)・画像(右の四角)・動画(右の三角)と、
 * 「ここから未読」から下を示す。印の位置はレスの番目で決める(高さを測らない)。
 * たたくとその割合の位置へ飛び、なぞるとそのまま送れる。いま見ている範囲はつまみで出す
 */
@Composable
fun Minimap(
    posts: List<Post>, index: PostIndex, own: Set<Int>, toOwn: Set<Int>, unreadFrom: Int?,
    listState: LazyListState, modifier: Modifier = Modifier,
    /** 印を押して飛んだ(そのレスを一瞬光らせる) */
    onJumped: (Int) -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    val n = posts.size
    // 印は posts が変わったときだけ作り直す
    val marks = remember(posts, index, own, toOwn) {
        posts.mapIndexedNotNull { i, p ->
            val heat = index.replyCount[p.no] ?: 0
            val info = index.info[p.no]
            if (heat < 3 && p.no !in own && p.no !in toOwn && info?.image != true && info?.video != true) null
            else Mark(i, heat, p.no in own, p.no in toOwn, info?.image == true, info?.video == true)
        }
    }
    val unreadAt = remember(posts, unreadFrom) { unreadFrom?.let { u -> posts.indexOfFirst { it.no >= u }.takeIf { it >= 0 } } }
    // つまみ: 画面に入っているレスの番目(上の帯に隠れた分は気にしない)
    val thumb by remember(n) {
        derivedStateOf {
            val visible = listState.layoutInfo.visibleItemsInfo.filter { it.key is Int }
            if (visible.isEmpty() || n == 0) null else visible.first().index to visible.last().index
        }
    }
    fun jump(y: Float, h: Float) {
        if (n == 0) return
        val i = ((y / h).coerceIn(0f, 1f) * (n - 1)).toInt()
        scope.launch { listState.scrollToItem(i) }
    }
    /**
     * たたいた: 近くに印(人気・自分・自分への返信・画像・動画)があれば、そのレスへ優先して飛び、一瞬光らせる。
     * 印がなければ、その割合の位置へ
     */
    fun tap(y: Float, h: Float, slop: Float) {
        if (n == 0) return
        fun yOf(i: Int) = if (n <= 1) 0f else i.toFloat() / (n - 1) * h
        val near = marks.minByOrNull { kotlin.math.abs(yOf(it.i) - y) }?.takeIf { kotlin.math.abs(yOf(it.i) - y) <= slop }
        if (near != null) {
            scope.launch { listState.scrollToItem(near.i) }
            onJumped(posts[near.i].no)
        } else jump(y, h)
    }
    val shape = RoundedCornerShape(4.dp)
    Canvas(
        modifier.width(22.dp).fillMaxHeight().background(Palette.surface2.copy(alpha = 0.85f), shape).border(1.dp, Palette.border, shape)
            .pointerInput(n, marks) { detectTapGestures { tap(it.y, size.height.toFloat(), 14.dp.toPx()) } }
            .pointerInput(n) { detectVerticalDragGestures { change, _ -> jump(change.position.y, size.height.toFloat()) } },
    ) {
        if (n == 0) return@Canvas
        val h = size.height
        val w = size.width
        fun yOf(i: Int) = if (n <= 1) 0f else i.toFloat() / (n - 1) * h
        // 未読の範囲
        unreadAt?.let { u ->
            val y = yOf(u)
            drawRect(Palette.unread.copy(alpha = 0.12f), Offset(0f, y), Size(w, h - y))
            drawRect(Palette.unread, Offset(0f, y - 1.dp.toPx()), Size(w, 2.dp.toPx()))
        }
        // つまみ(いま見ている範囲)。小さくなりすぎないよう 14dp より小さくしない
        thumb?.let { (a, b) ->
            val top = yOf(a.coerceAtMost(n - 1))
            val bottom = maxOf(yOf(b.coerceAtMost(n - 1)), top + 14.dp.toPx()).coerceAtMost(h)
            drawRoundRect(Palette.accent.copy(alpha = 0.28f), Offset(0f, top), Size(w, bottom - top), CornerRadius(4.dp.toPx()))
            drawRoundRect(Palette.accent, Offset(0f, top), Size(w, bottom - top), CornerRadius(4.dp.toPx()), style = Stroke(1.dp.toPx()))
        }
        val d = 7.dp.toPx()
        for (m in marks) {
            val y = yOf(m.i)
            // 真ん中: 人気レス
            if (m.heat >= 3) {
                drawRoundRect(Palette.heat(m.heat) ?: Palette.markHot, Offset(5.dp.toPx(), y - 2.dp.toPx()), Size(w - 10.dp.toPx(), 4.dp.toPx()), CornerRadius(2.dp.toPx()))
            }
            // 左: 自分のレスと自分への返信(ひし形)
            if (m.own || m.toOwn) {
                val c = Offset(2.dp.toPx() + d / 2, y)
                rotate(45f, c) {
                    if (m.own) drawRect(Palette.own, Offset(c.x - d / 2, y - d / 2), Size(d, d))
                    else drawRect(Palette.own, Offset(c.x - d / 2, y - d / 2), Size(d, d), style = Stroke(1.5.dp.toPx()))
                }
            }
            // 右: 画像(四角)と動画(三角)
            val x = w - 3.dp.toPx() - 5.dp.toPx()
            if (m.video) {
                val s = 5.dp.toPx()
                drawPath(Path().apply { moveTo(x, y - s / 2); lineTo(x + s, y); lineTo(x, y + s / 2); close() }, Palette.markVideo)
            } else if (m.image) {
                drawRect(Palette.markImage, Offset(x, y - 2.5.dp.toPx()), Size(5.dp.toPx(), 5.dp.toPx()))
            }
        }
    }
}

private class Mark(val i: Int, val heat: Int, val own: Boolean, val toOwn: Boolean, val image: Boolean, val video: Boolean)
