package io.github.contentsview08.obb.sync

// 書き込み履歴の ID と本文の切り方。切った後の本文で ID を作る(受け取った端末は切った本文しか持たないので、切る前で作ると作り直しで別の ID になる)

/** 暗号文の上限 16KB に、スレタイと URL の分を残す。エスケープで膨らんだ長さで数える */
const val POST_BODY_JSON_BYTES = 12288
private const val POST_ID_HEX = 32

/** JSON に書いたときのバイト数(canonicalJson と同じ規則) */
private fun jsonBytes(code: Int): Int = when {
    code == 0x22 || code == 0x5c || code == 0x08 || code == 0x09 || code == 0x0a || code == 0x0c || code == 0x0d -> 2
    code < 0x20 -> 6
    code < 0x80 -> 1
    code < 0x800 -> 2
    code in 0xd800..0xdfff -> 6
    code < 0x10000 -> 3
    else -> 4
}

/** 文字の途中で切らない。どちらの上限でも同じ位置で止まるので、PC とスマホで同じ本文になる */
fun fitPostBody(body: String): String {
    var bytes = 0
    var i = 0
    while (i < body.length) {
        val code = body.codePointAt(i)
        val units = if (code >= 0x10000) 2 else 1
        bytes += jsonBytes(code)
        if (i + units > POST_BODY_MAX || bytes > POST_BODY_JSON_BYTES) break
        i += units
    }
    return body.substring(0, i)
}

/** normalizedBoard は normalizeBoardUrl の値。同じ書き込みはどの端末でも、種まきをやり直しても同じ ID になる */
fun postIdOf(normalizedBoard: String, key: String, postedAt: Long, body: String): String =
    sha256(utf8("$normalizedBoard|$key|$postedAt|${fitPostBody(body)}")).toHex().substring(0, POST_ID_HEX)
