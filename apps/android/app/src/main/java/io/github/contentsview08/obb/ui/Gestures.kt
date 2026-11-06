package io.github.contentsview08.obb.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs

/** なぞって呼ぶ操作。label はなぞっている間、画面の真ん中に出す */
class SwipeAction(val label: String, val run: () -> Unit)

/** なぞっている間に出す名前(画面の真ん中に SwipeLabel で出す) */
class SwipeState {
    var label by mutableStateOf<String?>(null)
    /** なぞっている向きの並び(「→↑」)と、指の軌跡(なぞっている間だけ描く) */
    var arrows by mutableStateOf("")
    val path = androidx.compose.runtime.mutableStateListOf<Offset>()
}

@Composable
fun rememberSwipeState() = remember { SwipeState() }

/**
 * スワイプ(指でなぞる)の操作。PC 版の useSwipeGesture と同じ決まり。
 * - なぞった向きの並び(「right」「right,up」)を、map の操作に結びつける
 * - 最初の向きが縦なら、ふつうのスクロールに任せる。横なら以後の指の動きを受け取り、スクロールさせない
 * - 向きが変わったら(一定以上ほかの向きへ動いたら)次の向きを足す。指のぶれでは増えない
 * - 1 つの向きだけのときは、距離か速さが足りたときだけ確定する(スクロールのつもりの動きで発動しないように)
 * - 指が 1 秒止まったらやめる。登録していない並びなら、離しても何もしない
 * - 画面の左の端から右へなぞったら、onEdgeRight(メニューを開く)
 */
@Composable
fun Modifier.swipeGestures(state: SwipeState, map: Map<String, SwipeAction>, onEdgeRight: (() -> Unit)? = null, sensitivity: Int = 3): Modifier {
    val current by rememberUpdatedState(map)
    val edgeAction by rememberUpdatedState(onEdgeRight)
    val view = androidx.compose.ui.platform.LocalView.current
    // 感度(1 鈍い〜5 敏感)を、しきい値に掛ける倍率にする。3 が標準
    val k = when (sensitivity) { 1 -> 1.6f; 2 -> 1.3f; 4 -> 0.7f; 5 -> 0.45f; else -> 1f }
    return this.pointerInput(k) {
            // しきい値: 向きを決める 8・次の向き 16・確定は画面の 40% か、60 を超えて平均 0.5/ms より速い
            val lock = 8.dp.toPx() * k
            val segment = 16.dp.toPx() * k
            val minDistance = 60.dp.toPx() * k
            val minVelocity = 0.5f * density * k // 1ms あたり(平均の速さ)
            val edge = 24.dp.toPx()
            fun dominant(d: Offset) = if (abs(d.x) >= abs(d.y)) (if (d.x >= 0) "right" else "left") else (if (d.y >= 0) "down" else "up")
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                val fromEdge = down.position.x < edge
                val segs = ArrayList<String>()
                var anchor = down.position
                var lastMove = down.uptimeMillis
                val tracker = VelocityTracker()
                tracker.addPosition(down.uptimeMillis, down.position)
                fun actionOf(seq: String): SwipeAction? =
                    if (seq == "right" && fromEdge && edgeAction != null) SwipeAction("メニュー") { edgeAction?.invoke() } else current[seq]
                try {
                    while (true) {
                        val ev = awaitPointerEvent(PointerEventPass.Initial)
                        // 2 本指(拡大など)になったらやめる
                        if (ev.changes.count { it.pressed } > 1) break
                        val c = ev.changes.firstOrNull { it.id == down.id } ?: break
                        if (!c.pressed) {
                            if (segs.isEmpty() || c.uptimeMillis - lastMove > 1000) break
                            val seq = segs.joinToString(",")
                            val action = actionOf(seq) ?: break
                            if (segs.size == 1) {
                                val horizontal = seq == "left" || seq == "right"
                                val dist = (c.position - down.position).let { if (horizontal) abs(it.x) else abs(it.y) }
                                val v = dist / maxOf(1L, c.uptimeMillis - down.uptimeMillis)
                                val viewport = if (horizontal) size.width else size.height
                                if (!(dist > viewport * 0.4f * k || (dist > minDistance && v > minVelocity))) break
                            }
                            c.consume()
                            Haptics.confirm(view)
                            action.run()
                            break
                        }
                        tracker.addPosition(c.uptimeMillis, c.position)
                        if (segs.isNotEmpty()) state.path += c.position
                        val d = c.position - anchor
                        if (segs.isEmpty()) {
                            if (d.getDistance() < lock) continue
                            val dir = dominant(d)
                            // 縦に動き始めたら、ふつうのスクロール
                            if (dir == "up" || dir == "down") break
                            segs += dir
                            state.path.clear(); state.path += down.position; state.path += c.position
                            anchor = c.position
                            lastMove = c.uptimeMillis
                        } else {
                            // 前の区切りから 16 動いたら向きを見て、変わっていれば次の向きを足す(区切りは毎回置き直す)
                            if (d.getDistance() >= segment) {
                                val dir = dominant(d)
                                if (dir != segs.last()) segs += dir
                                anchor = c.position
                            }
                            if (d.getDistance() > 2f) lastMove = c.uptimeMillis
                        }
                        c.consume()
                        val label = actionOf(segs.joinToString(","))?.label
                        state.arrows = gestureArrows(segs.joinToString(","))
                        // 操作の名前が変わったら(向きを足した・登録した並びに入った)軽く振動
                        if (label != state.label && label != null) Haptics.tick(view)
                        state.label = label
                    }
                } finally {
                    state.label = null
                    state.arrows = ""
                    state.path.clear()
                }
            }
        }
}

