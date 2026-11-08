package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.sync.SyncConfig.HEAD_BACKOFF_MAX_MS
import io.github.contentsview08.obb.sync.SyncConfig.HEAD_INTERVAL_MS
import io.github.contentsview08.obb.sync.SyncConfig.IDLE_STOP_MS
import io.github.contentsview08.obb.sync.SyncConfig.NET_MIN_GAP_MS
import io.github.contentsview08.obb.sync.SyncConfig.NET_SETTLE_MS
import io.github.contentsview08.obb.sync.SyncConfig.PUSH_INTERVAL_MS
import io.github.contentsview08.obb.sync.engine.SchedulerHost
import io.github.contentsview08.obb.sync.engine.SyncPace
import io.github.contentsview08.obb.sync.engine.SyncScheduler
import io.github.contentsview08.obb.sync.engine.headWaitMs
import io.github.contentsview08.obb.sync.engine.paceMs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

// 自動の同期を偽の時計で確かめる。PC 版の packages/sync/test/scheduler.test.ts と同じ内容
class SyncSchedulerTest {
    private class FakeClock {
        var now = 1_800_000_000_000L
        private var seq = 0
        private class Timer(val at: Long, val f: () -> Unit)
        private val timers = LinkedHashMap<Int, Timer>()
        val pending get() = timers.size

        fun setTimer(f: () -> Unit, ms: Long): Any {
            timers[++seq] = Timer(now + ms, f)
            return seq
        }

        fun clearTimer(t: Any) {
            timers.remove(t as Int)
        }

        fun advance(ms: Long) {
            val end = now + ms
            while (true) {
                val next = timers.entries.filter { it.value.at <= end }.minByOrNull { it.value.at } ?: break
                timers.remove(next.key)
                now = next.value.at
                next.value.f()
            }
            now = end
        }
    }

    private class Setup(idle: Boolean = false, var changes: Boolean = false, var changed: Boolean = false, var on: Boolean = true, var paceValue: SyncPace? = null) {
        val c = FakeClock()
        val log = ArrayList<String>()
        val heads get() = log.count { it == "head" }
        val s = SyncScheduler(object : SchedulerHost {
            override fun now() = c.now
            override fun setTimer(f: () -> Unit, ms: Long) = c.setTimer(f, ms)
            override fun clearTimer(t: Any) = c.clearTimer(t)

            // 中で本当に待つものがないので、その場で最後まで動く
            override fun launch(f: suspend () -> Unit) {
                CoroutineScope(Dispatchers.Unconfined).launch { f() }
            }

            override suspend fun enabled() = on
            override suspend fun cycle(reason: String) {
                log += reason
                changes = false
            }

            override suspend fun check(): Boolean {
                log += "head"
                return changed
            }

            override suspend fun hasChanges() = changes
            override fun pace() = paceValue
            override val idleStops = idle
        })
    }

    @Test fun 前面に来るとすぐpullし1分後に確認する_変化なしが続くと間隔を2倍ずつ伸ばし5分で止める() = runBlocking {
        val x = Setup()
        x.s.foreground()
        assertEquals(listOf("foreground"), x.log)
        x.c.advance(HEAD_INTERVAL_MS - 1)
        assertEquals(listOf("foreground"), x.log)
        x.c.advance(1)
        assertEquals(listOf("foreground", "head"), x.log)
        // 2 倍: 2 分後
        x.c.advance(HEAD_INTERVAL_MS * 2 - 1)
        assertEquals(1, x.heads)
        x.c.advance(1)
        assertEquals(2, x.heads)
        // 4 倍: 4 分後
        x.c.advance(HEAD_INTERVAL_MS * 4)
        assertEquals(3, x.heads)
        // 上限の 5 分
        x.c.advance(HEAD_BACKOFF_MAX_MS - 1)
        assertEquals(3, x.heads)
        x.c.advance(1)
        assertEquals(4, x.heads)
        x.c.advance(HEAD_BACKOFF_MAX_MS)
        assertEquals(5, x.heads)
        assertEquals(emptyList<String>(), x.log.filter { it == "tick" })
    }

