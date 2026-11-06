package io.github.contentsview08.obb.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import io.github.contentsview08.obb.bbs.decodeHtml
import java.net.URI
import java.util.concurrent.TimeUnit

/** リンクのカードに出す情報 */
class Ogp(val title: String?, val description: String?, val image: String?, val siteName: String?)

/**
 * リンクのカード用に、ページを取ってきて OGP を読む(PC 版の host/ogp.ts・utils/ogp.ts と同じ)。
 * - 同時に取りに行くのは 4 件まで。ページは頭の部分(256KB まで、</head> が見えたらそこまで)だけ読む
 * - 取ったものは新しい方から MEMORY_MAX 件まで覚えておく(同じページを何度も取りに行かない)。取れなかったものは少したったら取り直す
 * - 家の中のアドレスは、表示しただけでは読みに行かない(isAutoLoadable。リダイレクトの行き先も)
 */
object OgpFetcher {
    // 掲示板向けの Monazilla ではなく、ふつうのブラウザに近い名乗りにする(OGP を返さないサイトがあるため)
    private const val USER_AGENT = "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) bbs-native/0.1.0"
    private const val HEAD_BYTES = 256 * 1024
    /** 取れなかったページを取り直すまでの時間(スクロールで通るたびに取りに行かないように) */
    private const val RETRY_MS = 10L * 60 * 1000
    private val client by lazy {
        OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS).followRedirects(false).addInterceptor(HttpsFirst).build()
    }
    private val limit = Semaphore(4)
    // 取得は画面の行と切り離す(行が画面から外れて取り消されても、取れなかったことにしない)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private const val MEMORY_MAX = 2000
    private val memory = object : LinkedHashMap<String, Deferred<Ogp?>>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Deferred<Ogp?>>?) = size > MEMORY_MAX
    }

    suspend fun fetch(url: String): Ogp? {
        if (!isAutoLoadable(url)) return null
        val d = synchronized(memory) {
            memory.getOrPut(url) {
                scope.async {
                    val ogp = runCatching { limit.withPermit { load(url) } }.getOrNull()
                    if (ogp == null) scope.launch { delay(RETRY_MS); synchronized(memory) { memory.remove(url) } }
                    ogp
                }
            }
        }
        return d.await()
    }

    private suspend fun load(url: String): Ogp? = withContext(Dispatchers.IO) {
        openCheckingRedirects(client, url) { Request.Builder().url(it).header("User-Agent", USER_AGENT).header("Accept", "text/html").build() }?.use { res ->
            val type = res.header("Content-Type") ?: ""
            if (!res.isSuccessful || !type.contains("html", true)) return@use null
            val bytes = readHead(res.body?.byteStream() ?: return@use null)
            val html = decodeHtml(bytes, type)
            parse(html, res.request.url.toString()).takeIf { it.title != null || it.image != null }
        }
    }

    private fun readHead(input: java.io.InputStream): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (out.size() < HEAD_BYTES) {
            val n = input.read(buf)
            if (n <= 0) break
            out.write(buf, 0, n)
            if (String(buf, 0, n, Charsets.ISO_8859_1).contains("</head>", true)) break
        }
        return out.toByteArray()
    }

    private fun decode(s: String): String = s
        .replace(Regex("&#x([0-9a-fA-F]+);")) { runCatching { String(Character.toChars(it.groupValues[1].toInt(16))) }.getOrDefault("") }
        .replace(Regex("&#([0-9]+);")) { runCatching { String(Character.toChars(it.groupValues[1].toInt())) }.getOrDefault("") }
        .replace("&quot;", "\"").replace("&apos;", "'").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").replace("&amp;", "&")

    private fun parse(html: String, pageUrl: String): Ogp {
        val head = html.take(200_000)
        val meta = HashMap<String, String>()
        for (tag in Regex("<meta\\b[^>]*>", RegexOption.IGNORE_CASE).findAll(head)) {
            val attrs = HashMap<String, String>()
            for (m in Regex("([a-zA-Z:-]+)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))").findAll(tag.value)) {
                attrs[m.groupValues[1].lowercase()] = m.groupValues[2].ifEmpty { m.groupValues[3].ifEmpty { m.groupValues[4] } }
            }
            val key = (attrs["property"] ?: attrs["name"] ?: "").lowercase()
            val content = attrs["content"]
            if (key.isNotEmpty() && content != null && key !in meta) meta[key] = decode(content).trim()
        }
        val title = meta["og:title"]?.ifEmpty { null } ?: meta["twitter:title"]?.ifEmpty { null }
            ?: Regex("<title[^>]*>([^<]*)</title>", RegexOption.IGNORE_CASE).find(head)?.groupValues?.get(1)?.let { decode(it).trim() }?.ifEmpty { null }
        val desc = meta["og:description"] ?: meta["twitter:description"] ?: meta["description"]
        val rawImage = meta["og:image"] ?: meta["og:image:url"] ?: meta["twitter:image"]
        val image = rawImage?.let { runCatching { URI(pageUrl).resolve(it).toString() }.getOrNull() }?.takeIf { isAutoLoadable(it) }
        return Ogp(title, desc?.ifEmpty { null }, image, meta["og:site_name"]?.ifEmpty { null })
    }
}

/**
 * リダイレクトを 1 段ずつたどり、行き先ごとに isAutoLoadable を確かめて取る(client は followRedirects(false) のもの)。
 * 読んではいけない行き先・行き先がない・たどりすぎのときは、そこへは通信せずに null
 */
internal fun openCheckingRedirects(client: OkHttpClient, url: String, request: (String) -> Request): Response? {
    var current = url
    repeat(5 + 1) {
        val res = client.newCall(request(current)).execute()
        if (!res.isRedirect) return res
        val next = res.header("Location")?.let { res.request.url.resolve(it) }?.toString()
        res.close()
        if (next == null || !isAutoLoadable(next)) return null
        current = next
    }
    return null
}

/**
 * レスに書かれた URL を、画面に出しただけで(押さずに)読みに行ってよいか(PC 版の safeUrl.ts と同じ)。
 * 家の中のネットワーク・自分の端末のアドレス・標準以外のポートは読まない(ルーターなどを勝手に叩かないように)
 */
fun isAutoLoadable(url: String): Boolean {
    val u = runCatching { URI(url) }.getOrNull() ?: return false
    if (u.scheme?.lowercase() !in setOf("http", "https")) return false
    if (u.port != -1) return false
    // 末尾の点は同じ名前を指す(localhost. も localhost)
    val host = u.host?.lowercase()?.trimEnd('.') ?: return false
    if (host == "localhost" || Regex("\\.(?:local|localhost|lan|home|internal|intranet|corp|home\\.arpa)$").containsMatchIn(host)) return false
    if (host.startsWith("[")) return false
    Regex("^([0-9]{1,3})\\.([0-9]{1,3})\\.([0-9]{1,3})\\.([0-9]{1,3})$").find(host)?.let { m ->
        val (a, b) = m.groupValues.drop(1).map { it.toInt() }
        return !(a == 0 || a == 10 || a == 127 || (a == 100 && b in 64..127) || (a == 169 && b == 254) || (a == 172 && b in 16..31) || (a == 192 && b == 168) || a >= 224)
    }
    if (Regex("^[0-9.]+$").matches(host) || host.startsWith("0x") || host.contains(".0x")) return false
    return host.contains('.')
}
