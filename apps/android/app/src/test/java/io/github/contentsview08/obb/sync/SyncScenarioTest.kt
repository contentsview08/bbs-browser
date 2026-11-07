package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.bbs.Board
import io.github.contentsview08.obb.data.FavoriteBoardSql
import io.github.contentsview08.obb.data.FavoriteThreadSql
import io.github.contentsview08.obb.data.NgRule
import io.github.contentsview08.obb.data.PostHistoryEntry
import io.github.contentsview08.obb.data.ThreadLogSql
import io.github.contentsview08.obb.data.SiteSql
import io.github.contentsview08.obb.data.SyncNgHost
import io.github.contentsview08.obb.data.UploadRecord
import io.github.contentsview08.obb.data.UploadSql
import io.github.contentsview08.obb.data.UserOps
import io.github.contentsview08.obb.data.applyNgDiff
import io.github.contentsview08.obb.data.ngDiff
import io.github.contentsview08.obb.data.ngRuleToBody
import io.github.contentsview08.obb.sync.adapters.FavoriteThreadAdapter
import io.github.contentsview08.obb.sync.adapters.HistoryHost
import io.github.contentsview08.obb.sync.adapters.PostAdapter
import io.github.contentsview08.obb.sync.adapters.SettingAdapter
import io.github.contentsview08.obb.sync.adapters.SettingAllowlist
import io.github.contentsview08.obb.sync.adapters.SettingsHost
import io.github.contentsview08.obb.sync.adapters.SyncAdapter
import io.github.contentsview08.obb.sync.adapters.AdapterContext
import io.github.contentsview08.obb.sync.adapters.historyAdapters
import io.github.contentsview08.obb.sync.adapters.restoreThreadRead
import io.github.contentsview08.obb.sync.engine.SqlStatement
import io.github.contentsview08.obb.sync.engine.syncMismatches
import io.github.contentsview08.obb.sync.engine.syncSummary
import io.github.contentsview08.obb.sync.adapters.ImageAdapter
import io.github.contentsview08.obb.sync.adapters.SecretAdapter
import io.github.contentsview08.obb.sync.adapters.NgAdapter
import io.github.contentsview08.obb.sync.adapters.SiteAdapter
import io.github.contentsview08.obb.sync.adapters.favoriteBoardAdapters
import io.github.contentsview08.obb.sync.adapters.ResolvedBoard
import io.github.contentsview08.obb.sync.engine.SyncEngine
import io.github.contentsview08.obb.sync.engine.SyncKeyMaterial
import io.github.contentsview08.obb.sync.engine.SyncKeyStore
import io.github.contentsview08.obb.sync.engine.SyncRequest
import io.github.contentsview08.obb.sync.engine.SyncResponse
import io.github.contentsview08.obb.sync.engine.CycleResult
import io.github.contentsview08.obb.sync.engine.checkServerUrl
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

// packages/conformance/sync-client.json を流す枠。PC 版の scenarioRunner.ts と同じ手順で動かし、同期の表の digest まで比べる

private const val START = 1_800_000_000_000L

private class MemoryKeyStore : SyncKeyStore {
    var value: SyncKeyMaterial? = null
    override suspend fun load() = value
    override suspend fun save(v: SyncKeyMaterial) {
        value = v
    }
    override suspend fun clear() {
        value = null
    }
}

private class Fault(val kind: String, var times: Int, val path: String?, val status: Int? = null, val body: Any? = null, val location: String? = null, val other: String? = null, var skip: Int = 0)

private class LogEntry(val device: String, val method: String, val path: String, val host: String, val requestId: String?, val secrets: Int = 0)

private val URL_PARTS = Regex("https?://([^/?]+)([^?]*)(\\?.*)?")

@Suppress("UNCHECKED_CAST")
private class World(o: Map<String, Any?>) {
    var now = START
    val server = FakeSyncServer(
        now = { now },
        spaceLimit = (o["space_limit"] as Long?)?.toInt() ?: 100,
        quotaRecords = (o["quota_records"] as Long?)?.toInt() ?: 50_000,
        creationClosed = o["creation_closed"] == true,
        ratePerMinute = null,
        fullPullPerHour = null,
        ticketTtlDays = o["ticket_ttl_days"] as Long? ?: 365,
        powBits = o["pow_bits"] as Long? ?: 0,
    )
    /** 同期を始めるページを通した回数。人の操作の代わり */
    var tickets = 0
    val faults = ArrayList<Fault>()
    val log = ArrayList<LogEntry>()

    /** 端末が送った本文の全部。権限系の値が平文で出ていないかを見る */
    val sent = ArrayList<String>()
    var mark = 0
    val devices = LinkedHashMap<String, Device>()
    var retentionDays = 0
}

private val ALLOW = SettingAllowlist(java.io.File("../../../packages/sync/settings-allowlist.json").readText())

/** settings 表の置き場。TS の settingsTableHost と同じ。スマホの実物は Prefs の裏 */
@Suppress("UNCHECKED_CAST")
private class TableSettingsHost(val sql: JdbcSyncSql, override val device: String) : SettingsHost {
    private fun rows(): MutableMap<String, Any?> {
        val names = ALLOW.items.map { it.name } + "boardMeta"
        val out = LinkedHashMap<String, Any?>()
        for (r in sql.query("SELECT key, value FROM settings WHERE key IN (${names.joinToString(", ") { "?" }})", names)) {
            try {
                out[r["key"] as String] = parseStrictJson(r["value"] as String)
            } catch (_: Exception) {
                // 読めない値は無いものとして扱う
            }
        }
        return out
    }

    override fun read(): Map<String, Any?> {
        val all = rows()
        val meta = all.remove("boardMeta") as Map<String, Any?>? ?: emptyMap()
        for ((url, m) in meta) all[ALLOW.boardMetaPrefix + url] = m
        return all
    }

    override fun apply(changes: Map<String, Any?>) {
        val meta = LinkedHashMap((rows()["boardMeta"] as Map<String, Any?>?) ?: emptyMap())
        var metaChanged = false
        val stmts = ArrayList<SqlStatement>()
        for ((name, value) in changes) {
            if (name.startsWith(ALLOW.boardMetaPrefix)) {
                val url = name.substring(ALLOW.boardMetaPrefix.length)
                // 許可された項目だけを差し替える。手元だけの項目(名前欄の既定値など)は残す
                val kept = (meta[url] as Map<String, Any?>?).orEmpty().filterKeys { it !in ALLOW.boardMetaFields }
                val next = kept + (value as Map<String, Any?>)
                if (next.isEmpty()) meta.remove(url) else meta[url] = next
                metaChanged = true
            } else stmts += setSetting(name, value)
        }
        if (metaChanged) stmts += setSetting("boardMeta", meta)
        sql.batch(stmts)
    }
}

private fun setSetting(name: String, value: Any?) = SqlStatement("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", listOf(name, canonicalJson(value)))

private fun resolver(device: String): (String) -> ResolvedBoard? = { url ->
    if (device == "phone" && url.contains("2chan.net")) null
    else ResolvedBoard(url.replace(Regex("^http://([^/]*5ch\\.)"), "https://$1").replaceFirst("5ch.net", "5ch.io"), "2ch-compat")
}

