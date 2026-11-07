package io.github.contentsview08.obb.sync.adapters

import io.github.contentsview08.obb.sync.Hlc
import io.github.contentsview08.obb.sync.Ordered
import io.github.contentsview08.obb.sync.ORDERED_COMPARATOR
import io.github.contentsview08.obb.sync.SyncPayload
import io.github.contentsview08.obb.sync.body
import io.github.contentsview08.obb.sync.checkPayload
import io.github.contentsview08.obb.sync.engine.RecordRefs
import io.github.contentsview08.obb.sync.engine.SqlStatement
import io.github.contentsview08.obb.sync.engine.StoredRecord
import io.github.contentsview08.obb.sync.engine.SyncOpRow
import io.github.contentsview08.obb.sync.engine.SyncSql
import io.github.contentsview08.obb.sync.engine.SyncTables
import io.github.contentsview08.obb.sync.isOrderKey
import io.github.contentsview08.obb.sync.makeTombstone
import io.github.contentsview08.obb.sync.normalizeBoardUrl
import io.github.contentsview08.obb.sync.orderKeyBetween
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.recordId
import io.github.contentsview08.obb.sync.updateRecord

// お気に入り板と並び順。ID は favorite:<板>: と order:<板>:。sort は順序キーから計算した写し

const val ORDER_KIND = "order"
const val FAVORITE_BOARD_ADD = "favorite_board_add"
const val FAVORITE_BOARD_REMOVE = "favorite_board_remove"
const val FAVORITE_BOARD_ORDER = "favorite_board_order"
const val AREA_FAVORITE_BOARDS = "favoriteBoards"
private const val NAME_MAX = 256
private const val SEED_PRIORITY = 1L
private const val SEED_WALL = 1L

/** これを超えたらリストを振り直す。桁が増え続けないように */
const val ORDER_KEY_REBUILD = 256

private fun targetOf(ctx: AdapterContext, kind: String, url: String): OpTarget? {
    val board = normalizeBoardUrl(url) ?: return null
    return OpTarget(recordId(ctx.keys.kId, kind, url, ""), RecordRefs(board))
}

private fun boardBody(url: String, name: String): Map<String, Any?> = buildMap {
    put("board_url", url)
    if (name.isNotEmpty()) put("board_name", name.take(NAME_MAX))
}

private fun tombstoneOf(existing: SyncPayload?, kind: String, stamp: String, ctx: AdapterContext) =
    makeTombstone(existing ?: mapOf("kind" to kind, "hlc" to stamp, "device_id" to ctx.deviceId), stamp, ctx.deviceId)

private class Keyed(val id: String, val board: String, val key: String)

/** 今のキーのうち、前後が変わらない最長の部分。キーが狭義に増える並びだけを残す */
private fun longestKept(keys: List<String?>): Set<Int> {
    val tails = ArrayList<Int>()
    val prev = IntArray(keys.size) { -1 }
    keys.forEachIndexed { i, k ->
        if (k == null) return@forEachIndexed
        var lo = 0
        var hi = tails.size
        while (lo < hi) {
            val mid = (lo + hi) ushr 1
            if (keys[tails[mid]]!! < k) lo = mid + 1 else hi = mid
        }
        if (lo > 0) prev[i] = tails[lo - 1]
        if (lo == tails.size) tails.add(i) else tails[lo] = i
    }
    val kept = HashSet<Int>()
    var i = tails.lastOrNull() ?: -1
    while (i >= 0) {
        kept += i
        i = prev[i]
    }
    return kept
}

/**
 * 新しい並びに必要なキー。動かなかった項目のキーは変えない(2 台が別の項目を動かしても、両方の結果が残る)。
 * 戻り値は位置 → 新しいキー
 */
fun planOrderKeys(keys: List<String?>): Map<Int, String> {
    val kept = longestKept(keys)
    val out = LinkedHashMap<Int, String>()
    var prev: String? = null
    for (i in keys.indices) {
        if (i in kept) {
            prev = keys[i]
            continue
        }
        val next = ((i + 1) until keys.size).firstOrNull { it in kept }?.let { keys[it] }
        prev = orderKeyBetween(prev, next)
        out[i] = prev
    }
    if (out.values.any { it.length > ORDER_KEY_REBUILD }) {
        val all = LinkedHashMap<Int, String>()
        var k: String? = null
        for (i in keys.indices) {
            k = orderKeyBetween(k, null)
            all[i] = k
        }
        return all
    }
    return out
}

class FavoriteBoardAdapter(private val db: SyncSql, private val resolve: (String) -> ResolvedBoard?) : SyncAdapter {
    override val kind = FAVORITE_KIND
    override val area = AREA_FAVORITE_BOARDS
    override val ops = listOf(FAVORITE_BOARD_ADD, FAVORITE_BOARD_REMOVE, FAVORITE_BOARD_ORDER)
    override val expands = true

