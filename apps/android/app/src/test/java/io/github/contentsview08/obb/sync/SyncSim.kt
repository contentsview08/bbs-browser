package io.github.contentsview08.obb.sync

// 端末の動きをまねて、順番と重複を変えても同じ状態になるかを見る。PC 版の packages/sync/test/sim.ts と同じ手順で乱数を使う(同じシードで同じ結果になるか比べるため)

class Rng(seed: Int) {
    private var a = seed

    fun next(): Long {
        a += 0x6d2b79f5
        var t = (a xor (a ushr 15)) * (1 or a)
        t = (t + (t xor (t ushr 7)) * (61 or t)) xor t
        return (t xor (t ushr 14)).toLong() and 0xffffffffL
    }

    fun int(n: Int): Int = (next() % n).toInt()
}

class SimOptions(val seed: Int, val devices: Int, val ops: Int, val skews: List<Long>, val maxReads: Int? = null, val decreasingReads: Boolean = false)

class SimResult(
    val state: String,
    val sha256: String,
    val converged: Boolean,
    val positions: Map<String, Long>,
    val oracle: Map<String, Long>,
    val resets: Map<String, Long>,
)

private typealias Store = MutableMap<String, SyncPayload>

private class Read(val thread: String, val at: String, val pos: Long, val known: String?)

private fun <T> shuffled(rng: Rng, xs: List<T>): List<T> {
    val a = xs.toMutableList()
    for (i in a.size - 1 downTo 1) {
        val j = rng.int(i + 1)
        val t = a[i]
        a[i] = a[j]
        a[j] = t
    }
    return a
}

private fun devsOf(s: Store, thread: String): List<SyncPayload> =
    s.keys.filter { it.startsWith("dev:$thread:") }.sorted().map { s.getValue(it) }

private fun apply(s: Store, id: String, p: SyncPayload) {
    val old = s[id]
    s[id] = if (old != null) mergePayloads(old, p) else p
}

private const val BOARD = "https://a.example/b/"

private fun refOf(thread: String) = ThreadRef(BOARD, thread)

/** シミュレーションで作る値は、受け取る側の検査を必ず通る */
private fun checked(p: SyncPayload): SyncPayload = checkNotNull(checkPayload(p)) { "検査に通らない: ${canonicalJson(p)}" }

private fun stateOf(s: Store, threads: List<String> = listOf("t0", "t1")): String {
    val positions = threads.associateWith { readPosition(s["reset:$it"], devsOf(s, it)) }
    return canonicalJson(mapOf("positions" to positions, "records" to s.toMap()))
}

