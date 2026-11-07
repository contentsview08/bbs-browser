package io.github.contentsview08.obb.sync.adapters

import io.github.contentsview08.obb.sync.Hlc
import io.github.contentsview08.obb.sync.SyncPayload
import io.github.contentsview08.obb.sync.body
import io.github.contentsview08.obb.sync.checkPayload
import io.github.contentsview08.obb.sync.engine.RecordRefs
import io.github.contentsview08.obb.sync.engine.SqlStatement
import io.github.contentsview08.obb.sync.engine.StoredRecord
import io.github.contentsview08.obb.sync.engine.SyncOpRow
import io.github.contentsview08.obb.sync.engine.SyncSql
import io.github.contentsview08.obb.sync.makeTombstone
import io.github.contentsview08.obb.sync.normalizeBoardUrl
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.recordId
import io.github.contentsview08.obb.sync.updateRecord

// お気に入りのスレ。ID は favorite:<板>:<キー>。お気に入り板は同じ kind で thread がない

const val FAVORITE_KIND = "favorite"
const val FAVORITE_THREAD_ADD = "favorite_thread_add"
const val FAVORITE_THREAD_REMOVE = "favorite_thread_remove"
const val AREA_FAVORITE_THREADS = "favoriteThreads"
private const val TITLE_MAX = 1024
private const val SEED_PRIORITY = 1L
private const val TITLE_SQL = "COALESCE(NULLIF((SELECT t.title FROM threads AS t WHERE t.board_url = f.board_url AND t.key = f.key), ''), f.title) AS title"

class ResolvedBoard(val boardUrl: String, val connectorId: String)

private class LocalRow(val boardUrl: String, val key: String, val title: String, val createdAt: Long?, val addedAt: Long)

class FavoriteThreadAdapter(
    private val db: SyncSql,
    /** 今の正しい URL とコネクタを親が決める。この端末で扱えない板は null(同期の表にだけ持つ) */
    private val resolve: (String) -> ResolvedBoard?,
) : SyncAdapter {
    override val kind = FAVORITE_KIND
    override val area = AREA_FAVORITE_THREADS
    override val ops = listOf(FAVORITE_THREAD_ADD, FAVORITE_THREAD_REMOVE)

    private fun targetOf(ctx: AdapterContext, boardUrl: String, key: String): OpTarget? {
        val board = normalizeBoardUrl(boardUrl)
        if (board == null || key.isEmpty()) return null
        return OpTarget(recordId(ctx.keys.kId, FAVORITE_KIND, boardUrl, key), RecordRefs(board, key))
    }

    private fun argsOf(op: SyncOpRow): Pair<String, String>? = try {
        val a = parseStrictJson(op.args.orEmpty()) as? Map<*, *>
        val board = a?.get("board_url") as? String
        val key = a?.get("key") as? String
        if (board != null && key != null) board to key else null
    } catch (_: Exception) {
        null
    }

    override fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget? = argsOf(op)?.let { (b, k) -> targetOf(ctx, b, k) }

    private fun row(r: Map<String, Any?>) = LocalRow(r["board_url"] as String, r["key"] as String, r["title"] as String, r["created_at"] as Long?, r["added_at"] as Long)

    /** ID の入力に使った値を本文に持つ。スレタイの空は手元を残す印なので書かない */
    private fun bodyOf(r: LocalRow): Map<String, Any?> = buildMap {
        put("board_url", r.boardUrl)
        put("thread", r.key)
        if (r.title.isNotEmpty()) put("title", r.title.take(TITLE_MAX))
        if (r.createdAt != null) put("created_at", r.createdAt)
    }

    override fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload? {
        if (op.op == FAVORITE_THREAD_REMOVE) {
            return makeTombstone(existing ?: mapOf("kind" to FAVORITE_KIND, "hlc" to stamp, "device_id" to ctx.deviceId), stamp, ctx.deviceId)
        }
        val (board, key) = argsOf(op) ?: return null
        val found = db.query("SELECT f.board_url, f.key, $TITLE_SQL, f.created_at, f.added_at FROM favorite_threads AS f WHERE f.board_url = ? AND f.key = ?", listOf(board, key)).firstOrNull()
            ?: return null
        return updateRecord(existing, FAVORITE_KIND, bodyOf(row(found)), stamp, ctx.deviceId)
    }

    override fun seed(ctx: AdapterContext): List<SeedRow> =
        db.query("SELECT f.board_url, f.key, $TITLE_SQL, f.created_at, f.added_at FROM favorite_threads AS f ORDER BY f.sort, f.added_at").mapNotNull {
            val r = row(it)
            val t = targetOf(ctx, r.boardUrl, r.key) ?: return@mapNotNull null
            val hlc = Hlc.format(maxOf(1L, minOf(r.addedAt, ctx.now)), 0, ctx.deviceId)
            val payload = mapOf("kind" to FAVORITE_KIND, "hlc" to hlc, "device_id" to ctx.deviceId, "body" to bodyOf(r))
            // 受け取る側の検査に落ちるものは送らない(長すぎるキーなど)。手元には残る
            if (checkPayload(payload) == null) null else SeedRow(t.recordId, t.refs, payload, SEED_PRIORITY)
        }

    /** 手元の URL は端末で違うことがあるので、キーで引いて正規化した値で比べる */
    private fun localRows(r: StoredRecord): List<Map<String, Any?>> =
        db.query("SELECT board_url, title FROM favorite_threads WHERE key = ?", listOf(r.refThread)).filter { normalizeBoardUrl(it["board_url"] as String) == r.refBoard }

    override fun owns(r: StoredRecord) = !r.refThread.isNullOrEmpty()

    override fun exists(r: StoredRecord) = localRows(r).isNotEmpty()

    override fun remove(r: StoredRecord): ApplyPlan {
        val rows = localRows(r)
        return ApplyPlan(rows.map { SqlStatement("DELETE FROM favorite_threads WHERE board_url = ? AND key = ?", listOf(it["board_url"], r.refThread)) }, rows.isNotEmpty())
    }

    override fun localLines(ctx: AdapterContext): List<String> =
        db.query("SELECT board_url, key FROM favorite_threads").map { "${normalizeBoardUrl(it["board_url"] as String)}\t${it["key"]}" }

    override fun apply(r: StoredRecord, ctx: AdapterContext): ApplyPlan {
        // trim はサーバーから外すだけの印で、手元を消さない
        if (r.payload["deleted"] == true) return if (r.payload["trim"] == true) ApplyPlan(emptyList(), false) else remove(r)
        val body = r.payload.body.orEmpty()
        val title = body["title"] as? String ?: ""
        val rows = localRows(r)
        if (rows.isNotEmpty()) {
            val stale = if (title.isEmpty()) emptyList() else rows.filter { it["title"] != title }
            return ApplyPlan(stale.map { SqlStatement("UPDATE favorite_threads SET title = ? WHERE board_url = ? AND key = ?", listOf(title, it["board_url"], r.refThread)) }, stale.isNotEmpty())
        }
        val resolved = resolve(body["board_url"] as String) ?: return ApplyPlan(emptyList(), false)
        return ApplyPlan(
            listOf(
                SqlStatement(
                    "INSERT OR IGNORE INTO favorite_threads (board_url, key, connector_id, title, created_at, sort, added_at) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM favorite_threads), ?)",
                    listOf(resolved.boardUrl, r.refThread, resolved.connectorId, title.ifEmpty { r.refThread }, body["created_at"] as? Long, ctx.now),
                ),
            ),
            true,
        )
    }
}
