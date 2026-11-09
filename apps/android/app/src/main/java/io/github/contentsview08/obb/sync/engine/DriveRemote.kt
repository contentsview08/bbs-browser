package io.github.contentsview08.obb.sync.engine

import io.github.contentsview08.obb.sync.Hlc
import io.github.contentsview08.obb.sync.RecordContext
import io.github.contentsview08.obb.sync.SyncConfig
import io.github.contentsview08.obb.sync.SyncError
import io.github.contentsview08.obb.sync.TOMB_MAX_AGE_MS
import io.github.contentsview08.obb.sync.canonicalJson
import io.github.contentsview08.obb.sync.openRecords
import io.github.contentsview08.obb.sync.parseStrictJson
import io.github.contentsview08.obb.sync.sealPayload
import io.github.contentsview08.obb.sync.toBase64Url
import io.github.contentsview08.obb.sync.toHex
import kotlinx.coroutines.CancellationException
import java.security.SecureRandom
import java.time.Instant
import java.time.ZoneOffset

// Google ドライブのアプリ専用フォルダ(appDataFolder)を置き場にする SyncRemote。PC 版の packages/sync/src/engine/drive.ts の写しで、
// セグメントの書き方・目印・changes.list と token・全件の読み取り・まとめ直し・エラーの写し方を同じにする(決まりは docs/sync-drive.md の 2・3・7.2 章)。
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
/** まとめ直しの条件(2.5)。閉じたセグメントがこの数以上か、その合計がこの大きさ以上 */
const val DRIVE_COMPACT_SEGS = 7
const val DRIVE_COMPACT_BYTES = 2L * 1024 * 1024
/** まとめ直しは 1 日 1 回まで。容量の超過で作れなかったときも、この間は試さない */
const val DRIVE_COMPACT_GAP_MS = 24L * 60 * 60 * 1000
/** スナップショットの 1 部分。本文とメタデータを 1 回で送る multipart(5MB まで)に収める。見出しの分を残す */
const val DRIVE_SNAP_PART_BYTES = 4 * 1024 * 1024 - 4096

private const val FILE_FIELDS = "id,name,appProperties,version,size,trashed,createdTime"
private val RATE_REASONS = setOf("userRateLimitExceeded", "rateLimitExceeded")

class DriveFile(val id: String, val appProperties: Map<String, String>?, val version: Long, val createdTime: String?, val trashed: Boolean)

private class DriveChange(val fileId: String, val removed: Boolean, val file: DriveFile?)

/** 最後の版が分からないセグメント(版を控える前の drive_seg)。読む側が「最後の版まで読んだ」と決めないよう、どの版より大きくする(appProperties の 15 桁に収める) */
private const val UNKNOWN_VERSION = 999_999_999_999_999L

/** 開いているセグメント。中身は送るたびに同期の表から作り直す(暗号文を手元に置かない)。v と bytes は最後に書いた版と大きさ */
private class SegState(val n: Long, val day: String, val file: String?, val ids: List<String>, val v: Long = UNKNOWN_VERSION, val bytes: Long = 0)

/** 閉じたセグメント。まとめ直しで消すまで、中のレコード ID と最後の版を控える */
private class ClosedSeg(val n: Long, val file: String, val v: Long, val bytes: Long, val ids: List<String>) {
    fun toJson() = mapOf("n" to n, "file" to file, "v" to v, "bytes" to bytes, "ids" to ids)
}

/** 自分のファイルの控え(drive_own)。中身を読み戻さずに、まとめ直しとリベースで使う */
private class OwnSnap(val u: Long, val g: Long, val files: List<String>, val ids: List<String>)

private class OwnFiles(val snap: OwnSnap?, val segs: List<ClosedSeg>) {
    fun toJson(): Map<String, Any?> {
        val m = LinkedHashMap<String, Any?>()
        if (snap != null) m["snap"] = mapOf("u" to snap.u, "g" to snap.g, "files" to snap.files, "ids" to snap.ids)
        m["segs"] = segs.map { it.toJson() }
        return m
    }
}

