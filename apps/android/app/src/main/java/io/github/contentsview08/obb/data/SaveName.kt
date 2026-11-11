package io.github.contentsview08.obb.data

// 画像の保存先の書き方(例 {site}/{board}/{filename})を、保存するフォルダとファイル名にする。
// 区切りは書き方の / だけで、最後の / の後ろがファイル名。拡張子はいつも中身の形式のものを付ける。
// 決まりは PC 版の src-tauri/src/save_name.rs と同じ。試験は packages/conformance/save-name.json

/** 分からない値(スレの外で開いた画像の板など) */
const val SAVE_UNKNOWN = "不明"
/** フォルダ 1 つの名前の長さの上限(バイト)。深いフォルダでパスが長くなりすぎないよう、ファイル名より短くする */
private const val MAX_DIR_BYTES = 120
/** ファイル名の、拡張子を除いた長さの上限。ファイル名の上限は 255(「 (1)」と拡張子の分を残す) */
private const val MAX_STEM_BYTES = 200

/** 保存のときに分かっていること。time は年・月・日・時・分・秒(端末の時計) */
data class SaveVars(
    val boardUrl: String? = null,
    /** 掲示板の名前(BBS メニューの名前)。なければホスト名 */
    val site: String? = null,
    val board: String? = null,
    val thread: String? = null,
    val threadKey: String? = null,
    val no: Int? = null,
    val time: List<Int> = listOf(1970, 1, 1, 0, 0, 0),
    val unix: Long = 0,
) {
    companion object {
        fun timeOf(millis: Long = System.currentTimeMillis()): Pair<List<Int>, Long> {
            val c = java.util.Calendar.getInstance().apply { timeInMillis = millis }
            val t = listOf(c.get(java.util.Calendar.YEAR), c.get(java.util.Calendar.MONTH) + 1, c.get(java.util.Calendar.DAY_OF_MONTH), c.get(java.util.Calendar.HOUR_OF_DAY), c.get(java.util.Calendar.MINUTE), c.get(java.util.Calendar.SECOND))
            return t to millis / 1000
        }
    }
}

/** %XX を元の文字に戻す。UTF-8 でない並びは置換文字にし、%XX の形でないものはそのまま残す */
internal fun percentDecode(s: String): String {
    val bytes = s.toByteArray(Charsets.UTF_8)
    val out = java.io.ByteArrayOutputStream(bytes.size)
    var i = 0
    while (i < bytes.size) {
        val hi = if (bytes[i] == '%'.code.toByte() && i + 2 < bytes.size) Character.digit(bytes[i + 1].toInt() and 0xff, 16) else -1
        val lo = if (hi >= 0) Character.digit(bytes[i + 2].toInt() and 0xff, 16) else -1
        if (hi >= 0 && lo >= 0) {
            out.write(hi * 16 + lo)
            i += 3
        } else {
            out.write(bytes[i].toInt())
            i++
        }
    }
    return String(out.toByteArray(), Charsets.UTF_8)
}

/** UTF-8 で max バイト以内に切る(文字の途中では切らない) */
private fun truncateBytes(s: String, max: Int): String {
    var bytes = 0
    var i = 0
    while (i < s.length) {
        val cp = s.codePointAt(i)
        val n = when { cp < 0x80 -> 1; cp < 0x800 -> 2; cp < 0x10000 -> 3; else -> 4 }
        if (bytes + n > max) return s.substring(0, i)
        bytes += n
        i += Character.charCount(cp)
    }
    return s
}

/** URL の最後の部分(? と # の前)。なければ空 */
private fun lastSegment(url: String): String = url.split('?', '#').first().split('/').lastOrNull { it.isNotEmpty() } ?: ""

/** 画像の URL の最後の部分の、拡張子を除いた名前(%XX は戻す)。空なら image */
internal fun saveNameOf(url: String): String {
    val last = percentDecode(lastSegment(url))
    val dot = last.lastIndexOf('.')
    val stem = if (dot >= 0) last.substring(0, dot) else last
    return stem.ifEmpty { "image" }
}

