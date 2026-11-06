package io.github.contentsview08.obb.bbs

// 本文の解析(アンカー・URL・本文の ID)。PC 版の utils/postBody.tsx の TOKEN と同じ決まりで、正は packages/conformance の JSON。
// \d・\w・\s の意味は JavaScript・JVM・Android で同じとは限らないので、文字の種類は明示する

/** JavaScript の \s と同じ文字 */
internal const val WS = """\t\n\u000B\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"""

private const val HOST = """[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+"""
private const val WORD = "[A-Za-z0-9_]"

/**
 * URL の頭。崩した書き方も拾う: h 抜き(ttps://・tps://)、コロンなし(//i.imgur.com/…)、http 抜き(i.imgur.com/a.jpg)。
 * コロンなしはホストに . があるものだけ。http 抜きはふつうの文と取り違えないよう、画像の拡張子で終わるものだけ
 */
private const val URL_HEAD = "h?ttps?://" +
    "|(?<!$WORD)tps?://" +
    "|(?<![A-Za-z0-9_/:])//(?=$HOST)" +
    """|(?<![A-Za-z0-9_./@:\-])(?=$HOST/[A-Za-z0-9_\-.~/%]*\.(?:jpe?g|png|gif|webp|avif|JPE?G|PNG|GIF|WEBP|AVIF)(?!$WORD))"""

/** URL は空白・見えない文字・日本語の句読点と閉じかっこで切る */
private const val URL_BODY = """[^$WS<>"、。「」）』】\u200B-\u200F\u2060-\u2064]+"""

/**
 * 1 つ目の組がアンカーの番号の並び、2 つ目が URL、3 つ目が本文の ID。
 * アンカーは >>1・>1・>>1-3・>>1,2,5・>>1-3,8・>No.12345、> のない No.1442072291(6 桁以上)。
 * > 1 つのものは「2>1」のような式を拾わないよう、前が英数字や記号のときは除く
 */
private val TOKEN = Regex(
    """(?:(?:>>|＞＞|(?<![A-Za-z0-9_>＞=\-])[>＞])(?:[NnＮｎ][OoＯｏ][.．])?|(?<![A-Za-z0-9])No\.(?=[0-9]{6,10}(?![0-9])))([0-9]{1,10}(?:-[0-9]{1,10})?(?:[,，][0-9]{1,10}(?:-[0-9]{1,10})?)*)(?![0-9])""" +
        "|((?:$URL_HEAD)$URL_BODY)" +
        """|(?<![A-Za-z0-9])ID[:：]([!#-;=?-~]+)""",
)

/** 範囲アンカーは広げすぎない(>>1-1000 で全レスに数が付くのを防ぐ) */
private const val MAX_RANGE = 10L

/** 1 つのアンカーで指せる数の上限 */
private const val MAX_LIST = 30

/** スレの中の番号として扱う上限。6 桁以上は昔からアンカーとして扱わない */
private const val MAX_NO = 99999L

/** アンカーの番号の並び("98-100,105")を、スレの中の番号の一覧にする */
private fun expandList(list: String): List<Int> {
    val nos = LinkedHashSet<Long>()
    for (part in list.split(',', '，')) {
        val range = part.split('-')
        val from = range[0].toLong()
        val to = range.getOrNull(1)?.toLong()
        if (to == null || to < from || to - from >= MAX_RANGE) nos += from else nos += from..to
    }
    return nos.take(MAX_LIST).filter { it <= MAX_NO }.map { it.toInt() }
}

sealed class BodyToken(val start: Int, val end: Int) {
    class Anchor(start: Int, end: Int, val nos: List<Int>) : BodyToken(start, end)
    class Url(start: Int, end: Int, val url: String) : BodyToken(start, end)
    class Id(start: Int, end: Int, val id: String) : BodyToken(start, end)
}

/** 本文の押せるところを、前から順に。どのレスも指さないアンカー(6 桁以上)はただの文字 */
fun bodyTokens(text: String): List<BodyToken> {
    val out = ArrayList<BodyToken>()
    for (m in TOKEN.findAll(text)) {
        val start = m.range.first
        val end = m.range.last + 1
        val anchor = m.groups[1]
        val url = m.groups[2]
        val id = m.groups[3]
        when {
            anchor != null -> expandList(anchor.value).takeIf { it.isNotEmpty() }?.let { out += BodyToken.Anchor(start, end, it) }
            url != null -> out += BodyToken.Url(start, end, normalizeBodyUrl(url.value))
            id != null -> out += BodyToken.Id(start, end, id.value)
        }
    }
    return out
}

/** 本文のアンカーが指すレスの番号 */
fun anchorTargets(text: String): List<Int> = bodyTokens(text).flatMap { (it as? BodyToken.Anchor)?.nos ?: emptyList() }

private val URL_SCHEME = Regex("^(h?t?tps?:)?//")

/** 崩した書き方の URL を、開ける形に直す。http 系の書き方は http のまま */
fun normalizeBodyUrl(raw: String): String {
    val m = URL_SCHEME.find(raw) ?: return "https://$raw"
    val scheme = m.groupValues[1]
    return (if (scheme.isNotEmpty() && !scheme.contains("s:")) "http://" else "https://") + raw.substring(m.range.last + 1)
}

private val IMAGE_URL = Regex("""\.(?:jpe?g|png|gif|webp|avif)(?:[?#][^$WS]*)?$""", RegexOption.IGNORE_CASE)
private val IMGUR_PAGE = Regex("^https?://(?:i\\.|m\\.)?imgur\\.com/([A-Za-z0-9]{5,8})$")
private val TWIMG = Regex("^https?://pbs\\.twimg\\.com/media/[^?$WS]+\\?(?:.*&)?format=(?:jpg|jpeg|png|webp)")

/**
 * 画像として出す URL に読み替える。画像でなければ null。
 * 拡張子がなくても画像だと分かるサイトも見る(imgur の画像ページ、X の ?format=jpg)。
 * 読み替えた先が画像でなかったときは、サムネイルの読み込みに失敗して出ないだけなので、試しに読んでよい
 */
fun toImageUrl(url: String): String? {
    if (IMAGE_URL.containsMatchIn(url)) return url
    IMGUR_PAGE.find(url)?.let { return "https://i.imgur.com/${it.groupValues[1]}.jpg" }
    TWIMG.find(url)?.let { return it.value }
    return null
}

private val VIDEO_FILE = Regex("""\.(?:mp4|m4v|webm|mov)(?:[?#][^$WS]*)?$""", RegexOption.IGNORE_CASE)
private val YOUTUBE_URL = Regex("^https?://(?:www\\.|m\\.)?(?:youtube\\.com/(?:watch|shorts|live)|youtu\\.be/)", RegexOption.IGNORE_CASE)
private val YOUTUBE_ID = Regex("(?:v=|youtu\\.be/|shorts/|live/)([A-Za-z0-9_\\-]{6,})")

fun isVideoFileUrl(url: String) = VIDEO_FILE.containsMatchIn(url)
fun isYoutubeUrl(url: String) = YOUTUBE_URL.containsMatchIn(url)
fun youtubeIdOf(url: String): String? = YOUTUBE_ID.find(url)?.groupValues?.get(1)