    /** 適用で板か順序が変わった。sort の振り直しは周の最後に 1 回 */
    var dirty = false
    private val tables = SyncTables(db)

    private fun urlOf(op: SyncOpRow): String? = try {
        (parseStrictJson(op.args.orEmpty()) as? Map<*, *>)?.get("url") as? String
    } catch (_: Exception) {
        null
    }

    override fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget? =
        if (op.op == FAVORITE_BOARD_ORDER) null else urlOf(op)?.let { targetOf(ctx, FAVORITE_KIND, it) }

    override fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload? = null

    private fun keys(): List<Keyed> = tables.recordsOfKind(ORDER_KIND).mapNotNull { r ->
        val key = r.payload.body?.get("key")
        val board = r.refBoard
        if (r.payload["deleted"] != true && board != null && r.refThread.isNullOrEmpty() && isOrderKey(key)) Keyed(r.recordId, board, key as String) else null
    }

    private fun lastKey(list: List<Keyed>): String? = list.maxOfOrNull { it.key }

    private fun orderEffect(url: String, key: String, ctx: AdapterContext): OpEffect? {
        val target = targetOf(ctx, ORDER_KIND, url) ?: return null
        return OpEffect(target) { existing, stamp -> updateRecord(existing, ORDER_KIND, mapOf("board_url" to url, "key" to key), stamp, ctx.deviceId) }
    }

    override fun expand(op: SyncOpRow, ctx: AdapterContext): List<OpEffect>? {
        if (op.op == FAVORITE_BOARD_ORDER) return expandOrder(op, ctx)
        val url = urlOf(op) ?: return null
        val favorite = targetOf(ctx, FAVORITE_KIND, url) ?: return null
        val order = targetOf(ctx, ORDER_KIND, url) ?: return null
        if (op.op == FAVORITE_BOARD_REMOVE) {
            return listOf(
                OpEffect(favorite) { existing, stamp -> tombstoneOf(existing, FAVORITE_KIND, stamp, ctx) },
                OpEffect(order) { existing, stamp -> tombstoneOf(existing, ORDER_KIND, stamp, ctx) },
            )
        }
        val row = db.query("SELECT name FROM favorite_boards WHERE url = ?", listOf(url)).firstOrNull() ?: return emptyList()
        val name = row["name"] as String
        val out = arrayListOf(OpEffect(favorite) { existing, stamp -> updateRecord(existing, FAVORITE_KIND, boardBody(url, name), stamp, ctx.deviceId) })
        val keys = keys()
        if (keys.none { it.board == favorite.refs.board }) out += orderEffect(url, orderKeyBetween(lastKey(keys), null), ctx)!!
        return out
    }

    private fun expandOrder(op: SyncOpRow, ctx: AdapterContext): List<OpEffect>? {
        val urls = try {
            ((parseStrictJson(op.args.orEmpty()) as? Map<*, *>)?.get("urls") as? List<*>)?.map { it as String }
        } catch (_: Exception) {
            null
        } ?: return null
        val known = keys().associate { it.board to it.key }
        val items = urls.filter { normalizeBoardUrl(it) != null }
        return planOrderKeys(items.map { known[normalizeBoardUrl(it)] }).mapNotNull { (i, key) -> orderEffect(items[i], key, ctx) }
    }

    override fun seed(ctx: AdapterContext): List<SeedRow> {
        val rows = db.query("SELECT url, name FROM favorite_boards ORDER BY sort, name")
        val seen = tables.recordsOfKind(ORDER_KIND).map { it.refBoard }.toSet()
        var last = lastKey(keys())
        val hlc = Hlc.format(SEED_WALL, 0, ctx.deviceId)
        val out = ArrayList<SeedRow>()
        for (r in rows) {
            val url = r["url"] as String
            val favorite = targetOf(ctx, FAVORITE_KIND, url) ?: continue
            val order = targetOf(ctx, ORDER_KIND, url) ?: continue
            val payload = mapOf("kind" to FAVORITE_KIND, "hlc" to hlc, "device_id" to ctx.deviceId, "body" to boardBody(url, r["name"] as String))
            if (checkPayload(payload) == null) continue
            out += SeedRow(favorite.recordId, favorite.refs, payload, SEED_PRIORITY)
            // 領域に順序があれば、種まきのキーで崩さない。手元だけの項目は末尾に足す
            if (favorite.refs.board in seen) continue
            last = orderKeyBetween(last, null)
            out += SeedRow(order.recordId, order.refs, mapOf("kind" to ORDER_KIND, "hlc" to hlc, "device_id" to ctx.deviceId, "body" to mapOf("board_url" to url, "key" to last)), SEED_PRIORITY)
        }
        return out
    }