/**
 * なぞっている間の目印: 指の軌跡を薄い線で描き、真ん中の札に向きの並び(→↑)と操作の名前を出す。
 * 割り当てのない並びのときは、向きだけを薄く出す(離しても何も起きないと分かるように)
 */
@Composable
fun BoxScope.SwipeLabel(state: SwipeState) {
    if (state.path.size >= 2) {
        val c = Palette.accent
        androidx.compose.foundation.Canvas(Modifier.matchParentSize()) {
            val p = androidx.compose.ui.graphics.Path().apply {
                moveTo(state.path[0].x, state.path[0].y)
                for (i in 1 until state.path.size) lineTo(state.path[i].x, state.path[i].y)
            }
            drawPath(p, c.copy(alpha = 0.45f), style = androidx.compose.ui.graphics.drawscope.Stroke(5.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round, join = androidx.compose.ui.graphics.StrokeJoin.Round))
            drawCircle(c.copy(alpha = 0.7f), 7.dp.toPx(), state.path.last())
        }
    }
    val label = state.label
    if (label != null || state.arrows.isNotEmpty()) {
        androidx.compose.foundation.layout.Column(
            Modifier.align(Alignment.Center).background(Palette.surface3.copy(alpha = if (label != null) 0.92f else 0.7f), RoundedCornerShape(8.dp)).padding(horizontal = 22.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (state.arrows.isNotEmpty()) Text(state.arrows, color = if (label != null) Palette.accent else Palette.textMuted, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(label ?: "割り当てなし", color = if (label != null) Palette.textStrong else Palette.textMuted, fontSize = if (label != null) 17.sp else 13.sp, fontWeight = FontWeight.Bold)
        }
    }
}

/**
 * ジェスチャーの練習: 枠の中でなぞると、スレ一覧・スレ表示でそれぞれ何の操作になるかを出す(実際には動かさない)。
 * 感度を変えながら試せる
 */
@Composable
fun GesturePractice(prefs: io.github.contentsview08.obb.data.Prefs) {
    var screen by remember { mutableStateOf("thread") }
    var last by remember { mutableStateOf<String?>(null) }
    val swipe = rememberSwipeState()
    val names = GESTURE_ACTIONS.getValue(screen).toMap()
    val map = prefs.gestures(screen).mapNotNull { (seq, key) -> names[key]?.takeIf { key.isNotEmpty() }?.let { n -> seq to SwipeAction(n) { last = "${gestureArrows(seq)}  $n" } } }.toMap()
    androidx.compose.foundation.layout.Column(Modifier.padding(16.dp)) {
        androidx.compose.foundation.layout.Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
            for ((k, n) in listOf("list" to "スレ一覧", "thread" to "スレ表示")) Text(
                n,
                Modifier.background(if (k == screen) Palette.accentWash else Palette.surface2, RoundedCornerShape(50))
                    .then(Modifier.pointerInput(k) { awaitEachGesture { awaitFirstDown(); screen = k; last = null } }).padding(horizontal = 14.dp, vertical = 6.dp),
                color = if (k == screen) Palette.accent else Palette.textBody, fontSize = 13.sp, fontWeight = FontWeight.Bold,
            )
        }
        Box(
            Modifier.padding(top = 12.dp).fillMaxWidth().height(320.dp).background(Palette.surface, RoundedCornerShape(8.dp))
                .swipeGestures(swipe, map, sensitivity = prefs.gestureSensitivity),
        ) {
            Text(
                last?.let { "いまの操作: $it" } ?: "この枠の中でなぞってください(横に動かし始め、続けて上下に)", Modifier.align(Alignment.TopCenter).padding(14.dp),
                color = if (last != null) Palette.textStrong else Palette.textMuted, fontSize = 13.sp,
            )
            SwipeLabel(swipe)
        }
    }
}

/** なぞる操作に割り当てられる操作(キー → 名前)。screen は list / thread。"" は何もしない */
val GESTURE_ACTIONS: Map<String, List<Pair<String, String>>> = mapOf(
    "list" to listOf(
        "drawer" to "メニュー", "forward" to "進む", "bottom" to "一番下へ", "top" to "先頭へ", "refresh" to "更新",
        "newThread" to "スレを立てる", "search" to "スレタイを探す", "quick" to "クイックアクセス", "" to "なし",
    ),
    "thread" to listOf(
        "back" to "一覧に戻る", "reply" to "書き込む", "bottom" to "一番下へ", "top" to "先頭へ", "refresh" to "更新",
        "deleteLog" to "ログを削除", "drawer" to "メニュー", "search" to "レスを探す", "favorite" to "お気に入りのスレ", "next" to "次スレを探す", "quick" to "クイックアクセス", "" to "なし",
    ),
)

/** 向きの並びの見せ方(「right,up」→「→↑」) */
fun gestureArrows(seq: String) = seq.split(',').joinToString("") { when (it) { "right" -> "→"; "left" -> "←"; "up" -> "↑"; else -> "↓" } }

/** 設定の割り当てを、画面の操作に結びつける。actions は操作のキー → 動き */
fun buildGestures(assign: Map<String, String>, screen: String, actions: Map<String, () -> Unit>): Map<String, SwipeAction> {
    val names = GESTURE_ACTIONS.getValue(screen).toMap()
    return assign.mapNotNull { (seq, key) -> actions[key]?.let { run -> seq to SwipeAction(names[key] ?: key, run) } }.toMap()
}

