package io.github.contentsview08.obb.bbs

import java.nio.charset.Charset

// バイト列の文字コードを見分ける。掲示板は Content-Type に charset を書かないことが多く、
// 同じサイトでも bbsmenu.html は UTF-8、subject.txt は Shift_JIS ということがある。
// 宣言は間違っていることもあるので、バイト列そのものを最も強い手がかりにする。
// PC 版の packages/connectors/src/encoding.ts と同じ決まりで、正は packages/conformance/charset.json。

enum class TextEncoding { UTF8, SJIS, EUC }

private val SJIS_CHARSET: Charset = runCatching { Charset.forName("windows-31j") }.getOrElse { Charset.forName("Shift_JIS") }
private val EUC_CHARSET: Charset = Charset.forName("EUC-JP")

fun TextEncoding.charset(): Charset = when (this) {
    TextEncoding.UTF8 -> Charsets.UTF_8
    TextEncoding.SJIS -> SJIS_CHARSET
    TextEncoding.EUC -> EUC_CHARSET
}

/** long は 3・4 バイトの正しい並び(日本語の UTF-8)、short は 2 バイトの正しい並び(Shift_JIS の半角カナでも偶然できる) */
private class Utf8Stats(val long: Int, val short: Int, val invalid: Int)

private fun utf8Stats(b: ByteArray): Utf8Stats {
    var long = 0
    var short = 0
    var invalid = 0
    fun cont(i: Int, lo: Int = 0x80, hi: Int = 0xbf) = i >= b.size || (b[i].toInt() and 0xff) in lo..hi
    var i = 0
    while (i < b.size) {
        val c = b[i].toInt() and 0xff
        when {
            c < 0x80 -> i++
            c in 0xc2..0xdf && cont(i + 1) -> { if (i + 2 <= b.size) short++; i += 2 }
            c in 0xe0..0xef && cont(i + 1, if (c == 0xe0) 0xa0 else 0x80, if (c == 0xed) 0x9f else 0xbf) && cont(i + 2) -> { if (i + 3 <= b.size) long++; i += 3 } // 末尾で切れた並びは、許すが手がかりにはしない
            c in 0xf0..0xf4 && cont(i + 1, if (c == 0xf0) 0x90 else 0x80, if (c == 0xf4) 0x8f else 0xbf) && cont(i + 2) && cont(i + 3) -> { if (i + 4 <= b.size) long++; i += 4 }
            else -> { invalid++; i++ }
        }
    }
    return Utf8Stats(long, short, invalid)
}

/** Shift_JIS として正しくないバイトの数 */
private fun sjisInvalid(b: ByteArray): Int {
    var n = 0
    var i = 0
    while (i < b.size) {
        val c = b[i].toInt() and 0xff
        if (c < 0x80 || c in 0xa1..0xdf) {
            i++
        } else if (c in 0x81..0x9f || c in 0xe0..0xfc) {
            if (i + 1 >= b.size) break
            val t = b[i + 1].toInt() and 0xff
            if (t in 0x40..0x7e || t in 0x80..0xfc) i += 2 else { n++; i++ }
        } else {
            n++
            i++
        }
    }
    return n
}

private class EucStats(val invalid: Int, val pairs: Int, val hiragana: Int)

/** EUC-JP として正しくないバイトの数と、ひらがなの数 */
private fun eucStats(b: ByteArray): EucStats {
    var invalid = 0
    var pairs = 0
    var hiragana = 0
    fun trail(c: Int) = c in 0xa1..0xfe
    var i = 0
    while (i < b.size) {
        val c = b[i].toInt() and 0xff
        if (c < 0x80) { i++; continue }
        if (i + 1 >= b.size) break
        val t = b[i + 1].toInt() and 0xff
        when {
            c == 0x8e && t in 0xa1..0xdf -> i += 2
            c == 0x8f && trail(t) && (i + 2 >= b.size || trail(b[i + 2].toInt() and 0xff)) -> i += 3
            trail(c) && trail(t) -> {
                pairs++
                // Shift_JIS の半角の「､」「･」の並びと紛れないように、その 2 つは数えない
                if (c == 0xa4 && t != 0xa4 && t != 0xa5) hiragana++
                i += 2
            }
            else -> { invalid++; i++ }
        }
    }
    return EucStats(invalid, pairs, hiragana)
}

/** Shift_JIS と EUC-JP のどちらか。どちらとしても正しいときは、ひらがなが目立てば EUC-JP(Shift_JIS では半角カナの羅列になる) */
private fun guessLegacy(b: ByteArray, preferred: TextEncoding): TextEncoding {
    val sjis = sjisInvalid(b)
    val euc = eucStats(b)
    if (sjis != euc.invalid) return if (sjis < euc.invalid) TextEncoding.SJIS else TextEncoding.EUC
    if (sjis > 0) return if (preferred == TextEncoding.EUC) TextEncoding.EUC else TextEncoding.SJIS
    if (preferred == TextEncoding.EUC) return TextEncoding.EUC
    return if (euc.hiragana >= 3 && euc.hiragana * 4 >= euc.pairs) TextEncoding.EUC else TextEncoding.SJIS
}

