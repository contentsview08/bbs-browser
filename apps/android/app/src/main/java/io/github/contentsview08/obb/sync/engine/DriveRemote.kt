package io.github.contentsview08.obb.sync.engine

import io.github.contentsview08.obb.sync.RecordContext
import io.github.contentsview08.obb.sync.SyncConfig
import io.github.contentsview08.obb.sync.SyncError
import io.github.contentsview08.obb.sync.canonicalJson
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.sealPayload
import io.github.contentsview08.obb.sync.toBase64Url
import io.github.contentsview08.obb.sync.toHex
import kotlinx.coroutines.CancellationException
import java.security.SecureRandom
import java.time.Instant
import java.time.ZoneOffset

// Google ドライブのアプリ専用フォルダ(appDataFolder)を置き場にする SyncRemote。PC 版の packages/sync/src/engine/drive.ts の写しで、
// セグメントの書き方・目印・changes.list と token・全件の読み取り・エラーの写し方を同じにする(決まりは docs/sync-drive.md の 2・3・7.2 章)。
// Drive は採番も比較もしないので、端末は自分のファイルにしか書かず、他の端末のファイルを読んでマージする。
// 通信は SyncTransport を借りる(https だけ・リダイレクトをたどらない)。アクセストークンの取り方は持たず、外から受け取る

const val DRIVE_API = "https://www.googleapis.com/drive/v3"
const val DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3"
/** ファイルの形の版(appProperties の f と中身の obbsync)。知らない版のファイルは読まない */
const val DRIVE_FORMAT = 1L
/** 1 ファイルを丸ごと読むので、サーバーの 1 ページ(MAX_RESPONSE_BYTES)より大きく取る */
const val MAX_DRIVE_FILE_BYTES = 5 * 1024 * 1024
/** 上書きのたびに古い版が残るので、超えそうなら閉じて次のセグメントへ */
const val DRIVE_SEG_BYTES = 512 * 1024

private const val FILE_FIELDS = "id,name,appProperties,version,size,trashed,createdTime"
private val RATE_REASONS = setOf("userRateLimitExceeded", "rateLimitExceeded")

class DriveFile(val id: String, val appProperties: Map<String, String>?, val version: Long, val createdTime: String?, val trashed: Boolean)

private class DriveChange(val fileId: String, val removed: Boolean, val file: DriveFile?)

/** 開いているセグメント。中身は送るたびに同期の表から作り直す(暗号文を手元に置かない) */
private class SegState(val n: Long, val day: String, val file: String?, val ids: List<String>)

/**
 * accessToken は Drive へ付けるアクセストークン。引数の true は 401 のあとの取り直し(1 回だけ)。
 * 取り直せない(invalid_grant など)ときは SyncApiError("http", 401, GOOGLE_AUTH_FAILED) を投げる
 */
class DriveRemoteOptions(
    val transport: SyncTransport,
    val accessToken: suspend (fresh: Boolean) -> String,
    /** 目印の e。テストで固定する */
    val newEpoch: (() -> String)? = null,
)

fun driveRemote(o: DriveRemoteOptions): SyncRemoteFactory = { c -> DriveRemote(c, o) }

private fun bad() = SyncApiError("bad_response")

/** encodeURIComponent と同じ。PC と同じ URL を作る */
private fun enc(s: String): String {
    val out = StringBuilder()
    for (b in s.toByteArray(Charsets.UTF_8)) {
        val c = b.toInt() and 0xff
        val ch = c.toChar()
        if (ch in 'A'..'Z' || ch in 'a'..'z' || ch in '0'..'9' || ch in "-_.!~*'()") out.append(ch) else out.append('%').append("%02X".format(c))
    }
    return out.toString()
}

private fun query(q: Map<String, String>) = q.entries.joinToString("&") { "${enc(it.key)}=${enc(it.value)}" }

private fun utcDay(ms: Long) = Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()

private fun ok(res: SyncResponse) = res.status in 200..299

