package io.github.contentsview08.obb.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** 応答。ヘッダー名は小文字 */
class HttpResponse(val status: Int, val headers: Map<String, String>, val body: ByteArray)

/**
 * 通信(専ブラの host/tauriContext.ts にあたる)。2ch 互換の板は専ブラに Monazilla の User-Agent を求める慣習がある。
 * Range を付けた取得(dat の差分)では、OkHttp は gzip を頼まない(バイトの位置がずれないように)。
 * Cookie は端末に保存する(エッヂの edge-token・5ch の書き込みの Cookie。アプリを閉じても残す)
 */
object Http {
    private const val USER_AGENT = "Monazilla/1.00 (bbs-native/0.1.0)"

    private lateinit var jar: SavedCookieJar
    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .followRedirects(false)
            .cookieJar(jar)
            .addInterceptor(HttpsFirst)
            .build()
    }

    /** アプリの起動時に一度呼ぶ(Cookie の置き場を開く) */
    fun init(context: Context) {
        if (!::jar.isInitialized) jar = SavedCookieJar(context.applicationContext)
    }

    /** 読むときはリダイレクトをたどる(板・スレが別のサーバーへ移ったとき。5ch の http → https など)。書き込み(POST)はたどらない */
    private val getClient by lazy { client.newBuilder().followRedirects(true).followSslRedirects(true).build() }

    suspend fun get(url: String, headers: Map<String, String> = emptyMap()): HttpResponse = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url).header("User-Agent", USER_AGENT)
        for ((k, v) in headers) req.header(k, v)
        getClient.newCall(req.build()).execute().use { res ->
            val h = HashMap<String, String>()
            for (name in res.headers.names()) h[name.lowercase()] = res.header(name) ?: ""
            HttpResponse(res.code, h, res.body?.bytes() ?: ByteArray(0))
        }
    }

    /** フォームを送る(body はエンコード済みの application/x-www-form-urlencoded) */
    suspend fun postForm(url: String, body: ByteArray, headers: Map<String, String> = emptyMap()): HttpResponse = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url).header("User-Agent", USER_AGENT)
            .post(body.toRequestBody("application/x-www-form-urlencoded".toMediaType()))
        for ((k, v) in headers) req.header(k, v)
        execute(req.build())
    }

    /** JSON を送る(hono-bbs の書き込み・ログイン)。Cookie は読む通信と同じ置き場(Turnstile のつなぎの Cookie を返すため)。headers はアカウントの Bearer など */
    suspend fun postJson(url: String, json: String, headers: Map<String, String> = emptyMap()): HttpResponse = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url).header("User-Agent", USER_AGENT).post(json.toRequestBody("application/json".toMediaType()))
        for ((k, v) in headers) req.header(k, v)
        execute(req.build())
    }

    /** multipart/form-data で送る(画像のアップロード)。OkHttp が区切り(boundary)を付ける */
    suspend fun postMultipart(url: String, body: okhttp3.MultipartBody, userAgent: String = USER_AGENT, headers: Map<String, String> = emptyMap()): HttpResponse = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url).header("User-Agent", userAgent).post(body)
        for ((k, v) in headers) req.header(k, v)
        execute(req.build())
    }

    /** 置き場(R2 などの署名付き URL)へファイルをそのまま送る(hono-bbs の画像のアップロード) */
    suspend fun put(url: String, body: ByteArray, contentType: String): HttpResponse = withContext(Dispatchers.IO) {
        execute(Request.Builder().url(url).header("User-Agent", USER_AGENT).put(body.toRequestBody(contentType.toMediaType())).build())
    }

    /** 中身を取らずに、あるか・種類・大きさだけを聞く(上げた画像が本当に開けるかの確かめ)。リダイレクトはたどる */
    suspend fun head(url: String, userAgent: String = USER_AGENT): HttpResponse = withContext(Dispatchers.IO) {
        getClient.newCall(Request.Builder().url(url).header("User-Agent", userAgent).head().build()).execute().use { res ->
            val h = HashMap<String, String>()
            for (name in res.headers.names()) h[name.lowercase()] = res.header(name) ?: ""
            HttpResponse(res.code, h, ByteArray(0))
        }
    }

    private fun execute(req: Request): HttpResponse = client.newCall(req).execute().use { res ->
        val h = HashMap<String, String>()
        for (name in res.headers.names()) h[name.lowercase()] = res.header(name) ?: ""
        HttpResponse(res.code, h, res.body?.bytes() ?: ByteArray(0))
    }
}

/** Cookie を SharedPreferences に保存する置き場。期限の切れたものは読むときに捨てる */
private class SavedCookieJar(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("cookies", Context.MODE_PRIVATE)
    private val cookies: MutableList<Cookie> = load()

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        for (c in cookies) {
            this.cookies.removeAll { it.name == c.name && it.domain == c.domain && it.path == c.path }
            if (c.expiresAt > System.currentTimeMillis()) this.cookies += c
        }
        save()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        if (cookies.removeAll { it.expiresAt <= now }) save()
        return cookies.filter { it.matches(url) }
    }

    private fun save() {
        val arr = JSONArray()
        for (c in cookies) {
            // 期限のない Cookie(ブラウザを閉じるまで)は保存しない
            if (!c.persistent) continue
            arr.put(JSONObject().apply {
                put("name", c.name); put("value", c.value); put("domain", c.domain); put("path", c.path)
                put("expiresAt", c.expiresAt); put("secure", c.secure); put("httpOnly", c.httpOnly); put("hostOnly", c.hostOnly)
            })
        }
        prefs.edit().putString("all", arr.toString()).apply()
    }

    private fun load(): MutableList<Cookie> {
        val out = ArrayList<Cookie>()
        val arr = runCatching { JSONArray(prefs.getString("all", "[]")) }.getOrNull() ?: return out
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val b = Cookie.Builder().name(o.getString("name")).value(o.getString("value")).path(o.getString("path")).expiresAt(o.getLong("expiresAt"))
            if (o.getBoolean("hostOnly")) b.hostOnlyDomain(o.getString("domain")) else b.domain(o.getString("domain"))
            if (o.getBoolean("secure")) b.secure()
            if (o.getBoolean("httpOnly")) b.httpOnly()
            out += b.build()
        }
        return out
    }
}
