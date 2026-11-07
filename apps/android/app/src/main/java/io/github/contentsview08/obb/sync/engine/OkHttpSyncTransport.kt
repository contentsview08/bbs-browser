package io.github.contentsview08.obb.sync.engine

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.CookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

// 同期専用の通信。掲示板の Http.client を使わない(Cookie と https の差し替えがあるので)。
// リダイレクトをたどらない(トークンが別の先へ渡るため)。トークンと本文をログに出さない

private val JSON_TYPE = "application/json".toMediaType()

class OkHttpSyncTransport(private val client: OkHttpClient = defaultClient()) : SyncTransport {
    override suspend fun send(req: SyncRequest): SyncResponse = withContext(Dispatchers.IO) {
        // 文字列のままだと OkHttp が charset を足す。サーバーは application/json だけを受ける
        val body = req.body?.toByteArray(Charsets.UTF_8)?.toRequestBody(JSON_TYPE)
        val b = Request.Builder().url(req.url).method(req.method, body)
        for ((k, v) in req.headers) b.header(k, v)
        val call = client.newBuilder().callTimeout(minOf(req.timeoutMs, TIMEOUT_MS), TimeUnit.MILLISECONDS).build().newCall(b.build())
        call.execute().use { res ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            val input = res.body?.byteStream()
            while (input != null) {
                val n = input.read(buf)
                if (n < 0) break
                if (out.size() + n > req.maxBytes) throw SyncResponseTooLarge()
                out.write(buf, 0, n)
            }
            SyncResponse(res.code, out.toString("UTF-8"))
        }
    }

    companion object {
        private const val TIMEOUT_MS = 10_000L

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            // UA はサーバー側の WAF で OBB の通信を見分けるのに使う(OBB/<版> で始める)
            .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("User-Agent", "OBB/${io.github.contentsview08.obb.BuildConfig.VERSION_NAME} (sync; Android)").build()) }
            .followRedirects(false)
            .followSslRedirects(false)
            .cookieJar(CookieJar.NO_COOKIES)
            .retryOnConnectionFailure(false)
            .connectTimeout(TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .callTimeout(TIMEOUT_MS, TimeUnit.MILLISECONDS)
            .build()
    }
}