@Suppress("UNCHECKED_CAST")
private class Device(val name: String, val world: World, val skew: Long, keepDefaults: Boolean) {
    val sql = JdbcSyncSql.open().also { if (!keepDefaults) { it.script("DELETE FROM sites"); it.script("DELETE FROM favorite_boards") } }

    /** スマホの置き場は Prefs。テストはメモリに同じ順で持つ */
    var ng: List<NgRule> = emptyList()

    /** 道具の窓が開いたときに見ていた NG。窓は保存まで読み直さない */
    val windows = HashMap<String, List<NgRule>>()
    val ops = UserOps(sql)
    val keys = MemoryKeyStore()
    lateinit var engine: SyncEngine
    var online = true
    var last: CycleResult? = null
    val trace = ArrayList<String>()
    var idCount = 0
    var requestCount = 0
    var resetCount = 0
    /** 画面で開いているスレ(tab_open / tab_close) */
    val openThreads = HashSet<String>()
    var adapters: List<SyncAdapter> = emptyList()

    init {
        newEngine()
    }

    fun now() = world.now + skew

    /** 次の要求の前に 1 回だけ呼ぶ。走っている周に別のきっかけを重ねるため */
    var onSend: (suspend () -> Unit)? = null

    private suspend fun send(req: SyncRequest): SyncResponse {
        onSend?.let { hook ->
            onSend = null
            hook()
        }
        val w = world
        val m = URL_PARTS.matchEntire(req.url)!!
        val pathOnly = m.groupValues[2]
        val path = pathOnly + m.groupValues[3]
        val parsed = req.body?.let { parseStrictJson(it) as Map<String, Any?> }
        val requestId = parsed?.get("request_id") as String?
        val secrets = (parsed?.get("records") as List<Map<String, Any?>>?)?.count { it["kind_tag"] == "s" } ?: 0
        w.log += LogEntry(name, req.method, pathOnly, m.groupValues[1], requestId, secrets)
        req.body?.let { w.sent += it }
        if (!online) throw IllegalStateException("offline")
        val f = w.faults.firstOrNull { it.times > 0 && (it.path == null || it.path == pathOnly) }
        val real = FakeRequest(req.method, path, req.headers, req.body)
        if (f != null && f.skip > 0) f.skip--
        else if (f != null) {
            f.times--
            when (f.kind) {
                "status" -> return SyncResponse(f.status!!, "{}")
                "swap" -> {
                    // 本物の別レコードの暗号文を、送った先頭のレコードの 409 として返す
                    val sp = w.server.spaces.getValue(fakeSpaceIdOf(req.headers.getValue("Authorization").substring(7)))
                    val first = ((parseStrictJson(req.body!!) as Map<String, Any?>)["records"] as List<Map<String, Any?>>)[0]["record_id"]
                    return SyncResponse(200, canonicalJson(mapOf("results" to listOf(mapOf("record_id" to first, "status" to 409L, "record" to sp.records.getValue(f.other!!).toMap())), "epoch" to sp.epoch, "gc_floor" to sp.gcFloor)))
                }
                "unreachable" -> throw IllegalStateException("unreachable")
                "redirect" -> return SyncResponse(302, "", mapOf("Location" to f.location!!))
                "drop" -> {
                    w.server.handle(real)
                    throw IllegalStateException("dropped")
                }
                else -> {
                    val epoch = w.server.spaces[fakeSpaceIdOf(req.headers.getValue("Authorization").substring(7))]?.epoch.orEmpty()
                    return SyncResponse(f.status ?: 200, canonicalJson(f.body).replace("\$epoch", epoch))
                }
            }
        }
        val res = w.server.handle(real)
        return SyncResponse(res.status, res.body, res.headers)
    }

    /** 同期を始めるページを通して許可証を受け取る。画面の手順の代わりなので通信の記録に入れない */
    fun startPage(k: ByteArray): String {
        world.tickets++
        val res = world.server.handle(FakeRequest("POST", "/tickets", emptyMap(), canonicalJson(mapOf("turnstile" to "test-pass", "space_id" to spaceId(deriveKeys(k).authToken)))))
        return (parseStrictJson(res.body) as Map<String, Any?>)["ticket"] as String
    }

    fun newEngine() {
        adapters = listOf(FavoriteThreadAdapter(sql, resolver(name))) + favoriteBoardAdapters(sql, resolver(name)) + listOf(
            SiteAdapter(sql) { url -> if (name == "phone" && url.contains("2chan.net")) null else "2ch-compat" },
            ImageAdapter(sql),
            SecretAdapter(sql),
            NgAdapter(SyncNgHost({ ng }, { ng = applyNgDiff(ng, it) }, ::dateOf)),
            PostAdapter(sql, resolver(name)),
            SettingAdapter(ALLOW, TableSettingsHost(sql, if (name == "phone") "phone" else "pc"), sql),
        ) + historyAdapters(sql, HistoryHost(resolver(name), { world.retentionDays }, { "reset_${name}_${++resetCount}" }, { board, key -> "$board\t$key" in openThreads }))
        engine = SyncEngine(
            db = sql,
            keyStore = keys,
            transport = { send(it) },
            serverUrl = "https://sync.test",
            adapters = adapters,
            now = { now() },
            newDeviceId = { if (idCount++ == 0) name else "${name}_$idCount" },
            newRequestId = {
                val n = (++requestCount).toString()
                (name + "_".repeat(22)).substring(0, 22 - n.length) + n
            },
            jitter = { 0.5 },
            onState = { trace += it },
            io = Dispatchers.Unconfined,
        )
    }

    suspend fun sync(manual: Boolean = true): CycleResult {
        trace.clear()
        return engine.runCycle(manual).also { last = it }
    }

    fun state(key: String) = sql.query("SELECT value FROM sync_state WHERE key = ?", listOf(key)).firstOrNull()?.get("value") as String?

    fun count(from: String): Int = (sql.query("SELECT COUNT(*) AS n $from")[0]["n"] as Long).toInt()

    /** 今のデータと同期の表の全部。PC とスマホで同じ文字列になる */
    fun digest(): String {
        val favorites = sql.query("SELECT board_url, key, connector_id, title, created_at, sort, added_at FROM favorite_threads ORDER BY board_url, key")
        val boards = sql.query("SELECT url, connector_id, name, sort FROM favorite_boards ORDER BY url")
        val sites = sql.query("SELECT menu_url, connector_id, name, sort FROM sites ORDER BY menu_url")
        val uploads = sql.query("SELECT url, name, size, uploaded_at, with_account, hash, delete_url FROM uploads ORDER BY url")
        val threads = sql.query("SELECT board_url, key, connector_id, title, post_count, read_no, status, created_at, read_at FROM threads ORDER BY board_url, key")
        val posts = sql.query("SELECT connector_id, board_url, key, thread_title, no, name, mail, body, posted_at FROM post_history ORDER BY posted_at, board_url, key, body")
        val own = sql.query("SELECT board_url, key, no, posted_at FROM own_posts ORDER BY board_url, key, no")
        val records = sql.query("SELECT record_id, kind, kind_tag, schema_version, payload, hlc, deleted, version, pending, priority, needs_apply, ref_board, ref_thread, ref_detail, tomb_at FROM sync_records ORDER BY record_id")
        val settings = TableSettingsHost(sql, "pc").read().entries.sortedBy { it.key }.map { listOf(it.key, canonicalJson(it.value)) }
        // 端末の要約の文字列も比べる。画面に出す値が PC とスマホで同じ作りになるように
        val summary = keys.value?.let { syncSummary(sql, adapters, context(it)).text } ?: ""
        return sha256(
            utf8(
                canonicalJson(
                    mapOf(
                        "favorites" to favorites, "boards" to boards, "sites" to sites, "uploads" to uploads, "ng" to ng.map(::ngRuleToBody), "threads" to threads,
                        "posts" to posts, "own" to own, "settings" to settings, "records" to records, "summary" to summary,
                    ),
                ),
            ),
        ).toHex()
    }

