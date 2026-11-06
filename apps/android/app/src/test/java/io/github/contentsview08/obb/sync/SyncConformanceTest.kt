package io.github.contentsview08.obb.sync

import io.github.contentsview08.obb.bbs.UrlRoute
import org.junit.Assert.assertEquals
import org.junit.Test

// 同期の決まりは packages/conformance の sync-*.json が正。PC 版のテスト(packages/sync/test/conformance.test.ts)も同じファイルを読む
class SyncConformanceTest {
    @Suppress("UNCHECKED_CAST")
    private fun load(file: String): List<Map<String, Any?>> =
        parseStrictJson(javaClass.classLoader!!.getResourceAsStream(file)!!.readBytes().toString(Charsets.UTF_8)) as List<Map<String, Any?>>

    @Suppress("UNCHECKED_CAST")
    private val ref = ThreadRef("https://a.example/b/", "1")

    private fun Map<String, Any?>.ref(k: String): ThreadRef = (this[k] as Map<*, *>).let { ThreadRef(it["board_url"] as String, it["thread"] as String) }

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.input() = this["input"] as Map<String, Any?>

    private fun Map<String, Any?>.s(k: String) = this[k] as String
    private fun Map<String, Any?>.sn(k: String) = this[k] as String?
    private fun Map<String, Any?>.hex(k: String) = fromHex(this[k] as String)

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.p(k: String) = this[k] as SyncPayload

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.pn(k: String) = this[k] as SyncPayload?

    @Suppress("UNCHECKED_CAST")
    private fun Map<String, Any?>.ps(k: String) = this[k] as List<SyncPayload>

    private fun run(file: String, f: (Map<String, Any?>) -> Any?) {
        val fails = ArrayList<String>()
        val all = load(file)
        for (c in all) {
            val expected = canonicalJson(c["expected"])
            val got = try {
                canonicalJson(f(c.input()))
            } catch (e: SyncError) {
                canonicalJson(mapOf("error" to e.code))
            } catch (e: Exception) {
                "例外: $e"
            }
            if (got != expected) fails += "${c["name"]}\n  期待: $expected\n  結果: $got"
        }
        assertEquals("$file の ${all.size} 件のうち ${fails.size} 件が違う\n" + fails.joinToString("\n"), 0, fails.size)
    }

    private fun ctx(c: Map<*, *>): RecordContext {
        val sv = c["schema_version"]
        // 小数は本番の型では作れないので、拒否されるのと同じ扱いにする
        if (sv !is Long) throw SyncError("bad_aad")
        return RecordContext(c["space_id"] as String, c["record_id"] as String, c["kind_tag"] as String, sv)
    }

    @Test fun crypto() = run("sync-crypto.json") { i ->
        when (i.s("fn")) {
            "sha256" -> sha256(i.hex("data")).toHex()
            "hmac" -> hmacSha256(i.hex("key"), i.hex("data")).toHex()
            "hkdf" -> hkdfSha256(i.hex("ikm"), i.hex("salt"), i.hex("info"), (i["length"] as Long).toInt()).toHex()
            "hchacha20" -> hchacha20(i.hex("key"), i.hex("nonce")).toHex()
            "xchacha_open" -> xchachaOpen(i.hex("key"), i.hex("nonce"), i.hex("ciphertext"), i.hex("aad")).toHex()
            "pad" -> pad(ByteArray((i["length"] as Long).toInt()) { 0x41 }).size
            "pad_bytes" -> pad(i.hex("plain")).toHex()
            "unpad" -> unpad(i.hex("padded")).toHex()
            "aad" -> buildAad(ctx(i["ctx"] as Map<*, *>)).toHex()
            "b64url_decode" -> fromBase64Url(i.s("text")).toHex()
            "b64url_encode" -> toBase64Url(i.hex("data"))
            "derive_keys" -> deriveKeys(i.hex("k")).let {
                mapOf("auth_token" to it.authToken.toHex(), "k_data" to it.kData.toHex(), "k_secret" to it.kSecret.toHex(), "k_id" to it.kId.toHex(), "space_id" to spaceId(it.authToken))
            }
            "open_record" -> openRecord(i.hex("key"), ctx(i["ctx"] as Map<*, *>), i.hex("nonce"), i.hex("ciphertext")).toHex()
            "open_records" -> {
                @Suppress("UNCHECKED_CAST")
                val r = openRecords(deriveKeys(i.hex("k")), i.s("space_id"), i["records"] as List<Any?>)
                mapOf(
                    "records" to r.records.map { mapOf("record_id" to it.recordId, "version" to it.version, "payload" to it.payload) },
                    "failed" to r.failed.map { mapOf("record_id" to it.recordId, "reason" to it.reason) },
                )
            }
            else -> error("知らない fn")
        }
    }