/** 途中のまとめ直し(drive_compact)。部分ごとのレコード ID を先に決め、作り終えた部分の ID を足していく */
private class CompactJob(
    val u: Long,
    /** 含めた最後のセグメントの最後の版。読む側が「もう全部読んだか」を決めるのに使う */
    val uv: Long,
    val g: Long,
    /** tombstone を落とす基準の時刻。続きから作るときも同じ基準にする */
    val cut: Long,
    /** 作り終えたら消す古いファイル */
    val del: List<String>,
    val parts: List<List<String>>,
    val done: List<String>,
    /** 容量の超過で止めたとき、次に試してよい時刻 */
    val wait: Long? = null,
) {
    fun toJson(): Map<String, Any?> {
        val m = linkedMapOf<String, Any?>("u" to u, "uv" to uv, "g" to g, "cut" to cut, "del" to del, "parts" to parts, "done" to done)
        if (wait != null) m["wait"] = wait
        return m
    }
}

private class SnapInfo(val d: String, val u: Long, val uv: Long, val g: Long, val i: Int, val n: Int)

private class Best(val info: SnapInfo, val parts: List<DriveFile>)

private class ReadPlan(val read: List<DriveFile>, val mark: List<DriveFile>, val g: Long)

private class Resealed(val sealed: List<Map<String, Any?>>, val missing: List<String>, val dropped: Boolean)

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

private val PROP_NUM = Regex("\\d{1,15}")
private val PART = Regex("(\\d{1,4})/(\\d{1,4})")

/** appProperties の数(10 進の文字列)。形が違えば null */
private fun propNum(s: String?): Long? = if (s != null && PROP_NUM.matches(s)) s.toLong() else null

/** 封をしたレコード(ファイルに入れる形) */
private fun sealedOf(m: Map<*, *>): Map<String, Any?> =
    linkedMapOf("record_id" to m["record_id"], "kind_tag" to m["kind_tag"], "schema_version" to m["schema_version"], "nonce" to m["nonce"], "ciphertext" to m["ciphertext"])

@Suppress("UNCHECKED_CAST")
private fun closedSegOf(m: Map<String, Any?>) = ClosedSeg(m["n"] as Long, m["file"] as String, m["v"] as Long, m["bytes"] as Long, m["ids"] as List<String>)

@Suppress("UNCHECKED_CAST")
private fun compactJobOf(m: Map<String, Any?>) = CompactJob(
    m["u"] as Long, m["uv"] as Long, m["g"] as Long, m["cut"] as Long, m["del"] as List<String>, m["parts"] as List<List<String>>, m["done"] as List<String>, m["wait"] as Long?,
)

/** 部分に分ける。1 部分は DRIVE_SNAP_PART_BYTES まで。レコードがなくても 1 部分は作る(u と g を伝えるため) */
private fun splitParts(records: List<Map<String, Any?>>): List<List<Map<String, Any?>>> {
    val parts = arrayListOf(ArrayList<Map<String, Any?>>())
    var size = 0
    for (r in records) {
        val n = canonicalJson(r).length + 1
        if (size + n > DRIVE_SNAP_PART_BYTES && parts.last().isNotEmpty()) {
            parts += ArrayList<Map<String, Any?>>()
            size = 0
        }
        parts.last() += r
        size += n
    }
    return parts
}

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

