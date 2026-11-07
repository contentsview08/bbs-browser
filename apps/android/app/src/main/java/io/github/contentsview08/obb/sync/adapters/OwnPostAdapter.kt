package io.github.contentsview08.obb.sync.adapters

import io.github.contentsview08.obb.sync.Hlc
import io.github.contentsview08.obb.sync.SyncPayload
import io.github.contentsview08.obb.sync.body
import io.github.contentsview08.obb.sync.canonicalJson
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

// 自分のレスの印。ID は own_post:<板>:<スレ>:<no>。書き込みで付いた印も手で付けた印も同じレコードで、外すと tombstone

const val OWN_POST_KIND = "own_post"
const val OWN_ADD = "own_add"
const val OWN_REMOVE = "own_remove"
const val AREA_OWN_POSTS = "ownPosts"

/** 書き込み履歴と同じ系統なので同じ順で送る */
private const val SEED_PRIORITY = 3L
private const val COLUMNS = "board_url, key, no, posted_at"

private class OwnRow(val boardUrl: String, val key: String, val no: Long, val postedAt: Long)

private class OwnArgs(val boardUrl: String, val key: String, val no: Long)

private fun rowOf(r: Map<String, Any?>) = OwnRow(r["board_url"] as String, r["key"] as String, r["no"] as Long, r["posted_at"] as Long)

private fun targetOf(ctx: AdapterContext, a: OwnArgs): OpTarget? {
    val board = normalizeBoardUrl(a.boardUrl)
    if (board == null || a.key.isEmpty() || a.no < 0) return null
    val detail = a.no.toString()
    return OpTarget(recordId(ctx.keys.kId, OWN_POST_KIND, a.boardUrl, a.key, detail), RecordRefs(board, a.key, detail))
}

private fun bodyOf(r: OwnRow): Map<String, Any?> = mapOf("board_url" to r.boardUrl, "thread" to r.key, "no" to r.no, "posted_at" to r.postedAt)

private fun argsOf(op: SyncOpRow): OwnArgs? = try {
    val a = parseStrictJson(op.args.orEmpty()) as? Map<*, *>
    val board = a?.get("board_url") as? String
    val key = a?.get("key") as? String
    val no = a?.get("no") as? Long
    if (board != null && key != null && no != null) OwnArgs(board, key, no) else null
} catch (_: Exception) {
    null
}

/** tombstone は本文を持たないので、覚えた ref から番号を読む */
private fun noOf(r: StoredRecord): Long? = r.refDetail?.toLongOrNull()

private val NOTHING = ApplyPlan(emptyList(), false)

class OwnPostAdapter(private val db: SyncSql, private val resolve: (String) -> ResolvedBoard?) : SyncAdapter {
    override val kind = OWN_POST_KIND
    override val area = AREA_OWN_POSTS
    override val ops = listOf(OWN_ADD, OWN_REMOVE)
    override val reconciles = false

    override fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget? = argsOf(op)?.let { targetOf(ctx, it) }

    /** スレのキーで引いてから板と番号を比べる(数の比較を WHERE に書かない。rawQuery は値を文字列で束ねる)。URL の揺れはここで吸収される */
    private fun rowsOf(board: String?, key: String?, no: Long?): List<OwnRow> {
        if (board == null || key == null || no == null) return emptyList()
        return db.query("SELECT $COLUMNS FROM own_posts WHERE key = ?", listOf(key)).map(::rowOf).filter { it.no == no && normalizeBoardUrl(it.boardUrl) == board }
    }

    override fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload? {
        val a = argsOf(op)!!
        if (op.op == OWN_REMOVE) return makeTombstone(existing ?: mapOf("kind" to OWN_POST_KIND, "hlc" to stamp, "device_id" to ctx.deviceId), stamp, ctx.deviceId)
        val row = rowsOf(normalizeBoardUrl(a.boardUrl), a.key, a.no).firstOrNull() ?: return null
        return updateRecord(existing, OWN_POST_KIND, bodyOf(row), stamp, ctx.deviceId)
    }

    override fun fill(ctx: AdapterContext): List<SeedRow> = seed(ctx)

    override fun seed(ctx: AdapterContext): List<SeedRow> {
        val seen = HashSet<String>()
        return db.query("SELECT $COLUMNS FROM own_posts ORDER BY posted_at DESC, board_url, key, no").mapNotNull {
            val r = rowOf(it)
            val t = targetOf(ctx, OwnArgs(r.boardUrl, r.key, r.no)) ?: return@mapNotNull null
            if (!seen.add(t.recordId)) return@mapNotNull null
            val hlc = Hlc.format(maxOf(1L, minOf(r.postedAt, ctx.now)), 0, ctx.deviceId)
            val payload = mapOf("kind" to OWN_POST_KIND, "hlc" to hlc, "device_id" to ctx.deviceId, "body" to bodyOf(r))
            if (checkPayload(payload) == null) null else SeedRow(t.recordId, t.refs, payload, SEED_PRIORITY)
        }
    }

    override fun detailOf(p: SyncPayload): String? = (p.body?.get("no") as? Long)?.toString()

    override fun owns(r: StoredRecord) = r.refDetail != null

    override fun exists(r: StoredRecord) = rowsOf(r.refBoard, r.refThread, noOf(r)).isNotEmpty()

    override fun remove(r: StoredRecord): ApplyPlan {
        val rows = rowsOf(r.refBoard, r.refThread, noOf(r))
        return ApplyPlan(rows.map { SqlStatement("DELETE FROM own_posts WHERE board_url = ? AND key = ? AND no = ?", listOf(it.boardUrl, it.key, it.no)) }, rows.isNotEmpty())
    }

    /** スレの行がなくても入れる(印はログと独立で、ログを消しても残る) */
    override fun apply(r: StoredRecord, ctx: AdapterContext): ApplyPlan {
        if (r.payload["deleted"] == true) return if (r.payload["trim"] == true) NOTHING else remove(r)
        val body = r.payload.body.orEmpty()
        val no = noOf(r) ?: return NOTHING
        if (exists(r)) return NOTHING
        val resolved = resolve(body["board_url"] as String) ?: return NOTHING
        val postedAt = body["posted_at"] as? Long ?: ctx.now
        return ApplyPlan(
            listOf(SqlStatement("INSERT OR IGNORE INTO own_posts (board_url, key, no, posted_at) VALUES (?, ?, ?, ?)", listOf(resolved.boardUrl, r.refThread, no, postedAt))),
            true,
        )
    }

    override fun localLines(ctx: AdapterContext): List<String> {
        val lines = LinkedHashSet<String>()
        for (x in db.query("SELECT $COLUMNS FROM own_posts")) {
            val r = rowOf(x)
            val board = normalizeBoardUrl(r.boardUrl) ?: continue
            lines += canonicalJson(listOf(board, r.key, r.no))
        }
        return lines.toList()
    }
}