    @Test fun id() = run("sync-id.json") { i ->
        when (i.s("fn")) {
            "board" -> normalizeBoardUrl(i.s("url"))
            "record_input" -> recordIdInput(i.s("kind"), i.sn("board"), i.sn("thread"), i.sn("detail"))
            else -> recordId(i.hex("k_id"), i.s("kind"), i.sn("board"), i.sn("thread"), i.sn("detail"))
        }
    }

    @Test fun same_board_through_to5chIo() {
        for (c in load("sync-id.json")) {
            val i = c.input()
            if (i["fn"] != "board") continue
            val url = i.s("url")
            if (normalizeBoardUrl(url) != null) assertEquals(url, normalizeBoardUrl(url), normalizeBoardUrl(UrlRoute.to5chIo(url.trim())))
        }
    }

    @Test fun schema() = run("sync-schema.json") { i -> checkPayload(i) != null }

    /** 既読の手順を順に動かす。expect は途中の、それぞれの端末から見た既読位置 */
    private class Device(var clock: String = Hlc.ZERO, val store: MutableMap<String, SyncPayload> = LinkedHashMap())

    private fun readScript(events: List<Map<String, Any?>>): Map<String, Long> {
        val devices = LinkedHashMap<String, Device>()
        fun dev(n: String) = devices.getOrPut(n) { Device() }
        fun devsOf(n: String) = dev(n).store.filterKeys { it.startsWith("dev:") }.values
        fun position(n: String) = readPosition(dev(n).store["reset"], devsOf(n))
        fun deliver(from: String, to: String, t: Long) {
            for ((k, p) in dev(from).store.toMap()) {
                val old = dev(to).store[k]
                dev(to).store[k] = if (old != null) mergePayloads(old, p) else p
                dev(to).clock = Hlc.observe(dev(to).clock, p.hlc, t)
            }
        }
        for (e in events) {
            (e["dev"] as String?)?.let { dev(it) }
            when {
                e.containsKey("read") -> {
                    val n = e.s("dev")
                    val d = dev(n)
                    val old = d.store["dev:$n"]
                    val s = Hlc.stamp(d.clock, e["t"] as Long, n, old?.hlc)
                    d.clock = s.clock
                    d.store["dev:$n"] = recordRead(old, d.store["reset"], ref, e["read"] as Long, s.stamp, n)
                }
                e.containsKey("reset") -> {
                    val n = e.s("dev")
                    val d = dev(n)
                    val old = d.store["reset"]
                    val s = Hlc.stamp(d.clock, e["t"] as Long, n, resetFloor(old, devsOf(n)))
                    d.clock = s.clock
                    d.store["reset"] = makeReset(old, ref, e.s("id"), e["reset"] as Long, s.stamp, n)
                }
                e.containsKey("sync") -> {
                    val pair = e["sync"] as List<*>
                    deliver(pair[0] as String, pair[1] as String, e["t"] as Long)
                }
                e.containsKey("sync_all") -> repeat(2) {
                    for (a in devices.keys.toList()) for (b in devices.keys.toList()) if (a != b) deliver(a, b, e["sync_all"] as Long)
                }
                e.containsKey("expect") -> for ((n, v) in e["expect"] as Map<*, *>) assertEquals("途中の $n", v, position(n as String))
            }
        }
        return devices.keys.associateWith(::position)
    }

    @Suppress("UNCHECKED_CAST")
    private fun records(v: Any?): Map<String, LocalRecord> =
        (v as Map<String, Map<String, Any?>>).mapValues { LocalRecord(it.value["payload"] as SyncPayload, it.value["version"] as Long, it.value["tomb_at"] as Long?) }

    private fun recordJson(r: LocalRecord): Map<String, Any?> =
        mapOf("payload" to r.payload, "version" to r.version) + (if (r.tombAt != null) mapOf("tomb_at" to r.tombAt) else emptyMap())

