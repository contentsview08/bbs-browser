package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.sync.adapters.FavoriteThreadAdapter
import io.github.contentsview08.obb.sync.adapters.ResolvedBoard
import io.github.contentsview08.obb.sync.engine.SyncApi
import io.github.contentsview08.obb.sync.engine.SyncApiError
import io.github.contentsview08.obb.sync.engine.SyncEngine
import io.github.contentsview08.obb.sync.engine.checkPowChallenge
import io.github.contentsview08.obb.sync.engine.powOk
import io.github.contentsview08.obb.sync.engine.solvePow
import io.github.contentsview08.obb.sync.engine.SyncKeyMaterial
import io.github.contentsview08.obb.sync.engine.SyncKeyStore
import io.github.contentsview08.obb.sync.engine.SyncRequest
import io.github.contentsview08.obb.sync.engine.SyncResponse
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
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
        ByteArray(32) { 7 }.let { k -> e.pair(k, signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)) }
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

    @Test fun leaveは走っている周の終わりを待ち周はあとで表を書かない() = runBlocking {
        val now = 1_800_000_000_000L
        val s = server { now }
        val db = JdbcSyncSql.open()
        val gate = CompletableDeferred<Unit>()
        val entered = CompletableDeferred<Unit>()
        var pulls = 0
        val e = engine(db, { now }) { r ->
            if (r.url.contains("/changes")) {
                pulls++
                entered.complete(Unit)
                gate.await()
            }
            call(s, r)
        }
        ByteArray(32) { 7 }.let { k -> e.pair(k, signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)) }
        val cycle = async(Dispatchers.Default) { e.runCycle(true) }
        entered.await()
        val leaving = async(Dispatchers.Default) { e.leave() }
        // leave が周を待っている間に来たきっかけも、表を消す前には走らない
        Thread.sleep(100)
        assertEquals(false, leaving.isCompleted)
        val during = async(Dispatchers.Default) { e.runCycle(true) }
        Thread.sleep(100)
        gate.complete(Unit)
        leaving.await()
        cycle.await()
        assertEquals("off", during.await().state)
        assertEquals(0L, db.query("SELECT COUNT(*) AS n FROM sync_records")[0]["n"])
        assertEquals(0L, db.query("SELECT COUNT(*) AS n FROM sync_state")[0]["n"])
        assertEquals(1, pulls)
        assertEquals("off", e.state)
        db.close()
    }

    @Test fun 止めると周は次の区切りで抜け先の通信をしない() = runBlocking {
        val now = 1_800_000_000_000L
        val s = server { now }
        val db = JdbcSyncSql.open()
        val gate = CompletableDeferred<Unit>()
        val entered = CompletableDeferred<Unit>()
        val paths = java.util.concurrent.CopyOnWriteArrayList<String>()
        val e = engine(db, { now }) { r ->
            paths += r.url
            entered.complete(Unit)
            gate.await()
            call(s, r)
        }
        ByteArray(32) { 7 }.let { k -> e.pair(k, signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)) }
        val cycle = async(Dispatchers.Default) { e.runCycle(true) }
        entered.await()
        val halting = async(Dispatchers.Default) { e.halt() }
        Thread.sleep(100)
        gate.complete(Unit)
        halting.await()
        assertEquals("idle", cycle.await().state)
        // 領域の作成の後の読み直しと送信へ進まない
        assertEquals(1, paths.count { it.contains("/changes") })
        assertEquals(0, paths.count { it.contains("/records") })
        db.close()
    }

    @Test fun headは304で周を回さず変化があれば回す_paceを覚える() = runBlocking {
        val now = 1_800_000_000_000L
        val s = server { now }
        val db = JdbcSyncSql.open()
        val etags = ArrayList<String?>()
        var head: () -> SyncResponse = { SyncResponse(500, "{}") }
        val e = engine(db, { now }) { r ->
            if (r.url.endsWith("/head")) {
                etags += r.headers["If-None-Match"]
                head()
            } else call(s, r)
        }
        ByteArray(32) { 7 }.let { k -> e.pair(k, signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)) }
        e.runCycle(true)
        val since = db.query("SELECT value FROM sync_state WHERE key = 'since'")[0]["value"].toString().toLong()
        val epoch = db.query("SELECT value FROM sync_state WHERE key = 'epoch'")[0]["value"]
        head = { SyncResponse(200, canonicalJson(mapOf("version" to since, "epoch" to epoch, "gc_floor" to 0L, "pace" to mapOf("head_sec" to 120L)))) }
        assertEquals(false, e.checkHead())
        assertEquals(120.0, e.pace?.headSec)
        head = { SyncResponse(304, "") }
        assertEquals(false, e.checkHead())
        assertEquals(listOf(null, "\"$epoch:$since\""), etags)
        // 304 の間も指示は残る
        assertEquals(120.0, e.pace?.headSec)
        head = { SyncResponse(200, canonicalJson(mapOf("version" to since + 1, "epoch" to epoch, "gc_floor" to 0L))) }
        assertEquals(true, e.checkHead())
        head = { SyncResponse(404, "{}") }
        assertEquals(true, e.checkHead())
        db.close()
    }

    @Test fun 混んでいるという応答の指示より早く試さない() = runBlocking {
        var now = 1_800_000_000_000L
        val s = server { now }
        val db = JdbcSyncSql.open()
        var busy = false
        var heads = 0
        val e = engine(db, { now }) { r ->
            if (r.url.endsWith("/head")) heads++
            if (busy) SyncResponse(429, canonicalJson(mapOf("error" to "rate", "retry_after_sec" to 600L))) else call(s, r)
        }
        ByteArray(32) { 7 }.let { k -> e.pair(k, signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)) }
        e.runCycle(true)
        busy = true
        now += SyncConfig.PULL_MIN_GAP_MS
        e.runCycle(false)
        assertEquals("backoff", e.state)
        now += 599_000
        assertEquals("backoff", e.runCycle(false).state)
        assertEquals(false, e.checkHead())
        assertEquals(0, heads)
        db.close()
    }

    @Test fun recordsは999個を超えるプレースホルダーを作らない() {
        val db = JdbcSyncSql.open()
        var most = 0
        val counting = object : io.github.contentsview08.obb.sync.engine.SyncSql by db {
            override fun query(sql: String, args: List<Any?>): List<Map<String, Any?>> {
                most = maxOf(most, args.size)
                return db.query(sql, args)
            }
        }
        val got = io.github.contentsview08.obb.sync.engine.SyncTables(counting).records(List(2500) { "id$it" })
        assertEquals(0, got.size)
        assertEquals(true, most in 1..999)
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
        ByteArray(32) { 7 }.let { k -> e.pair(k, signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)) }
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

    @Test fun 別の領域の許可証を受け取らない() = runBlocking {
        val now = 1_800_000_000_000L
        val s = server { now }
        val db = JdbcSyncSql.open()
        val e = engine(db, { now }) { call(s, it) }
        val k = ByteArray(32) { 7 }
        val good = signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)
        val other = signTicket("c".repeat(64), 4_000_000_000)
        for (bad in listOf(other, "garbage")) {
            try {
                e.pair(k, bad)
                fail("受け取った: $bad")
            } catch (err: SyncApiError) {
                assertEquals("bad_ticket", err.kind)
            }
        }
        e.pair(k, null)
        try {
            e.setTicket(other)
            fail("受け取った")
        } catch (err: SyncApiError) {
            assertEquals("bad_ticket", err.kind)
        }
        e.setTicket(good)
        assertEquals("idle", e.runCycle(true).state)
        assertEquals(1, s.spaces.size)
        db.close()
    }

    @Test fun 許可証を本文に入れて送り問題が出たら両方を送り直す() = runBlocking {
        val now = 1_800_000_000_000L
        val s = FakeSyncServer(now = { now }, ratePerMinute = null, fullPullPerHour = null, powBits = 8)
        val bodies = ArrayList<String>()
        val db = JdbcSyncSql.open()
        val e = engine(db, { now }) { r ->
            if (r.url.endsWith("/spaces")) bodies += r.body!!
            call(s, r)
        }
        val k = ByteArray(32) { 7 }
        val ticket = signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)
        e.pair(k, ticket)
        e.runCycle(true)
        assertEquals(2, bodies.size)
        assertEquals(mapOf("ticket" to ticket), parseStrictJson(bodies[0]))
        assertEquals(setOf("ticket", "pow"), (parseStrictJson(bodies[1]) as Map<*, *>).keys)
        assertEquals(1, s.spaces.size)
        db.close()
    }

    @Test fun 計算の問題の判定が共通の表と同じ() {
        val cases = parseStrictJson(javaClass.classLoader!!.getResourceAsStream("sync-pow.json")!!.readBytes().toString(Charsets.UTF_8)) as List<*>
        assertEquals(true, cases.size > 2)
        for (v in cases) {
            val c = v as Map<*, *>
            assertEquals(c.toString(), c["ok"], powOk(c["challenge"] as String, c["nonce"] as String, (c["bits"] as Long).toInt()))
        }
    }

    @Test fun 解いた答えが判定を通る() = runBlocking {
        val nonce = solvePow("x.y", 10)
        assertEquals(true, powOk("x.y", nonce, 10))
    }

    @Test fun サーバーが無理な難易度を出しても解き始めない() {
        for (bad in listOf<Any?>(null, 1L, mapOf("challenge" to "x", "bits" to 40L), mapOf("challenge" to 1L, "bits" to 4L), mapOf("challenge" to "", "bits" to 4L), mapOf("challenge" to "x"))) {
            try {
                checkPowChallenge(bad)
                fail("受け取った: $bad")
            } catch (_: IllegalArgumentException) {
            }
        }
        assertEquals(4, checkPowChallenge(mapOf("challenge" to "x", "bits" to 4L)).bits)
    }

    @Test fun 問題の難易度が無理ならエンジンを止めずに失敗にする() = runBlocking {
        val api = SyncApi("https://sync.test", "a".repeat(64), { SyncResponse(403, canonicalJson(mapOf("error" to "pow_required", "pow" to mapOf("challenge" to "x", "bits" to 40L)))) })
        try {
            api.createSpace("t")
            fail("通った")
        } catch (e: SyncApiError) {
            assertEquals("bad_response", e.kind)
        }
    }
}
