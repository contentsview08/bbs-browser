package io.github.contentsview08.obb.sync

import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.macs.HMac
import org.bouncycastle.crypto.params.HKDFParameters
import org.bouncycastle.crypto.params.KeyParameter
import java.security.SecureRandom

// 鍵の導出とレコード ID

const val KEY_BYTES = 32

class SyncKeys(val authToken: ByteArray, val kData: ByteArray, val kSecret: ByteArray, val kId: ByteArray)

fun generateMasterKey(): ByteArray = ByteArray(KEY_BYTES).also { SecureRandom().nextBytes(it) }

fun sha256(data: ByteArray): ByteArray {
    val d = SHA256Digest()
    d.update(data, 0, data.size)
    return ByteArray(d.digestSize).also { d.doFinal(it, 0) }
}

fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
    val m = HMac(SHA256Digest())
    m.init(KeyParameter(key))
    m.update(data, 0, data.size)
    return ByteArray(m.macSize).also { m.doFinal(it, 0) }
}

fun hkdfSha256(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
    val g = HKDFBytesGenerator(SHA256Digest())
    g.init(HKDFParameters(ikm, salt, info))
    return ByteArray(length).also { g.generateBytes(it, 0, length) }
}

fun deriveKeys(k: ByteArray): SyncKeys {
    if (k.size != KEY_BYTES) throw SyncError("bad_key")
    fun d(info: String) = hkdfSha256(k, ByteArray(0), utf8(info), KEY_BYTES)
    return SyncKeys(d("obb-sync/auth"), d("obb-sync/data"), d("obb-sync/secret"), d("obb-sync/record-id"))
}

/** Worker は Bearer の 16 進をバイト列に戻して同じ計算をする */
fun spaceId(authToken: ByteArray): String = sha256(authToken).toHex()

private val FIVE_CH_NET = Regex("((?:[a-z0-9]+\\.)?)5ch\\.net")
private val BOARD_URL = Regex("https?://(?:[^/?#@]*@)?(\\[[^\\]/?#]+\\]|[^/?#:@]+)(?::([0-9]*))?([^?#]*)(?:[?#][\\s\\S]*)?", RegexOption.IGNORE_CASE)
private const val MAX_URL = 2048
private val DOUBLE_SLASH = Regex("/{2,}")
private val KIND = Regex("[a-z_]{1,32}")

private fun isEdgeSpace(c: Char) = c == ' ' || c == '\t' || c == '\r' || c == '\n'

/**
 * 板 URL の同一性の決まり。スキームを除いた「ホスト[:ポート]/道/」にする(コネクタの boardKey と同じ形)。
 * http と https、5ch.net と 5ch.io、大文字のホスト、末尾の /、既定のポートの違いをなくす。道の大文字は板の名前なので変えない。
 * 掲示板の URL でなければ null
 */
fun normalizeBoardUrl(url: String): String? {
    val s = url.trim(::isEdgeSpace)
    if (s.length > MAX_URL || s.any { it.code <= 0x20 || it.code == 0x7f }) return null
    val m = BOARD_URL.matchEntire(s) ?: return null
    val lower = m.groupValues[1].lowercase().removeSuffix(".")
    if (lower.isEmpty()) return null
    val host = FIVE_CH_NET.matchEntire(lower)?.let { it.groupValues[1] + "5ch.io" } ?: lower
    val p = m.groupValues[2]
    val port = if (p.isNotEmpty() && p != "80" && p != "443") ":$p" else ""
    return host + port + "/${m.groupValues[3]}/".replace(DOUBLE_SLASH, "/")
}

/** 区切りの : を中身と混同しないようにする(細目に URL などが入っても、別のレコードと同じ ID にならない) */
private fun escapePart(s: String) = s.replace("%", "%25").replace(":", "%3A")

/** HMAC にかける文字列。板のないレコード(設定など)は boardUrl を null にする */
fun recordIdInput(kind: String, boardUrl: String?, thread: String? = null, detail: String? = null): String {
    val board = if (boardUrl == null) "" else normalizeBoardUrl(boardUrl)
    if (board == null || !KIND.matches(kind)) throw SyncError("bad_id")
    val head = "$kind:${escapePart(board)}:${escapePart(thread.orEmpty())}"
    return if (detail == null) head else "$head:${escapePart(detail)}"
}

fun recordId(kId: ByteArray, kind: String, boardUrl: String?, thread: String? = null, detail: String? = null): String =
    hmacSha256(kId, utf8(recordIdInput(kind, boardUrl, thread, detail))).toHex()