    fun context(m: SyncKeyMaterial) = AdapterContext(deriveKeys(m.k), m.deviceId, now())
}

/** 端末の日付の代わり。時差で結果が変わらないよう UTC で決める */
private fun dateOf(ms: Long) = java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneOffset.UTC).toLocalDate().toString()

private fun ruleOf(o: Map<String, Any?>) = NgRule(
    o["target"] as String, o["pattern"] as String, o["isRegex"] == true, o["enabled"] != false,
    o["expiresOnDate"] as String?, o["boardUrl"] as String?, o["boardName"] as String?, o["note"] as String?, o["id"] as String, o["createdAt"] as Long? ?: 0L,
)

private fun uploadOf(s: Map<String, Any?>, now: Long) = UploadRecord(s["url"] as String, s["name"] as String? ?: "", s["size"] as Long? ?: 0L, now, s["with_account"] == true, s["hash"] as String?, s["delete_url"] as String?)

/** 窓が見ている配列から新しい配列を作り、その窓の差分だけを保存する */
@Suppress("UNCHECKED_CAST")
private fun windowChange(d: Device, view: List<NgRule>, s: Map<String, Any?>): List<NgRule> {
    val removed = (s["remove"] as List<String>?).orEmpty().toSet()
    val edits = (s["edit"] as List<Map<String, Any?>>?).orEmpty().map(::ruleOf).associateBy { it.id }
    val after = view.filter { it.id !in removed }.map { edits[it.id] ?: it } + (s["add"] as List<Map<String, Any?>>?).orEmpty().map(::ruleOf)
    val diff = ngDiff(view, after, dateOf(d.now()))
    d.ng = applyNgDiff(d.ng, diff)
    d.ops.ngChangeNow(diff, d.now())
    return after
}

private fun thread(s: Map<String, Any?>) = ThreadSummary(s["board"] as String, s["key"] as String, s["title"] as String? ?: "", 0, 0, s["created_at"] as Long?)

/** 端末どうしで揃うはずの値。キーごとに持つので、違ったレコードと項目をそのまま読める */
private fun snapshot(d: Device, full: Boolean): Map<String, String> {
    val out = HashMap<String, String>()
    for (r in d.sql.query("SELECT record_id, kind, payload, ref_board, ref_thread, ref_detail FROM sync_records")) {
        val k = "record ${r["kind"]} ${(r["record_id"] as String).take(12)}"
        out[k] = r["payload"] as String
        // 削除だけを受けた端末は ref を知らない。比べずに、違いの見出しにだけ使う
        if (r["ref_board"] != null || r["ref_thread"] != null || r["ref_detail"] != null) out["#$k"] = "${r["ref_board"] ?: ""} ${r["ref_thread"] ?: ""} ${r["ref_detail"] ?: ""}"
    }
    for (p in d.sql.query("SELECT board_url, key, thread_title, no, body, posted_at FROM post_history")) {
        val board = normalizeBoardUrl(p["board_url"] as String)!!
        out["書き込み履歴 $board ${p["key"]} ${postIdOf(board, p["key"] as String, p["posted_at"] as Long, p["body"] as String)}"] = canonicalJson(mapOf("title" to p["thread_title"], "no" to p["no"], "posted_at" to p["posted_at"]))
    }
    for (t in d.sql.query("SELECT board_url, key, title, read_no, read_at FROM threads")) {
        val at = "${normalizeBoardUrl(t["board_url"] as String)} ${t["key"]}"
        if (full || t["read_at"] != null) out["閲覧履歴 $at"] = canonicalJson(mapOf("read_at" to t["read_at"], "title" to t["title"]))
        if (full || (t["read_no"] as Long) > 0) out["既読 $at"] = t["read_no"].toString()
    }
    return out
}

/** 全部の端末を比べ、違いを 1 行ずつ出す。ログを消した端末は行がないので、full でなければ両方にあるものだけを手元の値として比べる */
internal fun diffSnapshots(an: String, a: Map<String, String>, bn: String, b: Map<String, String>, full: Boolean): List<String> {
    val lines = ArrayList<String>()
    for (k in (a.keys + b.keys).sorted()) {
        if (a[k] == b[k] || k.startsWith("#")) continue
        if (!full && !k.startsWith("record ") && !k.startsWith("書き込み履歴 ") && (a[k] == null || b[k] == null)) continue
        lines += "$k ${a["#$k"] ?: b["#$k"] ?: ""}\n  $an: ${a[k] ?: "(ない)"}\n  $bn: ${b[k] ?: "(ない)"}"
    }
    return lines
}

private fun threadSql(s: Map<String, Any?>) = listOf(s["board"], s["key"], "2ch-compat", s["title"] as String? ?: "")

private fun keyOf(device: String) = sha256(utf8("key:$device"))

private fun checkEq(label: String, want: Any?, got: Any?) = assertEquals(label, canonicalJson(want), canonicalJson(got))

private fun Fault(s: Map<String, Any?>, kind: String) = Fault(kind, (s["times"] as Long?)?.toInt() ?: 1, s["path"] as String?, (s["status"] as Long?)?.toInt(), s["body"], s["location"] as String?, skip = (s["skip"] as Long?)?.toInt() ?: 0)

