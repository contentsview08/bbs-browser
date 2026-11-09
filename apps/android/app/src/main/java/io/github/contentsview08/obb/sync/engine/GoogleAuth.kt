package io.github.contentsview08.obb.sync.engine

import io.github.contentsview08.obb.sync.SyncConfig
import io.github.contentsview08.obb.sync.parseStrictJson
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.net.URLEncoder

// スマホの Google の接続(docs/sync-drive.md 5.3)。スマホは Google のログインをせず、PC の QR(obb2)で受け取った更新用のトークンと、
// PC と同じ「デスクトップ アプリ」のクライアントで、アクセストークンを取り直す。
// アクセストークンはメモリだけに置き、更新用のトークンは鍵保管(SyncKeyVault)にだけ置く。どちらもログに出さない

const val GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const val GOOGLE_UNAVAILABLE = "google_unavailable"
/** QR のトークンを Google が受け付けない(取り消された・期限切れ) */
const val GOOGLE_PAIRING_FAILED = "google_pairing_failed"
const val GOOGLE_OTHER_ACCOUNT = "google_other_account"

/** 期限のこれだけ前に取り直す */
private const val REFRESH_EARLY_MS = 5 * 60_000L

/** ビルドのときに入れたクライアント。なければ Google の同期は使えない */
class GoogleClient(val id: String, val secret: String) {
    companion object {
        fun of(id: String, secret: String): GoogleClient? = if (id.isBlank() || secret.isBlank()) null else GoogleClient(id.trim(), secret.trim())
    }
}

class GoogleAccount(val permissionId: String, val email: String)

private fun form(vararg pairs: Pair<String, String>) = pairs.joinToString("&") { (k, v) -> "${URLEncoder.encode(k, "UTF-8")}=${URLEncoder.encode(v, "UTF-8")}" }

private suspend fun send(transport: SyncTransport, req: SyncRequest): SyncResponse {
    val res = try {
        transport.send(req)
    } catch (e: CancellationException) {
        throw e
    } catch (_: SyncResponseTooLarge) {
        throw SyncApiError("too_large")
    } catch (_: Exception) {
        throw SyncApiError("network")
    }
    if (res.status in 300..399) throw SyncApiError("redirect", res.status)
    return res
}

/**
 * 更新用のトークンでアクセストークンを取り直す。invalid_grant(取り消し・期限切れ・100 本を超えた)は GOOGLE_AUTH_FAILED の 401 にする。
 * 応答に新しい更新用のトークンが入っていたら、それも返す(入れ替わることは公式に明記がないが、来たら置き換える)
 */
suspend fun refreshGoogleToken(transport: SyncTransport, client: GoogleClient?, refreshToken: String): Triple<String, Long, String?> {
    if (client == null) throw SyncApiError("http", 400, GOOGLE_UNAVAILABLE)
    val body = form("grant_type" to "refresh_token", "refresh_token" to refreshToken, "client_id" to client.id, "client_secret" to client.secret)
    val res = send(transport, SyncRequest("POST", GOOGLE_TOKEN_URL, mapOf("Content-Type" to "application/x-www-form-urlencoded"), body, 64 * 1024, SyncConfig.HTTP_TOTAL_TIMEOUT_MS, SyncConfig.HTTP_IDLE_TIMEOUT_MS))
    val o = try {
        parseStrictJson(res.body) as? Map<*, *>
    } catch (_: Exception) {
        null
    }
    if (res.status !in 200..299) {
        val err = o?.get("error") as? String ?: ""
        if (err == "invalid_grant") throw SyncApiError("http", 401, GOOGLE_AUTH_FAILED)
        // クライアントの取り違え(invalid_client など)。画面には番号と理由のコードだけを出す
        throw SyncApiError("http", res.status, if (res.status >= 500) "" else "google_${err.take(48)}".trimEnd('_'))
    }
    val access = o?.get("access_token") as? String
    if (access.isNullOrEmpty()) throw SyncApiError("bad_response")
    val expiresSec = (o["expires_in"] as? Long)?.takeIf { it > 0 } ?: 3600L
    return Triple(access, expiresSec * 1000, (o["refresh_token"] as? String)?.takeIf { it.isNotEmpty() })
}

/**
 * アクセストークンの控え。load は鍵保管の更新用のトークン、save は入れ替わったときの置き場。
 * fresh(401 のあと)か、期限の 5 分前を過ぎたら取り直す
 */