    private fun localRows(r: StoredRecord) = db.query("SELECT url, name FROM favorite_boards").filter { normalizeBoardUrl(it["url"] as String) == r.refBoard }

    override fun owns(r: StoredRecord) = r.refBoard != null && r.refThread.isNullOrEmpty()

    override fun exists(r: StoredRecord) = localRows(r).isNotEmpty()

    override fun remove(r: StoredRecord): ApplyPlan {
        val rows = localRows(r)
        if (rows.isNotEmpty()) dirty = true
        return ApplyPlan(rows.map { SqlStatement("DELETE FROM favorite_boards WHERE url = ?", listOf(it["url"])) }, rows.isNotEmpty())
    }

    override fun apply(r: StoredRecord, ctx: AdapterContext): ApplyPlan {
        if (r.payload["deleted"] == true) return if (r.payload["trim"] == true) ApplyPlan(emptyList(), false) else remove(r)
        val body = r.payload.body.orEmpty()
        val name = body["board_name"] as? String ?: ""
        val rows = localRows(r)
        if (rows.isNotEmpty()) {
            val stale = if (name.isEmpty()) emptyList() else rows.filter { it["name"] != name }
            return ApplyPlan(stale.map { SqlStatement("UPDATE favorite_boards SET name = ? WHERE url = ?", listOf(name, it["url"])) }, stale.isNotEmpty())
        }
        val resolved = resolve(body["board_url"] as String) ?: return ApplyPlan(emptyList(), false)
        dirty = true
        return ApplyPlan(
            listOf(
                SqlStatement(
                    "INSERT OR IGNORE INTO favorite_boards (url, connector_id, name, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM favorite_boards))",
                    listOf(resolved.boardUrl, resolved.connectorId, name.ifEmpty { resolved.boardUrl }),
                ),
            ),
            true,
        )
    }

    /** 順序のレコードで並べる。ない項目はある項目の後ろで、どの端末でも同じ順になるよう板 URL で決める */
    /** 並びまで比べる */
    override fun localLines(ctx: AdapterContext): List<String> =
        db.query("SELECT url, sort FROM favorite_boards").map { "${it["sort"]}\t${normalizeBoardUrl(it["url"] as String)}" }

    override fun afterApply(ctx: AdapterContext): ApplyPlan? {
        if (!dirty) return null
        dirty = false
        val rows = db.query("SELECT url, sort FROM favorite_boards ORDER BY sort, name")
        val keys = keys().associateBy { it.board }
        class Ranked(val url: String, val sort: Long, val board: String, val keyed: Ordered?)
        val ranked = rows.map {
            val url = it["url"] as String
            val board = normalizeBoardUrl(url) ?: url
            Ranked(url, it["sort"] as Long, board, keys[board]?.let { k -> Ordered(k.key, k.id) })
        }.sortedWith { a, b ->
            when {
                a.keyed != null && b.keyed != null -> ORDERED_COMPARATOR.compare(a.keyed, b.keyed)
                a.keyed != null -> -1
                b.keyed != null -> 1
                else -> a.board.compareTo(b.board)
            }
        }
        val statements = ranked.mapIndexedNotNull { i, r -> if (r.sort == i.toLong()) null else SqlStatement("UPDATE favorite_boards SET sort = ? WHERE url = ?", listOf(i.toLong(), r.url)) }
        return ApplyPlan(statements, statements.isNotEmpty())
    }
}

/** 順序のレコードの写し先は favorite_boards.sort。行を持たないので exists は false で、起動時の照合のたびに並べ直す */
class BoardOrderAdapter(private val boards: FavoriteBoardAdapter) : SyncAdapter {
    override val kind = ORDER_KIND
    override val area = AREA_FAVORITE_BOARDS
    override val ops = emptyList<String>()

    override fun target(op: SyncOpRow, ctx: AdapterContext): OpTarget? = null

    override fun fromOp(op: SyncOpRow, existing: SyncPayload?, stamp: String, ctx: AdapterContext): SyncPayload? = null

    override fun seed(ctx: AdapterContext) = emptyList<SeedRow>()

    override fun owns(r: StoredRecord) = r.refBoard != null && r.refThread.isNullOrEmpty()

    override fun exists(r: StoredRecord) = false

    override fun apply(r: StoredRecord, ctx: AdapterContext): ApplyPlan {
        boards.dirty = true
        return ApplyPlan(emptyList(), false)
    }

    override fun remove(r: StoredRecord): ApplyPlan {
        boards.dirty = true
        return ApplyPlan(emptyList(), false)
    }
}

fun favoriteBoardAdapters(db: SyncSql, resolve: (String) -> ResolvedBoard?): List<SyncAdapter> {
    val boards = FavoriteBoardAdapter(db, resolve)
    return listOf(boards, BoardOrderAdapter(boards))
}