@Suppress("UNCHECKED_CAST")
private suspend fun runStep(w: World, s: Map<String, Any?>, label: String) {
    val d = (s["device"] as String?)?.let { w.devices.getValue(it) }
    fun material() = d!!.keys.value!!
    fun spaceOfDevice() = spaceId(deriveKeys(material().k).authToken)
    when (val op = s["op"] as String) {
        "advance_ms" -> w.now += s["ms"] as Long
        "favorite_thread_add" -> thread(s).let { d!!.ops.setFavoriteThread(it, it.title, true, d.now()) }
        "favorite_thread_remove" -> thread(s).let { d!!.ops.setFavoriteThread(it, it.title, false, d.now()) }
        "auto_favorite_thread_add" -> thread(s).let { d!!.sql.exec(FavoriteThreadSql.ADD, FavoriteThreadSql.addArgs(it, it.title, d.now())) }
        "auto_favorite_thread_remove" -> d!!.sql.exec(FavoriteThreadSql.REMOVE, FavoriteThreadSql.removeArgs(thread(s)))
        "preset_board_add" -> d!!.sql.exec(
            "INSERT OR IGNORE INTO favorite_boards (url, connector_id, name, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM favorite_boards))",
            listOf(s["url"], "2ch-compat", s["name"]),
        )
        "favorite_board_add" -> d!!.ops.setFavoriteNow(Board(s["url"] as String, s["name"] as String? ?: ""), true, d.now())
        "favorite_board_remove" -> d!!.ops.setFavoriteNow(Board(s["url"] as String, ""), false, d.now())
        "favorite_board_order" -> d!!.ops.reorderFavoritesNow(s["urls"] as List<String>, d.now())
        "site_add" -> d!!.ops.addSiteNow(s["url"] as String, s["name"] as String? ?: "", d.now())
        "site_remove" -> d!!.ops.removeSiteNow(s["url"] as String, d.now())
        "preset_site_add" -> d!!.sql.exec(SiteSql.ADD, SiteSql.addArgs(s["url"] as String, s["name"] as String? ?: ""))
        "boards_cache" -> d!!.sql.exec("INSERT INTO boards (site_menu_url, url, connector_id, name, sort) VALUES (?, ?, '2ch-compat', 'x', 0)", listOf(s["site"], s["url"]))
        "upload_add" -> d!!.ops.addUploadNow(uploadOf(s, d.now()), d.now())
        "upload_remove" -> d!!.ops.removeUploadNow(s["url"] as String, d.now())
        "open" -> {
            val t = thread(s)
            restoreThreadRead(d!!.sql, t.boardUrl, t.key, "2ch-compat", t.title, t.createdAt)
            d.sql.exec("INSERT OR IGNORE INTO threads (board_url, key, connector_id, title, created_at) VALUES (?, ?, ?, ?, ?)", threadSql(s) + listOf(s["created_at"]))
            s["post_count"]?.let { d.sql.exec("UPDATE threads SET post_count = ? WHERE board_url = ? AND key = ?", listOf(it, t.boardUrl, t.key)) }
        }
        "thread_row_raw" -> d!!.sql.exec(
            // 操作を通らずに増えた手元の行(種まきのあとに足された種類、戻したバックアップ)
            "INSERT INTO threads (board_url, key, connector_id, title, post_count, read_no, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            threadSql(s) + listOf(s["post_count"] as Long? ?: 0L, s["read_no"] as Long? ?: 0L, s["created_at"], (s["read_ago_ms"] as Long?)?.let { d.now() - it }),
        )
        "post_row_raw" -> d!!.sql.exec(
            "INSERT INTO post_history (connector_id, board_url, key, thread_title, no, name, mail, body, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            listOf("2ch-compat", s["board"], s["key"], s["title"] as String? ?: "", s["no"], "", "", s["body"], d.now() - (s["ago_ms"] as Long? ?: 0L)),
        )
        "sync_overlapped" -> kotlinx.coroutines.coroutineScope {
            val dev = d!!
            var second: kotlinx.coroutines.Deferred<CycleResult>? = null
            dev.onSend = {
                second = async(Dispatchers.IO) { dev.engine.runCycle(true) }
                kotlinx.coroutines.delay(100)
            }
            dev.engine.runCycle(true)
            dev.last = second!!.await()
        }
        "read" -> d!!.ops.markReadNow(thread(s), s["no"] as Long, d.now())
        "view" -> d!!.ops.threadViewNow(thread(s), d.now())
        "view_remove" -> d!!.ops.historyRemoveNow(thread(s), d.now())
        "log_delete" -> d!!.ops.deleteLogsNow(((s["threads"] as List<Map<String, Any?>>?) ?: listOf(s)).map(::thread), d.now())
        "tab_open" -> d!!.openThreads += "${s["board"]}\t${s["key"]}"
        "tab_close" -> d!!.openThreads -= "${s["board"]}\t${s["key"]}"
        "prune" -> {
            val kept = (s["keep"] as List<Map<String, Any?>>?).orEmpty().map { "${it["board"]}\t${it["key"]}" }.toSet()
            val rows = d!!.sql.query(ThreadLogSql.PRUNE_TARGETS, listOf(d.now() - s["older_than_ms"] as Long))
            for (r in rows) if ("${r["board_url"]}\t${r["key"]}" !in kept) for (del in ThreadLogSql.DELETE_LOG) d.sql.exec(del, listOf(r["board_url"], r["key"]))
        }
        "post_add" -> thread(s).let { d!!.ops.postAddNow(it, it.title, (s["no"] as Long?)?.toInt(), s["name"] as String? ?: "", s["mail"] as String? ?: "", s["body"] as String, d.now()) }
        "post_remove" -> {
            val row = d!!.sql.query("SELECT id, board_url, key, thread_title, no, body, posted_at FROM post_history ORDER BY posted_at DESC, id DESC LIMIT 1000").firstOrNull { it["key"] == s["key"] && it["body"] == s["body"] }
            if (row != null) d.ops.postRemoveNow(PostHistoryEntry(row["id"] as Long, ThreadSummary(row["board_url"] as String, row["key"] as String, row["thread_title"] as String, 0, 0, null), (row["no"] as Long?)?.toInt(), row["body"] as String, row["posted_at"] as Long), d.now())
        }
        "clear_faults" -> {
            w.faults.clear()
            for (x in w.devices.values) x.sql.failing.clear()
        }
        "settle" -> {
            // 新しい変更が出なくなるまで全端末を回す。止まらなければ下の確かめで落ちる
            for (round in 0 until 400) {
                var moved = false
                for (x in w.devices.values) {
                    val r = x.sync()
                    if (r.pulled > 0 || r.pushed > 0 || r.conflicts > 0) moved = true
                }
                w.now += 1000
                if (!moved) break
            }
        }
        "converged" -> {
            val names = s["devices"] as List<String>? ?: w.devices.keys.toList()
            val full = s["full"] != false
            val snaps = names.map { snapshot(w.devices.getValue(it), full) }
            for (i in 1 until names.size) {
                val lines = diffSnapshots(names[0], snaps[0], names[i], snaps[i], full)
                if (lines.isNotEmpty()) fail("$label: ${names[0]} と ${names[i]} の違い(${lines.size} 件)\n${lines.take(40).joinToString("\n")}")
            }
        }
        "summary_same" -> {
            val names = s["devices"] as List<String>? ?: w.devices.keys.toList()
            class R(val sum: io.github.contentsview08.obb.sync.engine.SyncSummary, val mis: io.github.contentsview08.obb.sync.engine.MismatchSummary)
            val results = names.map { n ->
                val x = w.devices.getValue(n)
                val ctx = x.context(x.keys.value!!)
                R(syncSummary(x.sql, x.adapters, ctx), syncMismatches(x.sql, x.adapters, ctx))
            }
            fun kinds(r: R) = r.sum.kinds.map { listOf(it.kind, it.live, it.tombstones, it.hash) }
            fun local(r: R) = r.sum.local.map { listOf(it.area, it.count, it.hash) }
            for (i in names.indices) {
                checkEq("$label: ${names[i]} の手元と表の違い", emptyMap<String, Int>(), results[i].mis.differs)
                checkEq("$label: ${names[i]} の表にない手元の行", emptyMap<String, Int>(), results[i].mis.missing)
                checkEq("$label: ${names[i]} の表の要約", kinds(results[0]), kinds(results[i]))
                if (s["local"] != false) checkEq("$label: ${names[i]} の手元の要約", local(results[0]), local(results[i]))
            }
        }
        "setting_change" -> {
            val name = s["name"] as String
            val host = TableSettingsHost(d!!.sql, "pc")
            val all = host.read()
            val current = if (name == "boardMeta") all.filterKeys { it.startsWith(ALLOW.boardMetaPrefix) }.mapKeys { it.key.substring(ALLOW.boardMetaPrefix.length) } else all[name]
            d.ops.settingsWriteNow(ALLOW.opsOf(name, s["value"], current), d.now(), listOf(setSetting(name, s["value"])))
        }
        "setting_write_raw" -> d!!.sql.batch(listOf(setSetting(s["name"] as String, s["value"])))
        "ng_change" -> windowChange(d!!, d.ng, s)
        "ng_prune" -> {
            val today = dateOf(d!!.now())
            val diff = ngDiff(d.ng, d.ng.filter { it.expiresOnDate == null || it.expiresOnDate >= today }, today)
            d.ng = applyNgDiff(d.ng, diff)
            d.ops.ngChangeNow(diff, d.now())
        }
        "ng_window_open" -> d!!.windows[s["window"] as String] = d.ng
        "ng_window_change" -> d!!.windows[s["window"] as String] = windowChange(d, d.windows.getValue(s["window"] as String), s)
        "ng_write_raw" -> d!!.ng = (s["rules"] as List<Map<String, Any?>>).map(::ruleOf)
        "ng_import" -> {
            val diff = ngDiff(d!!.ng, (s["rules"] as List<Map<String, Any?>>).map(::ruleOf), dateOf(d.now()), keepRemoved = true)
            d.ng = applyNgDiff(d.ng, diff)
            d.ops.ngChangeNow(diff, d.now())
        }
        "pair_first" -> {
            val k = keyOf(s["device"] as String)
            d!!.engine.pair(k, if (s["no_ticket"] == true) null else d.startPage(k))
            d.sync()
        }
        "pair_join" -> {
            // QR とコピー用のコードの中身は K と許可証
            val from = w.devices.getValue(s["from"] as String).keys.value!!
            d!!.engine.pair(from.k, from.ticket)
            d.sync()
        }
        "start_page" -> d!!.engine.setTicket(d.startPage(material().k))
        "sync" -> d!!.sync()
        "sync_auto" -> d!!.sync(false)
        "restart" -> d!!.newEngine()
        "leave" -> d!!.engine.leave()
        "set_master" -> d!!.engine.setMaster(s["on"] as Boolean)
        "set_kind" -> d!!.engine.setKind(s["group"] as String, s["on"] as Boolean)
        "server_inject_secret" -> {
            // 別の端末が権限系を送った状態。corrupt は開けない暗号文
            val keys = deriveKeys(material().k)
            val id = recordId(keys.kId, "secret", null, "", s["url"] as String)
            w.server.injectRecord(spaceId(keys.authToken), id, "s", 1, false, toBase64Url(ByteArray(24)), toBase64Url(ByteArray(272)))
        }
        "confirm" -> d!!.engine.resolveConfirm(s["choice"] as String)
        "offline" -> d!!.online = false
        "online" -> d!!.online = true
        "server_fail" -> w.faults += Fault(s, "status")
        "server_drop_response" -> w.faults += Fault(s, "drop")
        "server_unreachable" -> w.faults += Fault(s, "unreachable")
        "server_redirect" -> w.faults += Fault(s, "redirect")
        "server_response" -> w.faults += Fault(s, "response")
        "server_swap_conflict" -> {
            val keys = deriveKeys(material().k)
            val o = s["other"] as List<String>
            w.faults += Fault("swap", 1, "/records", other = recordId(keys.kId, o[0], o[1], o[2]))
        }
        "server_delete_space" -> w.server.deleteSpace(spaceOfDevice())
        "server_bump_epoch" -> w.server.bumpEpoch(spaceOfDevice())
        "server_inject" -> {
            val keys = deriveKeys(material().k)
            val rec = s["record"] as List<String?>
            val id = recordId(keys.kId, rec[0]!!, rec[1], rec.getOrNull(2), rec.getOrNull(3))
            val sid = spaceId(keys.authToken)
            if (s["corrupt"] == true) {
                w.server.injectRecord(sid, id, "h", 1, false, toBase64Url(ByteArray(24)), toBase64Url(ByteArray(272)))
            } else {
                val payload = s["payload"] as SyncPayload
                val (nonce, ciphertext) = sealPayload(keys, RecordContext(sid, id, "h", 1), payload)
                w.server.injectRecord(sid, id, "h", 1, payload["deleted"] == true, nonce, ciphertext)
            }
        }
        "db_fail" -> d!!.sql.failing += JdbcSyncSql.DbFail(s["match"] as String, (s["times"] as Long?)?.toInt() ?: 1)
        "tamper_device_id" -> d!!.sql.script("UPDATE sync_state SET value = 'copied' WHERE key = 'device_id'")
        "clear_keys" -> d!!.keys.clear()
        "mark" -> w.mark = w.log.size
        "expect" -> check(w, s["expect"] as Map<String, Any?>, label)
        else -> throw IllegalStateException("知らない op: $op")
    }
}

