package io.github.contentsview08.obb.ui

import org.junit.Assert.assertEquals
import org.junit.Test

// 自動で流す速さ(bbs-suite docs/autoscroll.md)。PC 版も同じ場面でそろえる
class AutoScrollTest {
    private val lh = 40f // 本文の 1 行(px)
    private fun speed(rem: Float, ms: Long?, caughtUp: Boolean, key: String = "normal") = autoScrollSpeed(rem, ms, lh, key, caughtUp)

    @Test fun 追いつくまでは既定の速さで一定() {
        assertEquals(80f, speed(100_000f, 5_000, caughtUp = false), 0.001f)
        assertEquals(40f, speed(100_000f, 5_000, caughtUp = false, key = "slow"), 0.001f)
        assertEquals(160f, speed(100_000f, null, caughtUp = false, key = "fast"), 0.001f)
    }

    @Test fun 追いついた後は次の更新にちょうど着く速さ() {
        // 1200 px を 5 秒で → 240 px/秒(既定 80 と最大 480 の間)
        assertEquals(240f, speed(1200f, 5_000, caughtUp = true), 0.001f)
    }

    @Test fun 追いついた後も既定の速さより遅くしない() {
        // 50 px を 10 秒 → 5 px/秒だが、既定の 80 px/秒で流して下で待つ
        assertEquals(80f, speed(50f, 10_000, caughtUp = true), 0.001f)
    }

    @Test fun 最大の速さは既定の6倍() {
        assertEquals(480f, speed(100_000f, 1_000, caughtUp = true), 0.001f)
        assertEquals(960f, speed(100_000f, 1_000, caughtUp = true, key = "fast"), 0.001f)
    }

    @Test fun 更新が遅れたら残りの半分の速さで寄せる() {
        assertEquals(50f, speed(100f, 0, caughtUp = true), 0.001f)
        assertEquals(50f, speed(100f, -3_000, caughtUp = true), 0.001f)
        // 遅れていても最大の速さは超えない
        assertEquals(480f, speed(10_000f, -1, caughtUp = true), 0.001f)
    }

    @Test fun 自動更新がオフなら既定の速さで下まで流して止まる() {
        assertEquals(80f, speed(500f, null, caughtUp = true), 0.001f)
        assertEquals(0f, speed(0f, null, caughtUp = true), 0.001f)
    }

    @Test fun 下に着いていれば動かない() {
        assertEquals(0f, speed(0f, 5_000, caughtUp = true), 0.001f)
        assertEquals(0f, speed(-30f, 5_000, caughtUp = false), 0.001f)
    }

    @Test fun 知らない選択肢はふつう() {
        assertEquals(80f, speed(100_000f, 5_000, caughtUp = false, key = "?"), 0.001f)
    }

    @Test fun 残りの距離は最後のレスが見えていればその下端まで() {
        val rows = listOf(AutoRow(8, 0, 300), AutoRow(9, 300, 400), AutoRow(10, 700, 50))
        assertEquals(100f, remainingToLastPx(rows, 9, 600), 0.001f)
    }

    @Test fun 残りの距離は見えていないレスを平均の高さで見積もる() {
        val rows = listOf(AutoRow(0, -100, 200), AutoRow(1, 100, 600))
        // 1 の下端まで 100 + まだ測っていない 2〜4 の 3 つ × 平均 400
        assertEquals(1300f, remainingToLastPx(rows, 4, 600), 0.001f)
    }

    @Test fun レスより後の行だけ見えていれば通り越している() {
        assertEquals(0f, remainingToLastPx(listOf(AutoRow(10, 0, 50)), 9, 600), 0.001f)
    }

    @Test fun 画面より下のレスの数() {
        val rows = listOf(AutoRow(0, 0, 300), AutoRow(1, 300, 400), AutoRow(2, 700, 100))
        // 2 は上端が画面の下端より下なので、2〜20 の 19
        assertEquals(19, postsBelow(rows, 20, 600))
    }
}
