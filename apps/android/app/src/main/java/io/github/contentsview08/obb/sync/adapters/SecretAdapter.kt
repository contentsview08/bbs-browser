package io.github.contentsview08.obb.sync.adapters

import io.github.contentsview08.obb.sync.Hlc
import io.github.contentsview08.obb.sync.SyncPayload
import io.github.contentsview08.obb.sync.body
import io.github.contentsview08.obb.sync.checkPayload
import io.github.contentsview08.obb.sync.engine.RecordRefs
import io.github.contentsview08.obb.sync.engine.SECRET_KIND
import io.github.contentsview08.obb.sync.engine.SqlStatement
import io.github.contentsview08.obb.sync.engine.StoredRecord
import io.github.contentsview08.obb.sync.engine.SyncOpRow
import io.github.contentsview08.obb.sync.engine.SyncSql
import io.github.contentsview08.obb.sync.engine.SyncTables
import io.github.contentsview08.obb.sync.makeTombstone
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.recordId
import io.github.contentsview08.obb.sync.updateRecord

// 権限系(画像の削除ページの URL)。k_secret で暗号化する。スイッチがオンの端末だけが積み、読む。ID は secret:::<URL>

const val SECRET_PUT = "secret_put"
const val SECRET_REMOVE = "secret_remove"
private const val SEED_PRIORITY = 4L

class SecretAdapter(private val db: SyncSql) : SyncAdapter {
    private val tables = SyncTables(db)
    override val kind = SECRET_KIND
    override val area = AREA_UPLOADS
    override val ops = listOf(SECRET_PUT, SECRET_REMOVE)
    override val reconciles = false
    override val seedsAll = false

    private fun targetOf(ctx: AdapterContext, url: String) = OpTarget(recordId(ctx.keys.kId, SECRET_KIND, null, "", url), RecordRefs(detail = url))

    private fun urlOf(op: SyncOpRow): String? = try {
        (parseStrictJson(op.args.orEmpty()) as? Map<*, *>)?.get("url") as? String
    } catch (_: Exception) {
        null
    }

    override fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget? = urlOf(op)?.let { targetOf(ctx, it) }

    /** 値は操作に書かず、ここで今のデータから読む(sync_ops に残さない) */
    override fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload? {
        if (op.op == SECRET_REMOVE) return makeTombstone(existing ?: mapOf("kind" to SECRET_KIND, "hlc" to stamp, "device_id" to ctx.deviceId), stamp, ctx.deviceId)
        val row = db.query("SELECT url, delete_url FROM uploads WHERE url = ?", listOf(urlOf(op))).firstOrNull() ?: return null
        val value = row["delete_url"] as? String ?: return null
        return updateRecord(existing, SECRET_KIND, mapOf("url" to row["url"], "value" to value), stamp, ctx.deviceId)
    }

    override fun seed(ctx: AdapterContext): List<SeedRow> =
        db.query("SELECT url, delete_url, uploaded_at FROM uploads WHERE delete_url IS NOT NULL ORDER BY uploaded_at DESC, url").mapNotNull {
            val hlc = Hlc.format(maxOf(1L, minOf(it["uploaded_at"] as Long, ctx.now)), 0, ctx.deviceId)
            val payload = mapOf("kind" to SECRET_KIND, "hlc" to hlc, "device_id" to ctx.deviceId, "body" to mapOf("url" to it["url"], "value" to it["delete_url"]))
            if (checkPayload(payload) == null) return@mapNotNull null
            val t = targetOf(ctx, it["url"] as String)
            SeedRow(t.recordId, t.refs, payload, SEED_PRIORITY)
        }

    override fun fill(ctx: AdapterContext): List<SeedRow> = seed(ctx)

    override fun detailOf(p: SyncPayload): String? = p.body?.get("url") as? String

    override fun owns(r: StoredRecord) = r.refDetail != null

    /** 画像の行に付く値なので、大量削除の確認の数に入れない */
    override fun exists(r: StoredRecord) = false

    /** 手元の値は画像を消すときに一緒に消える */
    override fun remove(r: StoredRecord) = ApplyPlan(emptyList(), false)

    /** 画像の行より先に届くことがあるので、周の最後にまとめて写す */
    override fun apply(r: StoredRecord, ctx: AdapterContext) = ApplyPlan(emptyList(), false)

    override fun differs(r: StoredRecord, ctx: AdapterContext): Boolean {
        if (r.payload["deleted"] == true) return false
        val row = db.query("SELECT delete_url FROM uploads WHERE url = ?", listOf(r.refDetail)).firstOrNull() ?: return false
        return row["delete_url"] != r.payload.body?.get("value")
    }

    override fun afterApply(ctx: AdapterContext): ApplyPlan {
        val statements = tables.recordsOfKind(SECRET_KIND).filter { !it.needsApply && differs(it, ctx) }.map {
            SqlStatement("UPDATE uploads SET delete_url = ? WHERE url = ?", listOf(it.payload.body?.get("value"), it.refDetail))
        }
        return ApplyPlan(statements, statements.isNotEmpty())
    }
}
