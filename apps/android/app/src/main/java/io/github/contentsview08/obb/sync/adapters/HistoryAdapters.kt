package io.github.contentsview08.obb.sync.adapters

import io.github.contentsview08.obb.sync.DEV_KIND
import io.github.contentsview08.obb.sync.Hlc
import io.github.contentsview08.obb.sync.LAST_VIEWED_FIELD
import io.github.contentsview08.obb.sync.RESET_KIND
import io.github.contentsview08.obb.sync.SyncConfig
import io.github.contentsview08.obb.sync.SyncPayload
import io.github.contentsview08.obb.sync.ThreadRef
import io.github.contentsview08.obb.sync.body
import io.github.contentsview08.obb.sync.canonicalJson
import io.github.contentsview08.obb.sync.checkPayload
import io.github.contentsview08.obb.sync.engine.RecordRefs
import io.github.contentsview08.obb.sync.engine.SqlStatement
import io.github.contentsview08.obb.sync.engine.StoredRecord
import io.github.contentsview08.obb.sync.engine.SyncOpRow
import io.github.contentsview08.obb.sync.engine.SyncSql
import io.github.contentsview08.obb.sync.engine.parseSwitches
import io.github.contentsview08.obb.sync.hlc
import io.github.contentsview08.obb.sync.makeReset
import io.github.contentsview08.obb.sync.makeTombstone
import io.github.contentsview08.obb.sync.normalizeBoardUrl
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.readPosition
import io.github.contentsview08.obb.sync.recordId
import io.github.contentsview08.obb.sync.recordRead
import io.github.contentsview08.obb.sync.resetFloor
import io.github.contentsview08.obb.sync.updateRecord

// 閲覧履歴と既読。閲覧履歴は last_view:<板>:<スレ>、既読は read_dev(スレ×端末)と read_reset(スレごと)

const val LAST_VIEW_KIND = "last_view"
const val OP_READ = "read"
const val OP_VIEW = "view"
const val OP_VIEW_REMOVE = "view_remove"
const val OP_LOG_DELETE = "log_delete"
const val AREA_HISTORY = "history"
const val AREA_READS = "reads"
private const val TITLE_MAX = 1024
private const val NAME_MAX = 256
private const val SEED_PRIORITY = 5L
private const val DAY_MS = 86_400_000L
private val KEY_TIME = Regex("[0-9]{10}")

class HistoryHost(
    val resolve: (String) -> ResolvedBoard?,
    /** 保持日数。0 は消さない。これより古い履歴に手元の行を作っても、次の整理で消えるだけ */
    val retentionDays: () -> Int,
    /** リセットの id。ランダムな値 */
    val newResetId: () -> String,
)

private const val THREAD_COLUMNS = "board_url, key, title, read_no, read_at, created_at"

private class ThreadRow(val boardUrl: String, val key: String, val title: String, val readNo: Long, val readAt: Long?, val createdAt: Long?)

private fun rowOf(r: Map<String, Any?>) = ThreadRow(r["board_url"] as String, r["key"] as String, r["title"] as String, r["read_no"] as Long, r["read_at"] as Long?, r["created_at"] as Long?)

private fun argsOf(op: SyncOpRow): Pair<String, String>? = try {
    val a = parseStrictJson(op.args.orEmpty()) as? Map<*, *>
    val board = a?.get("board_url") as? String
    val key = a?.get("key") as? String
    if (board != null && key != null) board to key else null
} catch (_: Exception) {
    null
}

private fun targetOf(ctx: AdapterContext, kind: String, boardUrl: String, key: String, detail: String? = null): OpTarget? {
    val board = normalizeBoardUrl(boardUrl)
    if (board == null || key.isEmpty()) return null
    return OpTarget(recordId(ctx.keys.kId, kind, boardUrl, key, detail), RecordRefs(board, key, detail))
}

/** 手元の URL は端末で違うことがあるので、キーで引いて正規化した値で比べる */
private fun localRows(db: SyncSql, board: String?, key: String?): List<ThreadRow> {
    if (board == null || key == null) return emptyList()
    return db.query("SELECT $THREAD_COLUMNS FROM threads WHERE key = ?", listOf(key)).map(::rowOf).filter { normalizeBoardUrl(it.boardUrl) == board }
}

