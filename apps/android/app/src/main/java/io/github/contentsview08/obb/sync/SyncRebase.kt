package io.github.contentsview08.obb.sync

// 全件を取り直したときの手元の更新。適用はせず、計画を返す(大量に消えるときは呼び出す側が確認を出し、消す前に一覧を保存する)

const val PENDING_MAX_AGE_MS = 90L * 24 * 60 * 60 * 1000
const val TOMB_MAX_AGE_MS = 90L * 24 * 60 * 60 * 1000
private const val MASS_DELETE_MIN = 10
private const val MASS_DELETE_RATIO = 5

/**
 * version はサーバーで最後に見た値。0 は一度も同期していないもの(クォータでサーバーから外した手元だけの履歴を含む)。
 * tombAt はこの端末で tombstone になった時刻
 */
data class LocalRecord(val payload: SyncPayload, val version: Long, val tombAt: Long? = null)

class PendingRecord(val payload: SyncPayload, val baseVersion: Long)

class RebasePlan(
    val records: Map<String, LocalRecord>,
    val pending: Map<String, PendingRecord>,
    val removed: List<String>,
    val droppedPending: List<String>,
    /** サーバーが全件を空に見せる攻撃や事故に備え、自動で消さない */
    val needsConfirmation: Boolean,
)

class RecreatePlan(
    val records: Map<String, LocalRecord>,
    val pending: Map<String, PendingRecord>,
    /** 期限の切れた tombstone。同期の表から消すだけで、今のデータに触らない */
    val expired: List<String>,
)

private fun isTomb(p: SyncPayload) = p["deleted"] == true

/** tombAt がなければ、いま tombstone になったものとして扱う */
fun isTombExpired(tombAt: Long?, nowMs: Long): Boolean = tombAt != null && nowMs - tombAt > TOMB_MAX_AGE_MS

/** マージの結果に tombAt を付ける。tombstone のあいだは最初の時刻を保つ(新しい tombstone で保持の期限を延ばさない) */
fun settleRecord(payload: SyncPayload, version: Long, prev: LocalRecord?, nowMs: Long): LocalRecord {
    if (!isTomb(payload)) return LocalRecord(payload, version)
    val at = if (prev != null && isTomb(prev.payload) && prev.tombAt != null) prev.tombAt else nowMs
    return LocalRecord(payload, version, at)
}

/** complete は全件を最後まで受け取れたか。途中までなら、届いていないものを消えたと決めない */
fun planRebase(local: Map<String, LocalRecord>, pending: Map<String, SyncPayload>, full: Map<String, LocalRecord>, complete: Boolean, nowMs: Long): RebasePlan {
    val records = LinkedHashMap<String, LocalRecord>()
    val outPending = LinkedHashMap<String, PendingRecord>()
    val removed = ArrayList<String>()
    val dropped = ArrayList<String>()
    var lost = 0
    for (id in (local.keys + pending.keys + full.keys).sorted()) {
        val l = local[id]
        val s = full[id]
        var p = pending[id]
        if (s == null && !complete) {
            if (p != null) {
                val merged = if (l != null) mergePayloads(l.payload, p) else p
                val version = l?.version ?: 0
                records[id] = settleRecord(merged, version, l, nowMs)
                outPending[id] = PendingRecord(merged, version)
            } else if (l != null) {
                records[id] = l
            }
            continue
        }
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
                records[id] = settleRecord(merged, s.version, l, nowMs)
                if (canonicalJson(merged) != canonicalJson(s.payload)) outPending[id] = PendingRecord(merged, s.version)
            }
            p != null -> {
                val merged = if (l != null) mergePayloads(l.payload, p) else p
                records[id] = settleRecord(merged, 0, l, nowMs)
                outPending[id] = PendingRecord(merged, 0)
            }
            // サーバーの片づけの後も残す。領域を作り直すとき、削除済みが他の端末の古い値から戻らないように
            l != null && isTomb(l.payload) -> if (isTombExpired(l.tombAt, nowMs)) removed += id else records[id] = settleRecord(l.payload, 0, l, nowMs)
            l != null && l.version == 0L && !ignoreLocal -> records[id] = l
            l != null -> {
                removed += id
                lost++
            }
        }
    }
    // tombstone は手元のデータではないので、分母にも数えない(数えると本当に消える分の割合が薄まる)
    val synced = local.values.count { it.version > 0 && !isTomb(it.payload) }
    val confirm = lost > 0 && (full.isEmpty() || (lost >= MASS_DELETE_MIN && lost * MASS_DELETE_RATIO >= synced))
    return RebasePlan(records, outPending, removed, dropped, confirm)
}

/**
 * 領域が消えたときの合わせ直し。全件は空か途中までなので、手元を消さない。
 * 手元の全部を送るので、古い種まきの値も捨てない。他の端末が先に送ったものは 409 のマージで揃う
 */
fun planRecreate(local: Map<String, LocalRecord>, full: Map<String, LocalRecord>, nowMs: Long): RecreatePlan {
    val records = LinkedHashMap<String, LocalRecord>()
    val pending = LinkedHashMap<String, PendingRecord>()
    val expired = ArrayList<String>()
    for (id in (local.keys + full.keys).sorted()) {
        val l = local[id]
        val s = full[id]
        if (s != null) {
            val merged = if (l != null) mergePayloads(s.payload, l.payload) else s.payload
            records[id] = settleRecord(merged, s.version, l, nowMs)
            if (canonicalJson(merged) != canonicalJson(s.payload)) pending[id] = PendingRecord(merged, s.version)
        } else if (l != null) {
            if (isTomb(l.payload) && isTombExpired(l.tombAt, nowMs)) {
                expired += id
            } else {
                records[id] = settleRecord(l.payload, 0, l, nowMs)
                pending[id] = PendingRecord(l.payload, 0)
            }
        }
    }
    return RecreatePlan(records, pending, expired)
}