@Suppress("UNCHECKED_CAST")
private fun check(w: World, want: Map<String, Any?>, label: String) {
    for ((name, ev) in want) {
        val e = ev as Map<String, Any?>
        if (name == "\$server") {
            e["spaces"]?.let { assertEquals("$label: サーバーの領域の数", (it as Long).toInt(), w.server.spaces.size) }
            e["tickets"]?.let { assertEquals("$label: 同期を始めるページを通した回数", (it as Long).toInt(), w.tickets) }
            e["hosts"]?.let { checkEq("$label: 通信先", it, w.log.map { l -> l.host }.distinct()) }
            e["request_id_repeated"]?.let {
                val ids = w.log.mapNotNull { l -> l.requestId }
                assertEquals("$label: 同じ request_id の送り直し", it, ids.toSet().size < ids.size)
            }
            e["sent_lacks"]?.let { texts ->
                for (text in texts as List<String>) assertEquals("$label: 送った本文に $text がない", false, w.sent.any { b -> b.contains(text) })
            }
            for ((dev, vv) in (e["of"] as Map<String, Any?>?).orEmpty()) {
                val v = vv as Map<String, Any?>
                val m = w.devices.getValue(dev).keys.value
                val sp = m?.let { w.server.spaces[spaceId(deriveKeys(it.k).authToken)] }
                v["exists"]?.let { assertEquals("$label: $dev の領域", it, sp != null) }
                v["records"]?.let { assertEquals("$label: $dev の領域のレコード数", it, sp?.records?.size?.toLong()) }
                v["head"]?.let { assertEquals("$label: $dev の領域の version", it, sp?.next) }
                v["gc_floor"]?.let { assertEquals("$label: $dev の gc_floor", it, sp?.gcFloor) }
                v["s_records"]?.let { assertEquals("$label: $dev の領域の権限系のレコード数", it, sp?.records.orEmpty().values.count { r -> r.kindTag == "s" }.toLong()) }
                v["h_lacks"]?.let { texts ->
                    // 履歴系の鍵で開けるものに、権限系の値が混ざっていない
                    val k = deriveKeys(m!!.k)
                    val opened = openRecords(k, spaceId(k.authToken), sp?.records.orEmpty().values.filter { r -> r.kindTag == "h" }.map { r -> r.toMap() })
                    for (text in texts as List<String>) assertEquals("$label: $dev の履歴系に $text がない", false, opened.records.any { r -> canonicalJson(r.payload).contains(text) })
                }
            }
            continue
        }
        val d = w.devices.getValue(name)
        val at = "$label: $name"
        e["favorite_threads"]?.let { checkEq("$at のお気に入り", it, d.sql.query("SELECT key FROM favorite_threads ORDER BY key").map { r -> r["key"] }) }
        e["favorite_rows"]?.let { checkEq("$at のお気に入りの行", it, d.sql.query("SELECT board_url, key, title, created_at FROM favorite_threads ORDER BY board_url, key")) }
        e["favorite_boards"]?.let { checkEq("$at のお気に入り板", it, d.sql.query("SELECT url FROM favorite_boards ORDER BY url").map { r -> r["url"] }) }
        e["favorite_board_order"]?.let { checkEq("$at のお気に入り板の並び", it, d.sql.query("SELECT url FROM favorite_boards ORDER BY sort, url").map { r -> r["url"] }) }
        e["favorite_board_rows"]?.let { checkEq("$at のお気に入り板の行", it, d.sql.query("SELECT url, connector_id, name FROM favorite_boards ORDER BY url")) }
        e["sites"]?.let { checkEq("$at のサイト", it, d.sql.query("SELECT menu_url FROM sites ORDER BY menu_url").map { r -> r["menu_url"] }) }
        e["site_rows"]?.let { checkEq("$at のサイトの行", it, d.sql.query("SELECT menu_url, connector_id, name FROM sites ORDER BY menu_url")) }
        e["boards_cached"]?.let { assertEquals("$at の板一覧", (it as Long).toInt(), d.count("FROM boards")) }
        e["uploads"]?.let { checkEq("$at の画像", it, d.sql.query("SELECT url, name, size, uploaded_at, with_account, hash, delete_url FROM uploads ORDER BY url")) }
        e["ng_ids"]?.let { checkEq("$at の NG", it, d.ng.map { r -> r.id }) }
        e["ng_rules"]?.let { checkEq("$at の NG の中身", it, d.ng.map(::ngRuleToBody)) }
        e["read_no"]?.let { checkEq("$at の既読", it, d.sql.query("SELECT key, read_no FROM threads ORDER BY key").associate { r -> r["key"] as String to r["read_no"] }) }
        e["history"]?.let { checkEq("$at の閲覧履歴", it, d.sql.query("SELECT key FROM threads WHERE read_at IS NOT NULL ORDER BY read_at DESC, key").map { r -> r["key"] }) }
        e["screen_history"]?.let {
            val rows = d.sql.query(io.github.contentsview08.obb.data.ThreadLogSql.HISTORY, listOf(SyncConfig.HISTORY_SHOWN.toLong()))
            checkEq("$at の履歴の画面", it, rows.map { r -> "${r["key"]}:${r["read_no"]}" })
        }
        (e["screen_read"] as Map<String, Map<String, Any?>>?)?.forEach { (boardUrl, want) ->
            val urls = io.github.contentsview08.obb.data.boardUrlVariants(boardUrl)
            val rows = d.sql.query(io.github.contentsview08.obb.data.ThreadLogSql.threadStates(urls.size), urls)
            checkEq("$at の板の既読 $boardUrl", want, rows.groupBy { r -> r["key"] as String }.toSortedMap().mapValues { (_, v) -> v.maxOf { r -> r["read_no"] as Long } })
        }
        e["summary_notes"]?.let {
            val m = d.keys.value!!
            checkEq("$at の合わない理由", it, syncSummary(d.sql, d.adapters, AdapterContext(deriveKeys(m.k), m.deviceId, d.now())).notes.mapValues { (_, n) -> n.toLong() })
        }
        e["thread_rows"]?.let { checkEq("$at のスレの行", it, d.sql.query("SELECT board_url, key, connector_id, title, post_count, read_no, created_at, read_at FROM threads ORDER BY board_url, key")) }
        e["post_rows"]?.let { checkEq("$at の書き込み履歴", it, d.sql.query("SELECT board_url, key, thread_title, no, name, mail, body, posted_at FROM post_history ORDER BY posted_at, body")) }
        e["post_bodies"]?.let { checkEq("$at の書き込み履歴の本文", it, d.sql.query("SELECT body FROM post_history ORDER BY posted_at, body").map { r -> r["body"] }) }
        e["own_posts"]?.let { checkEq("$at の自分のレス", it, d.sql.query("SELECT key, no FROM own_posts ORDER BY key, no")) }
        e["settings"]?.let { checkEq("$at の設定", it, TableSettingsHost(d.sql, "pc").read()) }
        e["kinds"]?.let { checkEq("$at の種類ごとのレコード数", it, d.sql.query("SELECT kind, COUNT(*) AS n FROM sync_records GROUP BY kind").associate { r -> r["kind"] as String to r["n"] }) }
        e["ops_lack"]?.let { texts ->
            val rows = d.sql.query("SELECT target, args FROM sync_ops")
            for (text in texts as List<String>) assertEquals("$at の sync_ops に $text がない", false, rows.any { r -> "${r["target"]} ${r["args"]}".contains(text) })
        }
        e["secrets_sent"]?.let { assertEquals("$at の送った権限系の数", (it as Long).toInt(), w.log.drop(w.mark).filter { l -> l.device == name }.sumOf { l -> l.secrets }) }
        e["delete_urls"]?.let { checkEq("$at の削除ページ", it, d.sql.query("SELECT url, delete_url FROM uploads ORDER BY url").associate { r -> r["url"] as String to r["delete_url"] }) }
        e["kinds_lack"]?.let { kinds ->
            val rows = d.sql.query("SELECT DISTINCT kind FROM sync_records").map { r -> r["kind"] }
            for (k in kinds as List<String>) assertEquals("$at の表に $k がない", false, k in rows)
        }
        e["kinds_has"]?.let { kinds ->
            val rows = d.sql.query("SELECT DISTINCT kind FROM sync_records").map { r -> r["kind"] }
            for (k in kinds as List<String>) assertEquals("$at の表に $k がある", true, k in rows)
        }
        e["max_order_key"]?.let {
            val longest = d.sql.query("SELECT payload FROM sync_records WHERE kind = 'order' AND deleted = 0").maxOfOrNull { r -> ((parseStrictJson(r["payload"] as String) as Map<String, Any?>)["body"] as Map<String, Any?>)["key"].toString().length } ?: 0
            assertEquals("$at の順序キーの長さ", true, longest <= (it as Long))
        }
        e["record_lacks"]?.let { texts ->
            val rows = d.sql.query("SELECT payload FROM sync_records").map { r -> r["payload"] as String }
            for (text in texts as List<String>) assertEquals("$at のレコードに $text がない", false, rows.any { p -> p.contains(text) })
        }
        e["applied_areas"]?.let { checkEq("$at の適用の種類", it, d.last?.applied.orEmpty().sorted()) }
        e["state"]?.let { assertEquals("$at の状態", it, d.engine.state) }
        e["phase"]?.let { assertEquals("$at の phase", it, d.state("phase")) }
        e["pending"]?.let { assertEquals("$at の未送信", (it as Long).toInt(), d.count("FROM sync_records WHERE pending = 1")) }
        e["ops"]?.let { assertEquals("$at の sync_ops", (it as Long).toInt(), d.count("FROM sync_ops")) }
        e["records"]?.let { assertEquals("$at のレコード数", (it as Long).toInt(), d.count("FROM sync_records")) }
        e["tombstones"]?.let { assertEquals("$at の tombstone", (it as Long).toInt(), d.count("FROM sync_records WHERE deleted = 1")) }
        e["needs_apply"]?.let { assertEquals("$at の needs_apply", (it as Long).toInt(), d.count("FROM sync_records WHERE needs_apply = 1")) }
        e["state_rows"]?.let { assertEquals("$at の sync_state", (it as Long).toInt(), d.count("FROM sync_state")) }
        if (e.containsKey("last_error")) assertEquals("$at の last_error", e["last_error"], d.state("last_error"))
        e["since"]?.let { assertEquals("$at の since", it.toString(), d.state("since")) }
        if (e.containsKey("bad_counts")) assertEquals("$at の bad_counts", e["bad_counts"]?.let { canonicalJson(it) }, d.state("bad_counts"))
        e["inflight"]?.let { assertEquals("$at の push_inflight", it, d.state("push_inflight") != null) }
        e["device_id"]?.let { assertEquals("$at の device_id", it, d.state("device_id")) }
        e["has_ticket"]?.let { assertEquals("$at の許可証", it, d.keys.value?.ticket != null) }
        e["keys"]?.let { assertEquals("$at の鍵", it, d.keys.value != null) }
        e["pending_confirm"]?.let { assertEquals("$at の pending_confirm", canonicalJson(it), d.state("pending_confirm")) }
        e["trace"]?.let { checkEq("$at の状態の順", it, d.trace) }
        e["applied"]?.let { assertEquals("$at の適用", it, d.last?.favoriteThreads) }
        e["pushed"]?.let { assertEquals("$at の送信数", (it as Long).toInt(), d.last?.pushed) }
        e["conflicts"]?.let { assertEquals("$at の 409", (it as Long).toInt(), d.last?.conflicts) }
        if (e.containsKey("skipped")) assertEquals("$at の skipped", e["skipped"], d.last?.skipped)
        e["requests"]?.let {
            val seen = LinkedHashMap<String, Long>()
            for (l in w.log.drop(w.mark)) if (l.device == name) seen.merge("${l.method} ${l.path}", 1L, Long::plus)
            checkEq("$at の通信", it, seen)
        }
    }
}

