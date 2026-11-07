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
import io.github.contentsview08.obb.sync.fitPostBody
import io.github.contentsview08.obb.sync.makeTombstone
import io.github.contentsview08.obb.sync.normalizeBoardUrl
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.postIdOf
import io.github.contentsview08.obb.sync.recordId
import io.github.contentsview08.obb.sync.updateRecord
import io.github.contentsview08.obb.sync.utf8

// 書き込み履歴。ID は post:<板>:<スレ>:<post_id>。名前とメールは送らない(トリップが入るので)

const val POST_KIND = "post"
const val POST_ADD = "post_add"
const val POST_REMOVE = "post_remove"
const val AREA_POSTS = "posts"
private const val TITLE_MAX = 1024
private const val SEED_PRIORITY = 3L

/** 平文の上限より手前。スレタイを落とせば収まるようにする(本文は切ってあるので ID が変わらない) */
private const val PLAIN_BYTES = 15000
private const val COLUMNS = "id, board_url, key, thread_title, no, body, posted_at"

private class PostRow(val id: Long, val boardUrl: String, val key: String, val threadTitle: String, val no: Long?, val body: String, val postedAt: Long)

private class PostArgs(val boardUrl: String, val key: String, val postedAt: Long, val body: String)

private fun rowOf(r: Map<String, Any?>) = PostRow(r["id"] as Long, r["board_url"] as String, r["key"] as String, r["thread_title"] as String, r["no"] as Long?, r["body"] as String, r["posted_at"] as Long)

private fun targetOf(ctx: AdapterContext, a: PostArgs): OpTarget? {
    val board = normalizeBoardUrl(a.boardUrl)
    if (board == null || a.key.isEmpty()) return null
    val postId = postIdOf(board, a.key, a.postedAt, a.body)
    return OpTarget(recordId(ctx.keys.kId, POST_KIND, a.boardUrl, a.key, postId), RecordRefs(board, a.key, postId))
}

private fun bodyOf(r: PostRow, postId: String, title: String): Map<String, Any?> = buildMap {
    put("post_id", postId)
    put("board_url", r.boardUrl)
    put("thread", r.key)
    if (title.isNotEmpty()) put("title", title.take(TITLE_MAX))
    if (r.no != null) put("no", r.no)
    put("body", fitPostBody(r.body))
    put("posted_at", r.postedAt)
}

private fun fitted(p: SyncPayload): SyncPayload {
    val body = p.body
    if (utf8(canonicalJson(p)).size <= PLAIN_BYTES || body == null || !body.containsKey("title")) return p
    return p + ("body" to (body - "title"))
}

private fun argsOf(op: SyncOpRow): PostArgs? = try {
    val a = parseStrictJson(op.args.orEmpty()) as? Map<*, *>
    val board = a?.get("board_url") as? String
    val key = a?.get("key") as? String
    val postedAt = a?.get("posted_at") as? Long
    val body = a?.get("body") as? String
    if (board != null && key != null && postedAt != null && body != null) PostArgs(board, key, postedAt, body) else null
} catch (_: Exception) {
    null
}

private fun ownPost(boardUrl: String, key: String, no: Long, postedAt: Long) =
    SqlStatement("INSERT OR IGNORE INTO own_posts (board_url, key, no, posted_at) VALUES (?, ?, ?, ?)", listOf(boardUrl, key, no, postedAt))

private val NOTHING = ApplyPlan(emptyList(), false)

class PostAdapter(private val db: SyncSql, private val resolve: (String) -> ResolvedBoard?) : SyncAdapter {
    override val kind = POST_KIND
    override val area = AREA_POSTS
    override val ops = listOf(POST_ADD, POST_REMOVE)
    override val reconciles = false

    override fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget? = argsOf(op)?.let { targetOf(ctx, it) }

    /** 同じ時刻の行は少ないので、時刻で引いてから ID で比べる。URL の揺れはここで吸収される */
    private fun rowsOf(postId: Any?, postedAt: Any?): List<PostRow> {
        if (postId !is String || postedAt !is Long) return emptyList()
        return db.query("SELECT $COLUMNS FROM post_history WHERE posted_at = ? ORDER BY id", listOf(postedAt)).map(::rowOf).filter {
            val board = normalizeBoardUrl(it.boardUrl)
            board != null && postIdOf(board, it.key, it.postedAt, it.body) == postId
        }
    }