private class ReadRecords(val latest: SyncPayload?, val devs: List<SyncPayload>)

/** 同じスレのリセットと全端末の記録。tombstone は読みとして数えない */
@Suppress("UNCHECKED_CAST")
private fun readRecords(db: SyncSql, board: String, key: String): ReadRecords {
    val rows = db.query(
        "SELECT kind, payload FROM sync_records WHERE kind IN (?, ?) AND ref_board = ? AND ref_thread = ? AND deleted = 0 ORDER BY record_id",
        listOf(RESET_KIND, DEV_KIND, board, key),
    ).map { it["kind"] as String to (parseStrictJson(it["payload"] as String) as SyncPayload) }
    return ReadRecords(rows.firstOrNull { it.first == RESET_KIND }?.second, rows.filter { it.first == DEV_KIND }.map { it.second })
}

/** まだ処理していない読みを足す。下がった値を書いたあとで、読んだ位置へ戻る動きを見せない */
private fun pendingRead(db: SyncSql, boardUrl: String, key: String): Long =
    db.query("SELECT num FROM sync_ops WHERE op = 'read' AND target = ?", listOf("$boardUrl\t$key")).firstOrNull()?.get("num") as Long? ?: 0L

private fun createdAtOf(body: Map<String, Any?>, key: String): Long? =
    body["created_at"] as? Long ?: if (KEY_TIME.matches(key)) key.toLong() * 1000 else null

private val NOTHING = ApplyPlan(emptyList(), false)

/**
 * ログのないスレを開くとき、同期の表から既読と履歴を戻す(自動整理のあとに開き直すと既読が戻る)。
 * ログの削除はリセットを書くので、戻るのはリセットより後の読みだけになる
 */
@Suppress("UNCHECKED_CAST")
fun restoreThreadRead(db: SyncSql, boardUrl: String, key: String, connectorId: String, title: String, createdAt: Long?): Boolean {
    val board = normalizeBoardUrl(boardUrl)
    if (board == null || localRows(db, board, key).isNotEmpty()) return false
    // 切っている間は受け取った記録を手元へ写さない
    val state = db.query("SELECT key, value FROM sync_state WHERE key IN ('master', 'kinds')").associate { it["key"] as String to it["value"] as String }
    if (state["master"] == "0" || parseSwitches(state["kinds"])["history"] != true) return false
    val r = readRecords(db, board, key)
    val pos = readPosition(r.latest, r.devs)
    if (pos <= 0) return false
    val view = db.query("SELECT payload FROM sync_records WHERE kind = 'last_view' AND ref_board = ? AND ref_thread = ? AND deleted = 0", listOf(board, key)).firstOrNull()
    val viewedAt = view?.let { (parseStrictJson(it["payload"] as String) as SyncPayload).body?.get(LAST_VIEWED_FIELD) as? Long }
    db.exec(
        "INSERT OR IGNORE INTO threads (board_url, key, connector_id, title, created_at, read_no, read_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        listOf(boardUrl, key, connectorId, title, createdAt, pos, viewedAt),
    )
    return true
}

class LastViewAdapter(private val db: SyncSql, private val host: HistoryHost) : SyncAdapter {
    override val kind = LAST_VIEW_KIND
    override val area = AREA_HISTORY
    override val ops = listOf(OP_READ, OP_VIEW, OP_VIEW_REMOVE)
    override val reconciles = false
    override val expands = true

    override fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget? = argsOf(op)?.let { (b, k) -> targetOf(ctx, LAST_VIEW_KIND, b, k) }

    override fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload? = null

    private fun boardName(boardUrl: String): String? {
        val fav = db.query("SELECT name FROM favorite_boards WHERE url = ?", listOf(boardUrl)).firstOrNull()?.get("name") as String?
        if (!fav.isNullOrEmpty()) return fav
        return (db.query("SELECT name FROM boards WHERE url = ?", listOf(boardUrl)).firstOrNull()?.get("name") as String?)?.ifEmpty { null }
    }

    private fun bodyOf(r: ThreadRow, name: String?, viewedAt: Long): Map<String, Any?> = buildMap {
        put("board_url", r.boardUrl)
        put("thread", r.key)
        if (r.title.isNotEmpty()) put("title", r.title.take(TITLE_MAX))
        if (name != null) put("board_name", name.take(NAME_MAX))
        if (r.createdAt != null) put("created_at", r.createdAt)
        put(LAST_VIEWED_FIELD, viewedAt)
    }

