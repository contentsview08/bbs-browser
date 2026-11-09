package io.github.contentsview08.obb.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// 実況モード(bbs-suite docs/autoscroll.md)。PC 版(apps/desktop/src/utils/liveReveal.ts)と同じ場面でそろえる
class LiveModeTest {
    /** 2026-11-09 00:01:43 日本時間 */
    private val t0 = java.time.OffsetDateTime.parse("2026-11-09T00:01:43+09:00").toInstant().toEpochMilli()

    // ── 日時の文字 ──

    @Test fun 五ちゃんの日時は百分の一秒まで読む() {
        assertEquals(t0 + 120, postTimeMs("2026/11/09(月) 00:01:43.12"))
        // ID などが後ろに続いてもよい
        assertEquals(t0 + 120, postTimeMs("2026/11/09(月) 00:01:43.12 ID:abcd1234"))
    }

    @Test fun honoBbsのISOとアプリの形() {
        assertEquals(t0 + 123, postTimeMs("2026-11-08T15:01:43.123Z"))
        assertEquals(t0, postTimeMs("2026-11-09T00:01:43+09:00"))
        assertEquals(t0 + 123, postTimeMs("2026/11/09(月) 00:01:43.123"))
    }

    @Test fun したらばとまちBBSの形() {
        assertEquals(t0, postTimeMs("2026/11/09(月) 00:01:43"))
        assertEquals(t0, postTimeMs("2026/11/09(Mon) 00:01:43"))
        assertEquals(t0, postTimeMs("26/11/09(月)00:01:43"))
        assertEquals(t0, postTimeMs("2026年11月09日(月) 00時01分43秒"))
    }

    @Test fun 秒がない読めないならnull() {
        assertNull(postTimeMs("2026/11/09(月) 00:01"))
        assertNull(postTimeMs("あぼーん"))
        assertNull(postTimeMs(""))
        assertNull(postTimeMs("2026/13/40(月) 25:01:43"))
    }

    // ── 出す時刻 ──

    @Test fun 秒が分かれば基準からの差だけ遅らせる() {
        // 間隔 5 秒で、基準の 1 秒後と 4 秒後に書かれた 2 件
        assertEquals(listOf(1000L, 4000L), liveRevealSchedule(listOf(t0 + 1000, t0 + 4000), t0, 5000))
    }

    @Test fun 同じ時刻が続いても重ねない() {
        assertEquals(listOf(0L, 100L, 2000L), liveRevealSchedule(listOf(t0, t0, t0 + 2000), t0, 5000))
    }

    @Test fun 差がTを超えたら比を保ってTの中に縮める() {
        // 2・6・10 秒後(T = 5) → 1・3・5 秒後
        assertEquals(listOf(1000L, 3000L, 5000L), liveRevealSchedule(listOf(t0 + 2000, t0 + 6000, t0 + 10_000), t0, 5000))
        // 長く静かだった後は、その空白を除いて時刻の差どおりに出す
        assertEquals(listOf(1000L, 3000L, 5000L), liveRevealSchedule(listOf(t0 + 60_500, t0 + 62_500, t0 + 64_500), t0, 5000))
        assertEquals(listOf(0L, 5000L), liveRevealSchedule(listOf(t0 + 60_000, t0 + 70_000), t0, 5000))
    }

    @Test fun 秒が分からなければ等間隔() {
        assertEquals(listOf(1250L, 2500L, 3750L, 5000L), liveRevealSchedule(listOf(null, null, null, null), null, 5000))
        // 1 件でも読めなければ等間隔
        assertEquals(listOf(2500L, 5000L), liveRevealSchedule(listOf(t0 + 1000, null), t0, 5000))
        // 基準が読めなくても等間隔
        assertEquals(listOf(2500L, 5000L), liveRevealSchedule(listOf(t0 + 1000, t0 + 2000), null, 5000))
    }

    @Test fun 順番が前後したら等間隔() {
        assertEquals(listOf(2500L, 5000L), liveRevealSchedule(listOf(t0 + 3000, t0 + 1000), t0, 5000))
        // 基準より前の時刻も前後とみなす
        assertEquals(listOf(5000L), liveRevealSchedule(listOf(t0 - 1000), t0, 5000))
    }

    @Test fun 多すぎれば一件あたり0点1秒でTを超えて続ける() {
        val d = liveRevealSchedule(List(80) { null }, null, 5000)
        assertEquals(100L, d.first())
        assertEquals(8000L, d.last())
        assertTrue(d.zipWithNext().all { (a, b) -> b - a == 100L })
        // 秒が分かっても詰めすぎない
        assertEquals(listOf(0L, 100L, 200L), liveRevealSchedule(listOf(t0, t0, t0), t0, 3000))
    }

    @Test fun 届いていなければ空() {
        assertEquals(emptyList<Long>(), liveRevealSchedule(emptyList(), t0, 5000))
    }

    @Test fun 前の分が残っていれば後ろに続ける() {
        val (at, flush) = liveQueueTimes(10_000, listOf(500, 1000), 12_000, 5000)
        assertEquals(listOf(12_100L, 12_200L), at)
        assertFalse(flush)
        // 残っていなければ今から
        assertEquals(listOf(10_500L, 11_000L), liveQueueTimes(10_000, listOf(500, 1000), null, 5000).first)
    }

    @Test fun 間隔の3倍より先まで溜まったら全部出す() {
        assertTrue(liveQueueTimes(0, listOf(15_100), null, 5000).second)
        assertFalse(liveQueueTimes(0, listOf(15_000), null, 5000).second)
    }

    // ── 速さのスライダー ──

    @Test fun スライダーは対数の目盛り() {
        assertEquals(0.5f, liveSpeedOfPos(0f), 0.0001f)
        assertEquals(40f, liveSpeedOfPos(1f), 0.0001f)
        // 真ん中は 0.5 × √80 ≒ 4.5
        assertEquals(4.5f, liveSpeedOfPos(0.5f), 0.0001f)
        assertEquals(2f, liveSpeedOfPos(posOfLiveSpeed(2f)), 0.0001f)
        assertEquals(0f, posOfLiveSpeed(0.1f), 0.0001f)
        assertEquals(1f, posOfLiveSpeed(100f), 0.0001f)
    }

    @Test fun 速さの見せ方() {
        assertEquals("2", liveSpeedText(2f))
        assertEquals("0.5", liveSpeedText(0.5f))
        assertEquals("40", liveSpeedText(40f))
    }

    // ── 残りの距離 ──

    @Test fun 残りの距離は最後の行が見えていればその下端まで() {
        val rows = listOf(AutoRow(8, 0, 300), AutoRow(9, 300, 400), AutoRow(10, 700, 50))
        assertEquals(100f, remainingToLastPx(rows, 9, 600), 0.001f)
    }

    @Test fun 残りの距離は見えていない行を平均の高さで見積もる() {
        val rows = listOf(AutoRow(0, -100, 200), AutoRow(1, 100, 600))
        assertEquals(1300f, remainingToLastPx(rows, 4, 600), 0.001f)
    }
}
