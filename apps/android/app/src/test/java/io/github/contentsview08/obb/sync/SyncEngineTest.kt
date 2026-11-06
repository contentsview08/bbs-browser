package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.sync.adapters.FavoriteThreadAdapter
import io.github.contentsview08.obb.sync.adapters.ResolvedBoard
import io.github.contentsview08.obb.sync.engine.SyncEngine
import io.github.contentsview08.obb.sync.engine.SyncKeyMaterial
import io.github.contentsview08.obb.sync.engine.SyncKeyStore
import io.github.contentsview08.obb.sync.engine.SyncRequest
import io.github.contentsview08.obb.sync.engine.SyncResponse
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

// 共通シナリオに載せない、スマホの同時実行の決まり
class SyncEngineTest {
    private class Keys : SyncKeyStore {
        var value: SyncKeyMaterial? = null
        override suspend fun load() = value
        override suspend fun save(v: SyncKeyMaterial) {
            value = v
        }
        override suspend fun clear() {
            value = null
        }
    }

    private fun server(now: () -> Long) = FakeSyncServer(now = now, ratePerMinute = null, fullPullPerHour = null)

    private fun engine(db: JdbcSyncSql, now: () -> Long, send: suspend (SyncRequest) -> SyncResponse) = SyncEngine(
        db = db,
        keyStore = Keys(),
        transport = { send(it) },
        serverUrl = "https://sync.test",
        adapters = listOf(FavoriteThreadAdapter(db) { ResolvedBoard(it, "2ch-compat") }),
        now = now,
        newDeviceId = { "dev" },
    )

    private fun call(s: FakeSyncServer, r: SyncRequest): SyncResponse {
        val path = r.url.removePrefix("https://sync.test")
        val res = s.handle(FakeRequest(r.method, path, r.headers, r.body))
        return SyncResponse(res.status, res.body, res.headers)
    }

    @Test fun 走っている間のきっかけはもう1周にまとまり通信が重ならない() = runBlocking {
        val now = 1_800_000_000_000L
        val s = server { now }
        val gate = CompletableDeferred<Unit>()
        val active = AtomicInteger()
        var peak = 0
        val pulls = AtomicInteger()
        val entered = CompletableDeferred<Unit>()
        val db = JdbcSyncSql.open()
        val e = engine(db, { now }) { r ->
            val n = active.incrementAndGet()
            synchronized(this@SyncEngineTest) { peak = maxOf(peak, n) }
            if (r.url.contains("/changes")) pulls.incrementAndGet()
            entered.complete(Unit)
            gate.await()
            call(s, r).also { active.decrementAndGet() }
        }
        e.pair(ByteArray(32) { 7 })
        val first = async(Dispatchers.Default) { e.runCycle(true) }
        entered.await()
        val others = List(3) { async(Dispatchers.Default) { e.runCycle(true) } }
        // 後の 3 つが印を付けるのを待ってから通す
        Thread.sleep(200)
        gate.complete(Unit)
        (others + first).forEach { it.await() }
        assertEquals(1, peak)
        // 初回の周(404 と作成のあとの読み)と、まとまった 1 周
        assertEquals(3, pulls.get())
        db.close()
    }

    @Test fun pullは自動のきっかけなら10秒あける() = runBlocking {
        var now = 1_800_000_000_000L
        val s = server { now }
        val pulls = AtomicInteger()
        val db = JdbcSyncSql.open()
        val e = engine(db, { now }) { r ->
            if (r.url.contains("/changes")) pulls.incrementAndGet()
            call(s, r)
        }
        e.pair(ByteArray(32) { 7 })
        e.runCycle(true)
        pulls.set(0)
        e.runCycle(false)
        assertEquals(0, pulls.get())
        now += SyncConfig.PULL_MIN_GAP_MS
        e.runCycle(false)
        assertEquals(1, pulls.get())
        e.runCycle(true)
        assertEquals(2, pulls.get())
        db.close()
    }
}