    /** 読むと閲覧履歴と端末の記録の 2 つが変わる。ログを消した後に届いた読みでは閲覧履歴を作り直さない */
    override fun expand(op: SyncOpRow, ctx: AdapterContext): List<OpEffect>? {
        val (boardUrl, key) = argsOf(op) ?: return null
        val t = targetOf(ctx, LAST_VIEW_KIND, boardUrl, key) ?: return null
        if (op.op == OP_VIEW_REMOVE) {
            return listOf(OpEffect(t) { existing, stamp -> makeTombstone(existing ?: mapOf("kind" to LAST_VIEW_KIND, "hlc" to stamp, "device_id" to ctx.deviceId), stamp, ctx.deviceId, listOf(LAST_VIEWED_FIELD)) })
        }
        val row = localRows(db, t.refs.board, key).firstOrNull()
        val name = row?.let { boardName(it.boardUrl) }
        val view = OpEffect(t) { existing, stamp ->
            if (row == null) null
            else {
                val before = existing?.body?.get(LAST_VIEWED_FIELD) as? Long ?: 0L
                updateRecord(existing, LAST_VIEW_KIND, bodyOf(row, name, maxOf(before, op.atMs)), stamp, ctx.deviceId)
            }
        }
        if (op.op == OP_VIEW) return listOf(view)
        val dev = targetOf(ctx, DEV_KIND, boardUrl, key, ctx.deviceId)!!
        val latest = readRecords(db, t.refs.board!!, key).latest
        val ref = ThreadRef(row?.boardUrl ?: boardUrl, key)
        return listOf(view, OpEffect(dev) { existing, stamp -> recordRead(existing, latest, ref, op.num ?: 0L, stamp, ctx.deviceId) })
    }

    override fun seed(ctx: AdapterContext): List<SeedRow> {
        val names = HashMap<String, String>()
        for (b in db.query("SELECT url, name FROM boards")) if ((b["name"] as String).isNotEmpty()) names[b["url"] as String] = b["name"] as String
        for (b in db.query("SELECT url, name FROM favorite_boards")) if ((b["name"] as String).isNotEmpty()) names[b["url"] as String] = b["name"] as String
        return db.query("SELECT $THREAD_COLUMNS FROM threads WHERE read_at IS NOT NULL ORDER BY read_at DESC, key").mapNotNull {
            val r = rowOf(it)
            val t = targetOf(ctx, LAST_VIEW_KIND, r.boardUrl, r.key) ?: return@mapNotNull null
            val at = r.readAt!!
            val hlc = Hlc.format(maxOf(1L, minOf(at, ctx.now)), 0, ctx.deviceId)
            val payload = mapOf("kind" to LAST_VIEW_KIND, "hlc" to hlc, "device_id" to ctx.deviceId, "body" to bodyOf(r, names[r.boardUrl], at))
            if (checkPayload(payload) == null) null else SeedRow(t.recordId, t.refs, payload, SEED_PRIORITY)
        }
    }

    override fun owns(r: StoredRecord) = r.refThread != null

    override fun exists(r: StoredRecord) = localRows(db, r.refBoard, r.refThread).any { it.readAt != null }

    /** ログは消さない。閲覧履歴の印だけを外す */
    override fun remove(r: StoredRecord): ApplyPlan {
        val rows = localRows(db, r.refBoard, r.refThread).filter { it.readAt != null }
        return ApplyPlan(rows.map { SqlStatement("UPDATE threads SET read_at = NULL WHERE board_url = ? AND key = ?", listOf(it.boardUrl, it.key)) }, rows.isNotEmpty())
    }

