package io.github.contentsview08.obb.sync.engine

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import io.github.contentsview08.obb.sync.LocalRecord
import io.github.contentsview08.obb.sync.SyncPayload
import io.github.contentsview08.obb.sync.canonicalJson
import io.github.contentsview08.obb.sync.parseStrictJson

// 同期の表の読み書き

class SqlStatement(val sql: String, val args: List<Any?> = emptyList())

/** 単体テストでは sqlite-jdbc を差し込む。android.database は JVM のテストで動かない */
interface SyncSql {
    fun exec(sql: String, args: List<Any?> = emptyList())

    /** 行は列名 → Long・String・Double・null。Android の rawQuery は値を文字列で束ねるので、数の比較を WHERE に書かない */
    fun query(sql: String, args: List<Any?> = emptyList()): List<Map<String, Any?>>

    /** まとめて 1 つのトランザクションで流す。どれかが失敗すれば全部戻る */
    fun batch(statements: List<SqlStatement>)
}

class AndroidSyncSql(private val db: () -> SQLiteDatabase) : SyncSql {
    override fun exec(sql: String, args: List<Any?>) = db().execSQL(sql, args.toTypedArray())

    override fun query(sql: String, args: List<Any?>): List<Map<String, Any?>> =
        db().rawQuery(sql, args.map { it?.toString() }.toTypedArray()).use { c ->
            buildList {
                while (c.moveToNext()) add((0 until c.columnCount).associate { i -> c.getColumnName(i) to c.valueAt(i) })
            }
        }

    private fun Cursor.valueAt(i: Int): Any? = when (getType(i)) {
        Cursor.FIELD_TYPE_NULL -> null
        Cursor.FIELD_TYPE_INTEGER -> getLong(i)
        Cursor.FIELD_TYPE_FLOAT -> getDouble(i)
        else -> getString(i)
    }

    override fun batch(statements: List<SqlStatement>) {
        val d = db()
        d.beginTransaction()
        try {
            for (s in statements) d.execSQL(s.sql, s.args.toTypedArray())
            d.setTransactionSuccessful()
        } finally {
            d.endTransaction()
        }
    }
}

data class StoredRecord(
    val recordId: String,
    val kind: String,
    val kindTag: String,
    val schemaVersion: Long,
    val payload: SyncPayload,
    val version: Long,
    val pending: Boolean,
    val priority: Long,
    val needsApply: Boolean,
    val refBoard: String?,
    val refThread: String?,
    val refDetail: String?,
    val refLocal: Long?,
    val tombAt: Long?,
)

class SyncOpRow(val seq: Long, val op: String, val target: String, val num: Long?, val args: String?, val atMs: Long)

class RecordRefs(val board: String? = null, val thread: String? = null, val detail: String? = null, val local: Long? = null) {
    /** 一度分かった ref は消さない。tombstone は本文を残さないので、ここから何のレコードかを知る */
    fun over(old: RecordRefs?) = RecordRefs(board ?: old?.board, thread ?: old?.thread, detail ?: old?.detail, local ?: old?.local)
}

val StoredRecord.refs get() = RecordRefs(refBoard, refThread, refDetail, refLocal)

private const val COLUMNS = "record_id, kind, kind_tag, schema_version, payload, hlc, deleted, version, pending, priority, needs_apply, ref_board, ref_thread, ref_detail, ref_local, tomb_at"

fun isDeleted(p: SyncPayload) = p["deleted"] == true

fun StoredRecord.asLocal() = LocalRecord(payload, version, tombAt)

fun writeRecord(r: StoredRecord) = SqlStatement(
    "INSERT OR REPLACE INTO sync_records ($COLUMNS) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    listOf(
        r.recordId, r.payload["kind"], r.kindTag, r.schemaVersion, canonicalJson(r.payload), r.payload["hlc"], if (isDeleted(r.payload)) 1L else 0L, r.version,
        if (r.pending) 1L else 0L, r.priority, if (r.needsApply) 1L else 0L, r.refBoard, r.refThread, r.refDetail, r.refLocal, r.tombAt,
    ),
)

fun setState(key: String, value: String) = SqlStatement("INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)", listOf(key, value))
fun delState(key: String) = SqlStatement("DELETE FROM sync_state WHERE key = ?", listOf(key))
fun delRecord(id: String) = SqlStatement("DELETE FROM sync_records WHERE record_id = ?", listOf(id))
/**
 * 処理した操作を消す。読んだ時点と同じ値の行だけを消す。既読は同じ行を上書きして 1 行にまとめるので、
 * 読んでから消すまでの間に進んだ値を、送らないまま消さないように(残った行は次の drain で送る)
 */
fun delOp(op: SyncOpRow) = SqlStatement("DELETE FROM sync_ops WHERE seq = ? AND num IS ? AND at_ms = ?", listOf(op.seq, op.num, op.atMs))
fun clearNeedsApply(id: String) = SqlStatement("UPDATE sync_records SET needs_apply = 0 WHERE record_id = ?", listOf(id))