fun simulate(o: SimOptions): SimResult {
    val rng = Rng(o.seed)
    val names = List(o.devices) { "d$it" }
    val stores: List<Store> = names.map { HashMap() }
    val clocks = names.map { Hlc.ZERO }.toMutableList()
    val log = ArrayList<Pair<String, SyncPayload>>()
    val reads = ArrayList<Read>()
    val readCount = HashMap<String, Int>()
    var now = 1_700_000_000_000L
    var seq = 0
    fun stamp(d: Int, wall: Long, floor: String? = null): String {
        val r = Hlc.stamp(clocks[d], wall, names[d], floor)
        clocks[d] = r.clock
        return r.stamp
    }
    fun write(d: Int, id: String, p: SyncPayload) {
        apply(stores[d], id, checked(p))
        log += id to p
    }
    for (op in 0 until o.ops) {
        now += 1 + rng.int(5000)
        val d = rng.int(o.devices)
        val t = "t${rng.int(2)}"
        val r = rng.int(100)
        val wall = now + o.skews[d % o.skews.size]
        val s = stores[d]
        when {
            r < 35 -> {
                val random = rng.int(1000)
                val key = "$t:$d"
                val n = readCount[key] ?: 0
                val pos = if (o.decreasingReads) maxOf(0, 10000 - n * 7).toLong() else random.toLong()
                if (o.maxReads != null && n >= o.maxReads) continue
                readCount[key] = n + 1
                val id = "dev:$t:${names[d]}"
                val dev = s[id]
                val latest = s["reset:$t"]
                val at = stamp(d, wall, dev?.hlc)
                reads += Read(t, at, pos, latest?.body?.get("id") as? String)
                write(d, id, recordRead(dev, latest, refOf(t), pos, at, names[d]))
            }
            r < 45 -> {
                val target = if (rng.int(3) == 0) rng.int(100).toLong() else 0L
                val latest = s["reset:$t"]
                val at = stamp(d, wall, resetFloor(latest, devsOf(s, t)))
                seq++
                write(d, "reset:$t", makeReset(latest, refOf(t), "r$seq", target, at, names[d]))
            }
            r < 60 -> {
                val id = "fav:$t"
                val old = s[id]
                val title = "title${rng.int(3)}"
                write(d, id, updateRecord(old, "favorite", mapOf("board_url" to BOARD, "thread" to t, "title" to title), stamp(d, wall, old?.hlc), names[d]))
            }
            r < 65 -> {
                val id = "fav:$t"
                val old = s[id]
                if (old != null) write(d, id, makeTombstone(old, stamp(d, wall, old.hlc), names[d]))
            }
            r < 70 -> {
                val id = "lv:$t"
                val old = s[id]
                if (old != null) write(d, id, makeTombstone(old, stamp(d, wall, old.hlc), names[d], listOf(LAST_VIEWED_FIELD)))
            }
            r < 80 -> {
                val id = "lv:$t"
                val old = s[id]
                val viewed = rng.int(1_000_000).toLong()
                write(d, id, updateRecord(old, "last_view", mapOf("board_url" to BOARD, "thread" to t, "last_viewed_at" to viewed), stamp(d, wall, old?.hlc), names[d]))
            }
            r < 90 -> {
                val id = "ord:$t"
                val old = s[id]
                val key = (1 + rng.int(9)).toString()
                write(d, id, updateRecord(old, "order", mapOf("board_url" to BOARD, "thread" to t, "key" to key), stamp(d, wall, old?.hlc), names[d]))
            }
            else -> {
                val from = rng.int(o.devices)
                if (from == d) continue
                for (k in stores[from].keys.sorted()) {
                    val p = stores[from].getValue(k)
                    apply(s, k, p)
                    clocks[d] = Hlc.observe(clocks[d], p.hlc, wall)
                }
            }
        }
    }
    // 元の端末も新しい端末も、全部の変更を順番を変えて重複ありで受け取る
    val replicas: List<Store> = stores + List<Store>(3) { HashMap() }
    for (rep in replicas) {
        val dupes = List(log.size / 3) { log[rng.int(maxOf(log.size, 1))] }
        for ((id, p) in shuffled(rng, log + dupes)) apply(rep, id, p)
    }
    val states = replicas.map { stateOf(it) }
    val final = replicas[0]
    val positions = HashMap<String, Long>()
    val oracle = HashMap<String, Long>()
    val resets = HashMap<String, Long>()
    for (t in listOf("t0", "t1")) {
        val latest = final["reset:$t"]
        val id = latest?.body?.get("id") as? String
        val after = latest?.hlc ?: Hlc.ZERO
        val target = latest?.body?.get("target_res") as? Long ?: 0L
        resets[t] = target
        positions[t] = readPosition(latest, devsOf(final, t))
        oracle[t] = reads.filter { it.thread == t && (Hlc.compare(it.at, after) > 0 || it.known == id) }.fold(target) { m, x -> maxOf(m, x.pos) }
    }
    return SimResult(states[0], sha256(utf8(states[0])).toHex(), states.all { it == states[0] }, positions, oracle, resets)
}

// ここから下は領域が消えたときの動き。偽のサーバーと端末で、ふつうの同期と作り直しを通す

private class RecreateDevice(val name: String) {
    var clock = Hlc.ZERO
    var records = HashMap<String, LocalRecord>()
    var pending = HashSet<String>()
    var since = 0L
    var epoch = 0
}

private class ServerRecord(val payload: SyncPayload, val version: Long)

private class RecreateServer {
    val records = HashMap<String, ServerRecord>()
    var next = 0L
    var epoch = 0
    fun ordered() = records.entries.sortedBy { it.value.version }.map { it.key to it.value }
}