/** 板の URL のホスト名(小文字。利用者名とポートは外す) */
private fun hostOf(url: String): String? {
    val at = url.indexOf("://").takeIf { it >= 0 } ?: return null
    val authority = url.substring(at + 3).split('/', '?', '#').first()
    var host = authority.substringAfterLast('@')
    val colon = host.lastIndexOf(':')
    if (colon >= 0 && host.substring(colon + 1).all { it in '0'..'9' }) host = host.substring(0, colon)
    return host.takeIf { it.isNotEmpty() }?.map { if (it in 'A'..'Z') it + 32 else it }?.joinToString("")
}

/** 板の URL の最後の部分(例 https://bbs.eddibb.cc/liveedge/ → liveedge) */
private fun boardKeyOf(url: String): String? {
    val at = url.indexOf("://").takeIf { it >= 0 } ?: return null
    val rest = url.substring(at + 3)
    val slash = rest.indexOf('/')
    val path = if (slash >= 0) rest.substring(slash + 1) else ""
    return lastSegment(path).takeIf { it.isNotEmpty() }?.let { percentDecode(it) }
}

private fun known(s: String?): String? = s?.trim()?.takeIf { it.isNotEmpty() }

private fun two(n: Int) = n.toString().padStart(2, '0')

/** 変数の値。知らない名前は null(書いたまま残す) */
private fun valueOf(name: String, url: String, ext: String, v: SaveVars): String? {
    val host = v.boardUrl?.let { hostOf(it) }
    return when (name) {
        "name" -> saveNameOf(url)
        "ext" -> ext
        "filename" -> "${saveNameOf(url)}.$ext"
        "site" -> known(v.site) ?: host ?: SAVE_UNKNOWN
        "host" -> host ?: SAVE_UNKNOWN
        "board" -> known(v.board) ?: SAVE_UNKNOWN
        "boardKey" -> v.boardUrl?.let { boardKeyOf(it) } ?: SAVE_UNKNOWN
        "thread" -> known(v.thread) ?: SAVE_UNKNOWN
        "threadKey" -> known(v.threadKey) ?: SAVE_UNKNOWN
        "no" -> v.no?.toString() ?: SAVE_UNKNOWN
        "yyyy" -> v.time[0].toString().padStart(4, '0')
        "mm" -> two(v.time[1])
        "dd" -> two(v.time[2])
        "HH" -> two(v.time[3])
        "MM" -> two(v.time[4])
        "SS" -> two(v.time[5])
        "unix" -> v.unix.toString()
        else -> null
    }
}

/** {名前} を値に置き換える。知らない名前はそのまま残す */
private fun substitute(template: String, url: String, ext: String, v: SaveVars): String {
    val out = StringBuilder()
    var i = 0
    while (i < template.length) {
        val c = template[i]
        if (c == '{') {
            var j = i + 1
            while (j < template.length && (template[j] in 'a'..'z' || template[j] in 'A'..'Z')) j++
            val value = if (j < template.length && template[j] == '}') valueOf(template.substring(i + 1, j), url, ext, v) else null
            if (value != null) {
                out.append(value)
                i = j + 1
                continue
            }
        }
        out.append(c)
        i++
    }
    return out.toString()
}

private fun isBidi(c: Char) = c == '‎' || c == '‏' || c in '‪'..'‮' || c in '⁦'..'⁩'

/** Windows で使えない文字・制御文字・文字の向きを変える文字は _ にする(値に / が入っても、フォルダは増えない) */
private fun replaceBad(s: String): String = buildString(s.length) {
    for (c in s) append(if (c in "\\/:*?\"<>|" || c.isISOControl() || isBidi(c)) '_' else c)
}

/** 先頭・末尾の空白とピリオドを外す(「..」で外へ出ない・末尾のピリオドが消えて名前が変わらない) */
private fun trimEdges(s: String) = s.trim { it == ' ' || it == '　' || it == '.' }

/** CON・NUL・COM1 などの名前は Windows で作れない(パソコンに写したときに困らないよう、スマホでも避ける) */
private fun isReserved(s: String): Boolean {
    val device = s.substringBefore('.').map { if (it in 'a'..'z') it - 32 else it }.joinToString("")
    return device in setOf("CON", "PRN", "AUX", "NUL") ||
        (device.length == 4 && (device.startsWith("COM") || device.startsWith("LPT")) && device.last() in '0'..'9')
}

