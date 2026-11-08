package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.data.UserOps
import io.github.contentsview08.obb.sync.adapters.FavoriteThreadAdapter
import io.github.contentsview08.obb.sync.adapters.HistoryHost
import io.github.contentsview08.obb.sync.adapters.historyAdapters
import io.github.contentsview08.obb.sync.engine.SqlStatement
import io.github.contentsview08.obb.sync.engine.SyncSql
import io.github.contentsview08.obb.sync.adapters.ResolvedBoard
import io.github.contentsview08.obb.sync.engine.SyncApi
import io.github.contentsview08.obb.sync.engine.SyncApiError
import io.github.contentsview08.obb.sync.engine.SyncEngine
import io.github.contentsview08.obb.sync.engine.checkPowChallenge
import io.github.contentsview08.obb.sync.engine.powOk
import io.github.contentsview08.obb.sync.engine.pushedRun
import io.github.contentsview08.obb.sync.engine.PushResult
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

    private fun engine(db: SyncSql, now: () -> Long, send: suspend (SyncRequest) -> SyncResponse) = engineWith(db, now, false, send)

    private fun engineWith(db: SyncSql, now: () -> Long, history: Boolean, send: suspend (SyncRequest) -> SyncResponse) = SyncEngine(
        db = db,
        keyStore = Keys(),
        transport = { send(it) },
        serverUrl = "https://sync.test",
        adapters = if (history) historyAdapters(db, HistoryHost({ ResolvedBoard(it, "2ch-compat") }, { 0 }, { "r" })) else listOf(FavoriteThreadAdapter(db) { ResolvedBoard(it, "2ch-compat") }),
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
        // ETag は覚えずに手元の since と epoch から作る
        assertEquals(listOf("\"$epoch:$since\"", "\"$epoch:$since\""), etags)
        // 304 の間も指示は残る
        assertEquals(120.0, e.pace?.headSec)
        head = { SyncResponse(200, canonicalJson(mapOf("version" to since + 1, "epoch" to epoch, "gc_floor" to 0L))) }
        assertEquals(true, e.checkHead())
        head = { SyncResponse(404, "{}") }
        assertEquals(true, e.checkHead())
        db.close()
    }

    @Test fun 読んでから消すまでの間に既読が進んでも進んだ値を送らずに消さない() = runBlocking {
        val now = 1_800_000_000_000L
        val s = server { now }
        val raw = JdbcSyncSql.open()
        val t = ThreadSummary("https://a.5ch.io/x/", "1", "t1", 0, 0, null)
        var interfere = false
        // drain が送信待ちを読んだ直後に、スクロールで同じスレの既読が進む
        val db = object : SyncSql {
            override fun exec(sql: String, args: List<Any?>) = raw.exec(sql, args)
            override fun batch(statements: List<SqlStatement>) = raw.batch(statements)
            override fun query(sql: String, args: List<Any?>): List<Map<String, Any?>> {
                val rows = raw.query(sql, args)
                if (interfere && sql.contains("FROM sync_ops WHERE op IN")) {
                    interfere = false
                    UserOps(raw).markReadNow(t, 80, now + 500)
                }
                return rows
            }
        }
        val e = engineWith(db, { now }, true) { call(s, it) }
        ByteArray(32) { 7 }.let { k -> e.pair(k, signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)) }
        e.runCycle(true)
        raw.exec("INSERT INTO threads (board_url, key, connector_id, title) VALUES (?, ?, ?, ?)", listOf(t.boardUrl, t.key, "2ch-compat", "t1"))
        UserOps(raw).markReadNow(t, 50, now)
        interfere = true
        e.runCycle(true)
        assertEquals(false, interfere)
        assertEquals(0L, raw.query("SELECT COUNT(*) AS n FROM sync_ops").first()["n"])
        val dev = raw.query("SELECT payload FROM sync_records WHERE kind = 'read_dev'").first()["payload"] as String
        assertEquals(80L, ((parseStrictJson(dev) as Map<*, *>)["body"] as Map<*, *>)["pos"])
        raw.close()
    }

    @Test fun recordsの429は送信だけを待ちpullと確認は続け待ちは10分で丸める() = runBlocking {
        var now = 1_800_000_000_000L
        val s = server { now }
        val db = JdbcSyncSql.open()
        var limited = true
        val paths = ArrayList<String>()
        val e = engine(db, { now }) { r ->
            paths += "${r.method} ${r.url.removePrefix("https://sync.test").substringBefore('?')}"
            if (limited && r.url.endsWith("/records")) SyncResponse(429, canonicalJson(mapOf("error" to "rate_limited", "retry_after_sec" to 86_400L))) else call(s, r)
        }
        ByteArray(32) { 7 }.let { k -> e.pair(k, signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)) }
        e.runCycle(true)
        UserOps(db).setFavoriteThreadNow(ThreadSummary("https://a.5ch.io/x/", "1", "t1", 0, 0, null), "t1", true, 1)
        now += SyncConfig.PULL_MIN_GAP_MS
        assertEquals("idle", e.runCycle(false).state)
        assertEquals(false, e.hasChanges())
        assertEquals("rate_limited", db.query("SELECT value FROM sync_state WHERE key = 'last_error'").first()["value"])
        paths.clear()
        now += SyncConfig.PULL_MIN_GAP_MS
        e.runCycle(false)
        e.checkHead()
        assertEquals(listOf("GET /changes", "GET /head"), paths)
        limited = false
        now += SyncConfig.RETRY_WAIT_MAX_MS
        assertEquals(true, e.hasChanges())
        assertEquals(1, e.runCycle(false).pushed)
        assertEquals(0, db.query("SELECT value FROM sync_state WHERE key = 'last_error'").size)
        db.close()
    }

    @Test fun 周全体の429もサーバーが翌日と言ってきても10分で試す() = runBlocking {
        var now = 1_800_000_000_000L
        val s = server { now }
        val db = JdbcSyncSql.open()
        var limited = true
        val e = engine(db, { now }) { r ->
            if (limited && r.url.contains("/changes")) SyncResponse(429, canonicalJson(mapOf("error" to "rate_limited", "retry_after_sec" to 1_000_000_000_000L))) else call(s, r)
        }
        ByteArray(32) { 7 }.let { k -> e.pair(k, signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)) }
        assertEquals("backoff", e.runCycle(true).state)
        limited = false
        now += SyncConfig.RETRY_WAIT_MAX_MS - 1
        assertEquals("backoff", e.runCycle(false).skipped)
        now += 1
        assertEquals("idle", e.runCycle(false).state)
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

    // ── 確認と読み戻し。PC 版の engine.test.ts と同じ場面 ──

    private fun since(db: JdbcSyncSql) = db.query("SELECT value FROM sync_state WHERE key = 'since'").firstOrNull()?.get("value")?.toString()?.toLong() ?: 0L
    private fun thread(key: String) = ThreadSummary("https://a.5ch.io/x/", key, "t$key", 0, 0, null)
    private fun traced(s: FakeSyncServer, reqs: MutableList<String>): suspend (SyncRequest) -> SyncResponse = { r ->
        call(s, r).also { reqs += "${r.method} ${r.url.removePrefix("https://sync.test").substringBefore('?')} ${it.status}" }
    }

    @Test fun 送った分だけならsinceを進め次の確認は304でchangesを読み戻さない() = runBlocking {
        var now = 1_800_000_000_000L
        val s = server { now }
        val reqs = ArrayList<String>()
        val db = JdbcSyncSql.open()
        val e = engine(db, { now }, traced(s, reqs))
        ByteArray(32) { 7 }.let { k -> e.pair(k, signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)) }
        e.runCycle(true)
        UserOps(db).setFavoriteThread(thread("1"), "t1", true, now)
        UserOps(db).setFavoriteThread(thread("2"), "t2", true, now)
        val before = since(db)
        e.runCycle(true)
        assertEquals(before + 2, since(db))
        reqs.clear()
        assertEquals(false, e.checkHead())
        assertEquals(listOf("GET /head 304"), reqs)
        now += SyncConfig.PULL_MIN_GAP_MS
        e.runCycle(manual = false, quick = true)
        assertEquals(emptyList<String>(), reqs.filter { it.startsWith("GET /changes") })
        db.close()
    }

    @Test fun 間に別の端末が書いて隙間ができたらsinceを進めず次の確認で変化を見て読む() = runBlocking {
        var now = 1_800_000_000_000L
        val s = server { now }
        val reqs = ArrayList<String>()
        val dbA = JdbcSyncSql.open()
        val dbB = JdbcSyncSql.open()
        val a = engine(dbA, { now }, traced(s, reqs))
        val b = engine(dbB, { now }) { call(s, it) }
        val k = ByteArray(32) { 7 }
        val ticket = signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)
        a.pair(k, ticket)
        b.pair(k, ticket)
        a.runCycle(true)
        b.runCycle(true)
        now += SyncConfig.HEAD_INTERVAL_MS
        assertEquals(false, a.checkHead())
        UserOps(dbB).setFavoriteThread(thread("1"), "t1", true, now)
        b.runCycle(true)
        UserOps(dbA).setFavoriteThread(thread("2"), "t2", true, now)
        val before = since(dbA)
        reqs.clear()
        // 直前の確認が「変化なし」なので pull を省く。送ると version に隙間がある
        now += 1000
        a.runCycle(manual = false, quick = true)
        assertEquals(emptyList<String>(), reqs.filter { it.startsWith("GET /changes") })
        assertEquals(before, since(dbA))
        reqs.clear()
        assertEquals(true, a.checkHead())
        assertEquals(listOf("GET /head 200"), reqs)
        // 変化を見たあとの自動の周は pull を省かない
        a.runCycle(manual = false, quick = true)
        assertEquals(1, reqs.count { it.startsWith("GET /changes") })
        assertEquals(listOf("1", "2"), dbA.query("SELECT key FROM favorite_threads ORDER BY key").map { it["key"] })
        assertEquals(false, a.checkHead())
        dbA.close()
        dbB.close()
    }

    @Test fun 自動の周は直前の確認が変化なしならpullを省く_前面復帰と手動と間隔が過ぎたあとは省かない() = runBlocking {
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
        now += SyncConfig.HEAD_INTERVAL_MS
        assertEquals(false, e.checkHead())
        pulls.set(0)
        now += SyncConfig.PULL_MIN_GAP_MS
        e.runCycle(manual = false, quick = true)
        assertEquals(0, pulls.get())
        e.runCycle(false)
        assertEquals(1, pulls.get())
        e.runCycle(true)
        assertEquals(2, pulls.get())
        now += SyncConfig.HEAD_INTERVAL_MS
        e.runCycle(manual = false, quick = true)
        assertEquals(3, pulls.get())
        db.close()
    }

    @Test fun 確認で変化を見たあと周が通信の失敗で終わっても次の確認は304にならず変化を見る() = runBlocking {
        var now = 1_800_000_000_000L
        val s = server { now }
        val dbOther = JdbcSyncSql.open()
        val other = engine(dbOther, { now }) { call(s, it) }
        val k = ByteArray(32) { 7 }
        val ticket = signTicket(spaceId(deriveKeys(k).authToken), 4_000_000_000)
        other.pair(k, ticket)
        other.runCycle(true)
        var failing = false
        val reqs = ArrayList<String>()
        val db = JdbcSyncSql.open()
        val me = engine(db, { now }) { r ->
            if (failing && r.url.contains("/changes")) throw SyncApiError("network")
            traced(s, reqs)(r)
        }
        me.pair(k, ticket)
        me.runCycle(true)
        UserOps(dbOther).setFavoriteThread(thread("1"), "t1", true, now)
        other.runCycle(true)
        now += SyncConfig.HEAD_INTERVAL_MS
        assertEquals(true, me.checkHead())
        failing = true
        assertEquals("offline", me.runCycle(false).state)
        failing = false
        now += SyncConfig.BACKOFF_MAX_MS
        reqs.clear()
        assertEquals(true, me.checkHead())
        assertEquals(listOf("GET /head 200"), reqs)
        me.runCycle(true)
        assertEquals(listOf("1"), db.query("SELECT key FROM favorite_threads").map { it["key"] })
        assertEquals(false, me.checkHead())
        db.close()
        dbOther.close()
    }

    @Test fun versionの並びの判定() {
        fun ok(vararg v: Long) = v.map { PushResult("r$it", 200L, it, null) }
        assertEquals(5L, pushedRun(ok(4, 3, 5), 3, 2))
        assertEquals(3L, pushedRun(ok(3), 1, 2))
        assertEquals(null, pushedRun(ok(3, 5), 2, 2))
        assertEquals(null, pushedRun(ok(4), 1, 2))
        assertEquals(null, pushedRun(ok(3), 2, 2))
        assertEquals(null, pushedRun(listOf(PushResult("a", 200L, 3, null), PushResult("b", 409L, null, emptyMap())), 2, 2))
        assertEquals(null, pushedRun(emptyList(), 0, 2))
    }
}