private fun writeLocal(dev: RecreateDevice, id: String, p: SyncPayload, nowMs: Long) {
    val old = dev.records[id]
    val c = checked(p)
    dev.records[id] = settleRecord(if (old != null) mergePayloads(old.payload, c) else c, old?.version ?: 0, old, nowMs)
    dev.pending += id
}

private fun receive(dev: RecreateDevice, id: String, server: ServerRecord, nowMs: Long) {
    val old = dev.records[id]
    val merged = if (old != null) mergePayloads(old.payload, server.payload) else server.payload
    dev.records[id] = settleRecord(merged, server.version, old, nowMs)
    if (canonicalJson(merged) == canonicalJson(server.payload)) dev.pending -= id else dev.pending += id
    dev.clock = Hlc.observe(dev.clock, server.payload.hlc, nowMs)
}

private fun pullFrom(dev: RecreateDevice, srv: RecreateServer, nowMs: Long) {
    for ((id, r) in srv.ordered()) {
        if (r.version <= dev.since) continue
        receive(dev, id, r, nowMs)
        dev.since = r.version
    }
}

/** tombstone を先に送る。先のものが 409 なら手元でマージし、次の周でまた送る */
private fun pushTo(dev: RecreateDevice, srv: RecreateServer, nowMs: Long, limit: Int = Int.MAX_VALUE) {
    val ids = dev.pending.sortedWith(compareBy<String> { if (dev.records.getValue(it).payload["deleted"] == true) 0 else 1 }.thenBy { it })
    for (id in ids.take(limit)) {
        val rec = dev.records.getValue(id)
        val cur = srv.records[id]
        if (cur != null && cur.version > rec.version) {
            receive(dev, id, cur, nowMs)
            continue
        }
        val version = ++srv.next
        srv.records[id] = ServerRecord(rec.payload, version)
        dev.records[id] = rec.copy(version = version)
        dev.pending -= id
    }
}

private fun recreateOn(dev: RecreateDevice, srv: RecreateServer, nowMs: Long, deliver: Int = Int.MAX_VALUE) {
    val delivered = srv.ordered().take(deliver)
    val plan = planRecreate(dev.records, delivered.associate { (id, r) -> id to LocalRecord(r.payload, r.version) }, nowMs)
    dev.records = HashMap(plan.records)
    dev.pending = HashSet(plan.pending.keys)
    dev.since = delivered.lastOrNull()?.second?.version ?: 0
    dev.epoch = srv.epoch
    for ((_, r) in delivered) dev.clock = Hlc.observe(dev.clock, r.payload.hlc, nowMs)
}

/** 周の順は pull → push。epoch が変わっていれば、先に作り直す */
private fun syncWith(dev: RecreateDevice, srv: RecreateServer, nowMs: Long, pushLimit: Int = Int.MAX_VALUE) {
    if (dev.epoch != srv.epoch) recreateOn(dev, srv, nowMs)
    pullFrom(dev, srv, nowMs)
    pushTo(dev, srv, nowMs, pushLimit)
}

private fun deleteSpace(srv: RecreateServer) {
    srv.records.clear()
    srv.epoch++
}

private fun payloadsOf(dev: RecreateDevice): Store = dev.records.mapValuesTo(HashMap()) { it.value.payload }

class RecreateOptions(val seed: Int, val devices: Int, val ops: Int, val skews: List<Long>)

class RecreateResult(
    val state: String,
    val sha256: String,
    /** 全端末とサーバーの状態が同じか */
    val converged: Boolean,
    /** 全部の変更をマージした結果と同じか(失ったものも、戻ったものもない) */
    val matchesLog: Boolean,
    /** 変更の結果は tombstone なのに生きているレコードの数 */
    val revived: Int,
    /** 領域が消える前に tombstone になり、そのあと書かれなかったレコードの数(確かめた場面の数) */
    val survivedTombstones: Int,
)

private val THREADS = listOf("t0", "t1", "t2", "t3")