    private fun pendingJson(m: Map<String, PendingRecord>) = m.mapValues { mapOf("payload" to it.value.payload, "base_version" to it.value.baseVersion) }

    @Suppress("UNCHECKED_CAST")
    @Test fun merge() = run("sync-merge.json") { i ->
        when (i.s("fn")) {
            "lww" -> mergeLww(i.p("a"), i.p("b")).also { assertEquals(canonicalJson(it), canonicalJson(mergeLww(i.p("b"), i.p("a")))) }
            "max" -> mergePayloads(i.p("a"), i.p("b")).also { assertEquals(canonicalJson(it), canonicalJson(mergePayloads(i.p("b"), i.p("a")))) }
            "update" -> updateRecord(i.pn("existing"), i.s("kind"), i.p("changes"), i.s("stamp"), i.s("device"))
            "tombstone" -> makeTombstone(i.p("existing"), i.s("stamp"), i.s("device"), (i["keep"] as List<String>?) ?: emptyList(), i["trim"] == true)
            "order_between" -> orderKeyBetween(i.sn("a"), i.sn("b"))
            "order_sort" -> i.ps("items").map { Ordered(it.s("key"), it.s("id")) }.sortedWith(ORDERED_COMPARATOR).map { it.id }
            "hlc_format" -> Hlc.format(i["wall"] as Long, (i["counter"] as Long).toInt(), i.s("device"))
            "hlc_parse" -> Hlc.parse(i.s("text")).let { mapOf("wall" to it.wall, "counter" to it.counter, "device" to it.device) }
            "hlc_compare" -> Hlc.compare(i.s("a"), i.s("b"))
            "hlc_observe" -> Hlc.observe(i.s("clock"), i.s("remote"), i["now"] as Long)
            "hlc_stamp" -> Hlc.stamp(i.s("clock"), i["now"] as Long, i.s("device"), i.sn("floor")).let { mapOf("stamp" to it.stamp, "clock" to it.clock) }
            "push_step" -> pushStep(i["steps"] as List<Map<String, Any?>>, i.s("at"), i["pos"] as Long)
            "read_position" -> readPosition(i.pn("reset"), i.ps("devs"))
            "record_read" -> recordRead(i.pn("dev"), i.pn("reset"), i.ref("ref"), i["pos"] as Long, i.s("stamp"), i.s("device"))
            "make_reset" -> makeReset(i.pn("existing"), i.ref("ref"), i.s("id"), i["target"] as Long, i.s("stamp"), i.s("device"))
            "reset_floor" -> resetFloor(i.pn("reset"), i.ps("devs"))
            "read_script" -> readScript(i["events"] as List<Map<String, Any?>>)
            "rebase" -> planRebase(records(i["local"]), i["pending"] as Map<String, SyncPayload>, records(i["full"]), i["complete"] as Boolean, i["now"] as Long).let { r ->
                mapOf(
                    "records" to r.records.mapValues { recordJson(it.value) },
                    "pending" to pendingJson(r.pending),
                    "removed" to r.removed,
                    "dropped_pending" to r.droppedPending,
                    "needs_confirmation" to r.needsConfirmation,
                )
            }
            "recreate" -> planRecreate(records(i["local"]), records(i["full"]), i["now"] as Long).let { r ->
                mapOf("records" to r.records.mapValues { recordJson(it.value) }, "pending" to pendingJson(r.pending), "expired" to r.expired)
            }
            "recreate_script" -> recreateScript(i["events"] as List<Map<String, Any?>>) { who, actual, want -> assertEquals("途中の $who", canonicalJson(want), canonicalJson(actual)) }
            "tomb_expired" -> isTombExpired(i["tomb_at"] as Long?, i["now"] as Long)
            "check_device_id" -> checkDeviceId(i.sn("stored"), i.sn("db")).name.lowercase()
            "sim_recreate" -> simulateRecreate(RecreateOptions((i["seed"] as Long).toInt(), (i["devices"] as Long).toInt(), (i["ops"] as Long).toInt(), i["skews"] as List<Long>)).sha256
            "sim" -> simulate(
                SimOptions(
                    (i["seed"] as Long).toInt(), (i["devices"] as Long).toInt(), (i["ops"] as Long).toInt(), i["skews"] as List<Long>,
                    (i["max_reads"] as Long?)?.toInt(), i["decreasing_reads"] == true,
                ),
            ).sha256
            else -> error("知らない fn")
        }
    }
}