private fun errorReason(body: String): String = try {
    val v = parseStrictJson(body) as? Map<*, *>
    val first = ((v?.get("error") as? Map<*, *>)?.get("errors") as? List<*>)?.firstOrNull() as? Map<*, *>
    first?.get("reason") as? String ?: ""
} catch (_: Exception) {
    ""
}

/** Drive の失敗をエンジンの今の分け方へ写す(7.2)。404 は呼ぶ側が意味を決めるので、ここへ来たものは領域の消失と読み違えないようにする */
private fun driveError(res: SyncResponse): SyncApiError {
    val reason = errorReason(res.body)
    if (res.status == 429) return SyncApiError("http", 429)
    if (res.status == 403 && reason in RATE_REASONS) return SyncApiError("http", 429, "rate_limited")
    if (res.status == 403 && reason == "storageQuotaExceeded") return SyncApiError("http", 413, "quota_exceeded")
    if (res.status == 404) return bad()
    // 5xx の理由(backendError など)は画面の言葉にならないので、サーバーと同じく番号で出す
    return SyncApiError("http", res.status, if (res.status >= 500) "" else reason.take(64))
}

@Suppress("UNCHECKED_CAST")
private fun parseObject(body: String): Map<String, Any?> {
    val v = try {
        parseStrictJson(body)
    } catch (_: Exception) {
        throw bad()
    }
    return v as? Map<String, Any?> ?: throw bad()
}

private fun checkFile(v: Any?): DriveFile {
    val o = v as? Map<*, *> ?: throw bad()
    val id = o["id"] as? String
    if (id.isNullOrEmpty()) throw bad()
    val props = o["appProperties"]
    if (o.containsKey("appProperties") && (props !is Map<*, *> || !props.values.all { it is String })) throw bad()
    @Suppress("UNCHECKED_CAST")
    val p = props as Map<String, String>?
    val version = when (val x = o["version"]) {
        is String -> x.toLongOrNull()?.takeIf { it >= 0 } ?: 0L
        is Long -> x.coerceAtLeast(0)
        else -> 0L
    }
    return DriveFile(id, p, version, o["createdTime"] as? String, o["trashed"] == true)
}

private class ReadOut(val records: List<Map<String, Any?>>, val seen: LinkedHashMap<String, Long>, val bad: List<String>)

private class Classified(val markerTouched: Boolean, val toRead: List<DriveFile>, val removed: List<String>)

@Suppress("UNCHECKED_CAST")
class DriveRemote(private val c: RemoteContext, private val o: DriveRemoteOptions) : SyncRemote {
    override val pace: SyncPace? = null
    override val needsTicket = false
    private val t = SyncTables(c.db)

    // ── 通信 ──

    private suspend fun request(method: String, url: String, body: String? = null, contentType: String? = null, maxBytes: Int = SyncConfig.MAX_RESPONSE_BYTES): SyncResponse {
        var attempt = 0
        while (true) {
            val headers = LinkedHashMap<String, String>()
            headers["Authorization"] = "Bearer ${o.accessToken(attempt > 0)}"
            if (contentType != null) headers["Content-Type"] = contentType
            val res = try {
                o.transport.send(SyncRequest(method, url, headers, body, maxBytes, SyncConfig.HTTP_TOTAL_TIMEOUT_MS, SyncConfig.HTTP_IDLE_TIMEOUT_MS))
            } catch (e: CancellationException) {
                throw e
            } catch (_: SyncResponseTooLarge) {
                throw SyncApiError("too_large")
            } catch (_: Exception) {
                throw SyncApiError("network")
            }
            if (res.status in 300..399) throw SyncApiError("redirect", res.status)
            if (res.body.length > maxBytes) throw SyncApiError("too_large")
            // アクセストークンの期限切れ。1 回だけ取り直して送り直す
            if (res.status == 401 && attempt == 0) {
                attempt++
                continue
            }
            if (res.status == 401) throw SyncApiError("http", 401, GOOGLE_AUTH_FAILED)
            return res
        }
    }

    private suspend fun json(method: String, url: String): Map<String, Any?> {
        val res = request(method, url)
        if (!ok(res)) throw driveError(res)
        return parseObject(res.body)
    }