fun simulateRecreate(o: RecreateOptions): RecreateResult {
    val rng = Rng(o.seed)
    val devices = List(o.devices) { RecreateDevice("d$it") }
    val srv = RecreateServer()
    val log = ArrayList<Pair<String, SyncPayload>>()
    var now = 1_700_000_000_000L
    var seq = 0
    var deletedAt = HashMap<String, String>()
    fun stamp(dev: RecreateDevice, wall: Long, floor: String? = null): String {
        val r = Hlc.stamp(dev.clock, wall, dev.name, floor)
        dev.clock = r.clock
        return r.stamp
    }
    fun write(dev: RecreateDevice, id: String, p: SyncPayload, wall: Long) {
        writeLocal(dev, id, p, wall)
        log += id to p
    }
    for (round in 0 until 2) {
        for (op in 0 until o.ops) {
            now += 1 + rng.int(5000)
            val d = rng.int(o.devices)
            val dev = devices[d]
            // 後半は半分のスレだけを書き、領域が消える前の tombstone を最後まで残す
            val t = THREADS[rng.int(if (round == 0) THREADS.size else THREADS.size / 2)]
            val r = rng.int(100)
            val wall = now + o.skews[d % o.skews.size]
            fun get(id: String) = dev.records[id]?.payload
            when {
                r < 25 -> {
                    val pos = rng.int(1000).toLong()
                    val id = "dev:$t:${dev.name}"
                    val old = get(id)
                    val latest = get("reset:$t")
                    write(dev, id, recordRead(old, latest, refOf(t), pos, stamp(dev, wall, old?.hlc), dev.name), wall)
                }
                r < 35 -> {
                    val target = if (rng.int(3) == 0) rng.int(100).toLong() else 0L
                    val latest = get("reset:$t")
                    val at = stamp(dev, wall, resetFloor(latest, devsOf(payloadsOf(dev), t)))
                    seq++
                    write(dev, "reset:$t", makeReset(latest, refOf(t), "r$seq", target, at, dev.name), wall)
                }
                r < 50 -> {
                    val id = "fav:$t"
                    val old = get(id)
                    val title = "title${rng.int(3)}"
                    write(dev, id, updateRecord(old, "favorite", mapOf("board_url" to BOARD, "thread" to t, "title" to title), stamp(dev, wall, old?.hlc), dev.name), wall)
                }
                r < 65 -> {
                    val id = "fav:$t"
                    val old = get(id)
                    if (old != null) write(dev, id, makeTombstone(old, stamp(dev, wall, old.hlc), dev.name), wall)
                }
                r < 72 -> {
                    val id = "lv:$t"
                    val old = get(id)
                    if (old != null) write(dev, id, makeTombstone(old, stamp(dev, wall, old.hlc), dev.name, listOf(LAST_VIEWED_FIELD)), wall)
                }
                r < 85 -> {
                    val id = "lv:$t"
                    val old = get(id)
                    val viewed = rng.int(1_000_000).toLong()
                    write(dev, id, updateRecord(old, "last_view", mapOf("board_url" to BOARD, "thread" to t, "last_viewed_at" to viewed), stamp(dev, wall, old?.hlc), dev.name), wall)
                }
                r < 90 -> {
                    val id = "ord:$t"
                    val old = get(id)
                    val key = (1 + rng.int(9)).toString()
                    write(dev, id, updateRecord(old, "order", mapOf("board_url" to BOARD, "thread" to t, "key" to key), stamp(dev, wall, old?.hlc), dev.name), wall)
                }
                else -> syncWith(dev, srv, wall, rng.int(dev.pending.size + 1))
            }
        }
        if (round == 0) {
            deletedAt = HashMap()
            for (dev in devices) for ((id, r) in dev.records) if (r.payload["deleted"] == true) deletedAt[id] = r.payload.hlc
            deleteSpace(srv)
            // 一部の端末だけが先に気づき、途中までしか受け取らず、途中までしか送らない
            val first = shuffled(rng, devices).take(1 + rng.int(o.devices))
            for (dev in first) {
                now += 1 + rng.int(5000)
                recreateOn(dev, srv, now, rng.int(srv.records.size + 1))
                pushTo(dev, srv, now, rng.int(dev.pending.size + 1))
            }
        }
    }
    repeat(6) { for (dev in devices) syncWith(dev, srv, now) }
    val oracle: Store = HashMap()
    for ((id, p) in log) apply(oracle, id, p)
    val states = devices.map { stateOf(payloadsOf(it), THREADS) }
    val serverState = stateOf(srv.records.mapValuesTo(HashMap()) { it.value.payload }, THREADS)
    val oracleState = stateOf(oracle, THREADS)
    val finalStore = payloadsOf(devices[0])
    var revived = 0
    var survived = 0
    for ((id, p) in oracle) {
        if (p["deleted"] == true && finalStore[id]?.get("deleted") != true) revived++
        if (p["deleted"] == true && deletedAt[id] == p.hlc) survived++
    }
    return RecreateResult(
        states[0],
        sha256(utf8(states[0])).toHex(),
        states.all { it == states[0] } && serverState == states[0],
        states[0] == oracleState,
        revived,
        survived,
    )
}

