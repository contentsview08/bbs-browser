package io.github.contentsview08.obb.sync

// 全件を取り直したときの手元の更新。適用はせず、計画を返す(大量に消えるときは呼び出す側が確認を出し、消す前に一覧を保存する)

const val PENDING_MAX_AGE_MS = 90L * 24 * 60 * 60 * 1000
private const val MASS_DELETE_MIN = 10
private const val MASS_DELETE_RATIO = 5

/** version はサーバーで最後に見た値。0 は一度も同期していないもの(クォータでサーバーから外した手元だけの履歴を含む) */
class LocalRecord(val payload: SyncPayload, val version: Long)

class PendingRecord(val payload: SyncPayload, val baseVersion: Long)

class RebasePlan(
    val records: Map<String, LocalRecord>,
    val pending: Map<String, PendingRecord>,
    val removed: List<String>,
    val droppedPending: List<String>,
    /** サーバーが全件を空に見せる攻撃や事故に備え、自動で消さない */
    val needsConfirmation: Boolean,
)

fun planRebase(local: Map<String, LocalRecord>, pending: Map<String, SyncPayload>, full: Map<String, LocalRecord>, nowMs: Long): RebasePlan {
    val records = LinkedHashMap<String, LocalRecord>()
    val outPending = LinkedHashMap<String, PendingRecord>()
    val removed = ArrayList<String>()
    val dropped = ArrayList<String>()
    for (id in (local.keys + pending.keys + full.keys).sorted()) {
        val l = local[id]
        val s = full[id]
        var p = pending[id]
        // 古い未送信は、もう消えた tombstone より前の変更かもしれない。手元の値も未送信を含むので一緒に捨てる
        var ignoreLocal = false
        if (p != null && nowMs - Hlc.parse(p.hlc).wall > PENDING_MAX_AGE_MS) {
            dropped += id
            p = null
            ignoreLocal = true
        }
        when {
            s != null -> {
                var merged = s.payload
                if (l != null && !ignoreLocal) merged = mergePayloads(merged, l.payload)
                if (p != null) merged = mergePayloads(merged, p)
                records[id] = LocalRecord(merged, s.version)
                if (canonicalJson(merged) != canonicalJson(s.payload)) outPending[id] = PendingRecord(merged, s.version)
            }
            p != null -> {
                val merged = if (l != null) mergePayloads(l.payload, p) else p
                records[id] = LocalRecord(merged, 0)
                outPending[id] = PendingRecord(merged, 0)
            }
            l != null && l.version == 0L && !ignoreLocal -> records[id] = l
            l != null -> removed += id
        }
    }
    val synced = local.values.count { it.version > 0 }
    val lost = removed.size
    val confirm = lost > 0 && (full.isEmpty() || (lost >= MASS_DELETE_MIN && lost * MASS_DELETE_RATIO >= synced))
    return RebasePlan(records, outPending, removed, dropped, confirm)
}