@Suppress("UNCHECKED_CAST")
private suspend fun runScenario(c: Map<String, Any?>): Map<String, String> {
    val w = World(c["server"] as Map<String, Any?>? ?: emptyMap())
    w.retentionDays = (c["retention_days"] as Long?)?.toInt() ?: 0
    val skews = c["skew_ms"] as Map<String, Long>? ?: emptyMap()
    for (name in c["devices"] as List<String>) w.devices[name] = Device(name, w, skews[name] ?: 0, c["keep_defaults"] == true)
    for ((name, seed) in (c["seed"] as Map<String, Map<String, Any?>>?).orEmpty()) {
        val d = w.devices.getValue(name)
        for (f in (seed["favorite_threads"] as List<Map<String, Any?>>?).orEmpty()) {
            val t = thread(f)
            d.sql.exec(FavoriteThreadSql.ADD, FavoriteThreadSql.addArgs(t, t.title, START - (f["added_ago_ms"] as Long? ?: 0)))
        }
        for (b in (seed["favorite_boards"] as List<Map<String, Any?>>?).orEmpty()) d.sql.exec(FavoriteBoardSql.ADD, FavoriteBoardSql.addArgs(Board(b["url"] as String, b["name"] as String? ?: "")))
        for (x in (seed["sites"] as List<Map<String, Any?>>?).orEmpty()) d.sql.exec(SiteSql.ADD, SiteSql.addArgs(x["url"] as String, x["name"] as String? ?: ""))
        for (u in (seed["uploads"] as List<Map<String, Any?>>?).orEmpty()) {
            val at = START - (u["ago_ms"] as Long? ?: 0)
            d.sql.exec(UploadSql.ADD, UploadSql.addArgs(uploadOf(u, at), at).toList())
        }
        (seed["ng"] as List<Map<String, Any?>>?)?.let { d.ng = it.map(::ruleOf) }
        for ((k, v) in (seed["settings"] as Map<String, Any?>?).orEmpty()) d.sql.batch(listOf(setSetting(k, v)))
        for (t in (seed["threads"] as List<Map<String, Any?>>?).orEmpty()) {
            d.sql.exec(
                "INSERT INTO threads (board_url, key, connector_id, title, post_count, read_no, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                threadSql(t) + listOf(t["post_count"] as Long? ?: 0L, t["read_no"] as Long? ?: 0L, t["created_at"], (t["read_ago_ms"] as Long?)?.let { START - it }),
            )
        }
        for (p in (seed["posts"] as List<Map<String, Any?>>?).orEmpty()) {
            d.sql.exec(
                "INSERT INTO post_history (connector_id, board_url, key, thread_title, no, name, mail, body, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                listOf("2ch-compat", p["board"], p["key"], p["title"] as String? ?: "", p["no"], p["name"] as String? ?: "", p["mail"] as String? ?: "", p["body"], START - (p["ago_ms"] as Long? ?: 0L)),
            )
        }
    }
    val label = c["name"] as String
    for (s in c["steps"] as List<Map<String, Any?>>) runStep(w, s, label)
    (c["expected"] as Map<String, Any?>?)?.let { check(w, it, label) }
    val digests = LinkedHashMap<String, String>()
    for ((name, d) in w.devices) {
        digests[name] = d.digest()
        d.sql.close()
    }
    return digests
}