    override fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload? {
        val a = argsOf(op)!!
        val postId = targetOf(ctx, a)!!.refs.detail!!
        if (op.op == POST_REMOVE) {
            // 手元の行を探すのに要る 2 つだけを残す(本文もスレタイも残さない)
            val tomb = makeTombstone(existing ?: mapOf("kind" to POST_KIND, "hlc" to stamp, "device_id" to ctx.deviceId), stamp, ctx.deviceId)
            return tomb + ("body" to mapOf("post_id" to postId, "posted_at" to a.postedAt))
        }
        val row = rowsOf(postId, a.postedAt).firstOrNull() ?: return null
        return fitted(updateRecord(existing, POST_KIND, bodyOf(row, postId, row.threadTitle), stamp, ctx.deviceId))
    }

    override fun seed(ctx: AdapterContext): List<SeedRow> {
        val seen = HashSet<String>()
        return db.query("SELECT $COLUMNS FROM post_history ORDER BY posted_at DESC, id DESC").mapNotNull {
            val r = rowOf(it)
            val t = targetOf(ctx, PostArgs(r.boardUrl, r.key, r.postedAt, r.body)) ?: return@mapNotNull null
            if (!seen.add(t.recordId)) return@mapNotNull null
            val hlc = Hlc.format(maxOf(1L, minOf(r.postedAt, ctx.now)), 0, ctx.deviceId)
            val payload = fitted(mapOf("kind" to POST_KIND, "hlc" to hlc, "device_id" to ctx.deviceId, "body" to bodyOf(r, t.refs.detail!!, r.threadTitle)))
            if (checkPayload(payload) == null) null else SeedRow(t.recordId, t.refs, payload, SEED_PRIORITY)
        }
    }

    override fun detailOf(p: SyncPayload): String? = p.body?.get("post_id") as? String

    override fun owns(r: StoredRecord) = r.refDetail != null

    override fun exists(r: StoredRecord) = rowsOf(r.refDetail, r.payload.body?.get("posted_at")).isNotEmpty()

    override fun remove(r: StoredRecord): ApplyPlan {
        val rows = rowsOf(r.refDetail, r.payload.body?.get("posted_at"))
        return ApplyPlan(rows.map { SqlStatement("DELETE FROM post_history WHERE id = ?", listOf(it.id)) }, rows.isNotEmpty())
    }

    /** 自分のレスの印は足すだけ。履歴から消しても消さない */
    override fun apply(r: StoredRecord, ctx: AdapterContext): ApplyPlan {
        if (r.payload["deleted"] == true) return if (r.payload["trim"] == true) NOTHING else remove(r)
        val body = r.payload.body.orEmpty()
        val postId = body["post_id"] as String
        val postedAt = body["posted_at"] as Long
        val title = body["title"] as? String ?: ""
        val no = body["no"] as? Long
        val rows = rowsOf(postId, postedAt)
        if (rows.isEmpty()) {
            val resolved = resolve(body["board_url"] as String) ?: return NOTHING
            return ApplyPlan(
                listOfNotNull(
                    SqlStatement(
                        "INSERT INTO post_history (connector_id, board_url, key, thread_title, no, name, mail, body, posted_at) VALUES (?, ?, ?, ?, ?, '', '', ?, ?)",
                        listOf(resolved.connectorId, resolved.boardUrl, r.refThread, title, no, body["body"], postedAt),
                    ),
                    no?.let { ownPost(resolved.boardUrl, r.refThread!!, it, postedAt) },
                ),
                true,
            )
        }
        val first = rows.first()
        val extra = rows.drop(1)
        val newTitle = title.ifEmpty { first.threadTitle }
        val newNo = no ?: first.no
        if (extra.isEmpty() && newTitle == first.threadTitle && newNo == first.no) return NOTHING
        return ApplyPlan(
            extra.map { SqlStatement("DELETE FROM post_history WHERE id = ?", listOf(it.id)) } +
                SqlStatement("UPDATE post_history SET thread_title = ?, no = ? WHERE id = ?", listOf(newTitle, newNo, first.id)) +
                listOfNotNull(newNo?.let { ownPost(first.boardUrl, first.key, it, postedAt) }),
            true,
        )
    }

    override fun localLines(ctx: AdapterContext): List<String> {
        val lines = LinkedHashSet<String>()
        for (x in db.query("SELECT $COLUMNS FROM post_history")) {
            val r = rowOf(x)
            val board = normalizeBoardUrl(r.boardUrl) ?: continue
            lines += canonicalJson(listOf(postIdOf(board, r.key, r.postedAt, r.body), r.no, r.threadTitle))
        }
        return lines.toList()
    }
}
