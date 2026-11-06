package io.github.contentsview08.obb.sync

import org.junit.Assert.assertEquals
import org.junit.Test

// 偽サーバーの決まり。PC 版の fakeServer.rules.test.ts と同じファイルを読む
class FakeSyncServerTest {
    private fun tokenOf(name: String) = sha256(utf8("token:$name")).toHex()
    private fun recordIdOf(name: String) = sha256(utf8("record:$name")).toHex()
    private fun cipher(n: Int) = toBase64Url(ByteArray(n))
    private val nonce = toBase64Url(ByteArray(24))

    private fun recordBody(r: Map<*, *>): Map<String, Any?> = buildMap {
        put("record_id", recordIdOf(r["id"].toString()))
        put("base_version", r["base_version"] ?: 0L)
        put("kind_tag", "h")
        put("schema_version", 1L)
        put("deleted", r["deleted"] ?: false)
        put("nonce", nonce)
        put("ciphertext", cipher(((r["cipher_bytes"] as Long?) ?: 272L).toInt()))
        if (r["extra_key"] == true) put("extra_key", true)
    }

    /** 期待に書いたキーだけ比べる。配列は要素ごとに比べ、長さも見る */
    private fun subset(actual: Any?, want: Any?, path: String) {
        when (want) {
            is Map<*, *> -> for ((k, v) in want) subset((actual as? Map<*, *>)?.get(k), v, "$path.$k")
            is List<*> -> {
                assertEquals(path, want.size, (actual as List<*>).size)
                want.forEachIndexed { i, w -> subset(actual[i], w, "$path[$i]") }
            }
            else -> assertEquals(path, want, actual)
        }
    }

    @Suppress("UNCHECKED_CAST")
    @Test fun 決まりのファイルのとおりに動く() {
        val cases = parseStrictJson(javaClass.classLoader!!.getResourceAsStream("sync-server-rules.json")!!.readBytes().toString(Charsets.UTF_8)) as List<Map<String, Any?>>
        assertEquals(true, cases.size >= 24)
        for (c in cases) {
            var now = 1_800_000_000_000L
            val o = c["server"] as Map<String, Any?>? ?: emptyMap()
            val server = FakeSyncServer(
                now = { now },
                spaceLimit = (o["space_limit"] as Long?)?.toInt() ?: 100,
                quotaBytes = o["quota_bytes"] as Long? ?: (10L * 1024 * 1024),
                quotaRecords = (o["quota_records"] as Long?)?.toInt() ?: 50_000,
                creationClosed = o["creation_closed"] == true,
                ratePerMinute = (o["rate_per_minute"] as Long?)?.toInt(),
                fullPullPerHour = (o["full_pull_per_hour"] as Long?)?.toInt(),
            )
            fun send(method: String, path: String, token: String?, body: String? = null, extra: Map<String, String> = emptyMap()): FakeResponse {
                val headers = LinkedHashMap<String, String>()
                if (token != null) headers["Authorization"] = "Bearer ${tokenOf(token)}"
                headers += extra
                return server.handle(FakeRequest(method, path, headers, body))
            }
            (c["steps"] as List<Map<String, Any?>>).forEachIndexed { i, s ->
                val at = "${c["name"]} 手順 $i"
                val adv = s["advance_ms"] as Long?
                if (adv != null) {
                    val keep = s["keep_alive"] as String?
                    if (keep != null) {
                        now += adv - 1000
                        send("GET", "/head", keep)
                        now += 1000
                    } else now += adv
                    return@forEachIndexed
                }
                if (s["inject"] != null) {
                    val id = fakeSpaceIdOf(tokenOf(s["inject"] as String))
                    for (n in 0 until s["count"] as Long) server.injectRecord(id, recordIdOf("inj$n"), "h", 1, false, nonce, cipher(272))
                    return@forEachIndexed
                }
                val res = if (s["push"] != null) {
                    val records = if (s["repeat_records"] != null) List((s["repeat_records"] as Long).toInt()) { n -> recordBody(mapOf("id" to n)) } else (s["records"] as List<Map<*, *>>).map(::recordBody)
                    send("POST", "/records", s["push"] as String, canonicalJson(mapOf("request_id" to s["request_id"], "records" to records)))
                } else {
                    val extra = LinkedHashMap<String, String>()
                    (s["raw_auth"] as String?)?.let { extra["Authorization"] = it }
                    (s["if_none_match"] as String?)?.let { extra["If-None-Match"] = it }
                    send(s["method"] as String, s["path"] as String, s["token"] as String?, s["body"] as String?, extra)
                }
                val e = s["expect"] as Map<String, Any?>? ?: return@forEachIndexed
                assertEquals("$at の status", (e["status"] as Long).toInt(), res.status)
                (e["etag"] as String?)?.let { assertEquals(at, it, res.headers["ETag"]) }
                val parsed = if (res.body.isEmpty()) null else parseStrictJson(res.body) as Map<String, Any?>
                e["body"]?.let { subset(parsed, it, at) }
                (e["record_versions"] as List<Long>?)?.let { assertEquals(at, it, (parsed!!["records"] as List<Map<String, Any?>>).map { r -> r["version"] }) }
                (e["record_count"] as Long?)?.let { assertEquals(at, it.toInt(), (parsed!!["records"] as List<*>).size) }
            }
        }
    }
}
