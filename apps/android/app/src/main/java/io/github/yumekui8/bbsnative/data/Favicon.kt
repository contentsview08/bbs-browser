package io.github.yumekui8.bbsnative.data

import android.util.Base64
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * 板のファビコン(PC 版の host/favicon.ts と同じ): 板のページの <link rel="icon">、なければドメインの /favicon.ico。
 * 画像そのものを data: URL にして DB(favicons 表)に残し、起動のたびに取りに行かない。7 日たったら取り直す
 */
object Favicons {
    private const val USER_AGENT = "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) bbs-native/0.1.0"
    private const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000
    private val client by lazy { OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS).followRedirects(true).build() }
    private val memory = HashMap<String, CompletableDeferred<ByteArray?>>()
    var db: LogDb? = null

    /** 板のファビコン(画像のバイト列)。取れなければ null */
    suspend fun of(boardUrl: String): ByteArray? {
        val (d, first) = synchronized(memory) { memory[boardUrl]?.let { it to false } ?: CompletableDeferred<ByteArray?>().also { memory[boardUrl] = it }.let { it to true } }
        if (first) d.complete(runCatching { load(boardUrl) }.getOrNull())
        return d.await()
    }

    private suspend fun load(boardUrl: String): ByteArray? = withContext(Dispatchers.IO) {
        val saved = db?.favicon(boardUrl)
        if (saved != null && System.currentTimeMillis() - saved.second < MAX_AGE_MS) return@withContext decode(saved.first)
        val bytes = runCatching { download(findIconUrl(boardUrl)) }.getOrNull()
        if (bytes != null) {
            db?.setFavicon(boardUrl, "data:image/x-icon;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP))
            bytes
        } else saved?.let { decode(it.first) }
    }

    private fun decode(data: String): ByteArray? = runCatching { Base64.decode(data.substringAfter("base64,"), Base64.DEFAULT) }.getOrNull()

    private fun findIconUrl(boardUrl: String): String {
        val fallback = URI(boardUrl).resolve("/favicon.ico").toString()
        return runCatching {
            client.newCall(Request.Builder().url(boardUrl).header("User-Agent", USER_AGENT).header("Accept", "text/html").build()).execute().use { res ->
                val type = res.header("Content-Type") ?: ""
                if (!res.isSuccessful || !type.contains("html", true)) return fallback
                val html = res.body?.string()?.take(100_000) ?: return fallback
                val links = Regex("<link\\b[^>]*>", RegexOption.IGNORE_CASE).findAll(html).map { it.value }.toList()
                fun rel(l: String) = Regex("rel\\s*=\\s*[\"']?([^\"'>]+)", RegexOption.IGNORE_CASE).find(l)?.groupValues?.get(1) ?: ""
                val tag = links.firstOrNull { Regex("(^|\\s)(shortcut\\s+)?icon(\\s|$)", RegexOption.IGNORE_CASE).containsMatchIn(rel(it)) }
                    ?: links.firstOrNull { rel(it).contains("apple-touch-icon", true) }
                val href = tag?.let { Regex("href\\s*=\\s*[\"']?([^\"'\\s>]+)", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1) } ?: return fallback
                URI(res.request.url.toString()).resolve(href).toString()
            }
        }.getOrDefault(fallback)
    }

    private fun download(url: String): ByteArray? =
        client.newCall(Request.Builder().url(url).header("User-Agent", USER_AGENT).build()).execute().use { res ->
            val type = res.header("Content-Type") ?: ""
            if (!res.isSuccessful || (type.isNotEmpty() && !type.startsWith("image/"))) null else res.body?.bytes()?.takeIf { it.isNotEmpty() }
        }
}
