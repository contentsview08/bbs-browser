package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.sync.engine.powOk

// テスト用の同期サーバー。決まりは docs/sync-design.md の API と packages/conformance/sync-server-rules.json。PC 版の packages/sync/test/fakeServer.ts と同じ規則

class FakeRequest(val method: String, val path: String, val headers: Map<String, String> = emptyMap(), val body: String? = null)

class FakeResponse(val status: Int, val headers: Map<String, String>, val body: String)

class FakeServerRecord(val recordId: String, val version: Long, val kindTag: String, val schemaVersion: Long, val deleted: Boolean, val nonce: String, val ciphertext: String, val updatedAt: Long) {
    fun toMap(): Map<String, Any?> = mapOf(
        "record_id" to recordId, "version" to version, "kind_tag" to kindTag, "schema_version" to schemaVersion, "deleted" to deleted,
        "nonce" to nonce, "ciphertext" to ciphertext, "updated_at" to updatedAt,
    )
}

class FakeSpace(val id: String, var epoch: String, var lastUsed: Long) {
    val records = LinkedHashMap<String, FakeServerRecord>()
    var next = 0L
    var gcFloor = 0L
    val requests = HashMap<String, String>()
    var minute = 0L
    var minuteCount = 0
    var fullPulls = ArrayList<Long>()
}

private const val DAY = 24L * 60 * 60 * 1000
private const val HOUR = 60L * 60 * 1000
private const val MAX_BODY = 1024 * 1024
private const val MAX_RECORDS = 100
private const val PAGE_RECORDS = 500
private const val PAGE_BYTES = 1024 * 1024
private const val MAX_CIPHERTEXT = 16 * 1024
private const val MAX_SAFE = 9007199254740991L
private val RECORD_KEYS = setOf("base_version", "ciphertext", "deleted", "kind_tag", "nonce", "record_id", "schema_version")
private val KNOWN = mapOf("/tickets" to listOf("POST"), "/spaces" to listOf("POST"), "/changes" to listOf("GET"), "/records" to listOf("POST"), "/head" to listOf("GET"), "/space" to listOf("GET", "DELETE"))
private val BEARER = Regex("Bearer ([0-9a-f]{64})")
private val SINCE = Regex("since=(0|[1-9][0-9]*)")
private val REQUEST_ID = Regex("[A-Za-z0-9_-]{22}")
private val HEX_64 = Regex("[0-9a-f]{64}")

private const val POW_TTL_SEC = 300L
private val TICKET_FORM = Regex("(v1\\.([0-9a-f]{64})\\.([0-9]{1,12})\\.([A-Za-z0-9_-]{1,16}))\\.([A-Za-z0-9_-]{43})")

@Suppress("UNCHECKED_CAST")
private val TICKET_FILE = parseStrictJson(FakeSyncServer::class.java.classLoader!!.getResourceAsStream("sync-ticket.json")!!.readBytes().toString(Charsets.UTF_8)) as Map<String, Any?>
private val TICKET_KID = (TICKET_FILE["key"] as Map<*, *>)["kid"] as String
private val TICKET_KEY = fromBase64Url((TICKET_FILE["key"] as Map<*, *>)["secret"] as String)

private fun mac(text: String) = toBase64Url(hmacSha256(TICKET_KEY, utf8(text)))

fun signTicket(spaceId: String, expSec: Long): String {
    val payload = "v1.$spaceId.$expSec.$TICKET_KID"
    return "$payload.${mac("obb-sync-ticket-v1:$payload")}"
}

fun checkFakeTicket(spaceId: String, nowMs: Long, ticket: String): String {
    val m = TICKET_FORM.matchEntire(ticket) ?: return "invalid"
    val g = m.groupValues
    if (g[4] != TICKET_KID || g[5] != mac("obb-sync-ticket-v1:${g[1]}") || g[2] != spaceId) return "invalid"
    return if (g[3].toLong() * 1000 <= nowMs) "expired" else "ok"
}