private class ReadOut(val records: List<Map<String, Any?>>, val seen: LinkedHashMap<String, Long>, val bad: List<String>, val missing: Boolean)

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

    /** 作ったファイルの ID と版 */
    private suspend fun createFile(meta: Map<String, Any?>, content: String): DriveFile {
        val (body, type) = multipart(meta + ("parents" to listOf("appDataFolder")), content)
        val res = request("POST", "$DRIVE_UPLOAD/files?${query(mapOf("uploadType" to "multipart", "fields" to "id,version"))}", body, type)
        if (!ok(res)) throw driveError(res)
        return checkFile(parseObject(res.body))
    }

    /** 上書きして、新しい版を返す。ファイルが消えていたら null */
    private suspend fun updateFile(id: String, content: String): Long? {
        val (body, type) = multipart(emptyMap(), content)
        val res = request("PATCH", "$DRIVE_UPLOAD/files/${enc(id)}?${query(mapOf("uploadType" to "multipart", "fields" to "id,version"))}", body, type)
        if (res.status == 404) return null
        if (!ok(res)) throw driveError(res)
        return checkFile(parseObject(res.body)).version
    }

    private suspend fun deleteFile(id: String) {
        val res = request("DELETE", "$DRIVE_API/files/${enc(id)}")
        if (!ok(res) && res.status != 404) throw driveError(res)
    }

    /** 中身を読む。消えていたら null */
    private suspend fun download(id: String): String? {
        val res = request("GET", "$DRIVE_API/files/${enc(id)}?${query(mapOf("alt" to "media"))}", maxBytes = MAX_DRIVE_FILE_BYTES)
        if (res.status == 404) return null
        if (!ok(res)) throw driveError(res)
        return res.body
    }

    // ── 手元の控え ──

    private fun stateMap(key: String): Map<String, Any?>? = t.state(key)?.let { parseStrictJson(it) as Map<String, Any?> }

    private fun seen(): LinkedHashMap<String, Long> = LinkedHashMap(stateMap("drive_seen") as Map<String, Long>? ?: emptyMap())

    private fun upto(): Map<String, List<Long>> = stateMap("drive_read_upto") as Map<String, List<Long>>? ?: emptyMap()

    private fun segState(): SegState? = stateMap("drive_seg")?.let { m ->
        SegState(m["n"] as Long, m["day"] as String, m["file"] as String?, m["ids"] as List<String>, m["v"] as Long? ?: UNKNOWN_VERSION, m["bytes"] as Long? ?: 0L)
    }

    private fun own(): OwnFiles {
        val m = stateMap("drive_own") ?: return OwnFiles(null, emptyList())
        val snap = (m["snap"] as Map<String, Any?>?)?.let { OwnSnap(it["u"] as Long, it["g"] as Long, it["files"] as List<String>, it["ids"] as List<String>) }
        return OwnFiles(snap, (m["segs"] as List<Map<String, Any?>>).map(::closedSegOf))
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

    private fun owner(f: DriveFile) = f.appProperties!!.getValue("d")

    /** スナップショットの部分の見出し。形が違えば null(読まない) */
    private fun snapInfo(f: DriveFile): SnapInfo? {
        val p = props(f) ?: return null
        if (p["t"] != "snap") return null
        val u = propNum(p["u"]) ?: return null
        val uv = propNum(p["uv"]) ?: return null
        val g = propNum(p["g"]) ?: return null
        val m = PART.matchEntire(p["p"] ?: "") ?: return null
        val i = m.groupValues[1].toInt()
        val n = m.groupValues[2].toInt()
        return if (i in 1..n) SnapInfo(p["d"] ?: "", u, uv, g, i, n) else null
    }

    /** 目印が 2 つあれば(2 台が同時に作った)、作った時刻の古い方、同じなら id の小さい方を正にする */
    private fun winner(files: List<DriveFile>): DriveFile? = files.filter { f ->
        val p = props(f)
        val e = p?.get("e")
        p != null && !f.trashed && p["t"] == "space" && e != null && e.isNotEmpty() && e.length <= 128
    }.sortedWith(compareBy<DriveFile> { it.createdTime ?: "" }.thenBy { it.id }).firstOrNull()

    private fun epochOf(f: DriveFile) = f.appProperties!!.getValue("e")

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

    /**
     * 書き手ごとの「揃った最新のスナップショット」。部分が全部あるものだけを数える(2.5: 揃うまでは古いスナップショットとセグメントを読む)。
     * u の大きい方が新しい
     */
    private fun bestSnaps(files: List<DriveFile>): Map<String, Best> {
        class Group(val info: SnapInfo, val parts: LinkedHashMap<Int, DriveFile>)
        val groups = LinkedHashMap<String, Group>()
        for (f in files) {
            val s = snapInfo(f) ?: continue
            val key = "${s.d}\n${s.u}"
            val gr = groups[key]
            if (gr == null) groups[key] = Group(s, linkedMapOf(s.i to f))
            // 同じ u で部分の数や見出しが合わないものは混ぜない
            else if (gr.info.n == s.n && gr.info.g == s.g && gr.info.uv == s.uv && !gr.parts.containsKey(s.i)) gr.parts[s.i] = f
        }
        val best = LinkedHashMap<String, Best>()
        for (gr in groups.values) {
            if (gr.parts.size != gr.info.n) continue
            val cur = best[gr.info.d]
            if (cur == null || gr.info.u > cur.info.u) best[gr.info.d] = Best(gr.info, gr.parts.values.toList())
        }
        return best
    }

    /** 部分の揃わないスナップショットのある書き手。一覧で、ほかの部分がもうあるかを確かめる */
    private fun hasPartialSnap(files: List<DriveFile>): Set<String> {
        val have = LinkedHashMap<String, Pair<Int, Int>>()
        for (f in files) {
            val s = snapInfo(f) ?: continue
            val key = "${s.d}\n${s.u}"
            val cur = have[key] ?: (s.n to 0)
            have[key] = cur.first to cur.second + 1
        }
        return have.filter { it.value.second < it.value.first }.keys.map { it.substringBefore('\n') }.toSet()
    }

    /**
     * 読むファイルを決める。files の順を保つ(端末の中の通番を振る順が PC と同じになるように)。
     * - 揃ったスナップショットは、その書き手の最新だけを読む。読み終えた所(upto)までしか含まないものは読まずに控えだけ進める(2.5)
     * - スナップショットに含まれたセグメントは読まない
     * - 揃っていない部分・古いスナップショットは読まず、控えにも入れない(揃ったら変更として来る)
     */
    private fun plan(files: List<DriveFile>, seen: Map<String, Long>, upto: Map<String, List<Long>>): ReadPlan {
        val best = bestSnaps(files)
        val read = ArrayList<DriveFile>()
        val mark = ArrayList<DriveFile>()
        var g = 0L
        val covered = LinkedHashMap<String, Boolean>()
        for ((d, b) in best) {
            if (b.parts.none { it.version > (seen[it.id] ?: 0L) }) continue
            val at = upto[d]
            covered[d] = at != null && (b.info.u < at[0] || (b.info.u == at[0] && at[1] >= b.info.uv))
            g = maxOf(g, b.info.g)
        }
        for (f in files) {
            if (f.version <= (seen[f.id] ?: 0L)) continue
            val p = props(f)!!
            val d = p.getValue("d")
            val b = best[d]
            if (p["t"] == "snap") {
                if (b == null || b.parts.none { it.id == f.id } || !covered.containsKey(d)) continue
                if (covered.getValue(d)) mark += f else read += f
                continue
            }
            val n = propNum(p["n"]) ?: continue
            if (b != null && n <= b.info.u) mark += f else read += f
        }
        return ReadPlan(read, mark, g)
    }

    /** 読んだファイルで、書き手ごとの読み終えた所を進める */
    private fun advance(upto: Map<String, List<Long>>, files: List<DriveFile>): Map<String, List<Long>> {
        val out = LinkedHashMap(upto)
        for (f in files) {
            val p = props(f)!!
            val s = snapInfo(f)
            val at = if (s != null) listOf(s.u, s.uv) else propNum(p["n"])?.let { listOf(it, f.version) } ?: continue
            val cur = out[p.getValue("d")]
            if (cur == null || at[0] > cur[0] || (at[0] == cur[0] && at[1] > cur[1])) out[p.getValue("d")] = at
        }
        return out
    }

    /** ファイルを読み、レコードに端末の中だけの通番を振る。読む間に消えたもの(まとめ直しの途中)があれば missing */
    private suspend fun readFiles(files: List<DriveFile>, since: Long): ReadOut {
        val records = ArrayList<Map<String, Any?>>()
        val seen = LinkedHashMap<String, Long>()
        val badList = ArrayList<String>()
        var version = since
        for (f in files) {
            val body = download(f.id) ?: return ReadOut(records, seen, badList, true)
            seen[f.id] = f.version
            val list = parseFile(f, body)
            if (list == null) {
                badList += "drive_mismatch"
                continue
            }
            for (r in list) records += r + ("version" to ++version)
        }
        return ReadOut(records, seen, badList, false)
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
        if (p["t"] == "snap" && (v["u"]?.toString() != p["u"] || v["uv"]?.toString() != p["uv"] || v["g"]?.toString() != p["g"] || v["p"] != p["p"])) return null
        return records.map { r -> (r as? Map<*, *>)?.let(::sealedOf) ?: emptyMap() }
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

    /** 読む間にファイルが消えた(相手のまとめ直しの途中)ら、同じ token から 1 回だけ読み直す。消えた印と新しいスナップショットが来る */
    override suspend fun changes(since: Long): ChangesPage {
        var attempt = 0
        while (true) {
            changesOnce(since)?.let { return it }
            if (attempt++ > 0) throw bad()
        }
    }

    private suspend fun changesOnce(since: Long): ChangesPage? {
        val token = if (since == 0L) null else t.state("drive_token")
        if (token == null) return fullRead(since)
        // token を断られた。手元を消さない全件の読み取り(マージだけ)にする
        val (changes, next) = scanChanges(token) ?: return fullRead(since)
        val seen = seen()
        val marker = t.state("drive_space")
        val cl = classify(changes, seen, marker)
        // 部分の揃わないスナップショットが来た書き手は、一覧で揃ったかを確かめる(まとめ直しはまれなので、一覧もまれ)
        val listed = hasPartialSnap(cl.toRead)
        val commit = ArrayList<SqlStatement>()
        var epoch = t.state("epoch")
        val needMarker = cl.markerTouched || marker == null || epoch == null
        val listing = if (needMarker || listed.isNotEmpty()) listAll() else emptyList()
        if (needMarker) {
            val m = winner(listing) ?: throw SyncApiError("http", 404, "space_not_found")
            epoch = epochOf(m)
            commit += setState("drive_space", m.id)
        }
        val sources = cl.toRead.filter { owner(it) !in listed } + listing.filter { isOthersData(it) && owner(it) in listed }
        val upto = upto()
        val plan = plan(sources, seen, upto)
        // 自分が最後に読み終えた後に、相手が tombstone を落としていた。知らない削除があるかもしれないので全件で合わせ直す(2.6)
        if (plan.g > (t.state("drive_read_at")?.toLong() ?: 0L)) {
            c.db.batch(listOf(setState("drive_rebase", "1")))
            return ChangesPage(emptyList(), since, false, epoch!!, since + 1, emptyList(), emptyList())
        }
        val read = readFiles(plan.read, since)
        if (read.missing) return null
        for (id in cl.removed) seen.remove(id)
        for (f in plan.mark) seen[f.id] = f.version
        seen.putAll(read.seen)
        commit += listOf(
            setState("drive_token", next),
            setState("drive_seen", canonicalJson(seen)),
            setState("drive_read_upto", canonicalJson(advance(upto, plan.read))),
            setState("drive_read_at", c.now().toString()),
        )
        return ChangesPage(read.records, since + read.records.size, false, epoch!!, 0L, commit, read.bad)
    }

    /**
     * 全件の読み取り(3.4)。一覧より先に token を取っておき、一覧の後に起きた変更を次の周で拾う。
     * 書き手ごとに揃った最新のスナップショットと、それより後のセグメントを読む。
     * head は読んだ数より 1 つ進め、空の領域でも次からは変更だけを読むようにする
     */
    private suspend fun fullRead(since: Long): ChangesPage? {
        val start = startToken()
        val files = listAll()
        val m = winner(files) ?: throw SyncApiError("http", 404, "space_not_found")
        val plan = plan(files.filter(::isOthersData), emptyMap(), emptyMap())
        val read = readFiles(plan.read, since)
        if (read.missing) return null
        val seen = LinkedHashMap(read.seen)
        for (f in plan.mark) seen[f.id] = f.version
        val records = ArrayList(read.records)
        val commit = arrayListOf(
            setState("drive_token", start),
            setState("drive_seen", canonicalJson(seen)),
            setState("drive_read_upto", canonicalJson(advance(emptyMap(), plan.read))),
            setState("drive_space", m.id),
            setState("drive_read_at", c.now().toString()),
        )
        // リベースでは、全件に自分の書いた分も入れる。入れないと、自分しか持たないレコードが「全件にない」として消える
        if (t.state("drive_rebase") == "1") {
            records += ownRecords(files, since + records.size)
            commit += delState("drive_rebase")
        }
        return ChangesPage(records, since + records.size + 1, false, epochOf(m), 0L, commit, read.bad)
    }

    /** Drive に今ある自分のファイルに入れたレコードを、同期の表の値で封をして返す。中身は読み戻さない(手元の値の方が新しいか同じ) */
    private fun ownRecords(files: List<DriveFile>, base: Long): List<Map<String, Any?>> {
        val present = files.map { it.id }.toSet()
        val own = own()
        val seg = segState()
        val ids = ArrayList<String>()
        if (own.snap != null && own.snap.files.any { it in present }) ids += own.snap.ids
        for (s in own.segs) if (s.file in present) ids += s.ids
        if (seg?.file != null && seg.file in present) ids += seg.ids
        var version = base
        return reseal(ids.distinct().sorted()).sealed.map { it + ("version" to ++version) }
    }

    /**
     * 開いているセグメントを、今までに入れたレコードの今の値 + 今回の分で上書きする(1 回の送信 = 1 回の書き込み)。
     * 書き込みはぶつからないので 409 はない。version は since の続きを振り、エンジンが自分の送ったものを読み戻さないようにする
     */
    override suspend fun pushRecords(requestId: String, records: List<Map<String, Any?>>): PushResponse {
        val day = utcDay(c.now())
        val old = segState() ?: SegState(0, "", null, emptyList())
        var seg = old
        val fresh = records.map(::sealedOf)
        val freshIds = fresh.map { it["record_id"] as String }.toSet()
        var prev: List<Map<String, Any?>> = emptyList()
        var close = !(seg.n > 0 && seg.day == day)
        if (!close) {
            val want = seg.ids.filter { it !in freshIds }
            prev = reseal(want).sealed
            // 表から消えたもの(権限系を切った・期限の切れた tombstone)は封をし直せない。上書きで Drive から消さないよう、閉じて残す
            close = prev.size < want.size
        }
        var body = prev + fresh
        if (close || (prev.isNotEmpty() && segContent(seg.n, body).length > DRIVE_SEG_BYTES)) {
            seg = SegState(seg.n + 1, day, null, emptyList())
            body = fresh
        }
        // 閉じたセグメントは、まとめ直しで消すまで控える
        val closed = if (seg !== old && old.file != null) ClosedSeg(old.n, old.file, old.v, old.bytes, old.ids) else null
        var file = seg.file
        var content = segContent(seg.n, body)
        var version: Long? = null
        if (file != null) {
            version = updateFile(file, content)
            if (version == null) {
                // 消えていた(領域の削除など)。同じ通番のファイルを 2 つ作らないよう、次の通番で作る
                seg = SegState(seg.n + 1, day, null, emptyList())
                file = null
                content = segContent(seg.n, body)
            }
        }
        if (file == null) {
            val made = createFile(mapOf("name" to segName(seg.n), "appProperties" to segProps(seg.n)), content)
            file = made.id
            version = made.version
        }
        val stmts = arrayListOf(
            setState("drive_seg", canonicalJson(mapOf("n" to seg.n, "day" to seg.day, "file" to file, "ids" to body.map { it["record_id"] }, "v" to version, "bytes" to content.length.toLong()))),
        )
        if (closed != null) {
            val own = own()
            stmts += setState("drive_own", canonicalJson(OwnFiles(own.snap, own.segs + closed).toJson()))
        }
        c.db.batch(stmts)
        val since = t.state("since")?.toLong() ?: 0L
        return PushResponse(records.mapIndexed { i, r -> PushResult(r["record_id"] as String, 200L, since + 1 + i, null) }, knownEpoch(), 0L)
    }

    /** 前に入れたレコードを同期の表の今の値で封をし直す。表にないもの・封ができないものは missing に返す */
    private fun reseal(ids: List<String>, cut: Long = -1): Resealed {
        val rows = t.records(ids)
        val out = ArrayList<Map<String, Any?>>()
        val missing = ArrayList<String>()
        var dropped = false
        for (id in ids) {
            val r = rows[id]
            if (r == null) {
                missing += id
                continue
            }
            // 期限の切れた tombstone は落とす(2.6)
            if (isDeleted(r.payload) && Hlc.parse(r.payload["hlc"] as String).wall < cut) {
                dropped = true
                continue
            }
            try {
                val (nonce, ciphertext) = sealPayload(c.keys, RecordContext(c.spaceId, id, r.kindTag, r.schemaVersion), r.payload)
                out += linkedMapOf("record_id" to id, "kind_tag" to r.kindTag, "schema_version" to r.schemaVersion, "nonce" to nonce, "ciphertext" to ciphertext)
            } catch (_: SyncError) {
                missing += id
            }
        }
        return Resealed(out, missing, dropped)
    }

    private fun prefix() = "obbsync$DRIVE_FORMAT.${c.spaceId.take(16)}"

    private fun segName(n: Long) = "${prefix()}.${c.deviceId}.seg.$n"

    private fun segProps(n: Long) = mapOf("f" to DRIVE_FORMAT.toString(), "s" to c.spaceId, "t" to "seg", "d" to c.deviceId, "n" to n.toString())

    private fun segContent(n: Long, records: List<Map<String, Any?>>) =
        canonicalJson(mapOf("obbsync" to DRIVE_FORMAT, "space" to c.spaceId, "device" to c.deviceId, "type" to "seg", "n" to n, "records" to records))

    // ── まとめ直し(2.5・2.6) ──

    /** 周の最後に呼ばれる。条件を満たしたときだけ動き、そうでなければ手元の控えを見るだけで通信しない */
    override suspend fun maintain() {
        try {
            compact()
        } catch (e: SyncApiError) {
            // 容量の超過: 作るのに容量が要るので、1 日は試さない。送信の側の「古い閲覧履歴を外す」が先に効く
            if (e.kind == "http" && e.status == 413) {
                val job = stateMap("drive_compact")?.let(::compactJobOf)
                val wait = c.now() + DRIVE_COMPACT_GAP_MS
                c.db.batch(listOf(if (job != null) setState("drive_compact", canonicalJson(CompactJob(job.u, job.uv, job.g, job.cut, job.del, job.parts, job.done, wait).toJson())) else setState("drive_compact_at", c.now().toString())))
                return
            }
            // 回数の上限は次の周で続ける。同期そのものは止めない
            if (e.kind == "http" && e.status == 429) return
            throw e
        }
    }

    private suspend fun compact() {
        val now = c.now()
        val stored = stateMap("drive_compact")?.let(::compactJobOf)
        var made: Map<String, Map<String, Any?>>? = null
        var job: CompactJob
        if (stored == null) {
            val own = own()
            val bytes = own.segs.sumOf { it.bytes }
            if (own.segs.isEmpty() || (own.segs.size < DRIVE_COMPACT_SEGS && bytes < DRIVE_COMPACT_BYTES)) return
            if (now - (t.state("drive_compact_at")?.toLong() ?: 0L) < DRIVE_COMPACT_GAP_MS) return
            val last = own.segs.maxBy { it.n }
            val del = own.snap?.files.orEmpty() + own.segs.map { it.file }
            val cut = now - TOMB_MAX_AGE_MS
            val (records, dropped) = snapRecords((own.snap?.ids.orEmpty() + own.segs.flatMap { it.ids }).distinct().sorted(), del, cut)
            job = CompactJob(last.n, last.v, if (dropped) cut else own.snap?.g ?: 0L, cut, del, splitParts(records).map { p -> p.map { it["record_id"] as String } }, emptyList())
            // 部分の分け方を先に置く。途中で落ちても、作り終えた部分を作り直さずに続きから作れる
            c.db.batch(listOf(setState("drive_compact", canonicalJson(job.toJson()))))
            made = records.associateBy { it["record_id"] as String }
        } else {
            if (stored.wait != null && now < stored.wait) return
            job = stored
        }
        for (i in job.done.size until job.parts.size) {
            val ids = job.parts[i]
            val records = made?.let { m -> ids.mapNotNull { m[it] } } ?: snapRecords(ids, job.del, job.cut).first
            val p = "${i + 1}/${job.parts.size}"
            val f = createFile(
                mapOf(
                    "name" to "${prefix()}.${c.deviceId}.snap.${job.u}.${i + 1}of${job.parts.size}",
                    "appProperties" to mapOf("f" to DRIVE_FORMAT.toString(), "s" to c.spaceId, "t" to "snap", "d" to c.deviceId, "u" to job.u.toString(), "uv" to job.uv.toString(), "g" to job.g.toString(), "p" to p),
                ),
                canonicalJson(mapOf("obbsync" to DRIVE_FORMAT, "space" to c.spaceId, "device" to c.deviceId, "type" to "snap", "u" to job.u, "uv" to job.uv, "g" to job.g, "p" to p, "records" to records)),
            )
            job = CompactJob(job.u, job.uv, job.g, job.cut, job.del, job.parts, job.done + f.id)
            c.db.batch(listOf(setState("drive_compact", canonicalJson(job.toJson()))))
        }
        // 作り終えてから古いものを消す。どこにもない瞬間を作らない
        for (id in job.del) deleteFile(id)
        val own = own()
        val u = job.u
        val next = OwnFiles(OwnSnap(u, job.g, job.done, job.parts.flatten()), own.segs.filter { it.n > u })
        c.db.batch(listOf(setState("drive_own", canonicalJson(next.toJson())), delState("drive_compact"), setState("drive_compact_at", now.toString())))
    }

    /**
     * スナップショットに入れるレコード。同期の表の今の値で封をし、期限の切れた tombstone を落とす。
     * 表にないもの(権限系を切った・手元で期限が切れた)は、古い自分のファイルから暗号文のまま引き継ぐ(切った端末が Drive から消さないように)
     */
    private suspend fun snapRecords(ids: List<String>, oldFiles: List<String>, cut: Long): Pair<List<Map<String, Any?>>, Boolean> {
        val r = reseal(ids, cut)
        var dropped = r.dropped
        if (r.missing.isEmpty()) return r.sealed to dropped
        val records = ArrayList(r.sealed)
        val old = LinkedHashMap<String, Map<String, Any?>>()
        // 後のファイル(新しいセグメント)の値で上書きする
        for (id in oldFiles) {
            val body = download(id) ?: continue
            for (x in parseOwn(body).orEmpty()) old[x["record_id"] as String] = x
        }
        for (id in r.missing) {
            val x = old[id]
            val opened = x?.let { openRecords(c.keys, c.spaceId, listOf(it + ("version" to 0L))).records.firstOrNull() }
            if (x == null || opened == null || (isDeleted(opened.payload) && Hlc.parse(opened.payload["hlc"] as String).wall < cut)) {
                dropped = true
                continue
            }
            records += x
        }
        records.sortBy { it["record_id"] as String }
        return records to dropped
    }

    /** 自分のファイルの中身。形が違えば null */
    private fun parseOwn(body: String): List<Map<String, Any?>>? {
        val v = try {
            parseStrictJson(body)
        } catch (_: Exception) {
            return null
        } as? Map<*, *> ?: return null
        val records = v["records"] as? List<*>
        if (v["obbsync"] != DRIVE_FORMAT || v["space"] != c.spaceId || v["device"] != c.deviceId || records == null) return null
        return records.mapNotNull { r -> (r as? Map<*, *>)?.takeIf { it["record_id"] is String }?.let(::sealedOf) }
    }

    /**
     * 目印を作る(なければ)。許可証は使わない。2 台が同時に作ったら、作った後に一覧で正を決め、負けた方は自分の目印を消す。
     * 目印がない = 領域のファイルが全部消えたので、自分のファイルの控えも捨てる(消えたファイルを数えてまとめ直さない)
     */
    override suspend fun createSpace(ticket: String?): String {
        val forget = listOf(delState("drive_own"), delState("drive_compact"))
        winner(listAll())?.let { existing ->
            c.db.batch(forget + setState("drive_space", existing.id))
            return epochOf(existing)
        }
        val e = o.newEpoch?.invoke() ?: toBase64Url(ByteArray(16).also { SecureRandom().nextBytes(it) })
        val mine = createFile(mapOf("name" to "${prefix()}.space", "appProperties" to mapOf("f" to DRIVE_FORMAT.toString(), "s" to c.spaceId, "t" to "space", "e" to e)), "").id
        val w = winner(listAll())
        if (w != null && w.id != mine) {
            deleteFile(mine)
            c.db.batch(forget + setState("drive_space", w.id))
            return epochOf(w)
        }
        c.db.batch(forget + setState("drive_space", mine))
        return e
    }
}
