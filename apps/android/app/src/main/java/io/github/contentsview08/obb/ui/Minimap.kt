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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import io.github.contentsview08.obb.bbs.Post
import io.github.contentsview08.obb.bbs.PostIndex
import kotlinx.coroutines.launch

/**
 * ミニマップ。スレ全体を縦に縮めて、左の列(中身)に人気レスの横棒・画像(四角)・動画(三角)・リンク(点)、
 * 右の列(自分)に自分のレス(塗った丸)・自分への返信(輪)と、「ここから未読」の線を示す。
 * 寸法と色は bbs-suite の docs/minimap.md(PC 版・Web の components/Minimap.tsx と同じ並び)。
 * 印の位置はレスの番目で決める(高さを測らない)。
 * たたくとその割合の位置へ飛び、なぞるとそのまま送れる。いま見ている範囲はつまみで出す
 */
@Composable
fun Minimap(
    posts: List<Post>, index: PostIndex, own: Set<Int>, toOwn: Set<Int>, unreadFrom: Int?,
    listState: LazyListState, modifier: Modifier = Modifier,
    /** 印を押して飛んだ(そのレスを一瞬光らせる) */
    onJumped: (Int) -> Unit = {},
    /** 読んだところ(既読の番号)。今は塗らない(つまみと見分けにくい)が、呼ぶ側との取り決めとして残す */
    @Suppress("UNUSED_PARAMETER") readNo: Int = 0,
    /** 印を付けない行の番目(ツリー表示の 2 回目以降の出現) */
    skip: Set<Int> = emptySet(),
    /** ツリー表示: この番号から後ろのレスに新着の印(「ここから未読」から下を塗る代わり。ツリーでは新着がまとまっていない) */
    freshFrom: Int? = null,
) {
    val scope = rememberCoroutineScope()
    val n = posts.size
    val marks = remember(posts, index, own, toOwn, skip) {
        posts.mapIndexedNotNull { i, p ->
            if (i in skip) return@mapIndexedNotNull null
            val heat = index.replyCount[p.no] ?: 0
            val info = index.info[p.no]
            if (heat < 3 && p.no !in own && p.no !in toOwn && info?.image != true && info?.video != true && info?.link != true) null
            else Mark(i, heat, p.no in own, p.no in toOwn, info?.image == true, info?.video == true, info?.link == true)
        }
    }
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
    val freshAt = remember(posts, freshFrom, skip) { if (freshFrom == null) emptyList() else posts.indices.filter { it !in skip && posts[it].no >= freshFrom } }
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
     * たたいた: 近くに印(人気・自分・自分への返信・画像・動画・リンク)があれば、そのレスへ優先して飛び、一瞬光らせる。
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
        // 列の寸法(docs/minimap.md)。左の列(中身)と右の列(自分)を 6:4
        val pad = 1.5.dp.toPx()
        val col = w - pad * 2
        val leftW = col * 0.6f
        val rightX = pad + leftW + (col - leftW) / 2
        val dot = 5.dp.toPx()
        val media = 4.dp.toPx()
        val mediaX = pad + leftW - media / 2 - 0.5.dp.toPx()
        val halo = Palette.surface2
        // 時刻の目盛り(左の端。1 時間ごと、3 時間ごとは長く)
        for ((i, long) in hourTicks) {
            val y = yOf(i)
            drawRect(Palette.textMuted.copy(alpha = if (long) 0.7f else 0.4f), Offset(0f, y), Size(if (long) 6.dp.toPx() else 3.dp.toPx(), 1.dp.toPx()))
        }
        // 「ここから未読」: 細い線 1 本(面は塗らない。つまみや印と紛れないように)
        unreadAt?.let { u -> drawRect(Palette.unread, Offset(0f, yOf(u) - 0.75.dp.toPx()), Size(w, 1.5.dp.toPx())) }
        // 新着の印(ツリー表示)。未読の色の細い横線
        for (i in freshAt) drawRect(Palette.unread, Offset(0f, yOf(i) - 1.dp.toPx()), Size(w, 2.dp.toPx()))
        // つまみ(いま見ている範囲)。小さくなりすぎないよう 14dp より小さくしない。
        // 色はテーマの差し色の薄い面と縁(差し色が印と近いテーマは青灰色。MinimapThumb)
        thumb?.let { (a, b) ->
            val top = yOf(a.coerceAtMost(n - 1))
            val bottom = maxOf(yOf(b.coerceAtMost(n - 1)), top + 14.dp.toPx()).coerceAtMost(h)
            val c = MinimapThumb.color()
            val sw = 1.5.dp.toPx()
            drawRoundRect(c.copy(alpha = 0.15f), Offset(0f, top), Size(w, bottom - top), CornerRadius(4.dp.toPx()))
            drawRoundRect(c.copy(alpha = 0.5f), Offset(sw / 2, top + sw / 2), Size(w - sw, bottom - top - sw), CornerRadius(4.dp.toPx() - sw / 2), style = Stroke(sw))
        }
        for (m in marks) {
            val y = yOf(m.i)
            // 左の列: 人気レスの横棒。熱いほど暖かい色で長い(出し始めの 3 件で 40%、10 件で左の列いっぱい)
            if (m.heat >= 3) {
                val len = leftW * (0.4f + 0.6f * ((m.heat - 3) / 7f).coerceIn(0f, 1f))
                drawRoundRect(Palette.heat(m.heat) ?: Palette.markHot, Offset(pad, y - 1.5.dp.toPx()), Size(len, 3.dp.toPx()), CornerRadius(1.5.dp.toPx()))
            }
            // 左の列の右の端: 動画(三角)>画像(四角)>リンク(点)。地の色で縁取って、人気の棒に重なっても形が分かるように
            val ring = Stroke(1.2.dp.toPx(), join = androidx.compose.ui.graphics.StrokeJoin.Round)
            val x0 = mediaX - media / 2
            when {
                m.video -> {
                    val tri = Path().apply { moveTo(x0, y - media / 2); lineTo(x0 + media, y); lineTo(x0, y + media / 2); close() }
                    drawPath(tri, halo, style = ring)
                    drawPath(tri, Palette.markVideo)
                }
                m.image -> {
                    val r = CornerRadius(0.6.dp.toPx())
                    drawRoundRect(halo, Offset(x0, y - media / 2), Size(media, media), r, style = ring)
                    drawRoundRect(Palette.markImage, Offset(x0, y - media / 2), Size(media, media), r)
                }
                m.link -> {
                    drawCircle(halo, media / 2, Offset(mediaX, y), style = ring)
                    drawCircle(Palette.markLink, media / 2, Offset(mediaX, y))
                }
            }
            // 右の列: 自分のレス(塗った丸)と自分への返信(同じ大きさの輪)
            if (m.own) drawCircle(Palette.own, dot / 2, Offset(rightX, y))
            else if (m.toOwn) {
                val sw = 1.5.dp.toPx()
                drawCircle(Palette.own, dot / 2 - sw / 2, Offset(rightX, y), style = Stroke(sw))
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
                    "#${p.no}  ${shortDate(p.date).substringAfter(' ')}  ${p.body.lineSequence().map { it.replace(LABEL_ANCHOR, "").replace(LABEL_TAG, "").trim() }.firstOrNull { it.isNotBlank() } ?: ""}",
                    Modifier.shadow(6.dp, RoundedCornerShape(5.dp)).background(Palette.surface3, RoundedCornerShape(5.dp)).padding(horizontal = 10.dp, vertical = 6.dp),
                    color = Palette.textStrong, fontSize = 12.sp, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                )
            }
        }
    }
    }
}

