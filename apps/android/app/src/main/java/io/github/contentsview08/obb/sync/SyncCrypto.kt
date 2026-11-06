package io.github.contentsview08.obb.sync

import org.bouncycastle.crypto.modes.ChaCha20Poly1305
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.KeyParameter
import java.security.SecureRandom

// レコードの暗号化。ノンスは毎回ここで作り、外から渡す口を作らない(テストの固定値が本番へ紛れないように)

const val PAD_BLOCK = 256
const val NONCE_BYTES = 24
const val TAG_BYTES = 16
const val MAX_CIPHERTEXT = 16 * 1024
private const val MAX_SAFE = 9007199254740991L

class RecordContext(val spaceId: String, val recordId: String, val kindTag: String, val schemaVersion: Long)

class Sealed(val nonce: ByteArray, val ciphertext: ByteArray)

private val HEX_64 = Regex("[0-9a-f]{64}")

/** 中身の長さを隠す。最後に 0x80 を置いて 0 で埋める(ISO/IEC 7816-4)ので、必ず 1 バイト以上増える */
fun pad(plain: ByteArray): ByteArray {
    val out = plain.copyOf((plain.size / PAD_BLOCK + 1) * PAD_BLOCK)
    out[plain.size] = 0x80.toByte()
    return out
}

fun unpad(padded: ByteArray): ByteArray {
    if (padded.isEmpty() || padded.size % PAD_BLOCK != 0) throw SyncError("bad_padding")
    var i = padded.size - 1
    while (i >= 0 && padded[i] == 0.toByte()) i--
    if (i < 0 || padded[i] != 0x80.toByte()) throw SyncError("bad_padding")
    return padded.copyOf(i)
}

/** 各項目の形を固定して、区切りの | を中身に混ぜられないようにする */
fun buildAad(c: RecordContext): ByteArray {
    if (!HEX_64.matches(c.spaceId) || !HEX_64.matches(c.recordId) || (c.kindTag != "h" && c.kindTag != "s") || c.schemaVersion !in 0..MAX_SAFE) throw SyncError("bad_aad")
    return utf8("${c.spaceId}|${c.recordId}|${c.kindTag}|${c.schemaVersion}")
}

private fun keyFor(keys: SyncKeys, tag: String) = if (tag == "s") keys.kSecret else keys.kData

private fun rotl(x: Int, n: Int) = (x shl n) or (x ushr (32 - n))

private fun leInt(b: ByteArray, at: Int): Int =
    (b[at].toInt() and 0xff) or ((b[at + 1].toInt() and 0xff) shl 8) or ((b[at + 2].toInt() and 0xff) shl 16) or ((b[at + 3].toInt() and 0xff) shl 24)

/**
 * XChaCha の副鍵を作る。BouncyCastle に XChaCha がないので、ここだけ足す。
 * draft-irtf-cfrg-xchacha 2.2 の手順で、sync-crypto.json の公式ベクトルで確かめる
 */
internal fun hchacha20(key: ByteArray, nonce16: ByteArray): ByteArray {
    val s = IntArray(16)
    s[0] = 0x61707865
    s[1] = 0x3320646e
    s[2] = 0x79622d32
    s[3] = 0x6b206574
    for (i in 0 until 8) s[4 + i] = leInt(key, i * 4)
    for (i in 0 until 4) s[12 + i] = leInt(nonce16, i * 4)
    fun q(a: Int, b: Int, c: Int, d: Int) {
        s[a] += s[b]; s[d] = rotl(s[d] xor s[a], 16)
        s[c] += s[d]; s[b] = rotl(s[b] xor s[c], 12)
        s[a] += s[b]; s[d] = rotl(s[d] xor s[a], 8)
        s[c] += s[d]; s[b] = rotl(s[b] xor s[c], 7)
    }
    repeat(10) {
        q(0, 4, 8, 12); q(1, 5, 9, 13); q(2, 6, 10, 14); q(3, 7, 11, 15)
        q(0, 5, 10, 15); q(1, 6, 11, 12); q(2, 7, 8, 13); q(3, 4, 9, 14)
    }
    val out = ByteArray(32)
    for ((j, i) in intArrayOf(0, 1, 2, 3, 12, 13, 14, 15).withIndex()) {
        for (k in 0 until 4) out[j * 4 + k] = (s[i] ushr (8 * k)).toByte()
    }
    return out
}

/** XChaCha20 の 12 バイトのノンス。先頭 4 バイトは 0 */
private fun innerNonce(nonce: ByteArray): ByteArray = ByteArray(4) + nonce.copyOfRange(16, 24)