@Suppress("UNCHECKED_CAST")
class SyncScenarioTest {
    private fun load(file: String) = parseStrictJson(javaClass.classLoader!!.getResourceAsStream(file)!!.readBytes().toString(Charsets.UTF_8))

    @Test fun 共通シナリオがPCと同じ結果になる() = runBlocking {
        val scenarios = load("sync-client.json") as List<Map<String, Any?>>
        val digests = load("sync-client-digests.json") as Map<String, Map<String, String>>
        val fails = ArrayList<String>()
        for (c in scenarios) {
            val name = c["name"] as String
            try {
                val got = runScenario(c)
                if (canonicalJson(got) != canonicalJson(digests[name])) fails += "$name: digest が PC と違う"
            } catch (e: Throwable) {
                fails += "$name: ${e.message ?: e}"
            }
        }
        assertEquals(true, scenarios.size >= 11)
        if (fails.isNotEmpty()) fail("${scenarios.size} 件のうち ${fails.size} 件が違う\n" + fails.joinToString("\n"))
    }

    /** 順序・重複・中断を乱数で作った手順。digest まで PC と同じになる */
    @Test fun 乱数のシナリオがPCと同じ結果になる() = runBlocking {
        val scenarios = load("sync-client-random.json") as List<Map<String, Any?>>
        val digests = load("sync-client-digests.json") as Map<String, Map<String, String>>
        val fails = ArrayList<String>()
        for (c in scenarios) {
            val name = c["name"] as String
            try {
                val got = runScenario(c)
                if (canonicalJson(got) != canonicalJson(digests[name])) fails += "$name: digest が PC と違う"
            } catch (e: Throwable) {
                fails += "$name: ${e.message ?: e}"
            }
        }
        assertEquals(20, scenarios.size)
        if (fails.isNotEmpty()) fail("${scenarios.size} 件のうち ${fails.size} 件が違う\n" + fails.joinToString("\n"))
    }

