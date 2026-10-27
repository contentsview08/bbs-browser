package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
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
class SwipeState { var label by mutableStateOf<String?>(null) }

@Composable
fun rememberSwipeState() = remember { SwipeState() }

/**
 * スワイプ(指でなぞる)の操作。今のスマホ版の useSwipeGesture と同じ決まり。
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
    // 感度(1 鈍い〜5 敏感)を、しきい値に掛ける倍率にする。3 が標準(今のスマホ版と同じ)
    val k = when (sensitivity) { 1 -> 1.6f; 2 -> 1.3f; 4 -> 0.7f; 5 -> 0.45f; else -> 1f }
    return this.pointerInput(k) {
            // しきい値は今のスマホ版と同じ(向きを決める 8・次の向き 16・確定は画面の 40% か、60 を超えて平均 0.5/ms より速い)
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
                            action.run()
                            break
                        }
                        tracker.addPosition(c.uptimeMillis, c.position)
                        val d = c.position - anchor
                        if (segs.isEmpty()) {
                            if (d.getDistance() < lock) continue
                            val dir = dominant(d)
                            // 縦に動き始めたら、ふつうのスクロール
                            if (dir == "up" || dir == "down") break
                            segs += dir
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
                        state.label = actionOf(segs.joinToString(","))?.label
                    }
                } finally {
                    state.label = null
                }
            }
        }
}

@Composable
fun BoxScope.SwipeLabel(state: SwipeState) {
    state.label?.let {
        Text(
            it, Modifier.align(Alignment.Center).background(Palette.surface3.copy(alpha = 0.92f), RoundedCornerShape(8.dp)).padding(horizontal = 22.dp, vertical = 14.dp),
            color = Palette.textStrong, fontSize = 17.sp, fontWeight = FontWeight.Bold,
        )
    }
}

/** なぞる操作に割り当てられる操作(キー → 名前)。screen は list / thread。"" は何もしない */
val GESTURE_ACTIONS: Map<String, List<Pair<String, String>>> = mapOf(
    "list" to listOf(
        "drawer" to "メニュー", "forward" to "進む", "bottom" to "一番下へ", "top" to "先頭へ", "refresh" to "更新",
        "newThread" to "スレを立てる", "search" to "スレタイを探す", "" to "なし",
    ),
    "thread" to listOf(
        "back" to "一覧に戻る", "reply" to "書き込む", "bottom" to "一番下へ", "top" to "先頭へ", "refresh" to "更新",
        "deleteLog" to "ログを削除", "drawer" to "メニュー", "search" to "レスを探す", "favorite" to "お気に入りのスレ", "next" to "次スレを探す", "" to "なし",
    ),
)

/** 向きの並びの見せ方(「right,up」→「→↑」) */
fun gestureArrows(seq: String) = seq.split(',').joinToString("") { when (it) { "right" -> "→"; "left" -> "←"; "up" -> "↑"; else -> "↓" } }

/** 設定の割り当てを、画面の操作に結びつける。actions は操作のキー → 動き */
fun buildGestures(assign: Map<String, String>, screen: String, actions: Map<String, () -> Unit>): Map<String, SwipeAction> {
    val names = GESTURE_ACTIONS.getValue(screen).toMap()
    return assign.mapNotNull { (seq, key) -> actions[key]?.let { run -> seq to SwipeAction(names[key] ?: key, run) } }.toMap()
}
