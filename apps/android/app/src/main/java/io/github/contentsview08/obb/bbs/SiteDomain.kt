package io.github.contentsview08.obb.bbs

// サイトの見分け(主ドメイン)。決まりは packages/conformance/site-domain.json。PC 版は packages/connectors/src/siteDomain.ts

/**
 * 最後の 2 段までが誰でも取れる場所のもの。この下の 1 段までをサイトとする。
 * Public Suffix の全表は持たない小さな表なので、ここにない地域型(tokyo.jp など)は 2 段で切り、別のサイトが 1 つにまとまる
 */
private val SHARED_SUFFIXES = setOf(
    "co.jp", "ne.jp", "or.jp", "ac.jp", "ad.jp", "ed.jp", "go.jp", "gr.jp", "lg.jp",
    "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz",
    "co.kr", "or.kr", "com.cn", "net.cn", "org.cn", "com.tw", "net.tw", "org.tw", "com.br", "co.in",
    "github.io", "pages.dev", "workers.dev", "netlify.app", "vercel.app", "web.app",
)

/** 移転して同じサイトになったもの */
private val SAME_SITE = mapOf("5ch.net" to "5ch.io")

private val SCHEME = Regex("^(?:[a-zA-Z][a-zA-Z0-9+.-]*:)?//")
private val HOST_CHARS = Regex("^[\\p{L}\\p{N}._-]+$")
private val PORT = Regex(":\\d*$")
private val PATH_START = Regex("[/?#\\\\]")

/** URL の主ドメイン(サブドメインを除く)。読めなければ空。IP アドレスはそのまま */
fun siteDomain(url: String): String {
    val s = url.trim()
    val scheme = SCHEME.find(s)
    val rest = if (scheme != null) s.substring(scheme.value.length) else s
    val authority = rest.split(PATH_START, 2)[0]
    val hostPort = authority.substringAfterLast('@').lowercase()
    if (hostPort.startsWith("[")) {
        val end = hostPort.indexOf(']')
        return if (end > 0) hostPort.substring(0, end + 1) else ""
    }
    val host = hostPort.replace(PORT, "").trimEnd('.')
    if (!HOST_CHARS.matches(host)) return ""
    if ('.' !in host) return if (scheme != null) host else ""
    if (host.all { it in '0'..'9' || it == '.' }) return host
    val labels = host.split('.')
    val lastTwo = labels.takeLast(2).joinToString(".")
    val domain = if (lastTwo in SHARED_SUFFIXES) labels.takeLast(3).joinToString(".") else lastTwo
    return SAME_SITE[domain] ?: domain
}

/** URL の並びから、主ドメインを 1 つずつ(最初に出た順)。読めない URL は除く */
fun uniqueSiteDomains(urls: Iterable<String>): List<String> = urls.map(::siteDomain).filter { it.isNotEmpty() }.distinct()
