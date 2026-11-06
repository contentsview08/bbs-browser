package io.github.contentsview08.obb.sync

import org.bouncycastle.crypto.modes.ChaCha20Poly1305
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.KeyParameter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

// 乱数を使う処理と、固定のベクトルでは確かめられない性質
class SyncCryptoTest {
    private val keys = deriveKeys(generateMasterKey())
    private val space = spaceId(keys.authToken)
    private val rid = "a".repeat(64)
    private val payload: SyncPayload = mapOf(
        "kind" to "favorite", "hlc" to "000000000001.0000.d0", "device_id" to "d0",
        "body" to mapOf("board_url" to "https://a.example/b/", "title" to "ひみつのスレタイ", "x" to 1L),
    )

    private fun ctx(tag: String) = RecordContext(space, rid, tag, 1)

    private fun raw(tag: String): Map<String, Any?> {
        val (nonce, ct) = sealPayload(keys, ctx(tag), payload)
        return mapOf("record_id" to rid, "version" to 1L, "kind_tag" to tag, "schema_version" to 1L, "deleted" to false, "nonce" to nonce, "ciphertext" to ct)
    }

    /** 公式のベクトルの暗号化の向き。本番に固定ノンスの口を作らないので、副鍵の処理だけを本番の関数から使う */
    @Test fun official_vector_encrypts() {
        val key = ByteArray(32) { (0x80 + it).toByte() }
        val nonce = ByteArray(24) { (0x40 + it).toByte() }
        val aad = fromHex("50515253c0c1c2c3c4c5c6c7")
        val plain = utf8("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.")
        val c = ChaCha20Poly1305()
        c.init(true, AEADParameters(KeyParameter(hchacha20(key, nonce.copyOf(16))), 128, ByteArray(4) + nonce.copyOfRange(16, 24), aad))
        val out = ByteArray(c.getOutputSize(plain.size))
        val n = c.processBytes(plain, 0, plain.size, out, 0)
        c.doFinal(out, n)
        assertEquals(
            "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52e" + "c0875924c1c7987947deafd8780acf49",
            out.toHex(),
        )
    }

    @Test fun nonce_is_new_and_length_is_padded() {
        val a = raw("h")
        val b = raw("h")
        assertTrue(a["nonce"] != b["nonce"])
        assertTrue(a["ciphertext"] != b["ciphertext"])
        assertEquals(24, fromBase64Url(a["nonce"] as String).size)
        assertEquals(256 + 16, fromBase64Url(a["ciphertext"] as String).size)
    }

    @Test fun round_trip_keeps_unknown_fields() {
        val r = openRecords(keys, space, listOf(raw("h")))
        assertEquals(canonicalJson(payload), canonicalJson(r.records[0].payload))
    }

    @Test fun secret_uses_its_own_key() {
        val other = SyncKeys(keys.authToken, keys.kData, keys.kData, keys.kId)
        assertEquals("decrypt", openRecords(other, space, listOf(raw("s"))).failed[0].reason)
    }

    @Test fun broken_records_are_counted_and_others_open() {
        val moved = raw("h") + ("record_id" to "b".repeat(64))
        val r = openRecords(keys, space, listOf(moved, null, 3L, mapOf("record_id" to "<script>"), raw("h")))
        assertEquals(listOf(rid), r.records.map { it.recordId })
        assertEquals(listOf("decrypt", "shape", "shape", "shape"), r.failed.map { it.reason })
    }

    @Test fun other_space_cannot_open() {
        assertEquals("decrypt", openRecords(keys, "c".repeat(64), listOf(raw("h"))).failed[0].reason)
    }

    @Test fun error_text_has_no_secret() {
        val big = payload + ("body" to mapOf("title" to "ひみつのスレタイ".repeat(5000)))
        val e = assertThrows(SyncError::class.java) { sealPayload(keys, ctx("h"), big) }
        assertEquals("too_large", e.message)
        assertNull(e.cause)
        val r = raw("h")
        val ct = r["ciphertext"] as String
        val tampered = r + ("ciphertext" to ct.dropLast(4) + if (ct.endsWith("AAAA")) "BBBB" else "AAAA")
        val failed = openRecords(keys, space, listOf(tampered))
        assertEquals("decrypt", failed.failed[0].reason)
        val t = assertThrows(SyncError::class.java) { xchachaOpen(keys.kData, ByteArray(24), ByteArray(32), ByteArray(0)) }
        assertEquals("decrypt_failed", t.message)
        assertNull(t.cause)
    }

    @Test fun plain_deleted_is_not_used() {
        val r = openRecords(keys, space, listOf(raw("h") + ("deleted" to true)))
        assertFalse(r.records[0].payload.containsKey("deleted"))
    }

    @Test fun strict_parser_rejects_what_json_parse_rejects() {
        for (bad in listOf("{'a':1}", "{a:1}", "[1,]", "{\"a\":1,}", "01", "1.", "+1", "\"\\x\"", "\"\n\"", "nul", "[1] 2", "", "\uFEFF{}", "// x\n1", "NaN")) {
            assertThrows(bad, SyncError::class.java) { parseStrictJson(bad) }
        }
        assertEquals(1L, parseStrictJson(" 1.0 "))
        assertEquals(100L, parseStrictJson("1e2"))
        assertEquals("{\"a\":2}", canonicalJson(parseStrictJson("{\"a\":1,\"a\":2}")))
        assertEquals("\"\\u0001\\n\\ud800\"", canonicalJson(parseStrictJson("\"\\u0001\\n\\ud800\"")))
    }

    @Test fun device_id_is_22_chars_and_random() {
        val a = generateDeviceId()
        assertTrue(Regex("[A-Za-z0-9_-]{22}").matches(a))
        assertFalse(a == generateDeviceId())
    }

    private fun post(body: String): SyncPayload = mapOf(
        "kind" to "post", "hlc" to "000000000001.0000.d0", "device_id" to "d0",
        "body" to mapOf("post_id" to "a".repeat(32), "board_url" to "https://a.example/b/", "thread" to "1700000000", "title" to "あ".repeat(100), "no" to 1L, "body" to body, "posted_at" to 1L),
    )

    @Test fun post_of_max_japanese_fits() {
        sealPayload(keys, ctx("h"), post("あ".repeat(4096)))
    }

    @Test fun post_of_escaped_chars_can_exceed_limit() {
        assertThrows(SyncError::class.java) { sealPayload(keys, ctx("h"), post("\u0001".repeat(4096))) }
    }
}
