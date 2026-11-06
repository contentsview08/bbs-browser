package io.github.contentsview08.obb.bbs

import java.net.URLEncoder
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

// 2ch 互換の書き込み(POST /test/bbs.cgi)。専ブラの packages/connectors/src/sjis.ts と twoch/parse.ts の
// parseBbsCgiResponse・parseConfirmForm を Kotlin に写したもの

/** 書き込む内容 */
class PostInput(val name: String, val mail: String, val body: String)

/** 書き込みの結果 */
sealed class PostResult {
    class Ok(val message: String, val resNumber: Int?) : PostResult()
    /** 認証が要る(エッヂ)。url をブラウザで開き、code を入れてから書き込み直す */
    class Auth(val message: String, val url: String?, val code: String?) : PostResult()
    /** 5ch の書き込み確認。承諾したら fields を url に送り直す */
    class Confirm(val message: String, val url: String, val fields: Map<String, String>, val referer: String) : PostResult()
    class Error(val message: String) : PostResult()
}

private val SJIS: Charset = runCatching { Charset.forName("windows-31j") }.getOrElse { Charset.forName("Shift_JIS") }

/**
 * Shift_JIS・EUC-JP の表にないものとして &#数字; で送る文字(PC 版の表と同じ)。
 * Java・Android の文字コード変換は、似た文字に置き換えて送ることがある(¥ を \\ にするなど)ので、ここで先に決める
 */
internal val NOT_IN_JIS_TABLE = setOf(0x301C, 0x2212, 0x2016, 0x2014, 0xA2, 0xA3, 0xAC, 0xA5, 0x203E)

/** 1 つの値を Shift_JIS にする。Shift_JIS にない文字(絵文字など)は &#数字; にする */
private fun encodeShiftJis(text: String): ByteArray {
    val enc = SJIS.newEncoder().onUnmappableCharacter(CodingErrorAction.REPORT).onMalformedInput(CodingErrorAction.REPORT)
    val out = java.io.ByteArrayOutputStream()
    var i = 0
    while (i < text.length) {
        val cp = text.codePointAt(i)
        val ch = String(Character.toChars(cp))
        val bytes: ByteArray? = if (cp in NOT_IN_JIS_TABLE) null else runCatching {
            val bb: ByteBuffer = enc.encode(CharBuffer.wrap(ch))
            ByteArray(bb.remaining()).also { bb.get(it) }
        }.getOrNull()
        if (bytes != null) out.write(bytes) else out.write("&#$cp;".toByteArray(Charsets.US_ASCII))
        i += Character.charCount(cp)
    }
    return out.toByteArray()
}

/** Shift_JIS の application/x-www-form-urlencoded。改行はブラウザと同じく CR LF で送る */
fun encodeShiftJisForm(fields: Map<String, String>): ByteArray =
    fields.entries.joinToString("&") { (k, v) ->
        val bytes = encodeShiftJis(v.replace("\r\n", "\n").replace("\n", "\r\n"))
        "$k=" + URLEncoder.encode(String(bytes, Charsets.ISO_8859_1), "ISO-8859-1")
    }.toByteArray(Charsets.US_ASCII)

/** Shift_JIS で送ったときのバイト数(書き込む前に長すぎないか確かめる目安) */
fun shiftJisByteLength(text: String): Int = encodeShiftJis(text.replace("\n", "\r\n")).size

private val TITLE = Regex("<title>([\\s\\S]*?)</title>", RegexOption.IGNORE_CASE)
private val BODY = Regex("<body[^>]*>([\\s\\S]*?)</body>", RegexOption.IGNORE_CASE)
private val KIND = Regex("2ch_X:([A-Za-z0-9_]+)")

/**
 * bbs.cgi の応答を読み分ける。
 * - 2ch_X:true や「書きこみました」は成功
 * - 2ch_X:cookie(や「書き込み確認」「承諾して書き込む」の文面)は 5ch の書き込み確認
 * - 本文に認証ページの URL があれば認証待ち(eddist: 「認証コード'xxx'を用いて…/auth-code」)
 * - それ以外はエラー(本文のテキストを理由に)
 */
/** 応答から理由を読み取れなかったときの言葉 */
internal const val POST_FAILED = "書き込めませんでした"

fun parseBbsCgi(html: String, url: String, fields: Map<String, String>, referer: String, resNumber: Int?): PostResult {
    val kind = KIND.find(html)?.groupValues?.get(1)
    val title = htmlToText(TITLE.find(html)?.groupValues?.get(1) ?: "").trim()
    val bodyHtml = BODY.find(html)?.groupValues?.get(1) ?: html
    val message = htmlToText(bodyHtml.replace(Regex("\\r?\\n"), "")).replace(Regex("\\n{2,}"), "\n").trim()

    if (kind == "true" || (kind == null && title.contains("書きこみました"))) return PostResult.Ok(message.ifEmpty { title }, resNumber)
    if (kind == "cookie" || Regex("書き込み確認|書込確認|承諾して書き込む").containsMatchIn(html)) {
        val (action, hidden) = parseConfirmForm(html)
        val to = action?.let { runCatching { java.net.URI(url).resolve(it).toString() }.getOrNull() } ?: url
        return PostResult.Confirm(message, to, fields + hidden, referer)
    }
    val link = Regex("https?://[^\\s<>\"']+").find(message)?.value
    if (link != null && Regex("auth|認証|ユーザー登録").containsMatchIn(message)) {
        val code = Regex("認証コード'([^']+)'|再認証コード'([^']+)'").find(message)
        return PostResult.Auth(message, link, code?.groupValues?.get(1)?.ifEmpty { null } ?: code?.groupValues?.get(2))
    }
    return PostResult.Error(message.ifEmpty { title.ifEmpty { POST_FAILED } })
}

private val ATTR = Regex("([a-zA-Z_:][-A-Za-z0-9_:.]*)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))")

private fun attrsOf(tag: String): Map<String, String> =
    ATTR.findAll(tag).associate { m -> m.groupValues[1].lowercase() to decodeEntities(m.groupValues[2].ifEmpty { m.groupValues[3].ifEmpty { m.groupValues[4] } }) }

/** タグの名前から閉じ > までに当たる形を作る。クォートの中の > では切らない(確認画面の本文の「>>1」が消えないように) */
private fun tagPattern(name: String) = Regex("<$name\\b(?:[^>\"']|\"[^\"]*\"|'[^']*')*>", RegexOption.IGNORE_CASE)

/** 5ch の書き込み確認のフォームから、送り直すときに含める隠し項目と送り先を読む */
private fun parseConfirmForm(html: String): Pair<String?, Map<String, String>> {
    val action = tagPattern("form").find(html)?.value?.let { attrsOf(it)["action"] }?.ifEmpty { null }
    val hidden = HashMap<String, String>()
    for (m in tagPattern("input").findAll(html)) {
        val a = attrsOf(m.value)
        val type = (a["type"] ?: "").lowercase()
        val name = a["name"]
        if ((type == "hidden" || type == "submit") && !name.isNullOrEmpty()) hidden[name] = a["value"] ?: ""
    }
    return action to hidden
}
