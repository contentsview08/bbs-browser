package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.sync.SyncConfig.HEAD_INTERVAL_MS
import io.github.contentsview08.obb.sync.SyncConfig.IDLE_STOP_MS
import io.github.contentsview08.obb.sync.SyncConfig.NET_MIN_GAP_MS
import io.github.contentsview08.obb.sync.SyncConfig.NET_SETTLE_MS
import io.github.contentsview08.obb.sync.SyncConfig.PUSH_INTERVAL_MS
import io.github.contentsview08.obb.sync.engine.SchedulerHost
import io.github.contentsview08.obb.sync.engine.SyncPace
import io.github.contentsview08.obb.sync.engine.SyncScheduler
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

    @Test fun 前面に来るとすぐpullし30秒ごとに確認する_変化がなければ周を回さない() = runBlocking {
        val x = Setup()
        x.s.foreground()
        assertEquals(listOf("foreground"), x.log)
        x.c.advance(HEAD_INTERVAL_MS - 1)
        assertEquals(listOf("foreground"), x.log)
        x.c.advance(1)
        assertEquals(listOf("foreground", "head"), x.log)
        x.c.advance(HEAD_INTERVAL_MS * 3)
        assertEquals(listOf("foreground", "head", "head", "head", "head"), x.log)
    }

    @Test fun 確認で変化があれば周を回す() = runBlocking {
        val x = Setup()
        x.s.foreground()
        x.changed = true
        x.c.advance(HEAD_INTERVAL_MS)
        assertEquals(listOf("foreground", "head", "tick"), x.log)
    }

    @Test fun 変更がないと送らない_変更があれば次の30秒で1回だけ送る() = runBlocking {
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
        x.c.advance(IDLE_STOP_MS)
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
        x.c.advance(HEAD_INTERVAL_MS)
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
        assertEquals(120_000L to PUSH_INTERVAL_MS, pair(SyncPace(120.0, 5.0)))
        assertEquals(HEAD_INTERVAL_MS to PUSH_INTERVAL_MS, pair(SyncPace(-1.0, Double.NaN)))
        val x = Setup(paceValue = SyncPace(headSec = 120.0))
        x.s.foreground()
        x.c.advance(119_000)
        assertEquals(listOf("foreground"), x.log)
        x.c.advance(1_000)
        assertEquals(listOf("foreground", "head"), x.log)
    }

    @Test fun 使っていないときは何もしない() = runBlocking {
        val x = Setup(on = false, changes = true)
        x.s.foreground()
        x.c.advance(HEAD_INTERVAL_MS * 4)
        x.s.background()
        assertEquals(emptyList<String>(), x.log)
    }
}