    override fun apply(r: StoredRecord, ctx: AdapterContext): ApplyPlan {
        if (r.payload["deleted"] == true) return if (r.payload["trim"] == true) NOTHING else remove(r)
        val body = r.payload.body.orEmpty()
        val viewedAt = body[LAST_VIEWED_FIELD] as Long
        val title = body["title"] as? String ?: ""
        val key = r.refThread!!
        val rows = localRows(db, r.refBoard, key)
        if (rows.isNotEmpty()) {
            val statements = rows.mapNotNull { x ->
                val created = x.createdAt ?: (body["created_at"] as? Long)
                if (x.readAt == viewedAt && (title.isEmpty() || x.title == title) && x.createdAt == created) null
                else SqlStatement("UPDATE threads SET read_at = ?, title = ?, created_at = ? WHERE board_url = ? AND key = ?", listOf(viewedAt, title.ifEmpty { x.title }, created, x.boardUrl, key))
            }
            return ApplyPlan(statements, statements.isNotEmpty())
        }
        return emptyRow(r, body, viewedAt, title, ctx)
    }

    /** 行がないのは整理やログの削除で普通に起きる。ある行の値だけを比べる */
    override fun differs(r: StoredRecord, ctx: AdapterContext): Boolean {
        if (localRows(db, r.refBoard, r.refThread).isEmpty()) return false
        return apply(r, ctx).changed
    }

    private fun emptyRow(r: StoredRecord, body: Map<String, Any?>, viewedAt: Long, title: String, ctx: AdapterContext): ApplyPlan {
        val key = r.refThread!!
        val days = host.retentionDays()
        if (days > 0 && ctx.now - viewedAt > days * DAY_MS) return NOTHING
        val resolved = host.resolve(body["board_url"] as String) ?: return NOTHING
        val rec = readRecords(db, r.refBoard!!, key)
        // ログを消した後に届いた、それより前の閲覧で履歴の行を作り直さない
        if (rec.latest != null && Hlc.parse(rec.latest.hlc).wall >= viewedAt) return NOTHING
        return ApplyPlan(
            listOf(
                SqlStatement(
                    "INSERT OR IGNORE INTO threads (board_url, key, connector_id, title, created_at, read_no, read_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    listOf(resolved.boardUrl, key, resolved.connectorId, title.ifEmpty { key }, createdAtOf(body, key), readPosition(rec.latest, rec.devs), viewedAt),
                ),
            ),
            true,
        )
    }

    override fun fill(ctx: AdapterContext): List<SeedRow> = seed(ctx)

    /** 手元の履歴と表の履歴が合わない理由ごとの数 */
    override fun explain(ctx: AdapterContext): Map<String, Int> {
        val local = db.query("SELECT $THREAD_COLUMNS FROM threads WHERE read_at IS NOT NULL").map(::rowOf)
        val shown = local.map { "${normalizeBoardUrl(it.boardUrl)}\t${it.key}" }.toSet()
        val known = db.query("SELECT ref_board, ref_thread FROM sync_records WHERE kind = 'last_view'").map { "${it["ref_board"]}\t${it["ref_thread"]}" }.toSet()
        var old = 0
        var unresolved = 0
        var reset = 0
        var other = 0
        val days = host.retentionDays()
        for (r in db.query("SELECT ref_board, ref_thread, payload FROM sync_records WHERE kind = 'last_view' AND deleted = 0 AND needs_apply = 0")) {
            val board = r["ref_board"] as String
            val key = r["ref_thread"] as String
            if ("$board\t$key" in shown) continue
            @Suppress("UNCHECKED_CAST")
            val body = (parseStrictJson(r["payload"] as String) as SyncPayload).body.orEmpty()
            val viewedAt = body[LAST_VIEWED_FIELD] as Long
            val latest = readRecords(db, board, key).latest
            when {
                days > 0 && ctx.now - viewedAt > days * DAY_MS -> old++
                host.resolve(body["board_url"] as String) == null -> unresolved++
                latest != null && Hlc.parse(latest.hlc).wall >= viewedAt -> reset++
                else -> other++
            }
        }
        return mapOf(
            "history_over_shown" to maxOf(0, local.size - SyncConfig.HISTORY_SHOWN),
            "history_no_record" to shown.count { it !in known },
            "view_old" to old,
            "view_unresolved" to unresolved,
            "view_reset" to reset,
            "view_other" to other,
        )
    }

    override fun localLines(ctx: AdapterContext): List<String> =
        db.query("SELECT $THREAD_COLUMNS FROM threads WHERE read_at IS NOT NULL").map(::rowOf).map { canonicalJson(listOf(normalizeBoardUrl(it.boardUrl), it.key, it.readAt)) }
}

