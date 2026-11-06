package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.data.FavoriteThreadSql
import io.github.contentsview08.obb.data.UserOps
import io.github.contentsview08.obb.sync.adapters.FavoriteThreadAdapter
import io.github.contentsview08.obb.sync.adapters.ResolvedBoard
import io.github.contentsview08.obb.sync.engine.SyncEngine
import io.github.contentsview08.obb.sync.engine.SyncKeyMaterial
import io.github.contentsview08.obb.sync.engine.SyncKeyStore
import io.github.contentsview08.obb.sync.engine.SyncRequest
import io.github.contentsview08.obb.sync.engine.SyncResponse
import io.github.contentsview08.obb.sync.engine.CycleResult
import io.github.contentsview08.obb.sync.engine.checkServerUrl
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

// packages/conformance/sync-client.json を流す枠。PC 版の scenarioRunner.ts と同じ手順で動かし、同期の表の digest まで比べる

private const val START = 1_800_000_000_000L

private class MemoryKeyStore : SyncKeyStore {
    var value: SyncKeyMaterial? = null
    override suspend fun load() = value
    override suspend fun save(v: SyncKeyMaterial) {
        value = v
    }
    override suspend fun clear() {
        value = null
    }
}

private class Fault(val kind: String, var times: Int, val path: String?, val status: Int? = null, val body: Any? = null, val location: String? = null, val other: String? = null)

private class LogEntry(val device: String, val method: String, val path: String, val host: String, val requestId: String?)

private val URL_PARTS = Regex("https?://([^/?]+)([^?]*)(\\?.*)?")

@Suppress("UNCHECKED_CAST")
private class World(o: Map<String, Any?>) {
    var now = START
    val server = FakeSyncServer(
        now = { now },
        spaceLimit = (o["space_limit"] as Long?)?.toInt() ?: 100,
        quotaRecords = (o["quota_records"] as Long?)?.toInt() ?: 50_000,
        creationClosed = o["creation_closed"] == true,
        ratePerMinute = null,
        fullPullPerHour = null,
    )
    val faults = ArrayList<Fault>()
    val log = ArrayList<LogEntry>()
    var mark = 0
    val devices = LinkedHashMap<String, Device>()
}

private fun resolver(device: String): (String) -> ResolvedBoard? = { url ->
    if (device == "phone" && url.contains("2chan.net")) null
    else ResolvedBoard(url.replace(Regex("^http://([^/]*5ch\\.)"), "https://$1").replaceFirst("5ch.net", "5ch.io"), "2ch-compat")
}

@Suppress("UNCHECKED_CAST")
private class Device(val name: String, val world: World, val skew: Long) {
    val sql = JdbcSyncSql.open()
    val ops = UserOps(sql)
    val keys = MemoryKeyStore()
    lateinit var engine: SyncEngine
    var online = true
    var last: CycleResult? = null
    val trace = ArrayList<String>()
    var idCount = 0
    var requestCount = 0

    init {
        newEngine()
    }

    fun now() = world.now + skew

    private suspend fun send(req: SyncRequest): SyncResponse {
        val w = world
        val m = URL_PARTS.matchEntire(req.url)!!
        val pathOnly = m.groupValues[2]
        val path = pathOnly + m.groupValues[3]
        val requestId = req.body?.let { (parseStrictJson(it) as Map<String, Any?>)["request_id"] as String? }
        w.log += LogEntry(name, req.method, pathOnly, m.groupValues[1], requestId)
        if (!online) throw IllegalStateException("offline")
        val f = w.faults.firstOrNull { it.times > 0 && (it.path == null || it.path == pathOnly) }
        val real = FakeRequest(req.method, path, req.headers, req.body)
        if (f != null) {
            f.times--
            when (f.kind) {
                "status" -> return SyncResponse(f.status!!, "{}")
                "swap" -> {
                    // 本物の別レコードの暗号文を、送った先頭のレコードの 409 として返す
                    val sp = w.server.spaces.getValue(fakeSpaceIdOf(req.headers.getValue("Authorization").substring(7)))
                    val first = ((parseStrictJson(req.body!!) as Map<String, Any?>)["records"] as List<Map<String, Any?>>)[0]["record_id"]
                    return SyncResponse(200, canonicalJson(mapOf("results" to listOf(mapOf("record_id" to first, "status" to 409L, "record" to sp.records.getValue(f.other!!).toMap())), "epoch" to sp.epoch, "gc_floor" to sp.gcFloor)))
                }
                "unreachable" -> throw IllegalStateException("unreachable")
                "redirect" -> return SyncResponse(302, "", mapOf("Location" to f.location!!))
                "drop" -> {
                    w.server.handle(real)
                    throw IllegalStateException("dropped")
                }
                else -> {
                    val epoch = w.server.spaces[fakeSpaceIdOf(req.headers.getValue("Authorization").substring(7))]?.epoch.orEmpty()
                    return SyncResponse(f.status ?: 200, canonicalJson(f.body).replace("\$epoch", epoch))
                }
            }
        }
        val res = w.server.handle(real)
        return SyncResponse(res.status, res.body, res.headers)
    }