    private suspend fun startToken(): String {
        val r = json("GET", "$DRIVE_API/changes/startPageToken?${query(mapOf("fields" to "startPageToken"))}")
        val token = r["startPageToken"] as? String
        if (token.isNullOrEmpty()) throw bad()
        return token
    }

    /** appDataFolder の全ファイル。2〜3 台なら 1 ページ */
    private suspend fun listAll(): List<DriveFile> {
        val out = ArrayList<DriveFile>()
        var page: String? = null
        while (true) {
            val q = linkedMapOf("spaces" to "appDataFolder", "pageSize" to "1000", "fields" to "nextPageToken,files($FILE_FIELDS)")
            if (page != null) q["pageToken"] = page
            val r = json("GET", "$DRIVE_API/files?${query(q)}")
            val files = r["files"] as? List<*> ?: throw bad()
            files.mapTo(out, ::checkFile)
            if (!r.containsKey("nextPageToken")) return out
            val next = r["nextPageToken"] as? String
            if (next == null || next == page) throw SyncApiError("no_progress")
            page = next
        }
    }

    /** token からの変更。token を断られたら null(3.7: 全件の読み取りへ切り替える) */
    private suspend fun scanChanges(token: String): Pair<List<DriveChange>, String>? {
        val byFile = LinkedHashMap<String, DriveChange>()
        var page = token
        while (true) {
            val q = linkedMapOf(
                "pageToken" to page, "spaces" to "appDataFolder", "pageSize" to "1000", "includeRemoved" to "true",
                "fields" to "changes(fileId,removed,file($FILE_FIELDS)),nextPageToken,newStartPageToken",
            )
            val res = request("GET", "$DRIVE_API/changes?${query(q)}")
            if (res.status == 400 || res.status == 404) return null
            if (!ok(res)) throw driveError(res)
            val r = parseObject(res.body)
            val changes = r["changes"] as? List<*> ?: throw bad()
            for (x in changes) {
                val ch = x as? Map<*, *> ?: throw bad()
                val fileId = ch["fileId"] as? String ?: throw bad()
                // 同じファイルが何度来ても、最後の状態だけを見る
                byFile.remove(fileId)
                byFile[fileId] = DriveChange(fileId, ch["removed"] == true, ch["file"]?.let(::checkFile))
            }
            val fresh = r["newStartPageToken"] as? String
            if (!fresh.isNullOrEmpty()) return byFile.values.toList() to fresh
            val next = r["nextPageToken"] as? String
            if (next == null || next == page) throw SyncApiError("no_progress")
            page = next
        }
    }

    private fun multipart(meta: Map<String, Any?>, content: String): Pair<String, String> {
        val b = "obbsync_${ByteArray(12).also { SecureRandom().nextBytes(it) }.toHex()}"
        return "--$b\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${canonicalJson(meta)}\r\n--$b\r\nContent-Type: application/json\r\n\r\n$content\r\n--$b--" to "multipart/related; boundary=$b"
    }

    private suspend fun createFile(meta: Map<String, Any?>, content: String): String {
        val (body, type) = multipart(meta + ("parents" to listOf("appDataFolder")), content)
        val res = request("POST", "$DRIVE_UPLOAD/files?${query(mapOf("uploadType" to "multipart", "fields" to "id,version"))}", body, type)
        if (!ok(res)) throw driveError(res)
        return checkFile(parseObject(res.body)).id
    }

    /** 上書き。ファイルが消えていたら false */
    private suspend fun updateFile(id: String, content: String): Boolean {
        val (body, type) = multipart(emptyMap(), content)
        val res = request("PATCH", "$DRIVE_UPLOAD/files/${enc(id)}?${query(mapOf("uploadType" to "multipart", "fields" to "id,version"))}", body, type)
        if (res.status == 404) return false
        if (!ok(res)) throw driveError(res)
        return true
    }

    private suspend fun deleteFile(id: String) {
        val res = request("DELETE", "$DRIVE_API/files/${enc(id)}")
        if (!ok(res) && res.status != 404) throw driveError(res)
    }

    // ── 読み分け ──