private val LABEL_ANCHOR = Regex("(&gt;|>|＞){1,2}[0-9]+(-[0-9]+)?")
private val LABEL_TAG = Regex("<[^>]+>")

private class Mark(val i: Int, val heat: Int, val own: Boolean, val toOwn: Boolean, val image: Boolean, val video: Boolean, val link: Boolean)

/**
 * つまみの色。テーマの差し色を使うが、差し色が印の色と近いテーマでは落ち着いた青灰色にする。
 * 近さの決め方と値は PC 版・Web の utils/minimapThumb.ts と同じ(bbs-suite の docs/minimap.md・tools/colors.py で突き合わせる)
 */
object MinimapThumb {
    /** 色相の差(Oklch の度)がこれより小さいと、同じ系統の色に見える */
    const val NEAR_HUE = 40f
    /** 鮮やかさ(Oklch の C)の比(小さい方 ÷ 大きい方)がこれ以上だと、同じくらいの鮮やかさに見える */
    const val NEAR_CHROMA_RATIO = 0.5f
    /** 鮮やかさがこれより小さい色は灰色とみなす(色相に意味がない)。灰色どうしは近い */
    const val GRAY_CHROMA = 0.02f
    /** 差し色が印と近いときの、落ち着いた青灰色 */
    val CALM_LIGHT = Color(0xFF5D6B80)
    val CALM_DARK = Color(0xFF8E9AAC)

    /** いまのテーマのつまみの色 */
    fun color(): Color = color(
        Palette.accent,
        listOf(Palette.heatWarm, Palette.heatHot, Palette.heatVeryHot, Palette.markImage, Palette.markVideo, Palette.markLink, Palette.own, Palette.unread),
        Palette.scheme.dark,
    )

    /** marks は印の色(人気の 3 段・画像・動画・リンク・自分・未読) */
    fun color(accent: Color, marks: List<Color>, dark: Boolean): Color =
        if (marks.any { near(accent, it) }) (if (dark) CALM_DARK else CALM_LIGHT) else accent

    /** 2 つの色が、見分けにくいほど近いか(色相と鮮やかさで見る。明るさは見ない) */
    fun near(a: Color, b: Color): Boolean {
        val (ca, ha) = oklch(a)
        val (cb, hb) = oklch(b)
        val grayA = ca < GRAY_CHROMA
        val grayB = cb < GRAY_CHROMA
        if (grayA || grayB) return grayA && grayB
        val dh = kotlin.math.abs(ha - hb) % 360f
        return minOf(dh, 360f - dh) < NEAR_HUE && minOf(ca, cb) / maxOf(ca, cb) >= NEAR_CHROMA_RATIO
    }

    /** Oklch の鮮やかさ(C)と色相(度) */
    private fun oklch(c: Color): Pair<Float, Float> {
        fun lin(v: Float) = if (v <= 0.04045f) v / 12.92f else Math.pow((v + 0.055) / 1.055, 2.4).toFloat()
        val r = lin(c.red); val g = lin(c.green); val b = lin(c.blue)
        val l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        val m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        val s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        val aa = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
        val bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
        val h = (Math.toDegrees(kotlin.math.atan2(bb, aa)) + 360.0) % 360.0
        return kotlin.math.hypot(aa, bb).toFloat() to h.toFloat()
    }
}