    fun newEngine() {
        engine = SyncEngine(
            db = sql,
            keyStore = keys,
            transport = { send(it) },
            serverUrl = "https://sync.test",
            adapters = listOf(FavoriteThreadAdapter(sql, resolver(name))),
            now = { now() },
            newDeviceId = { if (idCount++ == 0) name else "${name}_$idCount" },
            newRequestId = {
                val n = (++requestCount).toString()
                (name + "_".repeat(22)).substring(0, 22 - n.length) + n
            },
            jitter = { 0.5 },
            onState = { trace += it },
            io = Dispatchers.Unconfined,
        )
    }

    suspend fun sync(manual: Boolean = true): CycleResult {
        trace.clear()
        return engine.runCycle(manual).also { last = it }
    }

    fun state(key: String) = sql.query("SELECT value FROM sync_state WHERE key = ?", listOf(key)).firstOrNull()?.get("value") as String?

    fun count(from: String): Int = (sql.query("SELECT COUNT(*) AS n $from")[0]["n"] as Long).toInt()

    /** 今のデータと同期の表の全部。PC とスマホで同じ文字列になる */
    fun digest(): String {
        val favorites = sql.query("SELECT board_url, key, connector_id, title, created_at, sort, added_at FROM favorite_threads ORDER BY board_url, key")
        val records = sql.query("SELECT record_id, kind, kind_tag, schema_version, payload, hlc, deleted, version, pending, priority, needs_apply, ref_board, ref_thread, tomb_at FROM sync_records ORDER BY record_id")
        return sha256(utf8(canonicalJson(mapOf("favorites" to favorites, "records" to records)))).toHex()
    }
}

private fun thread(s: Map<String, Any?>) = ThreadSummary(s["board"] as String, s["key"] as String, s["title"] as String? ?: "", 0, 0, s["created_at"] as Long?)

private fun keyOf(device: String) = sha256(utf8("key:$device"))

private fun checkEq(label: String, want: Any?, got: Any?) = assertEquals(label, canonicalJson(want), canonicalJson(got))

private fun Fault(s: Map<String, Any?>, kind: String) = Fault(kind, (s["times"] as Long?)?.toInt() ?: 1, s["path"] as String?, (s["status"] as Long?)?.toInt(), s["body"], s["location"] as String?)