    private fun props(f: DriveFile): Map<String, String>? {
        val p = f.appProperties ?: return null
        return if (p["f"] == DRIVE_FORMAT.toString() && p["s"] == c.spaceId) p else null
    }

    /** 他の端末のレコードのファイル。自分の書いたものは読み戻さない(手元が正) */
    private fun isOthersData(f: DriveFile): Boolean {
        val p = props(f) ?: return false
        val d = p["d"]
        return !f.trashed && (p["t"] == "seg" || p["t"] == "snap") && d != null && d != c.deviceId
    }

    /** 目印が 2 つあれば(2 台が同時に作った)、作った時刻の古い方、同じなら id の小さい方を正にする */
    private fun winner(files: List<DriveFile>): DriveFile? = files.filter { f ->
        val p = props(f)
        val e = p?.get("e")
        p != null && !f.trashed && p["t"] == "space" && e != null && e.isNotEmpty() && e.length <= 128
    }.sortedWith(compareBy<DriveFile> { it.createdTime ?: "" }.thenBy { it.id }).firstOrNull()

    private fun epochOf(f: DriveFile) = f.appProperties!!.getValue("e")

    private fun seen(): LinkedHashMap<String, Long> {
        val raw = t.state("drive_seen") ?: return LinkedHashMap()
        return LinkedHashMap(parseStrictJson(raw) as Map<String, Long>)
    }

    private fun classify(changes: List<DriveChange>, seen: Map<String, Long>, marker: String?): Classified {
        var markerTouched = false
        val toRead = ArrayList<DriveFile>()
        val removed = ArrayList<String>()
        for (ch in changes) {
            val f = ch.file
            if (ch.removed || f == null || f.trashed) {
                if (ch.fileId == marker) markerTouched = true
                removed += ch.fileId
                continue
            }
            val p = props(f) ?: continue
            if (p["t"] == "space") markerTouched = true
            else if (isOthersData(f) && f.version > (seen[f.id] ?: 0L)) toRead += f
        }
        return Classified(markerTouched, toRead, removed)
    }

    /** ファイルを読み、レコードに端末の中だけの通番を振る。読む間に消えたもの(404)は飛ばす(消えた印は次の変更で来る) */
    private suspend fun readFiles(files: List<DriveFile>, since: Long): ReadOut {
        val records = ArrayList<Map<String, Any?>>()
        val seen = LinkedHashMap<String, Long>()
        val badList = ArrayList<String>()
        var version = since
        for (f in files) {
            val res = request("GET", "$DRIVE_API/files/${enc(f.id)}?${query(mapOf("alt" to "media"))}", maxBytes = MAX_DRIVE_FILE_BYTES)
            if (res.status == 404) continue
            if (!ok(res)) throw driveError(res)
            seen[f.id] = f.version
            val list = parseFile(f, res.body)
            if (list == null) {
                badList += "drive_mismatch"
                continue
            }
            for (r in list) records += r + ("version" to ++version)
        }
        return ReadOut(records, seen, badList)
    }

    /** 見出しが appProperties と違うファイルは丸ごと捨てる(2.3)。レコードの形は openRecords が確かめる */
    private fun parseFile(f: DriveFile, body: String): List<Map<String, Any?>>? {
        val p = f.appProperties!!
        val v = try {
            parseStrictJson(body)
        } catch (_: Exception) {
            return null
        } as? Map<*, *> ?: return null
        val records = v["records"] as? List<*>
        if (v["obbsync"] != DRIVE_FORMAT || v["space"] != c.spaceId || v["device"] != p["d"] || v["type"] != p["t"] || records == null) return null
        if (p["t"] == "seg" && v["n"]?.toString() != p["n"]) return null
        return records.map { r ->
            val m = r as? Map<*, *> ?: return@map emptyMap()
            linkedMapOf("record_id" to m["record_id"], "kind_tag" to m["kind_tag"], "schema_version" to m["schema_version"], "nonce" to m["nonce"], "ciphertext" to m["ciphertext"])
        }
    }

