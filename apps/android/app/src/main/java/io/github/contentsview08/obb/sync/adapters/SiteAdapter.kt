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

// サイト(BBS メニュー)。ID は site:::<正規化したメニューの URL>。本文は生の URL を書く

const val SITE_KIND = "site"
const val SITE_ADD = "site_add"
const val SITE_REMOVE = "site_remove"
const val AREA_SITES = "sites"
private const val NAME_MAX = 256
private const val SEED_PRIORITY = 1L
private const val SEED_WALL = 1L

class SiteAdapter(
    private val db: SyncSql,
    /** この端末で扱えないサイトは null(同期の表にだけ持つ) */
    private val resolve: (String) -> String?,
) : SyncAdapter {
    override val kind = SITE_KIND
    override val area = AREA_SITES
    override val ops = listOf(SITE_ADD, SITE_REMOVE)
    override val reconciles = false

    private fun targetOf(ctx: AdapterContext, menuUrl: String): OpTarget? {
        val detail = normalizeBoardUrl(menuUrl) ?: return null
        return OpTarget(recordId(ctx.keys.kId, SITE_KIND, null, "", detail), RecordRefs(detail = detail))
    }

    private fun bodyOf(menuUrl: String, name: String): Map<String, Any?> = buildMap {
        put("menu_url", menuUrl)
        if (name.isNotEmpty()) put("name", name.take(NAME_MAX))
    }

    private fun urlOf(op: SyncOpRow): String? = try {
        (parseStrictJson(op.args.orEmpty()) as? Map<*, *>)?.get("menu_url") as? String
    } catch (_: Exception) {
        null
    }

    override fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget? = urlOf(op)?.let { targetOf(ctx, it) }

    override fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload? {
        if (op.op == SITE_REMOVE) return makeTombstone(existing ?: mapOf("kind" to SITE_KIND, "hlc" to stamp, "device_id" to ctx.deviceId), stamp, ctx.deviceId)
        val url = urlOf(op) ?: return null
        val row = db.query("SELECT name FROM sites WHERE menu_url = ?", listOf(url)).firstOrNull() ?: return null
        return updateRecord(existing, SITE_KIND, bodyOf(url, row["name"] as String), stamp, ctx.deviceId)
    }

    override fun seed(ctx: AdapterContext): List<SeedRow> {
        val hlc = Hlc.format(SEED_WALL, 0, ctx.deviceId)
        return db.query("SELECT menu_url, name FROM sites ORDER BY sort").mapNotNull {
            val url = it["menu_url"] as String
            val t = targetOf(ctx, url) ?: return@mapNotNull null
            val payload = mapOf("kind" to SITE_KIND, "hlc" to hlc, "device_id" to ctx.deviceId, "body" to bodyOf(url, it["name"] as String))
            if (checkPayload(payload) == null) null else SeedRow(t.recordId, t.refs, payload, SEED_PRIORITY)
        }
    }

    override fun detailOf(p: SyncPayload): String? = (p.body?.get("menu_url") as? String)?.let(::normalizeBoardUrl)

    private fun localRows(r: StoredRecord) = db.query("SELECT menu_url, name FROM sites").filter { normalizeBoardUrl(it["menu_url"] as String) == r.refDetail }

    override fun owns(r: StoredRecord) = r.refDetail != null

    override fun exists(r: StoredRecord) = localRows(r).isNotEmpty()

    override fun remove(r: StoredRecord): ApplyPlan {
        val rows = localRows(r)
        return ApplyPlan(
            rows.flatMap {
                listOf(SqlStatement("DELETE FROM boards WHERE site_menu_url = ?", listOf(it["menu_url"])), SqlStatement("DELETE FROM sites WHERE menu_url = ?", listOf(it["menu_url"])))
            },
            rows.isNotEmpty(),
        )
    }

    override fun apply(r: StoredRecord, ctx: AdapterContext): ApplyPlan {
        if (r.payload["deleted"] == true) return if (r.payload["trim"] == true) ApplyPlan(emptyList(), false) else remove(r)
        val body = r.payload.body.orEmpty()
        val url = body["menu_url"] as String
        val name = body["name"] as? String ?: ""
        val rows = localRows(r)
        if (rows.isNotEmpty()) {
            val stale = if (name.isEmpty()) emptyList() else rows.filter { it["name"] != name }
            return ApplyPlan(stale.map { SqlStatement("UPDATE sites SET name = ? WHERE menu_url = ?", listOf(name, it["menu_url"])) }, stale.isNotEmpty())
        }
        val connector = resolve(url) ?: return ApplyPlan(emptyList(), false)
        return ApplyPlan(
            listOf(SqlStatement("INSERT OR IGNORE INTO sites (menu_url, connector_id, name, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM sites))", listOf(url, connector, name.ifEmpty { url }))),
            true,
        )
    }
}
