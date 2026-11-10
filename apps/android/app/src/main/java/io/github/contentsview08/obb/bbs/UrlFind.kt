package io.github.contentsview08.obb.bbs

// 本文から URL を見つける決まり。PC 版・Web の utils/urlFind.ts の写しで、正は packages/conformance の link.json と tld.json。
// \s・\w の意味は JavaScript と JVM で違うことがあるので、文字の種類は明示する

/**
 * ドメインとみなす TLD。スキームのない「example.com」や崩れたスキームのものは、これで終わるときだけリンクにする。
 * 実在しても、ファイルの拡張子や英語の略と重なるものは入れない(理由は tld.json)。co.jp・co.uk などは jp・uk で拾える
 */
val TLDS = listOf(
    // よく使う gTLD
    "com", "net", "org", "info", "biz", "edu", "gov", "mobi", "asia",
    // 日本と、よく見る国の ccTLD
    "jp", "us", "uk", "de", "fr", "eu", "ru", "cn", "kr", "tw", "hk", "au", "ca", "ph",
    // 短縮 URL・サービスでよく使う ccTLD
    "io", "tv", "me", "cc", "to", "ly", "gl", "be", "gg", "tk", "ws", "co", "ai", "ms", "it",
    // 新しい gTLD のうち、よく見るもの
    "xyz", "dev", "app", "site", "online", "top", "club", "shop", "blog", "news", "page", "live", "link", "fun", "moe", "tech", "wiki", "art", "cloud", "store",
)

/** 大文字・小文字のどちらでも合う形(PC 版と同じ式にするため、(?i) は使わない) */
private fun ci(s: String) = s.replace(Regex("[a-z]")) { "[${it.value}${it.value.uppercase()}]" }

private val TLD = "(?:" + TLDS.sortedByDescending { it.length }.joinToString("|") { ci(it) } + ")"
private const val LABEL = "[A-Za-z0-9](?:[A-Za-z0-9\\-]{0,61}[A-Za-z0-9])?"
/** 後ろにラベルや英数字が続くもの(example.com.au・example.community)はドメインの終わりとしない */
private const val HOST_END = """(?![A-Za-z0-9\-]|\.[A-Za-z0-9])"""
private val DOMAIN = """(?:$LABEL\.)+$TLD$HOST_END"""
private const val IPV4 = """(?:[0-9]{1,3}\.){3}[0-9]{1,3}$HOST_END"""
private const val PORT = "(?::[0-9]{1,5})?"
/** スキームが正しいときのホスト(localhost・IP・ポート・ユーザー名も)。日本語が来たらそこで終わる */
private val HOST_LOOSE = """[A-Za-z0-9\[][A-Za-z0-9\-._~%!${'$'}&'*+,;=:@\[\]]*"""
/** 道・クエリ。空白・見えない文字・日本語の句読点と閉じかっこで切る。日本語の道(wiki/東京)は残す */
private const val PATH = """(?:[/?#][^$WS<>"、。「」）』】\u200B-\u200F\u2060-\u2064]*)?"""
/** スキームのないものの道は ASCII だけ */
private const val PATH_ASCII = """(?:[/?#][!#-;=?-~]*)?"""

private const val H = "[hH]"
private const val T = "[tT]"
private const val P = "[pP]"
private const val S = "[sS]"
/** 正しい・h が抜けた書き方(http://・ttp://・tps:// など)。大文字も。英字の後ろでも拾う(abchttp://) */
private const val HEAD_FULL = """$H?$T$T$P$S?://|(?<![A-Za-z0-9_])$T$P$S?://"""
/** コロン・スラッシュが欠けたもの(https//・https:/・http:)。後ろが TLD で終わるドメインのときだけ */
private const val HEAD_BROKEN_SEP = """(?<![A-Za-z0-9_])$H?$T{1,2}$P$S?(?::/?|//?)"""
/** 頭が欠けたもの(ht://・ps://・s://・://)と、// から始まるもの */
private const val HEAD_PARTIAL = """(?<![A-Za-z0-9_])$H?$T{0,2}$P?$S?://|(?<![A-Za-z0-9_/:])//"""
/** スキームのないドメイン。前が英数字・.・@(メールアドレス)・/・:・-・全角の英数字のときは拾わない */
private const val HEAD_NONE = """(?<![A-Za-z0-9_.@/:\-＠Ａ-Ｚａ-ｚ０-９])"""

/** URL の候補の正規表現の中身(捕まえる組は持たない)。末尾の句読点・閉じかっこは trimUrlEnd で落とす */
internal val URL_PATTERN =
    "(?:(?:$HEAD_FULL)$HOST_LOOSE$PATH" +
        "|(?:$HEAD_BROKEN_SEP|$HEAD_PARTIAL)(?:$DOMAIN|$IPV4)$PORT$PATH" +
        "|$HEAD_NONE$DOMAIN$PORT$PATH_ASCII)"

/** URL の終わりに来ても URL に含めない文字(文の句読点・引用符) */
private const val TRAIL = ".,;:!?'\"*！？，．：；・…"
private val CLOSE = mapOf(')' to '(', ']' to '[', '}' to '{')

/** 末尾の句読点と、対応のない閉じかっこを落とす。「(https://a.com/x)」の ) は落とし、「https://a.com/(x)」の ) は残す */
fun trimUrlEnd(raw: String): String {
    var s = raw
    while (s.isNotEmpty()) {
        val c = s.last()
        val open = CLOSE[c]
        if (open != null) {
            if (s.count { it == open } >= s.count { it == c }) return s
        } else if (c !in TRAIL) return s
        s = s.dropLast(1)
    }
    return s
}

private val SCHEME = Regex("^([A-Za-z]*)(:?/*)")

/** 崩した書き方の URL を、開ける形に直す。http と書いてあるものだけ http で、ほかは https を補う(ttp:// も https) */
fun normalizeBodyUrl(raw: String): String {
    val m = SCHEME.find(raw)!!
    // 区切り(: か /)がなければスキームのないドメイン
    if (m.groupValues[2].isEmpty()) return "https://$raw"
    return (if (m.groupValues[1].lowercase() == "http") "http://" else "https://") + raw.substring(m.value.length)
}