/** 手順を順に動かす。結果は端末とサーバーごとの { ID: スレタイ }。tombstone は null、レコードがなければキーなし */
fun recreateScript(events: List<Map<String, Any?>>, onExpect: (String, Any?, Any?) -> Unit): Map<String, Any?> {
    val srv = RecreateServer()
    val devices = LinkedHashMap<String, RecreateDevice>()
    fun dev(n: String) = devices.getOrPut(n) { RecreateDevice(n) }
    fun view(recs: Map<String, SyncPayload>): Map<String, Any?> = recs.mapValues { (_, p) -> if (p["deleted"] == true) null else p.body?.get("title") ?: "" }
    fun viewOf(n: String): Map<String, Any?> = if (n == "server") view(srv.records.mapValues { it.value.payload }) else view(payloadsOf(dev(n)))
    for (e in events) {
        val name = e["dev"] as String?
        if (name != null) {
            val d = dev(name)
            val t = e["t"] as Long
            when {
                e.containsKey("add") -> {
                    val id = e["add"] as String
                    val old = d.records[id]?.payload
                    val r = Hlc.stamp(d.clock, t, d.name, old?.hlc)
                    d.clock = r.clock
                    writeLocal(d, id, updateRecord(old, "favorite", mapOf("board_url" to BOARD, "thread" to id, "title" to e["title"]), r.stamp, d.name), t)
                }
                e.containsKey("remove") -> {
                    val id = e["remove"] as String
                    val old = d.records.getValue(id).payload
                    val r = Hlc.stamp(d.clock, t, d.name, old.hlc)
                    d.clock = r.clock
                    writeLocal(d, id, makeTombstone(old, r.stamp, d.name), t)
                }
                e["sync"] == true -> syncWith(d, srv, t)
                e["recreate"] == true -> {
                    recreateOn(d, srv, t, (e["deliver"] as Long?)?.toInt() ?: Int.MAX_VALUE)
                    pushTo(d, srv, t, (e["push"] as Long?)?.toInt() ?: Int.MAX_VALUE)
                }
            }
        } else if (e["delete_space"] == true) {
            deleteSpace(srv)
        } else if (e.containsKey("expect")) {
            for ((n, v) in e["expect"] as Map<*, *>) onExpect(n as String, viewOf(n), v)
        }
    }
    return (devices.keys + "server").associateWith { viewOf(it) }
}

/** マージの法則を確かめるための、同じ HLC や同じ値がよくぶつかる値 */
fun randomPayload(rng: Rng, kind: String): SyncPayload {
    val device = "d${rng.int(2)}"
    val p = HashMap<String, Any?>()
    p["kind"] = kind
    p["hlc"] = "00000000000${1 + rng.int(3)}.000${rng.int(2)}.$device"
    p["device_id"] = device
    if (rng.int(5) == 0) p["deleted"] = true
    if (rng.int(4) == 0) p["x_future"] = rng.int(2).toLong()
    if (p["deleted"] != true || rng.int(2) == 0) {
        val body = HashMap<String, Any?>()
        if (rng.int(2) == 0) body["title"] = "t${rng.int(2)}"
        if (rng.int(3) != 0) body[LAST_VIEWED_FIELD] = rng.int(4).toLong()
        if (body.isNotEmpty()) p["body"] = body
    }
    return p
}
