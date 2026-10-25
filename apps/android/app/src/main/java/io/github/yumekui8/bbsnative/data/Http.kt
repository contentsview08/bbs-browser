package io.github.yumekui8.bbsnative.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** 応答。ヘッダー名は小文字 */
class HttpResponse(val status: Int, val headers: Map<String, String>, val body: ByteArray)

/**
 * 通信(専ブラの host/tauriContext.ts にあたる)。2ch 互換の板は専ブラに Monazilla の User-Agent を求める慣習がある。
 * Range を付けた取得(dat の差分)では、OkHttp は gzip を頼まない(バイトの位置がずれないように)
 */
object Http {
    private const val USER_AGENT = "Monazilla/1.00 (bbs-native/0.1.0)"

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()

    suspend fun get(url: String, headers: Map<String, String> = emptyMap()): HttpResponse = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url).header("User-Agent", USER_AGENT)
        for ((k, v) in headers) req.header(k, v)
        client.newCall(req.build()).execute().use { res ->
            val h = HashMap<String, String>()
            for (name in res.headers.names()) h[name.lowercase()] = res.header(name) ?: ""
            HttpResponse(res.code, h, res.body?.bytes() ?: ByteArray(0))
        }
    }
}