/** read_dev と read_reset の適用は同じ。手元の値はどちらも readPosition の結果で、下げることもある */
abstract class ReadAdapterBase(protected val db: SyncSql) : SyncAdapter {
    override val area = AREA_READS
    override val reconciles = false

    override fun owns(r: StoredRecord) = r.refBoard != null && r.refThread != null

    override fun exists(r: StoredRecord) = localRows(db, r.refBoard, r.refThread).isNotEmpty()

    override fun remove(r: StoredRecord) = NOTHING

    override fun apply(r: StoredRecord, ctx: AdapterContext): ApplyPlan {
        // 外した記録を除いて計算すると手元の既読が下がる
        if (r.payload["trim"] == true) return NOTHING
        val key = r.refThread!!
        val rows = localRows(db, r.refBoard, key)
        if (rows.isEmpty()) return NOTHING
        val rec = readRecords(db, r.refBoard!!, key)
        val pos = readPosition(rec.latest, rec.devs)
        val statements = rows.mapNotNull { x ->
            // 下げるのはリセットだけ。まだ送っていない手元の読みを、他の端末の記録で下げない
            val next = maxOf(pos, pendingRead(db, x.boardUrl, key), if (rec.latest == null) x.readNo else 0L)
            if (x.readNo == next) null else SqlStatement("UPDATE threads SET read_no = ? WHERE board_url = ? AND key = ?", listOf(next, x.boardUrl, key))
        }
        return ApplyPlan(statements, statements.isNotEmpty())
    }

    override fun localLines(ctx: AdapterContext): List<String> = emptyList()
}

/** 端末の記録は LastViewAdapter の read の操作で作る。種まきと適用だけを受け持つ */
class ReadDevAdapter(db: SyncSql) : ReadAdapterBase(db) {
    override val kind = DEV_KIND
    override val ops = emptyList<String>()
    override val seedsAll = false

    override fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget? = null

    override fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload? = null

    /** 古い読みが未読に戻す操作に勝たないよう、HLC は読んだ時刻のまま */
    override fun seed(ctx: AdapterContext): List<SeedRow> =
        db.query("SELECT board_url, key, read_no, read_at, fetched_at FROM threads WHERE read_no > 0 ORDER BY read_at DESC, key").mapNotNull {
            val boardUrl = it["board_url"] as String
            val key = it["key"] as String
            val pos = it["read_no"] as Long
            val t = targetOf(ctx, DEV_KIND, boardUrl, key, ctx.deviceId) ?: return@mapNotNull null
            val at = it["read_at"] as Long? ?: it["fetched_at"] as Long? ?: 1L
            val hlc = Hlc.format(maxOf(1L, minOf(at, ctx.now)), 0, ctx.deviceId)
            val body = mapOf("board_url" to boardUrl, "thread" to key, "base_reset_id" to null, "pos" to pos, "steps" to listOf(mapOf("at" to hlc, "pos" to pos)))
            val payload = mapOf("kind" to DEV_KIND, "hlc" to hlc, "device_id" to ctx.deviceId, "body" to body)
            if (checkPayload(payload) == null) null else SeedRow(t.recordId, t.refs, payload, SEED_PRIORITY)
        }

    /** 表の既読より手元が進んでいるスレだけ。全スレに端末ごとの記録を増やさない。外した記録のあるスレは送り直さない */
    override fun fill(ctx: AdapterContext): List<SeedRow> {
        val rows = seed(ctx)
        if (rows.isEmpty()) return emptyList()
        class Group(var latest: SyncPayload? = null, val devs: ArrayList<SyncPayload> = ArrayList(), var trimmed: Boolean = false)
        val groups = HashMap<String, Group>()
        for (r in db.query("SELECT kind, payload, deleted, ref_board, ref_thread FROM sync_records WHERE kind IN (?, ?)", listOf(RESET_KIND, DEV_KIND))) {
            val g = groups.getOrPut("${r["ref_board"]}\t${r["ref_thread"]}") { Group() }
            @Suppress("UNCHECKED_CAST")
            val p = parseStrictJson(r["payload"] as String) as SyncPayload
            if (r["deleted"] == 1L) g.trimmed = g.trimmed || r["kind"] == DEV_KIND
            else if (r["kind"] == RESET_KIND) g.latest = p
            else g.devs += p
        }
        return rows.mapNotNull { r ->
            val g = groups["${r.refs.board}\t${r.refs.thread}"]
            if (g != null && (g.trimmed || readPosition(g.latest, g.devs) >= r.payload.body!!["pos"] as Long)) return@mapNotNull null
            // リセットのあとの読みは操作で記録される。手元の方が大きいのはリセットの前の値なので、送らずに下げる
            val latest = g?.latest
            if (latest != null) {
                val reset = targetOf(ctx, RESET_KIND, r.payload.body!!["board_url"] as String, r.refs.thread!!) ?: return@mapNotNull null
                return@mapNotNull SeedRow(reset.recordId, reset.refs, latest, r.priority, reapply = true)
            }
            SeedRow(r.recordId, r.refs, r.payload, r.priority, reapply = true)
        }
    }