class GoogleTokens(
    private val transport: SyncTransport,
    private val client: GoogleClient?,
    private val now: () -> Long,
    private val load: suspend () -> String?,
    private val save: suspend (String) -> Unit,
) {
    private val mutex = Mutex()
    private var forToken: String? = null
    private var access: String? = null
    private var expiresAt = 0L

    val available get() = client != null

    suspend fun accessToken(fresh: Boolean): String = mutex.withLock {
        val rt = load() ?: throw SyncApiError("http", 401, GOOGLE_AUTH_FAILED)
        val cached = access
        if (!fresh && cached != null && forToken == rt && now() < expiresAt - REFRESH_EARLY_MS) return@withLock cached
        val (token, ttl, next) = refreshGoogleToken(transport, client, rt)
        if (next != null && next != rt) save(next)
        forToken = next ?: rt
        access = token
        expiresAt = now() + ttl
        token
    }

    /** やめた・トークンを置き換えたとき。メモリのアクセストークンを捨てる */
    suspend fun forget() = mutex.withLock {
        forToken = null
        access = null
        expiresAt = 0
    }
}

/** どのアカウントかを確かめる(about.get は drive.appdata の範囲で呼べる)。permissionId は配り直しで別のアカウントに気づくため */
suspend fun googleAbout(transport: SyncTransport, accessToken: String): GoogleAccount {
    val res = send(transport, SyncRequest("GET", "$DRIVE_API/about?fields=user(permissionId%2CemailAddress)", mapOf("Authorization" to "Bearer $accessToken"), null, 64 * 1024, SyncConfig.HTTP_TOTAL_TIMEOUT_MS, SyncConfig.HTTP_IDLE_TIMEOUT_MS))
    if (res.status == 401) throw SyncApiError("http", 401, GOOGLE_AUTH_FAILED)
    if (res.status !in 200..299) throw SyncApiError("http", res.status)
    val user = try {
        (parseStrictJson(res.body) as? Map<*, *>)?.get("user") as? Map<*, *>
    } catch (_: Exception) {
        null
    }
    val id = user?.get("permissionId") as? String
    if (id.isNullOrEmpty()) throw SyncApiError("bad_response")
    return GoogleAccount(id, user["emailAddress"] as? String ?: "")
}

/**
 * appDataFolder で使っている量(バイト)。files.list の size(今の版の大きさ)を全ページ足す。PC の driveUsage と同じ数え方。
 * 周とは別に呼ぶので、画面を開いたときと同期の後だけにする
 */
suspend fun driveUsage(transport: SyncTransport, accessToken: suspend (Boolean) -> String): Long {
    var total = 0L
    var page: String? = null
    while (true) {
        var url = "$DRIVE_API/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken%2Cfiles(size)"
        if (page != null) url += "&pageToken=${URLEncoder.encode(page, "UTF-8")}"
        var res = send(transport, SyncRequest("GET", url, mapOf("Authorization" to "Bearer ${accessToken(false)}"), null, SyncConfig.MAX_RESPONSE_BYTES, SyncConfig.HTTP_TOTAL_TIMEOUT_MS, SyncConfig.HTTP_IDLE_TIMEOUT_MS))
        // アクセストークンの期限切れは 1 回だけ取り直す
        if (res.status == 401) res = send(transport, SyncRequest("GET", url, mapOf("Authorization" to "Bearer ${accessToken(true)}"), null, SyncConfig.MAX_RESPONSE_BYTES, SyncConfig.HTTP_TOTAL_TIMEOUT_MS, SyncConfig.HTTP_IDLE_TIMEOUT_MS))
        if (res.status == 401) throw SyncApiError("http", 401, GOOGLE_AUTH_FAILED)
        if (res.status !in 200..299) throw SyncApiError("http", res.status)
        val r = try {
            parseStrictJson(res.body) as? Map<*, *>
        } catch (_: Exception) {
            null
        } ?: throw SyncApiError("bad_response")
        val files = r["files"] as? List<*> ?: throw SyncApiError("bad_response")
        for (f in files) {
            // size は 10 進の文字列(int64)。ないもの(中身のないファイル)は 0
            val s = (f as? Map<*, *>)?.get("size") as? String
            if (s != null && Regex("\\d{1,15}").matches(s)) total += s.toLong()
        }
        if (!r.containsKey("nextPageToken")) return total
        val next = r["nextPageToken"] as? String
        if (next == null || next == page) throw SyncApiError("no_progress")
        page = next
    }
}

/** ドライブで使っている量の表し方。PC の formatDriveUsage と同じ: 1024 ごとに KB・MB・GB、小数 1 桁(四捨五入)、1 MB 未満は KB */
fun formatDriveUsage(bytes: Long): String {
    val units = listOf("KB", "MB", "GB")
    var v = maxOf(0L, bytes) / 1024.0
    var i = 0
    while (i < units.size - 1 && v >= 1024) {
        v /= 1024
        i++
    }
    // 1023.96 KB のように丸めて 1024.0 になるものは上の単位にする
    if (i < units.size - 1 && Math.round(v * 10) / 10.0 >= 1024) {
        v /= 1024
        i++
    }
    return "${java.math.BigDecimal(v).setScale(1, java.math.RoundingMode.HALF_UP).toPlainString()} ${units[i]}"
}