    @Test fun 五千スレと五千件の書き込みを持つ二台が合流する() = runBlocking {
        val board = "https://a.5ch.io/x/"
        fun threads(from: Int, to: Int, ago: Long) = (from until to).map { i -> mapOf("board" to board, "key" to "$i", "title" to "スレ $i", "read_no" to 1L + ((i - from) % 500), "read_ago_ms" to ago + (i - from), "post_count" to 600L) }
        fun posts(from: Int, to: Int, ago: Long) = (from until to).map { i -> mapOf("board" to board, "key" to "$i", "title" to "スレ $i", "no" to 1L, "body" to "本文 $i", "ago_ms" to ago + i) }
        val c = mapOf(
            "name" to "5,000 件の合流",
            "devices" to listOf("pc", "phone"),
            "seed" to mapOf(
                "pc" to mapOf("threads" to threads(0, 5000, 1000), "posts" to posts(0, 5000, 1000)),
                "phone" to mapOf("threads" to threads(2500, 7500, 2000), "posts" to posts(2500, 7500, 1000)),
            ),
            "steps" to listOf(
                mapOf("device" to "pc", "op" to "pair_first"),
                mapOf("device" to "phone", "op" to "pair_join", "from" to "pc"),
                mapOf("op" to "settle"),
                mapOf("op" to "converged"),
                mapOf("op" to "summary_same"),
                mapOf("op" to "expect", "expect" to mapOf("pc" to mapOf("pending" to 0L, "ops" to 0L, "needs_apply" to 0L, "kinds" to mapOf("last_view" to 7500L, "read_dev" to 10000L, "post" to 7500L)))),
            ),
        )
        val at = System.currentTimeMillis()
        runScenario(c)
        println("合流 2 台(閲覧 7,500・書き込み 7,500・レコード 25,000): ${System.currentTimeMillis() - at} ms")
    }

    @Test fun 書き込みのIDと切り方とハッシュが表と同じ() {
        val t = load("sync-post.json") as Map<String, Any?>
        for (p in t["posts"] as List<Map<String, Any?>>) {
            val body = p["body"] as String
            assertEquals("${p["name"]} の長さ", (p["cut_length"] as Long).toInt(), fitPostBody(body).length)
            assertEquals("${p["name"]} の ID", p["post_id"], postIdOf(p["board"] as String, p["key"] as String, p["posted_at"] as Long, body))
        }
        for (h in t["hash_lines"] as List<Map<String, Any?>>) {
            assertEquals(h["hash"], io.github.contentsview08.obb.sync.engine.hashLines(h["lines"] as List<String>))
        }
    }

    @Test fun 定数と待ち時間とサーバーのURLが表と同じ() {
        val cfg = load("sync-config.json") as Map<String, Any?>
        val c = cfg["constants"] as Map<String, Long>
        val actual = mapOf(
            "SCHEMA_VERSION" to SyncConfig.SCHEMA_VERSION, "PULL_MIN_GAP_MS" to SyncConfig.PULL_MIN_GAP_MS, "HISTORY_SHOWN" to SyncConfig.HISTORY_SHOWN.toLong(), "HTTP_TIMEOUT_MS" to SyncConfig.HTTP_TIMEOUT_MS,
            "BACKOFF_MIN_MS" to SyncConfig.BACKOFF_MIN_MS, "BACKOFF_MAX_MS" to SyncConfig.BACKOFF_MAX_MS, "MAX_RESPONSE_BYTES" to SyncConfig.MAX_RESPONSE_BYTES.toLong(),
            "PUSH_BATCH_RECORDS" to SyncConfig.PUSH_BATCH_RECORDS.toLong(), "PUSH_BATCH_BYTES" to SyncConfig.PUSH_BATCH_BYTES.toLong(), "PUSH_MAX_ROUNDS" to SyncConfig.PUSH_MAX_ROUNDS.toLong(),
            "APPLY_BATCH" to SyncConfig.APPLY_BATCH.toLong(), "WRITE_BATCH" to SyncConfig.WRITE_BATCH.toLong(), "APPLY_SPLIT_AFTER" to SyncConfig.APPLY_SPLIT_AFTER.toLong(),
            "REBASE_LIMIT" to SyncConfig.REBASE_LIMIT.toLong(), "REBASE_WINDOW_MS" to SyncConfig.REBASE_WINDOW_MS, "RECREATE_RETRY_MS" to SyncConfig.RECREATE_RETRY_MS,
            "JOIN_CONFIRM_MIN" to SyncConfig.JOIN_CONFIRM_MIN.toLong(), "RESET_BATCH_MAX" to SyncConfig.RESET_BATCH_MAX.toLong(), "RESET_TOTAL_MAX" to SyncConfig.RESET_TOTAL_MAX.toLong(),
            "TRIM_BATCH" to SyncConfig.TRIM_BATCH.toLong(), "TRIM_ROUNDS" to SyncConfig.TRIM_ROUNDS.toLong(),
            "HEAD_INTERVAL_MS" to SyncConfig.HEAD_INTERVAL_MS, "PUSH_INTERVAL_MS" to SyncConfig.PUSH_INTERVAL_MS, "HEAD_BACKOFF_MAX_MS" to SyncConfig.HEAD_BACKOFF_MAX_MS, "NET_SETTLE_MS" to SyncConfig.NET_SETTLE_MS,
            "NET_MIN_GAP_MS" to SyncConfig.NET_MIN_GAP_MS, "IDLE_STOP_MS" to SyncConfig.IDLE_STOP_MS,
        )
        assertEquals(c.toSortedMap(), actual.toSortedMap())
        for (b in cfg["backoff"] as List<Map<String, Any?>>) {
            val j = when (val v = b["jitter"]) {
                is Long -> v.toDouble()
                else -> v as Double
            }
            assertEquals(b.toString(), b["ms"], SyncConfig.backoffDelayMs((b["attempt"] as Long).toInt(), j))
        }
        for (u in cfg["server_url"] as List<Map<String, Any?>>) {
            val got = try {
                checkServerUrl(u["url"] as String, u["allow_localhost"] == true)
            } catch (_: Exception) {
                null
            }
            assertEquals(u["url"].toString(), u["ok"], got)
        }
    }
}
