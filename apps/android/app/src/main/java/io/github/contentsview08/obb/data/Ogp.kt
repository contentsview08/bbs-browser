package io.github.contentsview08.obb.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URI
import java.nio.charset.Charset
import java.util.concurrent.TimeUnit

/** リンクのカードに出す情報 */
class Ogp(val title: String?, val description: String?, val image: String?, val siteName: String?)

/**
 * リンクのカード用に、ページを取ってきて OGP を読む(PC 版の host/ogp.ts・utils/ogp.ts と同じ)。
 * - 同時に取りに行くのは 4 件まで。ページは頭の部分(256KB まで、</head> が見えたらそこまで)だけ読む
 * - 取ったものはアプリを閉じるまで覚えておく(同じページを何度も取りに行かない)
 * - 家の中のアドレスは、表示しただけでは読みに行かない(isAutoLoadable)
 */
object OgpFetcher {
    // 掲示板向けの Monazilla ではなく、ふつうのブラウザに近い名乗りにする(OGP を返さないサイトがあるため)
    private const val USER_AGENT = "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) bbs-native/0.1.0"
    private const val HEAD_BYTES = 256 * 1024
    private val client by lazy {
        OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS).followRedirects(true).build()
    }
    private val limit = Semaphore(4)
    private val memory = HashMap<String, CompletableDeferred<Ogp?>>()

    suspend fun fetch(url: String): Ogp? {
        if (!isAutoLoadable(url)) return null
        val (d, first) = synchronized(memory) {
            memory[url]?.let { it to false } ?: CompletableDeferred<Ogp?>().also { memory[url] = it }.let { it to true }
        }
        if (first) d.complete(runCatching { limit.withPermit { load(url) } }.getOrNull())
        return d.await()
    }

    private suspend fun load(url: String): Ogp? = withContext(Dispatchers.IO) {
        client.newCall(Request.Builder().url(url).header("User-Agent", USER_AGENT).header("Accept", "text/html").build()).execute().use { res ->
            val type = res.header("Content-Type") ?: ""
            if (!res.isSuccessful || !type.contains("html", true)) return@use null
            val bytes = readHead(res.body?.byteStream() ?: return@use null)
            val latin = String(bytes, Charsets.ISO_8859_1)
            val cs = Regex("charset=([A-Za-z0-9_-]+)", RegexOption.IGNORE_CASE).find(type)?.groupValues?.get(1)
                ?: Regex("<meta[^>]+charset\\s*=\\s*[\"']?([A-Za-z0-9_-]+)", RegexOption.IGNORE_CASE).find(latin)?.groupValues?.get(1)
            val html = String(bytes, runCatching { Charset.forName(cs ?: "UTF-8") }.getOrDefault(Charsets.UTF_8))
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
 * レスに書かれた URL を、画面に出しただけで(押さずに)読みに行ってよいか(PC 版の safeUrl.ts と同じ)。
 * 家の中のネットワーク・自分の端末のアドレス・標準以外のポートは読まない(ルーターなどを勝手に叩かないように)
 */
fun isAutoLoadable(url: String): Boolean {
    val u = runCatching { URI(url) }.getOrNull() ?: return false
    if (u.scheme?.lowercase() !in setOf("http", "https")) return false
    if (u.port != -1) return false
    val host = u.host?.lowercase() ?: return false
    if (host == "localhost" || Regex("\\.(?:local|localhost|lan|home|internal|intranet|corp|home\\.arpa)$").containsMatchIn(host)) return false
    if (host.startsWith("[")) return false
    Regex("^([0-9]{1,3})\\.([0-9]{1,3})\\.([0-9]{1,3})\\.([0-9]{1,3})$").find(host)?.let { m ->
        val (a, b) = m.groupValues.drop(1).map { it.toInt() }
        return !(a == 0 || a == 10 || a == 127 || (a == 100 && b in 64..127) || (a == 169 && b == 254) || (a == 172 && b in 16..31) || (a == 192 && b == 168) || a >= 224)
    }
    if (Regex("^[0-9.]+$").matches(host) || host.startsWith("0x") || host.contains(".0x")) return false
    return host.contains('.')
}