    private suspend fun knownEpoch(): String {
        t.state("epoch")?.let { return it }
        val m = winner(listAll()) ?: throw SyncApiError("http", 404, "space_not_found")
        return epochOf(m)
    }

    // ── 口 ──

    /**
     * 前置きの確認(3.1)。token が手元と同じなら 304 と同じ。違えば変更を見て、他の端末の変化か目印の変化があれば「変化あり」。
     * 自分の書いたものだけなら token を進めて「変化なし」にする
     */
    override suspend fun head(etag: String?): HeadResult {
        val known = t.state("drive_token")
        val since = t.state("since")?.toLong() ?: 0L
        val changed = HeadResult(since + 1, t.state("epoch") ?: "", 0L)
        if (known == null) return changed
        if (startToken() == known) return HeadResult(null)
        val (changes, next) = scanChanges(known) ?: return changed
        val seen = seen()
        val cl = classify(changes, seen, t.state("drive_space"))
        if (cl.markerTouched || cl.toRead.isNotEmpty()) return changed
        for (id in cl.removed) seen.remove(id)
        c.db.batch(listOf(setState("drive_token", next), setState("drive_seen", canonicalJson(seen))))
        return HeadResult(null)
    }

    override suspend fun changes(since: Long): ChangesPage {
        val token = if (since == 0L) null else t.state("drive_token")
        if (token == null) return fullRead(since)
        // token を断られた。手元を消さない全件の読み取り(マージだけ)にする
        val (changes, next) = scanChanges(token) ?: return fullRead(since)
        val seen = seen()
        val marker = t.state("drive_space")
        val cl = classify(changes, seen, marker)
        val commit = ArrayList<SqlStatement>()
        var epoch = t.state("epoch")
        if (cl.markerTouched || marker == null || epoch == null) {
            val m = winner(listAll()) ?: throw SyncApiError("http", 404, "space_not_found")
            epoch = epochOf(m)
            commit += setState("drive_space", m.id)
        }
        val read = readFiles(cl.toRead, since)
        for (id in cl.removed) seen.remove(id)
        seen.putAll(read.seen)
        commit += listOf(setState("drive_token", next), setState("drive_seen", canonicalJson(seen)), setState("drive_read_at", c.now().toString()))
        return ChangesPage(read.records, since + read.records.size, false, epoch, 0L, commit, read.bad)
    }

    /**
     * 全件の読み取り(3.4)。一覧より先に token を取っておき、一覧の後に起きた変更を次の周で拾う。
     * head は読んだ数より 1 つ進め、空の領域でも次からは変更だけを読むようにする
     */
    private suspend fun fullRead(since: Long): ChangesPage {
        val start = startToken()
        val files = listAll()
        val m = winner(files) ?: throw SyncApiError("http", 404, "space_not_found")
        val read = readFiles(files.filter(::isOthersData), since)
        val commit = listOf(setState("drive_token", start), setState("drive_seen", canonicalJson(read.seen)), setState("drive_space", m.id), setState("drive_read_at", c.now().toString()))
        return ChangesPage(read.records, since + read.records.size + 1, false, epochOf(m), 0L, commit, read.bad)
    }