@Suppress("UNCHECKED_CAST")
private suspend fun runStep(w: World, s: Map<String, Any?>, label: String) {
    val d = (s["device"] as String?)?.let { w.devices.getValue(it) }
    fun material() = d!!.keys.value!!
    fun spaceOfDevice() = spaceId(deriveKeys(material().k).authToken)
    when (val op = s["op"] as String) {
        "advance_ms" -> w.now += s["ms"] as Long
        "favorite_thread_add" -> thread(s).let { d!!.ops.setFavoriteThread(it, it.title, true, d.now()) }
        "favorite_thread_remove" -> thread(s).let { d!!.ops.setFavoriteThread(it, it.title, false, d.now()) }
        "auto_favorite_thread_add" -> thread(s).let { d!!.sql.exec(FavoriteThreadSql.ADD, FavoriteThreadSql.addArgs(it, it.title, d.now())) }
        "auto_favorite_thread_remove" -> d!!.sql.exec(FavoriteThreadSql.REMOVE, FavoriteThreadSql.removeArgs(thread(s)))
        "preset_board_add" -> d!!.sql.exec(
            "INSERT OR IGNORE INTO favorite_boards (url, connector_id, name, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM favorite_boards))",
            listOf(s["url"], "2ch-compat", s["name"]),
        )
        "pair_first" -> {
            d!!.engine.pair(keyOf(s["device"] as String))
            d.sync()
        }
        "pair_join" -> {
            d!!.engine.pair(w.devices.getValue(s["from"] as String).keys.value!!.k)
            d.sync()
        }
        "sync" -> d!!.sync()
        "sync_auto" -> d!!.sync(false)
        "restart" -> d!!.newEngine()
        "leave" -> d!!.engine.leave()
        "confirm" -> d!!.engine.resolveConfirm(s["choice"] as String)
        "offline" -> d!!.online = false
        "online" -> d!!.online = true
        "server_fail" -> w.faults += Fault(s, "status")
        "server_drop_response" -> w.faults += Fault(s, "drop")
        "server_unreachable" -> w.faults += Fault(s, "unreachable")
        "server_redirect" -> w.faults += Fault(s, "redirect")
        "server_response" -> w.faults += Fault(s, "response")
        "server_swap_conflict" -> {
            val keys = deriveKeys(material().k)
            val o = s["other"] as List<String>
            w.faults += Fault("swap", 1, "/records", other = recordId(keys.kId, o[0], o[1], o[2]))
        }
        "server_delete_space" -> w.server.deleteSpace(spaceOfDevice())
        "server_bump_epoch" -> w.server.bumpEpoch(spaceOfDevice())
        "server_inject" -> {
            val keys = deriveKeys(material().k)
            val rec = s["record"] as List<String?>
            val id = recordId(keys.kId, rec[0]!!, rec[1], rec.getOrNull(2), rec.getOrNull(3))
            val sid = spaceId(keys.authToken)
            if (s["corrupt"] == true) {
                w.server.injectRecord(sid, id, "h", 1, false, toBase64Url(ByteArray(24)), toBase64Url(ByteArray(272)))
            } else {
                val payload = s["payload"] as SyncPayload
                val (nonce, ciphertext) = sealPayload(keys, RecordContext(sid, id, "h", 1), payload)
                w.server.injectRecord(sid, id, "h", 1, payload["deleted"] == true, nonce, ciphertext)
            }
        }
        "db_fail" -> d!!.sql.failing += JdbcSyncSql.DbFail(s["match"] as String, (s["times"] as Long?)?.toInt() ?: 1)
        "tamper_device_id" -> d!!.sql.script("UPDATE sync_state SET value = 'copied' WHERE key = 'device_id'")
        "clear_keys" -> d!!.keys.clear()
        "mark" -> w.mark = w.log.size
        "expect" -> check(w, s["expect"] as Map<String, Any?>, label)
        else -> throw IllegalStateException("知らない op: $op")
    }
}

