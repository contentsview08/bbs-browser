package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.sync.engine.DRIVE_API
import io.github.contentsview08.obb.sync.engine.GOOGLE_TOKEN_URL
import io.github.contentsview08.obb.sync.engine.GoogleClient
import io.github.contentsview08.obb.sync.engine.SyncRequest
import io.github.contentsview08.obb.sync.engine.SyncResponse
import java.net.URI
import java.net.URLDecoder
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

// テスト用の Google ドライブ。PC 版の packages/sync/test/fakeDrive.ts の写しで、同期が使う分(appDataFolder の files・changes)だけをメモリで真似る。
// 本物の Google には繋がない。応答の形は公式の参照の一部(fields は見ずに全部返す)

const val FAKE_DRIVE_TOKEN = "fake-drive-access-token"
const val FAKE_DRIVE_HOST = "www.googleapis.com"

/** 4.1 の単位。呼び出しごとに数え、見積もりを確かめる */
object DriveUnits {
    const val OTHER = 5
    const val READ = 5
    const val LIST = 100
    const val EDIT = 50
    const val DOWNLOAD = 200
}

/** modifiedTime は最後に中身か appProperties を書いた時刻。止まった書き手のファイルを見分けるのに使う */
class FakeDriveFile(val id: String, val name: String, val parents: List<String>, var appProperties: Map<String, String>, var version: Long, val createdTime: String, var content: String, var modifiedTime: String = createdTime)

private fun json(status: Int, v: Any?) = SyncResponse(status, canonicalJson(v), mapOf("Content-Type" to "application/json"))

fun driveFail(status: Int, reason: String, message: String = reason) =
    json(status, mapOf("error" to mapOf("code" to status.toLong(), "message" to message, "errors" to listOf(mapOf("domain" to "global", "reason" to reason, "message" to message)))))

private fun utf8Bytes(s: String) = s.toByteArray(Charsets.UTF_8).size

/** new Date(ms).toISOString() と同じ形 */
private val ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

@Suppress("UNCHECKED_CAST")
class FakeDrive(private val now: () -> Long) {
    val files = LinkedHashMap<String, FakeDriveFile>()
    /** 変更の記録。token は次に付く番号 */
    private val changes = ArrayList<Pair<Long, String>>()
    private var seq = 1L
    private var ids = 0
    var units = 0
    val calls = LinkedHashMap<String, Int>()
    val tokens = mutableSetOf(FAKE_DRIVE_TOKEN)
    /** 利用者の Drive の空き。超えたら 403 storageQuotaExceeded */
    var quotaBytes = Long.MAX_VALUE

    private fun count(name: String, u: Int) {
        calls[name] = (calls[name] ?: 0) + 1
        units += u
    }

    private fun bump(fileId: String) {
        changes += seq++ to fileId
    }

    private fun meta(f: FakeDriveFile) = linkedMapOf(
        "kind" to "drive#file", "id" to f.id, "name" to f.name, "appProperties" to f.appProperties, "version" to f.version.toString(),
        "size" to utf8Bytes(f.content).toString(), "createdTime" to f.createdTime, "modifiedTime" to f.modifiedTime, "trashed" to false,
    )

    private fun usedBytes() = files.values.sumOf { utf8Bytes(it.content).toLong() }

    // ── テストの操作。API にはない ──

    /** 利用者がほかの Drive のファイルを触った。appDataFolder の変更ではないが token は進む */
    fun touchOther() {
        seq++
    }

    fun filesOf(spaceId: String) = files.values.filter { it.appProperties["s"] == spaceId }

    /** 目印のある領域の数 */
    fun spaceCount() = files.values.filter { it.appProperties["t"] == "space" }.map { it.appProperties["s"] }.toSet().size

    /** 利用者が「隠しアプリデータを削除」した */
    fun deleteSpace(spaceId: String) {
        for (f in filesOf(spaceId)) remove(f.id)
    }

    /** 目印の e を替える */
    fun bumpEpoch(spaceId: String) {
        for (f in filesOf(spaceId)) {
            if (f.appProperties["t"] != "space") continue
            f.appProperties = f.appProperties + ("e" to "bumped$seq")
            f.version++
            f.modifiedTime = ISO.format(Instant.ofEpochMilli(now()))
            bump(f.id)
        }
    }