    @Test fun 確認で変化があれば周を回し間隔は基本に戻る() = runBlocking {
        val x = Setup()
        x.s.foreground()
        x.c.advance(HEAD_INTERVAL_MS)
        assertEquals(listOf("foreground", "head"), x.log)
        // 伸びた間隔の途中で変化が出ても、次の確認まで待つ
        x.changed = true
        x.c.advance(HEAD_INTERVAL_MS)
        assertEquals(listOf("foreground", "head"), x.log)
        x.c.advance(HEAD_INTERVAL_MS)
        assertEquals(listOf("foreground", "head", "head", "tick"), x.log)
        x.changed = false
        x.c.advance(HEAD_INTERVAL_MS)
        assertEquals(listOf("foreground", "head", "head", "tick", "head"), x.log)
    }

    @Test fun 利用者の操作で間隔を基本に戻す_放置で止めない端末でも戻す() = runBlocking {
        val a = Setup()
        a.s.foreground()
        repeat(5) {
            a.c.advance(HEAD_INTERVAL_MS)
            a.s.activity()
        }
        assertEquals(5, a.heads)
        // 操作がなければ同じ 5 分で 2 回
        val b = Setup()
        b.s.foreground()
        b.c.advance(HEAD_INTERVAL_MS * 5)
        assertEquals(2, b.heads)
        // 伸びているときの操作は、確認が遅れていればすぐ確認する
        b.s.activity()
        b.c.advance(0)
        assertEquals(3, b.heads)
    }

    @Test fun 前面に戻ると間隔を基本に戻す_周を回しても戻す() = runBlocking {
        val x = Setup()
        x.s.foreground()
        x.c.advance(HEAD_INTERVAL_MS * 4)
        assertEquals(2, x.heads)
        x.s.background()
        x.s.foreground()
        x.c.advance(HEAD_INTERVAL_MS)
        assertEquals(3, x.heads)
        // 送信の周のあとも基本から
        x.changes = true
        x.c.advance(PUSH_INTERVAL_MS - HEAD_INTERVAL_MS)
        assertEquals("tick", x.log.last())
        x.c.advance(HEAD_INTERVAL_MS)
        assertEquals("head", x.log.last())
    }

    @Test fun 変更がないと送らない_変更があれば次の送信の間隔で1回だけ送る() = runBlocking {
        val x = Setup()
        x.s.foreground()
        x.c.advance(PUSH_INTERVAL_MS * 2)
        assertEquals(emptyList<String>(), x.log.filter { it == "tick" })
        x.changes = true
        x.c.advance(PUSH_INTERVAL_MS)
        assertEquals(listOf("tick"), x.log.filter { it == "tick" })
        x.c.advance(PUSH_INTERVAL_MS * 3)
        assertEquals(listOf("tick"), x.log.filter { it == "tick" })
    }

    @Test fun 確認を遠ざけている間も送るものは送信の間隔で送る() = runBlocking {
        val x = Setup()
        x.s.foreground()
        x.c.advance(HEAD_INTERVAL_MS * 7)
        assertEquals(3, x.heads)
        x.changes = true
        x.c.advance(PUSH_INTERVAL_MS)
        assertEquals(listOf("tick"), x.log.filter { it == "tick" })
    }

    @Test fun 裏に回る瞬間に送るものがあれば1回だけ試し裏では何も動かない() = runBlocking {
        val x = Setup()
        x.s.foreground()
        x.changes = true
        x.s.background()
        assertEquals(listOf("foreground", "background"), x.log)
        assertEquals(0, x.c.pending)
        x.changes = true
        x.c.advance(HEAD_INTERVAL_MS * 20)
        x.s.activity()
        x.s.networkBack()
        x.c.advance(NET_SETTLE_MS * 2)
        assertEquals(listOf("foreground", "background"), x.log)
    }

    @Test fun 裏に回るときに送るものがなければ通信しない() = runBlocking {
        val x = Setup()
        x.s.foreground()
        x.s.background()
        assertEquals(listOf("foreground"), x.log)
    }

