package io.github.contentsview08.obb.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class DownloadLanesTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @Test fun queued_thumbnail_runs_in_viewer_lane_when_opened() = runBlocking {
        val lanes = DownloadLanes<String>(scope, thumbs = 1, viewers = 1)
        val hold = CompletableDeferred<Unit>()
        val holding = CompletableDeferred<Unit>()
        // サムネイルの枠を塞ぐ
        val blocker = lanes.start("blocker", viewer = false) { holding.complete(Unit); hold.await(); "blocker" }
        holding.await()
        val runs = AtomicInteger()
        val work: suspend (DownloadRun) -> String = { runs.incrementAndGet(); "image" }
        val thumb = lanes.start("image", viewer = false, work)
        // 枠が空かないので、ビューアーの枠へ移らなければ終わらない
        val viewer = lanes.start("image", viewer = true, work)
        assertEquals("image", withTimeout(5000) { viewer.await() })
        assertEquals("image", thumb.await())
        assertFalse(lanes.isRunning("image"))
        // 枠が空いて、待っていたサムネイルの分が動いても、2 回は取らない
        hold.complete(Unit)
        assertEquals("blocker", withTimeout(5000) { blocker.await() })
        val after = lanes.start("next", viewer = false) { "next" }
        assertEquals("next", withTimeout(5000) { after.await() })
        assertEquals(1, runs.get())
    }

    @Test fun same_key_runs_once_while_running() = runBlocking {
        val lanes = DownloadLanes<Int>(scope, thumbs = 2, viewers = 2)
        val hold = CompletableDeferred<Unit>()
        val runs = AtomicInteger()
        val work: suspend (DownloadRun) -> Int = { hold.await(); runs.incrementAndGet() }
        val a = lanes.start("k", viewer = false, work)
        val b = lanes.start("k", viewer = false, work)
        assertTrue(a === b)
        hold.complete(Unit)
        assertEquals(1, withTimeout(5000) { a.await() })
        assertEquals(1, runs.get())
    }

    @Test fun cancel_skips_queued_work() = runBlocking {
        val lanes = DownloadLanes<String?>(scope, thumbs = 1, viewers = 1)
        val hold = CompletableDeferred<Unit>()
        val started = CompletableDeferred<Unit>()
        val first = lanes.start("a", viewer = false) { started.complete(Unit); hold.await(); "a" }
        started.await()
        val ran = AtomicInteger(0)
        val queued = lanes.start("b", viewer = false) { ran.incrementAndGet(); "b" }
        assertTrue(lanes.cancel("b", null))
        assertEquals(null, withTimeout(5000) { queued.await() })
        assertFalse(lanes.isRunning("b"))
        hold.complete(Unit)
        assertEquals("a", withTimeout(5000) { first.await() })
        assertEquals(0, ran.get())
    }

    @Test fun cancel_tells_running_work_and_restart_is_a_new_run() = runBlocking {
        val lanes = DownloadLanes<String?>(scope, thumbs = 1, viewers = 1)
        val started = CompletableDeferred<Unit>()
        val stop = CompletableDeferred<Unit>()
        val running = lanes.start("a", viewer = false) { run -> run.onCancel { stop.complete(Unit) }; started.complete(Unit); stop.await(); "古い" }
        started.await()
        assertTrue(lanes.cancel("a", null))
        assertEquals(null, withTimeout(5000) { running.await() })
        val again = lanes.start("a", viewer = false) { "新しい" }
        assertEquals("新しい", withTimeout(5000) { again.await() })
        assertFalse(lanes.cancel("なし", null))
    }
}