    /** 書き手 device のセグメント 1 つに、レコードを足す(同じ ID は置き換える)。他の端末が書いた状態を作る */
    fun putRecord(spaceId: String, device: String, record: Map<String, Any?>) {
        val f = filesOf(spaceId).firstOrNull { it.appProperties["t"] == "seg" && it.appProperties["d"] == device }
        val records = ArrayList<Map<String, Any?>>()
        if (f != null) ((parseStrictJson(f.content) as Map<String, Any?>)["records"] as List<Map<String, Any?>>).filterTo(records) { it["record_id"] != record["record_id"] }
        records += record
        val content = canonicalJson(mapOf("obbsync" to 1L, "space" to spaceId, "device" to device, "type" to "seg", "n" to 1L, "records" to records))
        if (f != null) {
            f.content = content
            f.version++
            f.modifiedTime = ISO.format(Instant.ofEpochMilli(now()))
            bump(f.id)
        } else {
            create(mapOf("name" to "obbsync1.${spaceId.take(16)}.$device.seg.1", "parents" to listOf("appDataFolder"), "appProperties" to mapOf("f" to "1", "s" to spaceId, "t" to "seg", "d" to device, "n" to "1")), content)
        }
    }

    /** 領域のファイルにあるレコード。同じ ID が書き手ごとにあれば全部 */
    fun recordsOf(spaceId: String): List<Map<String, Any?>> = filesOf(spaceId).flatMap { f ->
        if (f.appProperties["t"] != "seg" && f.appProperties["t"] != "snap") return@flatMap emptyList()
        try {
            ((parseStrictJson(f.content) as Map<String, Any?>)["records"] as? List<Map<String, Any?>>).orEmpty()
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun remove(id: String) {
        if (files.remove(id) != null) bump(id)
    }

    private fun create(meta: Map<String, Any?>, content: String): FakeDriveFile {
        val f = FakeDriveFile(
            "f${(++ids).toString().padStart(8, '0')}",
            meta["name"] as? String ?: "untitled",
            meta["parents"] as List<String>,
            (meta["appProperties"] as Map<String, String>?).orEmpty(),
            1,
            ISO.format(Instant.ofEpochMilli(now())),
            content,
        )
        files[f.id] = f
        bump(f.id)
        return f
    }

    // ── API ──

    private fun params(raw: String?): Map<String, String> = raw.orEmpty().split('&').filter { it.isNotEmpty() }.associate {
        val at = it.indexOf('=')
        val k = if (at < 0) it else it.substring(0, at)
        val v = if (at < 0) "" else it.substring(at + 1)
        URLDecoder.decode(k, "UTF-8") to URLDecoder.decode(v, "UTF-8")
    }

    fun handle(method: String, url: String, headers: Map<String, String>, body: String?): SyncResponse {
        val u = try {
            URI(url)
        } catch (_: Exception) {
            return driveFail(400, "badRequest")
        }
        if (u.scheme != "https" || u.host != FAKE_DRIVE_HOST) return driveFail(404, "notFound")
        val auth = Regex("^Bearer (.+)$").find(headers["Authorization"].orEmpty())
        if (auth == null || auth.groupValues[1] !in tokens) return driveFail(401, "authError", "Invalid Credentials")
        val q = params(u.rawQuery)
        val path = u.rawPath
        val m = Regex("^/(upload/)?drive/v3/files(?:/([^/]+))?$").find(path)
        if (path == "/drive/v3/changes/startPageToken" && method == "GET") {
            count("changes.getStartPageToken", DriveUnits.OTHER)
            return json(200, mapOf("kind" to "drive#startPageToken", "startPageToken" to seq.toString()))
        }
        if (path == "/drive/v3/changes" && method == "GET") return listChanges(q)
        if (m == null) return driveFail(404, "notFound")
        val upload = m.groupValues[1].isNotEmpty()
        val id = m.groupValues[2].takeIf { it.isNotEmpty() }?.let { URLDecoder.decode(it, "UTF-8") }
        if (upload) {
            if (q["uploadType"] != "multipart") return driveFail(400, "badRequest")
            if (method == "POST" && id == null) return upload(headers, body, null)
            if (method == "PATCH" && id != null) return upload(headers, body, id)
            return driveFail(405, "methodNotAllowed")
        }
        if (id == null) {
            if (method != "GET") return driveFail(405, "methodNotAllowed")
            return listFiles(q)
        }
        val f = files[id]
        if (method == "GET") {
            val media = q["alt"] == "media"
            count(if (media) "files.get(media)" else "files.get", if (media) DriveUnits.DOWNLOAD else DriveUnits.READ)
            if (f == null) return driveFail(404, "notFound", "File not found: $id.")
            return if (media) SyncResponse(200, f.content, mapOf("Content-Type" to "application/json")) else json(200, meta(f))
        }
        if (method == "DELETE") {
            count("files.delete", DriveUnits.EDIT)
            if (f == null) return driveFail(404, "notFound", "File not found: $id.")
            remove(id)
            return SyncResponse(204, "")
        }
        return driveFail(405, "methodNotAllowed")
    }

    private fun pageSize(q: Map<String, String>): Int? {
        val raw = q["pageSize"] ?: return 100
        val n = raw.toIntOrNull() ?: return null
        return if (n in 1..1000) n else null
    }

    /** appDataFolder の中は spaces=appDataFolder を付けないと見えない */
    private fun inAppData(q: Map<String, String>) = (q["spaces"] ?: "drive").split(',').contains("appDataFolder")

    private fun listChanges(q: Map<String, String>): SyncResponse {
        count("changes.list", DriveUnits.LIST)
        val token = q["pageToken"]?.toLongOrNull()
        val size = pageSize(q)
        if (token == null || token < 1 || token > seq || size == null) return driveFail(400, "invalid", "Invalid Value")
        // ファイルごとに最後の変更だけを、その順に返す
        val last = LinkedHashMap<String, Long>()
        for ((s, fileId) in changes) if (s >= token) last[fileId] = s
        val entries = last.entries.sortedBy { it.value }
        val page = if (inAppData(q)) entries.take(size) else emptyList()
        val more = inAppData(q) && entries.size > size
        val list = page.map { (fileId, _) ->
            val f = files[fileId]
            if (f != null) linkedMapOf("kind" to "drive#change", "changeType" to "file", "fileId" to fileId, "removed" to false, "file" to meta(f))
            else linkedMapOf("kind" to "drive#change", "changeType" to "file", "fileId" to fileId, "removed" to true)
        }
        val out = linkedMapOf<String, Any?>("kind" to "drive#changeList", "changes" to list)
        if (more) out["nextPageToken"] = (page.last().value + 1).toString() else out["newStartPageToken"] = seq.toString()
        return json(200, out)
    }

    private fun listFiles(q: Map<String, String>): SyncResponse {
        count("files.list", DriveUnits.LIST)
        val size = pageSize(q)
        val offset = (q["pageToken"] ?: "0").toIntOrNull()
        if (size == null || offset == null || offset < 0) return driveFail(400, "invalid", "Invalid Value")
        val all = if (inAppData(q)) files.values.sortedBy { it.id } else emptyList()
        val page = all.drop(offset).take(size)
        val out = linkedMapOf<String, Any?>("kind" to "drive#fileList", "files" to page.map(::meta))
        if (offset + size < all.size) out["nextPageToken"] = (offset + size).toString()
        return json(200, out)
    }

    /** multipart/related: メタデータの JSON と本文の 2 部分 */
    private fun upload(headers: Map<String, String>, body: String?, id: String?): SyncResponse {
        count(if (id == null) "files.create" else "files.update", DriveUnits.EDIT)
        val b = Regex("boundary=([^;]+)").find(headers["Content-Type"].orEmpty())?.groupValues?.get(1)
        if (b == null || body.isNullOrEmpty()) return driveFail(400, "badRequest", "Bad multipart")
        val chunks = body.split("--$b")
        if (chunks.size < 3) return driveFail(400, "badRequest", "Bad multipart")
        val parts = chunks.subList(1, chunks.size - 1).map { p ->
            val at = p.indexOf("\r\n\r\n")
            if (at < 0) null else p.substring(at + 4).removeSuffix("\r\n")
        }
        if (parts.size != 2 || parts[0] == null || parts[1] == null || !body.trimEnd().endsWith("--$b--")) return driveFail(400, "badRequest", "Bad multipart")
        val m = try {
            parseStrictJson(parts[0]!!) as Map<String, Any?>
        } catch (_: Exception) {
            return driveFail(400, "badRequest", "Bad metadata")
        }
        val content = parts[1]!!
        val props = m["appProperties"] as Map<String, Any?>?
        if (props != null) {
            // 1 ファイル 30 個まで、1 つは鍵と値を合わせて 124 バイトまで
            if (props.size > 30 || props.any { (k, v) -> v !is String || utf8Bytes(k) + utf8Bytes(v) > 124 }) return driveFail(400, "invalidProperty")
        }
        val old = if (id == null) 0L else utf8Bytes(files[id]?.content ?: "").toLong()
        if (usedBytes() - old + utf8Bytes(content) > quotaBytes) return driveFail(403, "storageQuotaExceeded", "The user has exceeded their Drive storage quota")
        if (id == null) {
            val parents = m["parents"] as? List<*>
            if (parents == null || parents.size != 1 || parents[0] != "appDataFolder") return driveFail(403, "insufficientPermissions")
            return json(200, meta(create(m, content)))
        }
        val f = files[id] ?: return driveFail(404, "notFound", "File not found: $id.")
        if (m.containsKey("parents")) return driveFail(403, "fieldNotWritable")
        if (props != null) f.appProperties = f.appProperties + (props as Map<String, String>)
        f.content = content
        f.version++
        f.modifiedTime = ISO.format(Instant.ofEpochMilli(now()))
        bump(f.id)
        return json(200, meta(f))
    }
}

/** テストのクライアント。本物の値ではない */
val TEST_GOOGLE_CLIENT = GoogleClient("test-client.apps.googleusercontent.com", "test-secret")

/**
 * 偽の Google。Drive は FakeDrive、トークンの口と about.get はここで真似る。本物の Google には繋がない。
 * accounts は更新用のトークン → アカウント(permissionId)。revoked のトークンは invalid_grant
 */
class FakeGoogle(now: () -> Long) {
    val drive = FakeDrive(now)
    val accounts = HashMap<String, String>()
    val revoked = HashSet<String>()
    private var issued = 0
    /** 発行したアクセストークン → 元の更新用のトークン */
    private val issuedFor = HashMap<String, String>()
    val tokenBodies = ArrayList<String>()

    fun handle(r: SyncRequest): SyncResponse {
        if (r.url == GOOGLE_TOKEN_URL) {
            tokenBodies += r.body.orEmpty()
            val form = r.body.orEmpty().split('&').associate { it.substringBefore('=') to java.net.URLDecoder.decode(it.substringAfter('='), "UTF-8") }
            if (form["client_id"] != TEST_GOOGLE_CLIENT.id || form["client_secret"] != TEST_GOOGLE_CLIENT.secret) return SyncResponse(401, """{"error":"invalid_client"}""")
            val rt = form["refresh_token"].orEmpty()
            if (form["grant_type"] != "refresh_token" || rt !in accounts || rt in revoked) return SyncResponse(400, """{"error":"invalid_grant","error_description":"Token has been expired or revoked."}""")
            val access = "access-${++issued}"
            issuedFor[access] = rt
            drive.tokens += access
            return SyncResponse(200, """{"access_token":"$access","expires_in":3599,"scope":"https://www.googleapis.com/auth/drive.appdata","token_type":"Bearer"}""")
        }
        if (r.url.startsWith("$DRIVE_API/about")) {
            val access = r.headers["Authorization"].orEmpty().removePrefix("Bearer ")
            if (access !in drive.tokens) return SyncResponse(401, "{}")
            val id = accounts.getValue(issuedFor.getValue(access))
            return SyncResponse(200, """{"user":{"permissionId":"$id","emailAddress":"$id@example.test"}}""")
        }
        return drive.handle(r.method, r.url, r.headers, r.body)
    }

    /** 取り消し。発行したアクセストークンも効かなくなる */
    fun revoke(rt: String) {
        revoked += rt
        drive.tokens.removeAll { issuedFor[it] == rt }
    }
}
