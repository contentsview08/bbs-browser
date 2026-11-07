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
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.recordId
import io.github.contentsview08.obb.sync.updateRecord

// 上げた画像の履歴。ID は image:::<URL>。テキストだけで、削除キーと手元のハッシュは送らない

const val IMAGE_KIND = "image"
const val UPLOAD_ADD = "upload_add"
const val UPLOAD_REMOVE = "upload_remove"
const val AREA_UPLOADS = "uploads"
private const val NAME_MAX = 1024
private const val SEED_PRIORITY = 4L
private const val COLUMNS = "url, name, size, uploaded_at"

class ImageAdapter(private val db: SyncSql) : SyncAdapter {
    override val kind = IMAGE_KIND
    override val area = AREA_UPLOADS
    override val ops = listOf(UPLOAD_ADD, UPLOAD_REMOVE)
    override val reconciles = false

    private fun targetOf(ctx: AdapterContext, url: String) = OpTarget(recordId(ctx.keys.kId, IMAGE_KIND, null, "", url), RecordRefs(detail = url))

    private fun bodyOf(r: Map<String, Any?>): Map<String, Any?> =
        mapOf("url" to r["url"], "file_name" to (r["name"] as String).take(NAME_MAX), "size" to r["size"], "uploaded_at" to r["uploaded_at"])

    private fun urlOf(op: SyncOpRow): String? = try {
        (parseStrictJson(op.args.orEmpty()) as? Map<*, *>)?.get("url") as? String
    } catch (_: Exception) {
        null
    }

    override fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget? = urlOf(op)?.let { targetOf(ctx, it) }

    private fun row(url: String?) = db.query("SELECT $COLUMNS FROM uploads WHERE url = ?", listOf(url)).firstOrNull()

    override fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload? {
        if (op.op == UPLOAD_REMOVE) return makeTombstone(existing ?: mapOf("kind" to IMAGE_KIND, "hlc" to stamp, "device_id" to ctx.deviceId), stamp, ctx.deviceId)
        val found = row(urlOf(op)) ?: return null
        return updateRecord(existing, IMAGE_KIND, bodyOf(found), stamp, ctx.deviceId)
    }

    override fun seed(ctx: AdapterContext): List<SeedRow> =
        db.query("SELECT $COLUMNS FROM uploads ORDER BY uploaded_at DESC, url").mapNotNull {
            val hlc = Hlc.format(maxOf(1L, minOf(it["uploaded_at"] as Long, ctx.now)), 0, ctx.deviceId)
            val payload = mapOf("kind" to IMAGE_KIND, "hlc" to hlc, "device_id" to ctx.deviceId, "body" to bodyOf(it))
            if (checkPayload(payload) == null) return@mapNotNull null
            val t = targetOf(ctx, it["url"] as String)
            SeedRow(t.recordId, t.refs, payload, SEED_PRIORITY)
        }

    override fun detailOf(p: SyncPayload): String? = p.body?.get("url") as? String

    override fun owns(r: StoredRecord) = r.refDetail != null

    override fun exists(r: StoredRecord) = row(r.refDetail) != null

    override fun remove(r: StoredRecord): ApplyPlan {
        val had = exists(r)
        return ApplyPlan(if (had) listOf(SqlStatement("DELETE FROM uploads WHERE url = ?", listOf(r.refDetail))) else emptyList(), had)
    }

    /** with_account は 0 で足す(その端末のアカウントで消せるとは限らない)。INSERT OR REPLACE は hash と削除キーを消すので使わない */
    override fun apply(r: StoredRecord, ctx: AdapterContext): ApplyPlan {
        if (r.payload["deleted"] == true) return if (r.payload["trim"] == true) ApplyPlan(emptyList(), false) else remove(r)
        val body = r.payload.body.orEmpty()
        val url = body["url"] as String
        val local = row(url)
        val name = body["file_name"] as? String ?: local?.get("name") as? String ?: ""
        val size = body["size"] as? Long ?: local?.get("size") as? Long ?: 0L
        val uploadedAt = body["uploaded_at"] as? Long ?: local?.get("uploaded_at") as? Long ?: ctx.now
        if (local != null && local["name"] == name && local["size"] == size && local["uploaded_at"] == uploadedAt) return ApplyPlan(emptyList(), false)
        return ApplyPlan(
            listOf(
                SqlStatement("UPDATE uploads SET name = ?, size = ?, uploaded_at = ? WHERE url = ?", listOf(name, size, uploadedAt, url)),
                SqlStatement("INSERT OR IGNORE INTO uploads (url, name, size, uploaded_at, with_account) VALUES (?, ?, ?, ?, 0)", listOf(url, name, size, uploadedAt)),
            ),
            true,
        )
    }
}