    /** 既読の記録が手元の行に届いていないスレと、手元の値が表の値と違うスレの数 */
    override fun explain(ctx: AdapterContext): Map<String, Int> {
        class Group(val board: String, val key: String, var latest: SyncPayload? = null, val devs: ArrayList<SyncPayload> = ArrayList())
        val groups = LinkedHashMap<String, Group>()
        for (r in db.query("SELECT ref_board, ref_thread, kind, payload FROM sync_records WHERE kind IN (?, ?) AND deleted = 0 AND needs_apply = 0", listOf(RESET_KIND, DEV_KIND))) {
            val board = r["ref_board"] as String
            val key = r["ref_thread"] as String
            val g = groups.getOrPut("$board\t$key") { Group(board, key) }
            @Suppress("UNCHECKED_CAST")
            val p = parseStrictJson(r["payload"] as String) as SyncPayload
            if (r["kind"] == RESET_KIND) g.latest = p else g.devs += p
        }
        var noRow = 0
        var differs = 0
        for (g in groups.values) {
            val local = localRows(db, g.board, g.key)
            if (local.isEmpty()) noRow++
            else if (local.any { it.readNo != readPosition(g.latest, g.devs) }) differs++
        }
        return mapOf("read_no_row" to noRow, "read_differs" to differs)
    }

    override fun detailOf(p: SyncPayload): String? = p["device_id"] as? String

    /** 手元の行のあるスレの既読。端末で同じ行があれば同じ値になる */
    override fun localLines(ctx: AdapterContext): List<String> =
        db.query("SELECT $THREAD_COLUMNS FROM threads WHERE read_no > 0").map(::rowOf).map { canonicalJson(listOf(normalizeBoardUrl(it.boardUrl), it.key, it.readNo)) }
}

/** ログの削除は全端末で未読に戻す操作。上限を超えた分は手元からだけ消える */
class ReadResetAdapter(db: SyncSql, private val host: HistoryHost) : ReadAdapterBase(db) {
    override val kind = RESET_KIND
    override val ops = listOf(OP_LOG_DELETE)
    override val expands = true

    override fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget? = argsOf(op)?.let { (b, k) -> targetOf(ctx, RESET_KIND, b, k) }

    override fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload? = null

    override fun expand(op: SyncOpRow, ctx: AdapterContext): List<OpEffect>? {
        val (boardUrl, key) = argsOf(op) ?: return null
        val t = targetOf(ctx, RESET_KIND, boardUrl, key) ?: return null
        val rec = readRecords(db, t.refs.board!!, key)
        if (rec.latest == null) {
            val n = db.query("SELECT COUNT(*) AS n FROM sync_records WHERE kind = ?", listOf(RESET_KIND)).firstOrNull()?.get("n") as Long? ?: 0L
            if (n >= SyncConfig.RESET_TOTAL_MAX) return null
        }
        val ref = ThreadRef(boardUrl, key)
        val id = host.newResetId()
        return listOf(OpEffect(t, resetFloor(rec.latest, rec.devs)) { existing, stamp -> makeReset(existing, ref, id, 0L, stamp, ctx.deviceId) })
    }

    override fun seed(ctx: AdapterContext) = emptyList<SeedRow>()
}

fun historyAdapters(db: SyncSql, host: HistoryHost): List<SyncAdapter> = listOf(LastViewAdapter(db, host), ReadDevAdapter(db), ReadResetAdapter(db, host))
