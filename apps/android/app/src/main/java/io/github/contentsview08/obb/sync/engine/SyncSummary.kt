package io.github.contentsview08.obb.sync.engine

import io.github.contentsview08.obb.sync.adapters.AdapterContext
import io.github.contentsview08.obb.sync.adapters.SyncAdapter
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.sha256
import io.github.contentsview08.obb.sync.toHex
import io.github.contentsview08.obb.sync.utf8

// 同期の状態の要約。「今すぐ同期」のあとで端末どうしを見比べるための値で、本文や URL は出さない

private const val HASH_HEX = 12
private const val IDS_SHOWN = 20

class KindSummary(val kind: String, val live: Int, val tombstones: Int, val pending: Int, val needsApply: Int, val hash: String)

class LocalSummary(val area: String, val count: Int, val hash: String)

class SyncSummary(
    val kinds: List<KindSummary>,
    val local: List<LocalSummary>,
    /** 手元の件数が合わない理由ごとの数。0 は入れない */
    val notes: Map<String, Int>,
    val text: String,
)

class MismatchSummary(val differs: Map<String, Int>, val missing: Map<String, Int>, val samples: List<String>)

fun hashLines(lines: List<String>): String = sha256(utf8(lines.sorted().joinToString("\n"))).toHex().substring(0, HASH_HEX)

private class KindGroup {
    var live = 0
    var tombstones = 0
    var pending = 0
    var needsApply = 0
    val lines = ArrayList<String>()
}

fun syncSummary(db: SyncSql, adapters: List<SyncAdapter>, ctx: AdapterContext): SyncSummary {
    val groups = HashMap<String, KindGroup>()
    // 既読の送信待ちなど、手元だけで変わるものを除いて比べる値を作る
    for (r in db.query("SELECT record_id, kind, payload, deleted, pending, needs_apply FROM sync_records")) {
        val g = groups.getOrPut(r["kind"] as String) { KindGroup() }
        if (r["deleted"] == 1L) g.tombstones++ else g.live++
        g.pending += (r["pending"] as Long).toInt()
        g.needsApply += (r["needs_apply"] as Long).toInt()
        g.lines += "${r["record_id"]}\t${r["payload"]}"
    }
    val kinds = groups.entries.sortedBy { it.key }.map { (kind, g) -> KindSummary(kind, g.live, g.tombstones, g.pending, g.needsApply, hashLines(g.lines)) }
    val areas = HashMap<String, List<String>>()
    for (a in adapters) {
        val lines = a.localLines(ctx) ?: continue
        val key = a.localArea ?: a.area
        areas[key] = areas[key].orEmpty() + lines
    }
    val local = areas.entries.sortedBy { it.key }.map { (area, lines) -> LocalSummary(area, lines.size, hashLines(lines)) }
    val notes = java.util.TreeMap<String, Int>()
    fun note(k: String, n: Int) {
        if (n > 0) notes[k] = (notes[k] ?: 0) + n
    }
    for (a in adapters) for ((k, n) in a.explain(ctx)) note(k, n)
    // 処理できる操作だけを数える(新しい版で積んだ操作が残った DB を開いても、待ちがあるように見せない。送信待ちの数と同じ)
    val names = adapters.flatMap { it.ops }.distinct()
    if (names.isNotEmpty()) {
        val marks = names.joinToString(", ") { "?" }
        note("ops_waiting", (db.query("SELECT COUNT(*) AS n FROM sync_ops WHERE op IN ($marks)", names).firstOrNull()?.get("n") as Long? ?: 0L).toInt())
    }
    (db.query("SELECT value FROM sync_state WHERE key = 'bad_counts'").firstOrNull()?.get("value") as String?)?.let { raw ->
        for ((k, n) in parseStrictJson(raw) as Map<*, *>) note("bad_$k", (n as Long).toInt())
    }
    val text = (kinds.map { "${it.kind}=${it.live}+${it.tombstones}:${it.hash}" } + local.map { "@${it.area}=${it.count}:${it.hash}" } + notes.map { "?${it.key}=${it.value}" }).joinToString(" ")
    return SyncSummary(kinds, local, notes, text)
}

/** 重いので押したときだけ。apply は文を作るだけで書かないので、手元と表の違いをそのまま数えられる */
fun syncMismatches(db: SyncSql, adapters: List<SyncAdapter>, ctx: AdapterContext): MismatchSummary {
    val t = SyncTables(db)
    val differs = LinkedHashMap<String, Int>()
    val missing = LinkedHashMap<String, Int>()
    val samples = ArrayList<String>()
    for (kind in adapters.map { it.kind }.distinct()) {
        val owners = adapters.filter { it.kind == kind }
        for (r in t.recordsOfKind(kind)) {
            if (r.needsApply || r.payload["trim"] == true) continue
            val a = owners.firstOrNull { it.owns(r) } ?: continue
            if (!a.differs(r, ctx)) continue
            differs.merge(kind, 1, Int::plus)
            if (samples.size < IDS_SHOWN) samples += r.recordId.substring(0, HASH_HEX)
        }
    }
    for (a in adapters) {
        if (!a.seedsAll) continue
        for (row in a.seed(ctx)) if (t.record(row.recordId) == null) missing.merge(a.kind, 1, Int::plus)
    }
    return MismatchSummary(differs, missing, samples)
}