private fun aead(encrypt: Boolean, key: ByteArray, nonce: ByteArray, aad: ByteArray, input: ByteArray): ByteArray {
    val c = ChaCha20Poly1305()
    c.init(encrypt, AEADParameters(KeyParameter(hchacha20(key, nonce.copyOf(16))), TAG_BYTES * 8, innerNonce(nonce), aad))
    val out = ByteArray(c.getOutputSize(input.size))
    val n = c.processBytes(input, 0, input.size, out, 0)
    return out.copyOf(n + c.doFinal(out, n))
}

/** 公式のテストベクトルや埋め草のない暗号文も確かめられるよう、復号の中心は AAD をバイト列で受ける */
fun xchachaOpen(key: ByteArray, nonce: ByteArray, ciphertext: ByteArray, aad: ByteArray): ByteArray {
    if (key.size != KEY_BYTES) throw SyncError("bad_key")
    if (nonce.size != NONCE_BYTES) throw SyncError("bad_nonce")
    return try {
        aead(false, key, nonce, aad, ciphertext)
    } catch (_: Exception) {
        // 元の例外は持たない(文に中身が入らないことをライブラリに任せない)
        throw SyncError("decrypt_failed")
    }
}

fun sealRecord(key: ByteArray, ctx: RecordContext, plain: ByteArray): Sealed {
    if (key.size != KEY_BYTES) throw SyncError("bad_key")
    val aad = buildAad(ctx)
    val padded = pad(plain)
    if (padded.size + TAG_BYTES > MAX_CIPHERTEXT) throw SyncError("too_large")
    val nonce = ByteArray(NONCE_BYTES).also { SecureRandom().nextBytes(it) }
    return Sealed(nonce, aead(true, key, nonce, aad, padded))
}

fun openRecord(key: ByteArray, ctx: RecordContext, nonce: ByteArray, ciphertext: ByteArray): ByteArray {
    val aad = buildAad(ctx)
    if (ciphertext.size > MAX_CIPHERTEXT || ciphertext.size < PAD_BLOCK + TAG_BYTES || (ciphertext.size - TAG_BYTES) % PAD_BLOCK != 0) throw SyncError("bad_length")
    return unpad(xchachaOpen(key, nonce, ciphertext, aad))
}

/** サーバーへ送る形。nonce・ciphertext は Base64URL(埋めの = なし) */
fun sealPayload(keys: SyncKeys, ctx: RecordContext, payload: SyncPayload): Pair<String, String> {
    val s = sealRecord(keyFor(keys, ctx.kindTag), ctx, utf8(canonicalJson(payload)))
    return toBase64Url(s.nonce) to toBase64Url(s.ciphertext)
}

class OpenedRecord(val recordId: String, val version: Long, val payload: SyncPayload)

/** 捨てた数を画面に出すための記録。recordId は形が正しいときだけ入れ、中身は入れない。reason は shape・decrypt・padding・json・schema */
class OpenFailure(val recordId: String?, val reason: String)

class OpenResult(val records: List<OpenedRecord>, val failed: List<OpenFailure>)

/**
 * サーバーから来たレコードをまとめて開く。壊れたレコードはそれだけ捨てて数え、ほかを止めない。
 * 平文の deleted は改ざんできるので見ない(本当の値は暗号文の中)
 */
fun openRecords(keys: SyncKeys, spaceIdValue: String, raw: List<Any?>): OpenResult {
    val records = ArrayList<OpenedRecord>()
    val failed = ArrayList<OpenFailure>()
    for (r in raw) {
        val o = r as? Map<*, *> ?: emptyMap<String, Any?>()
        val id = (o["record_id"] as? String)?.takeIf { HEX_64.matches(it) }
        val version = o["version"] as? Long
        val tag = o["kind_tag"] as? String
        val schema = o["schema_version"] as? Long
        val nonce = o["nonce"] as? String
        val ciphertext = o["ciphertext"] as? String
        if (id == null || version == null || version !in 0..MAX_SAFE || (tag != "h" && tag != "s") || schema == null || schema !in 0..MAX_SAFE || nonce == null || ciphertext == null) {
            failed += OpenFailure(id, "shape")
            continue
        }
        val plain = try {
            openRecord(keyFor(keys, tag), RecordContext(spaceIdValue, id, tag, schema), fromBase64Url(nonce), fromBase64Url(ciphertext))
        } catch (e: SyncError) {
            failed += OpenFailure(id, when (e.code) { "decrypt_failed" -> "decrypt"; "bad_padding" -> "padding"; else -> "shape" })
            continue
        }
        val value = try {
            parseStrictJson(fromUtf8(plain))
        } catch (_: SyncError) {
            failed += OpenFailure(id, "json")
            continue
        }
        val payload = checkPayload(value)
        if (payload == null) failed += OpenFailure(id, "schema") else records += OpenedRecord(id, version, payload)
    }
    return OpenResult(records, failed)
}