@Suppress("UNCHECKED_CAST")
private fun check(w: World, want: Map<String, Any?>, label: String) {
    for ((name, ev) in want) {
        val e = ev as Map<String, Any?>
        if (name == "\$server") {
            e["spaces"]?.let { assertEquals("$label: サーバーの領域の数", (it as Long).toInt(), w.server.spaces.size) }
            e["hosts"]?.let { checkEq("$label: 通信先", it, w.log.map { l -> l.host }.distinct()) }
            e["request_id_repeated"]?.let {
                val ids = w.log.mapNotNull { l -> l.requestId }
                assertEquals("$label: 同じ request_id の送り直し", it, ids.toSet().size < ids.size)
            }
            for ((dev, vv) in (e["of"] as Map<String, Any?>?).orEmpty()) {
                val v = vv as Map<String, Any?>
                val m = w.devices.getValue(dev).keys.value
                val sp = m?.let { w.server.spaces[spaceId(deriveKeys(it.k).authToken)] }
                v["exists"]?.let { assertEquals("$label: $dev の領域", it, sp != null) }
                v["records"]?.let { assertEquals("$label: $dev の領域のレコード数", it, sp?.records?.size?.toLong()) }
                v["head"]?.let { assertEquals("$label: $dev の領域の version", it, sp?.next) }
                v["gc_floor"]?.let { assertEquals("$label: $dev の gc_floor", it, sp?.gcFloor) }
            }
            continue
        }
        val d = w.devices.getValue(name)
        val at = "$label: $name"
        e["favorite_threads"]?.let { checkEq("$at のお気に入り", it, d.sql.query("SELECT key FROM favorite_threads ORDER BY key").map { r -> r["key"] }) }
        e["favorite_rows"]?.let { checkEq("$at のお気に入りの行", it, d.sql.query("SELECT board_url, key, title, created_at FROM favorite_threads ORDER BY board_url, key")) }
        e["favorite_boards"]?.let { checkEq("$at のお気に入り板", it, d.sql.query("SELECT url FROM favorite_boards ORDER BY url").map { r -> r["url"] }) }
        e["state"]?.let { assertEquals("$at の状態", it, d.engine.state) }
        e["phase"]?.let { assertEquals("$at の phase", it, d.state("phase")) }
        e["pending"]?.let { assertEquals("$at の未送信", (it as Long).toInt(), d.count("FROM sync_records WHERE pending = 1")) }
        e["ops"]?.let { assertEquals("$at の sync_ops", (it as Long).toInt(), d.count("FROM sync_ops")) }
        e["records"]?.let { assertEquals("$at のレコード数", (it as Long).toInt(), d.count("FROM sync_records")) }
        e["tombstones"]?.let { assertEquals("$at の tombstone", (it as Long).toInt(), d.count("FROM sync_records WHERE deleted = 1")) }
        e["needs_apply"]?.let { assertEquals("$at の needs_apply", (it as Long).toInt(), d.count("FROM sync_records WHERE needs_apply = 1")) }
        e["state_rows"]?.let { assertEquals("$at の sync_state", (it as Long).toInt(), d.count("FROM sync_state")) }
        if (e.containsKey("last_error")) assertEquals("$at の last_error", e["last_error"], d.state("last_error"))
        e["since"]?.let { assertEquals("$at の since", it.toString(), d.state("since")) }
        if (e.containsKey("bad_counts")) assertEquals("$at の bad_counts", e["bad_counts"]?.let { canonicalJson(it) }, d.state("bad_counts"))
        e["inflight"]?.let { assertEquals("$at の push_inflight", it, d.state("push_inflight") != null) }
        e["device_id"]?.let { assertEquals("$at の device_id", it, d.state("device_id")) }
        e["keys"]?.let { assertEquals("$at の鍵", it, d.keys.value != null) }
        e["pending_confirm"]?.let { assertEquals("$at の pending_confirm", canonicalJson(it), d.state("pending_confirm")) }
        e["trace"]?.let { checkEq("$at の状態の順", it, d.trace) }
        e["applied"]?.let { assertEquals("$at の適用", it, d.last?.favoriteThreads) }
        e["pushed"]?.let { assertEquals("$at の送信数", (it as Long).toInt(), d.last?.pushed) }
        e["conflicts"]?.let { assertEquals("$at の 409", (it as Long).toInt(), d.last?.conflicts) }
        if (e.containsKey("skipped")) assertEquals("$at の skipped", e["skipped"], d.last?.skipped)
        e["requests"]?.let {
            val seen = LinkedHashMap<String, Long>()
            for (l in w.log.drop(w.mark)) if (l.device == name) seen.merge("${l.method} ${l.path}", 1L, Long::plus)
            checkEq("$at の通信", it, seen)
        }
    }
}

@Suppress("UNCHECKED_CAST")
private suspend fun runScenario(c: Map<String, Any?>): Map<String, String> {
    val w = World(c["server"] as Map<String, Any?>? ?: emptyMap())
    val skews = c["skew_ms"] as Map<String, Long>? ?: emptyMap()
    for (name in c["devices"] as List<String>) w.devices[name] = Device(name, w, skews[name] ?: 0)
    for ((name, seed) in (c["seed"] as Map<String, Map<String, Any?>>?).orEmpty()) {
        val d = w.devices.getValue(name)
        for (f in (seed["favorite_threads"] as List<Map<String, Any?>>?).orEmpty()) {
            val t = thread(f)
            d.sql.exec(FavoriteThreadSql.ADD, FavoriteThreadSql.addArgs(t, t.title, START - (f["added_ago_ms"] as Long? ?: 0)))
        }
    }
    val label = c["name"] as String
    for (s in c["steps"] as List<Map<String, Any?>>) runStep(w, s, label)
    (c["expected"] as Map<String, Any?>?)?.let { check(w, it, label) }
    val digests = LinkedHashMap<String, String>()
    for ((name, d) in w.devices) {
        digests[name] = d.digest()
        d.sql.close()
    }
    return digests
}