    /**
     * 開いているセグメントを、今までに入れたレコードの今の値 + 今回の分で上書きする(1 回の送信 = 1 回の書き込み)。
     * 書き込みはぶつからないので 409 はない。version は since の続きを振り、エンジンが自分の送ったものを読み戻さないようにする
     */
    override suspend fun pushRecords(requestId: String, records: List<Map<String, Any?>>): PushResponse {
        val day = utcDay(c.now())
        var seg = t.state("drive_seg")?.let { raw ->
            val m = parseStrictJson(raw) as Map<String, Any?>
            SegState(m["n"] as Long, m["day"] as String, m["file"] as String?, (m["ids"] as List<String>))
        } ?: SegState(0, "", null, emptyList())
        val fresh = records.map { r -> linkedMapOf("record_id" to r["record_id"], "kind_tag" to r["kind_tag"], "schema_version" to r["schema_version"], "nonce" to r["nonce"], "ciphertext" to r["ciphertext"]) }
        val freshIds = fresh.map { it["record_id"] as String }.toSet()
        var prev: List<Map<String, Any?>> = emptyList()
        var close = !(seg.n > 0 && seg.day == day)
        if (!close) {
            val want = seg.ids.filter { it !in freshIds }
            prev = reseal(want)
            // 表から消えたもの(権限系を切った・期限の切れた tombstone)は封をし直せない。上書きで Drive から消さないよう、閉じて残す
            close = prev.size < want.size
        }
        var body = prev + fresh
        if (close || (prev.isNotEmpty() && segContent(seg.n, body).length > DRIVE_SEG_BYTES)) {
            seg = SegState(seg.n + 1, day, null, emptyList())
            body = fresh
        }
        var file = seg.file
        if (file != null && !updateFile(file, segContent(seg.n, body))) {
            // 消えていた(領域の削除など)。同じ通番のファイルを 2 つ作らないよう、次の通番で作る
            seg = SegState(seg.n + 1, day, null, emptyList())
            file = null
        }
        if (file == null) file = createFile(mapOf("name" to segName(seg.n), "appProperties" to segProps(seg.n)), segContent(seg.n, body))
        c.db.batch(listOf(setState("drive_seg", canonicalJson(mapOf("n" to seg.n, "day" to seg.day, "file" to file, "ids" to body.map { it["record_id"] })))))
        val since = t.state("since")?.toLong() ?: 0L
        return PushResponse(records.mapIndexed { i, r -> PushResult(r["record_id"] as String, 200L, since + 1 + i, null) }, knownEpoch(), 0L)
    }

    /** 前に入れたレコードを同期の表の今の値で封をし直す。表から消えたもの・封ができないものは外す */
    private fun reseal(ids: List<String>): List<Map<String, Any?>> {
        val rows = t.records(ids)
        val out = ArrayList<Map<String, Any?>>()
        for (id in ids) {
            val r = rows[id] ?: continue
            try {
                val (nonce, ciphertext) = sealPayload(c.keys, RecordContext(c.spaceId, id, r.kindTag, r.schemaVersion), r.payload)
                out += linkedMapOf("record_id" to id, "kind_tag" to r.kindTag, "schema_version" to r.schemaVersion, "nonce" to nonce, "ciphertext" to ciphertext)
            } catch (_: SyncError) {
                // 大きすぎるなど。このセグメントには入れない
            }
        }
        return out
    }

    private fun prefix() = "obbsync$DRIVE_FORMAT.${c.spaceId.take(16)}"

    private fun segName(n: Long) = "${prefix()}.${c.deviceId}.seg.$n"

    private fun segProps(n: Long) = mapOf("f" to DRIVE_FORMAT.toString(), "s" to c.spaceId, "t" to "seg", "d" to c.deviceId, "n" to n.toString())

    private fun segContent(n: Long, records: List<Map<String, Any?>>) =
        canonicalJson(mapOf("obbsync" to DRIVE_FORMAT, "space" to c.spaceId, "device" to c.deviceId, "type" to "seg", "n" to n, "records" to records))

    /**
     * 目印を作る(なければ)。許可証は使わない。2 台が同時に作ったら、作った後に一覧で正を決め、負けた方は自分の目印を消す
     */
    override suspend fun createSpace(ticket: String?): String {
        winner(listAll())?.let { existing ->
            c.db.batch(listOf(setState("drive_space", existing.id)))
            return epochOf(existing)
        }
        val e = o.newEpoch?.invoke() ?: toBase64Url(ByteArray(16).also { SecureRandom().nextBytes(it) })
        val mine = createFile(mapOf("name" to "${prefix()}.space", "appProperties" to mapOf("f" to DRIVE_FORMAT.toString(), "s" to c.spaceId, "t" to "space", "e" to e)), "")
        val w = winner(listAll())
        if (w != null && w.id != mine) {
            deleteFile(mine)
            c.db.batch(listOf(setState("drive_space", w.id)))
            return epochOf(w)
        }
        c.db.batch(listOf(setState("drive_space", mine)))
        return e
    }
}
