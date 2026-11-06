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

private fun stateOf(s: Store): String {
    val positions = listOf("t0", "t1").associateWith { readPosition(s["reset:$it"], devsOf(s, it)) }
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
        apply(stores[d], id, p)
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
                write(d, id, recordRead(dev, latest, pos, at, names[d]))
            }
            r < 45 -> {
                val target = if (rng.int(3) == 0) rng.int(100).toLong() else 0L
                val latest = s["reset:$t"]
                val at = stamp(d, wall, resetFloor(latest, devsOf(s, t)))
                seq++
                write(d, "reset:$t", makeReset(latest, "r$seq", target, at, names[d]))
            }
            r < 60 -> {
                val id = "fav:$t"
                val old = s[id]
                val title = "title${rng.int(3)}"
                write(d, id, updateRecord(old, "favorite", mapOf("board_url" to "https://a.example/b/", "thread" to t, "title" to title), stamp(d, wall, old?.hlc), names[d]))
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
                write(d, id, updateRecord(old, "last_view", mapOf("board_url" to "https://a.example/b/", "thread" to t, "last_viewed_at" to viewed), stamp(d, wall, old?.hlc), names[d]))
            }
            r < 90 -> {
                val id = "ord:$t"
                val old = s[id]
                val key = (1 + rng.int(9)).toString()
                write(d, id, updateRecord(old, "order", mapOf("key" to key), stamp(d, wall, old?.hlc), names[d]))
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
    val states = replicas.map(::stateOf)
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