    @Test fun ネットワークの復帰は5秒待ち前回から30秒以上空いていれば同期する() = runBlocking {
        val x = Setup(paceValue = SyncPace(3600.0, 3600.0))
        x.s.foreground()
        x.c.advance(10_000)
        x.s.networkBack()
        x.c.advance(NET_SETTLE_MS)
        assertEquals(listOf("foreground"), x.log)
        x.c.advance(NET_MIN_GAP_MS)
        x.s.networkBack()
        x.c.advance(NET_SETTLE_MS - 1)
        assertEquals(listOf("foreground"), x.log)
        x.c.advance(1)
        assertEquals(listOf("foreground", "network"), x.log)
    }

    @Test fun 放置で止める設定では10分操作がなければ確認を止め次の操作で1回確認する() = runBlocking {
        val x = Setup(idle = true)
        x.s.foreground()
        // 止めるのは時計が起きたとき。送信の間隔の分だけ遅れることがある
        x.c.advance(IDLE_STOP_MS + PUSH_INTERVAL_MS)
        val before = x.log.size
        assertEquals(true, x.s.isPaused)
        assertEquals(0, x.c.pending)
        x.c.advance(HEAD_INTERVAL_MS * 10)
        assertEquals(before, x.log.size)
        x.s.activity()
        x.c.advance(0)
        assertEquals(before + 1, x.log.size)
        assertEquals("head", x.log.last())
        assertEquals(false, x.s.isPaused)
        x.c.advance(HEAD_INTERVAL_MS * 2)
        assertEquals(before + 2, x.log.size)
    }

    @Test fun 操作が続けば止めない_スマホは操作がなくても止めない() = runBlocking {
        val a = Setup(idle = true)
        a.s.foreground()
        repeat(25) {
            a.c.advance(HEAD_INTERVAL_MS)
            a.s.activity()
        }
        assertEquals(false, a.s.isPaused)
        val b = Setup()
        b.s.foreground()
        b.c.advance(IDLE_STOP_MS * 2)
        assertEquals(false, b.s.isPaused)
        assertEquals("head", b.log.last())
    }

    @Test fun サーバーの指示より短くせず指示が既定より短くても既定より縮めない() = runBlocking {
        fun pair(p: SyncPace?) = paceMs(p).let { it.head to it.push }
        assertEquals(HEAD_INTERVAL_MS to PUSH_INTERVAL_MS, pair(null))
        assertEquals(180_000L to PUSH_INTERVAL_MS, pair(SyncPace(180.0, 5.0)))
        assertEquals(HEAD_INTERVAL_MS to PUSH_INTERVAL_MS, pair(SyncPace(-1.0, Double.NaN)))
        // 大きすぎる指示は 1 時間で丸める(時刻の足し算があふれて確認が空回りしないように)
        assertEquals(3_600_000L to 3_600_000L, pair(SyncPace(99_999_999.0, 1e300)))
        val x = Setup(paceValue = SyncPace(headSec = 180.0))
        x.s.foreground()
        x.c.advance(179_000)
        assertEquals(listOf("foreground"), x.log)
        x.c.advance(1_000)
        assertEquals(listOf("foreground", "head"), x.log)
    }

    @Test fun 伸ばす間隔は基本より短くせず上限で止める_指示が上限より長ければ指示のまま() {
        assertEquals(HEAD_INTERVAL_MS, headWaitMs(HEAD_INTERVAL_MS, 0))
        assertEquals(HEAD_INTERVAL_MS * 2, headWaitMs(HEAD_INTERVAL_MS, 1))
        assertEquals(HEAD_INTERVAL_MS * 4, headWaitMs(HEAD_INTERVAL_MS, 2))
        assertEquals(HEAD_BACKOFF_MAX_MS, headWaitMs(HEAD_INTERVAL_MS, 3))
        assertEquals(HEAD_BACKOFF_MAX_MS, headWaitMs(HEAD_INTERVAL_MS, 40))
        assertEquals(HEAD_BACKOFF_MAX_MS * 2, headWaitMs(HEAD_BACKOFF_MAX_MS * 2, 3))
    }

    @Test fun 使っていないときは何もしない() = runBlocking {
        val x = Setup(on = false, changes = true)
        x.s.foreground()
        x.c.advance(HEAD_INTERVAL_MS * 4)
        x.s.background()
        assertEquals(emptyList<String>(), x.log)
    }
}
