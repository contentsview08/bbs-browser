package io.github.contentsview08.obb.ui

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
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.sp
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import io.github.contentsview08.obb.bbs.Post
import io.github.contentsview08.obb.bbs.PostIndex
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
    /** 読んだところ(既読の番号)。そこまでを薄く塗る */
    readNo: Int = 0,
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
    // 読んだ範囲(先頭から既読の番号まで)の終わりの番目
    val readAt = remember(posts, readNo) { posts.indexOfLast { it.no <= readNo } }
    // 時刻の目盛り: 時(〜時台)が変わるレスの番目。3 時間ごとは長く
    val hourTicks = remember(posts) {
        var prev: Long? = null
        posts.mapIndexedNotNull { i, p ->
            val m = postMinutes(p.date) ?: return@mapIndexedNotNull null
            val h = m / 60
            val tick = if (prev != null && h != prev) i to (h % 3 == 0L) else null
            prev = h
            tick
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
    // なぞっている間の位置(指の高さと、そこにあるレス)。指の左に「#523 名無し: 本文の頭」の札を出す(どこへ飛ぶか分かるように)
    var drag by remember { androidx.compose.runtime.mutableStateOf<Pair<Float, Int>?>(null) }
    Box(modifier.width(18.dp).fillMaxHeight()) {
    Canvas(
        Modifier.fillMaxSize().background(Palette.surface2.copy(alpha = 0.85f), shape).border(1.dp, Palette.border, shape)
            .pointerInput(n, marks) { detectTapGestures { tap(it.y, size.height.toFloat(), 14.dp.toPx()) } }
            .pointerInput(n) {
                detectVerticalDragGestures(
                    onDragEnd = { drag = null }, onDragCancel = { drag = null },
                ) { change, _ ->
                    val h = size.height.toFloat()
                    jump(change.position.y, h)
                    if (n > 0) drag = change.position.y.coerceIn(0f, h) to ((change.position.y / h).coerceIn(0f, 1f) * (n - 1)).toInt()
                }
            },
    ) {
        if (n == 0) return@Canvas
        val h = size.height
        val w = size.width
        fun yOf(i: Int) = if (n <= 1) 0f else i.toFloat() / (n - 1) * h
        // 読んだ範囲(薄い灰色)
        if (readAt >= 0) drawRect(Palette.textMuted.copy(alpha = 0.10f), Offset(0f, 0f), Size(w, yOf(readAt)))
        // 時刻の目盛り(左の端。1 時間ごと、3 時間ごとは長く)
        for ((i, long) in hourTicks) {
            val y = yOf(i)
            drawRect(Palette.textMuted.copy(alpha = if (long) 0.7f else 0.4f), Offset(0f, y), Size(if (long) 6.dp.toPx() else 3.dp.toPx(), 1.dp.toPx()))
        }
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
            // つまみは文字の色の薄い面(強調色にすると、印より目立ってしまう)
            drawRoundRect(Palette.textMuted.copy(alpha = 0.22f), Offset(0f, top), Size(w, bottom - top), CornerRadius(4.dp.toPx()))
            drawRoundRect(Palette.textMuted.copy(alpha = 0.7f), Offset(0f, top), Size(w, bottom - top), CornerRadius(4.dp.toPx()), style = Stroke(1.dp.toPx()))
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
                    // 自分への返信は一回り大きく、枠を太く(見落とさないように)
                    else { val e = d * 1.3f; drawRect(Palette.own, Offset(c.x - e / 2, y - e / 2), Size(e, e), style = Stroke(2.dp.toPx())) }
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
    drag?.let { (y, i) ->
        val p = posts.getOrNull(i)
        if (p != null) {
            val density = androidx.compose.ui.platform.LocalDensity.current
            Box(
                Modifier.align(Alignment.TopEnd).offset { androidx.compose.ui.unit.IntOffset(-with(density) { 129.dp.roundToPx() }, (y - with(density) { 18.dp.toPx() }).toInt()) }
                    .requiredWidth(220.dp).wrapContentWidth(Alignment.End),
            ) {
                androidx.compose.material3.Text(
                    "#${p.no}  ${shortDate(p.date).substringAfter(' ')}  ${p.body.lineSequence().map { it.replace(Regex("(&gt;|>|＞){1,2}\\d+(-\\d+)?"), "").replace(Regex("<[^>]+>"), "").trim() }.firstOrNull { it.isNotBlank() } ?: ""}",
                    Modifier.shadow(6.dp, RoundedCornerShape(5.dp)).background(Palette.surface3, RoundedCornerShape(5.dp)).padding(horizontal = 10.dp, vertical = 6.dp),
                    color = Palette.textStrong, fontSize = 12.sp, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                )
            }
        }
    }
    }
}

private class Mark(val i: Int, val heat: Int, val own: Boolean, val toOwn: Boolean, val image: Boolean, val video: Boolean)