@Suppress("UNCHECKED_CAST")
class SyncScenarioTest {
    private fun load(file: String) = parseStrictJson(javaClass.classLoader!!.getResourceAsStream(file)!!.readBytes().toString(Charsets.UTF_8))

    @Test fun 共通シナリオがPCと同じ結果になる() = runBlocking {
        val scenarios = load("sync-client.json") as List<Map<String, Any?>>
        val digests = load("sync-client-digests.json") as Map<String, Map<String, String>>
        val fails = ArrayList<String>()
        for (c in scenarios) {
            val name = c["name"] as String
            try {
                val got = runScenario(c)
                if (canonicalJson(got) != canonicalJson(digests[name])) fails += "$name: digest が PC と違う"
            } catch (e: Throwable) {
                fails += "$name: ${e.message ?: e}"
            }
        }
        assertEquals(true, scenarios.size >= 11)
        if (fails.isNotEmpty()) fail("${scenarios.size} 件のうち ${fails.size} 件が違う\n" + fails.joinToString("\n"))
    }

    @Test fun 定数と待ち時間とサーバーのURLが表と同じ() {
        val cfg = load("sync-config.json") as Map<String, Any?>
        val c = cfg["constants"] as Map<String, Long>
        val actual = mapOf(
            "SCHEMA_VERSION" to SyncConfig.SCHEMA_VERSION, "PULL_MIN_GAP_MS" to SyncConfig.PULL_MIN_GAP_MS, "HTTP_TIMEOUT_MS" to SyncConfig.HTTP_TIMEOUT_MS,
            "BACKOFF_MIN_MS" to SyncConfig.BACKOFF_MIN_MS, "BACKOFF_MAX_MS" to SyncConfig.BACKOFF_MAX_MS, "MAX_RESPONSE_BYTES" to SyncConfig.MAX_RESPONSE_BYTES.toLong(),
            "PUSH_BATCH_RECORDS" to SyncConfig.PUSH_BATCH_RECORDS.toLong(), "PUSH_BATCH_BYTES" to SyncConfig.PUSH_BATCH_BYTES.toLong(), "PUSH_MAX_ROUNDS" to SyncConfig.PUSH_MAX_ROUNDS.toLong(),
            "APPLY_BATCH" to SyncConfig.APPLY_BATCH.toLong(), "WRITE_BATCH" to SyncConfig.WRITE_BATCH.toLong(), "APPLY_SPLIT_AFTER" to SyncConfig.APPLY_SPLIT_AFTER.toLong(),
            "REBASE_LIMIT" to SyncConfig.REBASE_LIMIT.toLong(), "REBASE_WINDOW_MS" to SyncConfig.REBASE_WINDOW_MS, "RECREATE_RETRY_MS" to SyncConfig.RECREATE_RETRY_MS,
            "JOIN_CONFIRM_MIN" to SyncConfig.JOIN_CONFIRM_MIN.toLong(),
        )
        assertEquals(c.toSortedMap(), actual.toSortedMap())
        for (b in cfg["backoff"] as List<Map<String, Any?>>) {
            val j = when (val v = b["jitter"]) {
                is Long -> v.toDouble()
                else -> v as Double
            }
            assertEquals(b.toString(), b["ms"], SyncConfig.backoffDelayMs((b["attempt"] as Long).toInt(), j))
        }
        for (u in cfg["server_url"] as List<Map<String, Any?>>) {
            val got = try {
                checkServerUrl(u["url"] as String, u["allow_localhost"] == true)
            } catch (_: Exception) {
                null
            }
            assertEquals(u["url"].toString(), u["ok"], got)
        }
    }
}
