package io.github.contentsview08.obb.sync.engine

import io.github.contentsview08.obb.sync.SyncConfig
import io.github.contentsview08.obb.sync.canonicalJson
import io.github.contentsview08.obb.sync.parseStrictJson
import kotlinx.coroutines.CancellationException

// サーバーとの通信の口。実物の HTTP は差し替えで渡す。https 以外とリダイレクトはここで断る(トークンが別の先へ渡らないように)

class SyncRequest(val method: String, val url: String, val headers: Map<String, String>, val body: String?, val maxBytes: Int, val timeoutMs: Long)

class SyncResponse(val status: Int, val body: String, val headers: Map<String, String> = emptyMap())

/** 応答が上限を超えた。通信の失敗と分ける(オフラインに見せない) */
class SyncResponseTooLarge : Exception("too_large")

/** 実装はリダイレクトをたどらず Cookie を持たない(同期専用の OkHttpClient)。通信できないときは例外を投げる */
fun interface SyncTransport {
    suspend fun send(req: SyncRequest): SyncResponse
}

class SyncApiError(val kind: String, val status: Int = 0, val code: String = "", val detail: Map<String, Any?>? = null) : Exception(if (code.isEmpty()) kind else "$kind:$code")

private val HTTPS_URL = Regex("https://[^/?#@\\s\\\\]+(?:/[^?#\\s\\\\]*)?")
private val LOCAL_URL = Regex("http://(?:localhost|127\\.0\\.0\\.1)(?::[0-9]+)?(?:/[^?#\\s\\\\]*)?")

/** 利用者名・パスワード・クエリ・フラグメントを拒否する。localhost は開発の版だけ */
fun checkServerUrl(url: String, allowLocalhost: Boolean = false): String {
    if (!HTTPS_URL.matches(url) && !(allowLocalhost && LOCAL_URL.matches(url))) throw SyncApiError("bad_url")
    return url.trimEnd('/')
}

private val TICKET_FORM = Regex("v1\\.([0-9a-f]{64})\\.[0-9]{1,12}\\.[A-Za-z0-9_-]{1,16}\\.[A-Za-z0-9_-]{43}")

/** 許可証の結び付く領域。形が違えば null。署名と期限はサーバーだけが確かめる(端末の時計を信用しない) */
fun ticketSpaceId(ticket: String): String? = TICKET_FORM.matchEntire(ticket)?.groupValues?.get(1)

class ChangesPage(val records: List<Map<String, Any?>>, val head: Long, val more: Boolean, val epoch: String, val gcFloor: Long)

class PushResult(val recordId: String, val status: Long, val version: Long?, val record: Map<String, Any?>?)

class PushResponse(val results: List<PushResult>, val epoch: String, val gcFloor: Long)

private const val MAX_SAFE = 9007199254740991L
private fun isCount(v: Any?) = v is Long && v in 0..MAX_SAFE
private fun bad() = SyncApiError("bad_response")

private fun checkEpoch(v: Any?): String {
    if (v !is String || v.isEmpty() || v.length > 128) throw bad()
    return v
}

@Suppress("UNCHECKED_CAST")
class SyncApi(serverUrl: String, private val tokenHex: String, private val transport: SyncTransport, allowLocalhost: Boolean = false) {
    private val base = checkServerUrl(serverUrl, allowLocalhost)

    private suspend fun call(method: String, path: String, body: Any? = null): Map<String, Any?> {
        val headers = LinkedHashMap<String, String>()
        headers["Authorization"] = "Bearer $tokenHex"
        if (body != null) headers["Content-Type"] = "application/json"
        val res = try {
            transport.send(SyncRequest(method, base + path, headers, body?.let { canonicalJson(it) }, SyncConfig.MAX_RESPONSE_BYTES, SyncConfig.HTTP_TIMEOUT_MS))
        } catch (e: CancellationException) {
            throw e
        } catch (_: SyncResponseTooLarge) {
            throw SyncApiError("too_large")
        } catch (_: Exception) {
            throw SyncApiError("network")
        }
        if (res.status in 300..399) throw SyncApiError("redirect", res.status)
        if (res.body.length > SyncConfig.MAX_RESPONSE_BYTES) throw SyncApiError("too_large")
        val parsed = try {
            parseStrictJson(res.body)
        } catch (_: Exception) {
            null
        }
        val detail = parsed as? Map<String, Any?>
        if (res.status !in 200..299) throw SyncApiError("http", res.status, (detail?.get("error") as? String)?.take(64).orEmpty(), detail)
        return parsed as? Map<String, Any?> ?: throw bad()
    }

    suspend fun createSpace(ticket: String): String {
        val r = try {
            call("POST", "/spaces", mapOf("ticket" to ticket))
        } catch (e: SyncApiError) {
            if (e.status != 403 || e.code != "pow_required") throw e
            val pow = try {
                checkPowChallenge(e.detail?.get("pow"))
            } catch (_: IllegalArgumentException) {
                throw bad()
            }
            // 解いて 1 回だけ送り直す。断られたら、ほかの 403 と同じくエンジンが止まる
            call("POST", "/spaces", mapOf("ticket" to ticket, "pow" to mapOf("challenge" to pow.challenge, "nonce" to solvePow(pow.challenge, pow.bits))))
        }
        return checkEpoch(r["epoch"])
    }

    suspend fun changes(since: Long): ChangesPage {
        val r = call("GET", "/changes?since=$since")
        val records = r["records"] as? List<*> ?: throw bad()
        if (!records.all { it is Map<*, *> } || !isCount(r["head"]) || r["more"] !is Boolean || !isCount(r["gc_floor"])) throw bad()
        return ChangesPage(records as List<Map<String, Any?>>, r["head"] as Long, r["more"] as Boolean, checkEpoch(r["epoch"]), r["gc_floor"] as Long)
    }

    suspend fun pushRecords(requestId: String, records: List<Map<String, Any?>>): PushResponse {
        val r = call("POST", "/records", mapOf("request_id" to requestId, "records" to records))
        val list = r["results"] as? List<*> ?: throw bad()
        if (!isCount(r["gc_floor"])) throw bad()
        val results = list.map { x ->
            val m = x as? Map<String, Any?> ?: throw bad()
            val id = m["record_id"] as? String ?: throw bad()
            val status = m["status"]
            if (status != 200L && status != 409L) throw bad()
            if (status == 200L && !isCount(m["version"])) throw bad()
            if (status == 409L && m["record"] !is Map<*, *>) throw bad()
            PushResult(id, status as Long, m["version"] as? Long, m["record"] as? Map<String, Any?>)
        }
        return PushResponse(results, checkEpoch(r["epoch"]), r["gc_floor"] as Long)
    }
}