/** フォルダ 1 つ・ファイル名の幹を、作れる名前にする。空になれば空 */
private fun cleanPart(s: String, max: Int): String {
    val cut = trimEdges(truncateBytes(trimEdges(replaceBad(s)), max))
    return if (isReserved(cut)) "_$cut" else cut
}

/** ext で終わっていれば外す(英字の大文字・小文字は見ない) */
private fun stripExt(s: String, ext: String): String {
    val dotExt = ".$ext"
    if (s.length < dotExt.length) return s
    val tail = s.substring(s.length - dotExt.length)
    fun low(c: Char) = if (c in 'A'..'Z') c + 32 else c
    return if (tail.indices.all { low(tail[it]) == low(dotExt[it]) }) s.substring(0, s.length - dotExt.length) else s
}

/**
 * 書き方から、保存するフォルダ(土台からの並び)とファイル名を作る。最後の要素がファイル名。
 * ext は中身から見分けた拡張子(書き方に {ext} がなくても付ける)
 */
fun savePath(pattern: String, url: String, ext: String, v: SaveVars): List<String> {
    val parts = pattern.split('/', '\\')
    val out = parts.dropLast(1).map { cleanPart(substitute(it, url, ext, v), MAX_DIR_BYTES) }.filter { it.isNotEmpty() }.toMutableList()
    val replaced = replaceBad(substitute(parts.last(), url, ext, v))
    val stem = cleanPart(stripExt(replaced, ext), MAX_STEM_BYTES).ifEmpty { cleanPart(saveNameOf(url), MAX_STEM_BYTES) }.ifEmpty { "image" }
    out += "$stem.$ext"
    return out
}

/** 同じ名前があるときの n 番目の名前(「名前 (1).jpg」) */
fun numberedName(name: String, n: Int): String {
    if (n == 0) return name
    val i = name.lastIndexOf('.')
    return if (i > 0) "${name.substring(0, i)} ($n)${name.substring(i)}" else "$name ($n)"
}

/** 設定の画面に出す変数の説明(PC 版の utils/saveName.ts と同じ言葉) */
val SAVE_NAME_VARS = listOf(
    "{filename}" to "元のファイル名(名前 + 拡張子)",
    "{name}" to "元のファイル名の、拡張子を除いた名前",
    "{ext}" to "拡張子(画像の中身の形式。jpg・png など)",
    "{site}" to "掲示板の名前(BBS メニューの名前。なければホスト名)",
    "{host}" to "板のホスト名(bbs.eddibb.cc など)",
    "{board}" to "板の名前",
    "{boardKey}" to "板のキー(URL の最後。liveedge など)",
    "{thread}" to "スレタイ",
    "{threadKey}" to "スレのキー(dat 番号など)",
    "{no}" to "レス番号",
    "{yyyy} {mm} {dd}" to "保存した年・月・日",
    "{HH} {MM} {SS}" to "保存した時・分・秒",
    "{unix}" to "保存した時刻(1970 年からの秒数)",
)

val SAVE_NAME_EXAMPLES = listOf("bbs/{name}_{unix}", "bbs/{site}/{board}/{filename}", "bbs/{yyyy}-{mm}/{threadKey}_{no}_{name}")

const val SAVE_NAME_NOTE = "最後の / の後ろがファイル名、その前がフォルダです。拡張子は画像の形式に合わせていつも付きます。スレの外の画像など、分からない値は「不明」に、フォルダ名・ファイル名に使えない文字は _ になります。同じ名前のファイルがあれば「名前 (1).jpg」のように番号を付けます"

/** 見本に使う画像とスレ */
const val SAVE_NAME_SAMPLE_URL = "https://i.imgur.com/abc123.jpg"
fun saveNameSample(): SaveVars {
    val (time, unix) = SaveVars.timeOf()
    return SaveVars("https://bbs.eddibb.cc/liveedge/", "エッヂ", "なんでも実況E", "見本のスレ", "1731300000", 12, time, unix)
}
