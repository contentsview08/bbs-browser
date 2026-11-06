package io.github.contentsview08.obb.sync

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.Base64

// バイト列と文字列の変換。サーバーから来た値を読むので、どれも正しい形だけを受け付ける

fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }

fun fromHex(s: String): ByteArray {
    if (s.length % 2 != 0 || !s.all { it in '0'..'9' || it in 'a'..'f' }) throw SyncError("bad_encoding")
    return ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
}

fun toBase64Url(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)

/** 余りのビットが立った別表記も拒否する(同じバイト列に複数の書き方を許さない) */
fun fromBase64Url(s: String): ByteArray {
    if (!s.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '_' || it == '-' } || s.length % 4 == 1) throw SyncError("bad_encoding")
    val out = try {
        Base64.getUrlDecoder().decode(s)
    } catch (_: IllegalArgumentException) {
        throw SyncError("bad_encoding")
    }
    if (toBase64Url(out) != s) throw SyncError("bad_encoding")
    return out
}

fun utf8(s: String): ByteArray = s.toByteArray(Charsets.UTF_8)

fun fromUtf8(b: ByteArray): String = try {
    Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(b))
        .toString()
} catch (_: CharacterCodingException) {
    throw SyncError("bad_utf8")
}