/** minSdk 26 の SQLite は 1 つの文のプレースホルダーが 999 個まで */
private const val SQL_VARS_MAX = 900

class SyncTables(val db: SyncSql) {
    private fun marks(n: Int) = List(n) { "?" }.joinToString(", ")

    @Suppress("UNCHECKED_CAST")
    private fun fromRow(r: Map<String, Any?>) = StoredRecord(
        recordId = r["record_id"] as String,
        kind = r["kind"] as String,
        kindTag = r["kind_tag"] as String,
        schemaVersion = r["schema_version"] as Long,
        payload = parseStrictJson(r["payload"] as String) as SyncPayload,
        version = r["version"] as Long,
        pending = r["pending"] == 1L,
        priority = r["priority"] as Long,
        needsApply = r["needs_apply"] == 1L,
        refBoard = r["ref_board"] as String?,
        refThread = r["ref_thread"] as String?,
        refDetail = r["ref_detail"] as String?,
        refLocal = r["ref_local"] as Long?,
        tombAt = r["tomb_at"] as Long?,
    )

    fun state(key: String): String? = db.query("SELECT value FROM sync_state WHERE key = ?", listOf(key)).firstOrNull()?.get("value") as String?

    fun record(id: String): StoredRecord? = db.query("SELECT $COLUMNS FROM sync_records WHERE record_id = ?", listOf(id)).firstOrNull()?.let(::fromRow)

    fun records(ids: Collection<String>): MutableMap<String, StoredRecord> {
        val out = LinkedHashMap<String, StoredRecord>()
        val unique = ids.distinct()
        for (chunk in unique.chunked(SQL_VARS_MAX)) {
            for (r in db.query("SELECT $COLUMNS FROM sync_records WHERE record_id IN (${marks(chunk.size)})", chunk)) fromRow(r).let { out[it.recordId] = it }
        }
        return out
    }

    fun allRecords(): List<StoredRecord> = db.query("SELECT $COLUMNS FROM sync_records ORDER BY record_id").map(::fromRow)

    fun recordsOfKind(kind: String): List<StoredRecord> = db.query("SELECT $COLUMNS FROM sync_records WHERE kind = ? ORDER BY record_id", listOf(kind)).map(::fromRow)

    fun selectRecords(where: String, args: List<Any?>): List<StoredRecord> = db.query("SELECT $COLUMNS FROM sync_records WHERE $where", args).map(::fromRow)

    /** except は切っている種類。送信待ちのまま残し、送らない */
    fun pendingRecords(limit: Int, except: Collection<String> = emptyList()): List<StoredRecord> {
        val skip = if (except.isEmpty()) "" else "AND kind NOT IN (${marks(except.size)}) "
        return db.query("SELECT $COLUMNS FROM sync_records WHERE pending = 1 ${skip}ORDER BY priority, hlc, record_id LIMIT ?", except.toList<Any?>() + limit.toLong()).map(::fromRow)
    }

    /** 写す順を決めておく。afterId より後を返すので、飛ばした行を読み直さない */
    fun toApply(kinds: List<String>, afterId: String, limit: Int): List<StoredRecord> {
        if (kinds.isEmpty()) return emptyList()
        return db.query(
            "SELECT $COLUMNS FROM sync_records WHERE needs_apply = 1 AND record_id > ? AND kind IN (${marks(kinds.size)}) ORDER BY record_id LIMIT ?",
            listOf<Any?>(afterId) + kinds + limit.toLong(),
        ).map(::fromRow)
    }

    /**
     * 送信待ちの数。切っている種類のレコードは送らないので数えない。sync_ops は処理できる操作(names)だけを数える
     * (新しい版で積んだ操作が残った DB を開いても「送信待ちあり」が続かないように)
     */
    fun pendingCount(offKinds: Collection<String>, names: Collection<String>): Long {
        val records = "SELECT COUNT(*) FROM sync_records WHERE pending = 1" + if (offKinds.isEmpty()) "" else " AND kind NOT IN (${marks(offKinds.size)})"
        val ops = if (names.isEmpty()) "SELECT 0" else "SELECT COUNT(*) FROM sync_ops WHERE op IN (${marks(names.size)})"
        return db.query("SELECT ($records) + ($ops) AS n", offKinds.toList<Any?>() + names.toList()).firstOrNull()?.get("n") as Long? ?: 0L
    }

    fun ops(names: List<String>, limit: Int): List<SyncOpRow> {
        if (names.isEmpty()) return emptyList()
        return db.query("SELECT seq, op, target, num, args, at_ms FROM sync_ops WHERE op IN (${marks(names.size)}) ORDER BY seq LIMIT ?", names + limit.toLong()).map {
            SyncOpRow(it["seq"] as Long, it["op"] as String, it["target"] as String, it["num"] as Long?, it["args"] as String?, it["at_ms"] as Long)
        }
    }
}