private val LABELS = mapOf(
    "utf-8" to TextEncoding.UTF8, "utf8" to TextEncoding.UTF8,
    "shift_jis" to TextEncoding.SJIS, "shift-jis" to TextEncoding.SJIS, "sjis" to TextEncoding.SJIS, "x-sjis" to TextEncoding.SJIS,
    "ms932" to TextEncoding.SJIS, "cp932" to TextEncoding.SJIS, "windows-31j" to TextEncoding.SJIS, "x-ms-cp932" to TextEncoding.SJIS,
    "euc-jp" to TextEncoding.EUC, "eucjp" to TextEncoding.EUC, "x-euc-jp" to TextEncoding.EUC,
)

private val HEADER_CHARSET = Regex("charset\\s*=\\s*[\"']?\\s*([\\w-]+)", RegexOption.IGNORE_CASE)
private val META_CHARSET = Regex("<meta[^>]+charset\\s*=\\s*[\"']?\\s*([\\w-]+)", RegexOption.IGNORE_CASE)

/** 宣言された文字コードの名前(小文字)。ヘッダー、なければ HTML の <meta> */
fun declaredCharset(body: ByteArray, contentType: String?): String? {
    val type = contentType ?: ""
    HEADER_CHARSET.find(type)?.let { return it.groupValues[1].lowercase() }
    // dat や subject.txt の本文に書かれた <meta> を宣言と取り違えないように、HTML のときだけ見る
    if (type.contains("text/plain", ignoreCase = true)) return null
    val head = String(body, 0, minOf(body.size, 4096), Charsets.ISO_8859_1)
    if (!head.trimStart().startsWith("<")) return null
    return META_CHARSET.find(head)?.groupValues?.get(1)?.lowercase()
}

/** UTF-8 の日本語と言ってよいか。Shift_JIS の文章がこの形になることはまずない。数バイトの壊れは許す */
fun looksLikeUtf8(body: ByteArray): Boolean {
    val s = utf8Stats(body)
    return s.long > 0 && s.invalid * 20 <= s.long
}

/**
 * 文字コードを決める。順番は UTF-8 の BOM → UTF-8 の形 → 宣言(中身と矛盾しなければ) → 中身から推測。
 * fallback は、手がかりがないときに選ぶもの(そのサイトの慣習)
 */
fun detectEncoding(body: ByteArray, contentType: String?, fallback: TextEncoding = TextEncoding.SJIS): TextEncoding {
    if (body.size >= 3 && (body[0].toInt() and 0xff) == 0xef && (body[1].toInt() and 0xff) == 0xbb && (body[2].toInt() and 0xff) == 0xbf) return TextEncoding.UTF8
    val declared = declaredCharset(body, contentType)?.let { LABELS[it] }
    if (body.none { it < 0 }) return declared ?: fallback
    val utf8 = utf8Stats(body)
    if (utf8.long > 0 && utf8.invalid * 20 <= utf8.long) return TextEncoding.UTF8
    if (declared == TextEncoding.UTF8 && utf8.invalid * 20 <= utf8.long + utf8.short) return TextEncoding.UTF8
    if (declared == TextEncoding.SJIS && sjisInvalid(body) == 0) return TextEncoding.SJIS
    if (declared == TextEncoding.EUC && eucStats(body).invalid == 0) return TextEncoding.EUC
    if (fallback == TextEncoding.UTF8 && utf8.invalid == 0) return TextEncoding.UTF8
    return guessLegacy(body, declared ?: fallback)
}

/** バイト列を文字にする。BOM は文字に残さない */
fun decodeText(body: ByteArray, contentType: String?, fallback: TextEncoding = TextEncoding.SJIS): String =
    String(body, detectEncoding(body, contentType, fallback).charset()).removePrefix("\uFEFF")

private val JAPANESE_LABEL = Regex("^(utf-?8|shift[-_]jis|x?-?sjis|ms932|cp932|windows-31j|x-ms-cp932|x?-?euc-?jp)$")

/**
 * 一般のページを文字にする。UTF-8 の形なら UTF-8、日本語以外の宣言(iso-8859-1 など)はそれに従い、
 * 残りは中身から決める(宣言が間違っているページ・書いていないページがある)
 */
fun decodeHtml(body: ByteArray, contentType: String?): String {
    val label = declaredCharset(body, contentType)
    if (label != null && !looksLikeUtf8(body) && !JAPANESE_LABEL.matches(label)) {
        runCatching { Charset.forName(label) }.getOrNull()?.let { return String(body, it) }
    }
    return decodeText(body, contentType, TextEncoding.UTF8)
}

/** UTF-8 の掲示板へ送るフォームの本文。空白は +、改行は CR LF(Shift_JIS のときと同じ決まり) */
fun encodeUtf8Form(fields: Map<String, String>): ByteArray =
    fields.entries.joinToString("&") { (k, v) ->
        "${java.net.URLEncoder.encode(k, "UTF-8")}=${java.net.URLEncoder.encode(v.replace("\r\n", "\n").replace("\n", "\r\n"), "UTF-8")}"
    }.toByteArray(Charsets.US_ASCII)