private fun isCount(v: Any?) = v is Long && v in 0..MAX_SAFE
private fun json(status: Int, value: Any?, headers: Map<String, String> = emptyMap()) = FakeResponse(status, headers, canonicalJson(value))
private fun fail(status: Int, error: String) = json(status, mapOf("error" to error))

private fun decoded(s: Any?): ByteArray? = if (s !is String) null else try {
    fromBase64Url(s)
} catch (_: Exception) {
    null
}

fun fakeSpaceIdOf(tokenHex: String): String = sha256(fromHex(tokenHex)).toHex()

class FakeSyncServer(
    private val now: () -> Long,
    private val spaceLimit: Int = 100,
    private val evictIdleDays: Long = 14,
    private val idleDeleteDays: Long = 90,
    private val tombGcDays: Long = 90,
    private val quotaBytes: Long = 10L * 1024 * 1024,
    private val quotaRecords: Int = 50_000,
    private val creationClosed: Boolean = false,
    /** null は数えない */
    private val ratePerMinute: Int? = 20,
    private val fullPullPerHour: Int? = 3,
    private val ticketTtlDays: Long = 365,
    /** 0 は問題を出さない */
    private val powBits: Long = 0,
) {
    val spaces = LinkedHashMap<String, FakeSpace>()
    private var epochs = 0

    // ── テストの操作。API にはない ──

    fun deleteSpace(id: String) {
        spaces.remove(id)
    }

    fun bumpEpoch(id: String) {
        spaces[id]?.epoch = newEpoch()
    }

    fun injectRecord(id: String, recordId: String, kindTag: String, schemaVersion: Long, deleted: Boolean, nonce: String, ciphertext: String) {
        val s = spaces.getValue(id)
        s.records[recordId] = FakeServerRecord(recordId, ++s.next, kindTag, schemaVersion, deleted, nonce, ciphertext, now())
    }

    private fun newEpoch() = "e${++epochs}"

    private fun housekeeping() {
        val t = now()
        for (id in spaces.keys.toList()) {
            val s = spaces.getValue(id)
            if (t - s.lastUsed >= idleDeleteDays * DAY) {
                spaces.remove(id)
                continue
            }
            for (r in s.records.values.toList()) {
                if (r.deleted && t - r.updatedAt >= tombGcDays * DAY) {
                    s.records.remove(r.recordId)
                    s.gcFloor = maxOf(s.gcFloor, r.version)
                }
            }
        }
    }

    fun handle(req: FakeRequest): FakeResponse {
        housekeeping()
        val q = req.path.indexOf('?')
        val path = if (q < 0) req.path else req.path.substring(0, q)
        val query = if (q < 0) "" else req.path.substring(q + 1)
        val methods = KNOWN[path] ?: return fail(404, "not_found")
        if (req.method !in methods) return fail(405, "method_not_allowed")
        if ((req.body?.length ?: 0) > MAX_BODY) return fail(413, "too_large")
        if (path == "/tickets") return tickets(req.body.orEmpty())
        val m = BEARER.matchEntire(req.headers["Authorization"].orEmpty()) ?: return fail(401, "unauthorized")
        val id = fakeSpaceIdOf(m.groupValues[1])
        if (path == "/spaces") return createSpace(id, req.body.orEmpty())
        val space = spaces[id] ?: return fail(404, "space_not_found")
        val t = now()
        if (ratePerMinute != null) {
            val minute = t / 60_000
            if (space.minute != minute) {
                space.minute = minute
                space.minuteCount = 0
            }
            if (++space.minuteCount > ratePerMinute) return fail(429, "rate_limited")
        }
        space.lastUsed = t
        if (path == "/changes") return changes(space, query)
        if (path == "/records") return records(space, req.body.orEmpty())
        if (path == "/head") {
            val etag = "\"${space.epoch}:${space.next}\""
            if (req.headers["If-None-Match"] == etag) return FakeResponse(304, mapOf("ETag" to etag), "")
            return json(200, mapOf("version" to space.next, "epoch" to space.epoch, "gc_floor" to space.gcFloor), mapOf("ETag" to etag))
        }
        if (req.method == "DELETE") {
            spaces.remove(id)
            return json(200, mapOf("deleted" to true))
        }
        return json(200, mapOf("used_bytes" to usedBytes(space), "record_count" to space.records.size.toLong(), "quota_bytes" to quotaBytes, "quota_records" to quotaRecords.toLong(), "epoch" to space.epoch, "gc_floor" to space.gcFloor))
    }

    private fun usedBytes(s: FakeSpace): Long = s.records.values.sumOf { it.ciphertext.length.toLong() }

    /** Turnstile の結果はトークンの値で決める(apps/sync-server/test/fakeSiteverify.ts と同じ) */
    @Suppress("UNCHECKED_CAST")
    private fun tickets(text: String): FakeResponse {
        val b = try {
            parseStrictJson(text) as? Map<String, Any?>
        } catch (_: Exception) {
            null
        } ?: return fail(400, "bad_request")
        if (b.keys != setOf("space_id", "turnstile")) return fail(400, "bad_request")
        val turnstile = b["turnstile"] as? String
        val id = b["space_id"] as? String
        if (turnstile.isNullOrEmpty() || id == null || !HEX_64.matches(id)) return fail(400, "bad_request")
        if (turnstile == "test-down") return fail(503, "turnstile_unavailable")
        if (turnstile != "test-pass") return fail(403, "turnstile_invalid")
        val exp = Math.floorDiv(now() + ticketTtlDays * DAY, 1000L)
        return json(200, mapOf("ticket" to signTicket(id, exp), "exp" to exp))
    }

    private fun checkFakePow(id: String, challenge: Any?, nonce: Any?): Boolean {
        if (challenge !is String || nonce !is String) return false
        val p = challenge.split(".")
        if (p.size != 5 || p[1] != id || p[2].toLong() * 1000 <= now() || p[3].toLong() < powBits) return false
        if (p[4] != mac(p.subList(0, 4).joinToString("."))) return false
        return powOk(challenge, nonce, p[3].toInt())
    }

    @Suppress("UNCHECKED_CAST")
    private fun createSpace(id: String, text: String): FakeResponse {
        val b = try {
            parseStrictJson(text) as? Map<String, Any?>
        } catch (_: Exception) {
            null
        } ?: return fail(400, "bad_request")
        if (b.keys.any { it != "ticket" && it != "pow" }) return fail(400, "bad_request")
        if (!b.containsKey("ticket")) return fail(403, "ticket_required")
        val ticket = b["ticket"] as? String ?: return fail(400, "bad_request")
        val check = checkFakeTicket(id, now(), ticket)
        if (check != "ok") return fail(403, if (check == "expired") "ticket_expired" else "ticket_invalid")
        if (powBits > 0) {
            val pow = b["pow"] as? Map<String, Any?>
            if (pow == null) {
                val payload = "v1.$id.${Math.floorDiv(now(), 1000L) + POW_TTL_SEC}.$powBits"
                return json(403, mapOf("error" to "pow_required", "pow" to mapOf("challenge" to "$payload.${mac(payload)}", "bits" to powBits)))
            }
            if (!checkFakePow(id, pow["challenge"], pow["nonce"])) return fail(403, "pow_invalid")
        }
        val t = now()
        spaces[id]?.let {
            it.lastUsed = t
            return json(200, mapOf("epoch" to it.epoch, "created" to false))
        }
        if (creationClosed) return fail(403, "creation_closed")
        if (spaces.size >= spaceLimit) {
            val idle = spaces.values.filter { t - it.lastUsed >= evictIdleDays * DAY }.sortedWith(compareBy({ it.lastUsed }, { it.id }))
            if (idle.isEmpty()) return fail(403, "capacity_full")
            spaces.remove(idle[0].id)
        }
        val space = FakeSpace(id, newEpoch(), t)
        spaces[id] = space
        return json(201, mapOf("epoch" to space.epoch, "created" to true))
    }

    private fun changes(s: FakeSpace, query: String): FakeResponse {
        val m = SINCE.matchEntire(query) ?: return fail(400, "bad_request")
        val since = m.groupValues[1].toLongOrNull()?.takeIf { it <= MAX_SAFE } ?: return fail(400, "bad_request")
        val t = now()
        // 空の領域の全件は重くない。使い始めの端末を止めないよう数えない
        if (since == 0L && fullPullPerHour != null && s.records.isNotEmpty()) {
            s.fullPulls = ArrayList(s.fullPulls.filter { t - it < HOUR })
            if (s.fullPulls.size >= fullPullPerHour) return fail(429, "rate_limited")
            s.fullPulls += t
        }
        val all = s.records.values.filter { it.version > since }.sortedBy { it.version }
        val page = ArrayList<FakeServerRecord>()
        var bytes = 0L
        for (r in all) {
            bytes += r.ciphertext.length + r.nonce.length
            if (page.isNotEmpty() && (page.size >= PAGE_RECORDS || bytes > PAGE_BYTES)) break
            page += r
        }
        return json(200, mapOf("records" to page.map { it.toMap() }, "head" to s.next, "more" to (page.size < all.size), "epoch" to s.epoch, "gc_floor" to s.gcFloor))
    }

    @Suppress("UNCHECKED_CAST")
    private fun records(s: FakeSpace, text: String): FakeResponse {
        val body = try {
            parseStrictJson(text) as? Map<String, Any?>
        } catch (_: Exception) {
            null
        } ?: return fail(400, "bad_request")
        if (body.keys != setOf("records", "request_id")) return fail(400, "bad_request")
        val requestId = body["request_id"] as? String
        if (requestId == null || !REQUEST_ID.matches(requestId)) return fail(400, "bad_request")
        val list = body["records"] as? List<*> ?: return fail(400, "bad_request")
        if (list.isEmpty() || list.size > MAX_RECORDS || !list.all(::validRecord)) return fail(400, "bad_request")
        s.requests[requestId]?.let { return FakeResponse(200, emptyMap(), it) }
        val rows = list as List<Map<String, Any?>>
        var bytes = usedBytes(s)
        var count = s.records.size
        for (r in rows) {
            val cur = s.records[r["record_id"] as String]
            if (cur != null && cur.version > (r["base_version"] as Long)) continue
            bytes += (r["ciphertext"] as String).length - (cur?.ciphertext?.length ?: 0)
            if (cur == null) count++
        }
        if (bytes > quotaBytes || count > quotaRecords) return fail(413, "quota_exceeded")
        val t = now()
        val results = rows.map { r ->
            val id = r["record_id"] as String
            val cur = s.records[id]
            if (cur != null && cur.version > (r["base_version"] as Long)) {
                mapOf("record_id" to id, "status" to 409L, "record" to cur.toMap())
            } else {
                val version = ++s.next
                s.records[id] = FakeServerRecord(id, version, r["kind_tag"] as String, r["schema_version"] as Long, r["deleted"] as Boolean, r["nonce"] as String, r["ciphertext"] as String, t)
                mapOf("record_id" to id, "status" to 200L, "version" to version)
            }
        }
        val out = canonicalJson(mapOf("results" to results, "epoch" to s.epoch, "gc_floor" to s.gcFloor))
        s.requests[requestId] = out
        return FakeResponse(200, emptyMap(), out)
    }

    private fun validRecord(v: Any?): Boolean {
        val r = v as? Map<*, *> ?: return false
        if (r.keys != RECORD_KEYS) return false
        val id = r["record_id"] as? String ?: return false
        if (!HEX_64.matches(id) || !isCount(r["base_version"]) || !isCount(r["schema_version"]) || r["deleted"] !is Boolean) return false
        if (r["kind_tag"] != "h" && r["kind_tag"] != "s") return false
        if (decoded(r["nonce"])?.size != 24) return false
        val c = decoded(r["ciphertext"]) ?: return false
        return c.size <= MAX_CIPHERTEXT && c.size >= 272 && (c.size - 16) % 256 == 0
    }
}
