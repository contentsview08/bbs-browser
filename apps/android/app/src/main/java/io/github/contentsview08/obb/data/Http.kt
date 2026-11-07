package io.github.contentsview08.obb.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** 応答。ヘッダー名は小文字 */
class HttpResponse(val status: Int, val headers: Map<String, String>, val body: ByteArray)

/**
 * 通信(PC 版の host/tauriContext.ts にあたる)。2ch 互換の板は専ブラに Monazilla の User-Agent を求める慣習がある。
 * Range を付けた取得(dat の差分)では、OkHttp は gzip を頼まない(バイトの位置がずれないように)。
 * Cookie は端末に保存する(期限のないものも。アプリを閉じても残す)。
 * 掲示板のフォームの書き込み(postForm)は、読む通信とは別の置き場を使う(エッヂの edge-token・5ch の書き込みの Cookie。PC 版の post_http.rs と同じ分け方)
 */
object Http {
    private val USER_AGENT = AppUa.MONAZILLA

    /** 試験用: 通信の代わりに答える(メソッド・URL・ヘッダー・送る中身) */
    internal var fake: ((String, String, Map<String, String>, ByteArray?) -> HttpResponse)? = null

    private const val MAX_REDIRECTS = 5

    /** 読む応答(dat・スレ一覧)の上限。これより大きいものは掲示板の中身ではない */
    private const val READ_MAX_BYTES = 16L * 1024 * 1024

    /** 書き込みの応答などのページの上限 */
    private const val PAGE_MAX_BYTES = 4L * 1024 * 1024

    private lateinit var jar: SavedCookieJar
    private lateinit var postJar: SavedCookieJar
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
        if (::jar.isInitialized) return
        jar = SavedCookieJar(context.applicationContext, "cookies")
        postJar = SavedCookieJar(context.applicationContext, "post-cookies")
    }

    private val postFormClient by lazy { client.newBuilder().cookieJar(postJar).build() }

    /** 読むときはリダイレクトをたどる(板・スレが別のサーバーへ移ったとき。5ch の http → https など)。書き込み(POST)は execute で 1 段ずつたどる */
    private val getClient by lazy { client.newBuilder().followRedirects(true).followSslRedirects(true).build() }

    /**
     * 読む。followRedirects を false にすると、リダイレクトをたどらずに 301・302 をそのまま返す
     * (dat 落ちを 302 で知らせる掲示板のため。ふだんの読み取りはたどる)
     */
    suspend fun get(url: String, headers: Map<String, String> = emptyMap(), followRedirects: Boolean = true): HttpResponse =
        fake?.invoke("GET", url, headers, null) ?: withContext(Dispatchers.IO) {
            val req = Request.Builder().url(url).header("User-Agent", USER_AGENT)
            for ((k, v) in headers) req.header(k, v)
            (if (followRedirects) getClient else client).newCall(req.build()).execute().use { res -> toResponse(res, READ_MAX_BYTES) }
        }

    /** フォームを送る(body はエンコード済みの application/x-www-form-urlencoded) */
    suspend fun postForm(url: String, body: ByteArray, headers: Map<String, String> = emptyMap()): HttpResponse = fake?.invoke("POST", url, headers, body) ?: withContext(Dispatchers.IO) {
        val req = Request.Builder().url(url).header("User-Agent", USER_AGENT)
            .post(body.toRequestBody("application/x-www-form-urlencoded".toMediaType()))
        for ((k, v) in headers) req.header(k, v)
        execute(req.build(), postFormClient)
    }

    /** JSON を送る(hono-bbs の書き込み・ログイン)。Cookie は読む通信と同じ置き場(Turnstile のつなぎの Cookie を返すため)。headers はアカウントの Bearer など */
    suspend fun postJson(url: String, json: String, headers: Map<String, String> = emptyMap()): HttpResponse = fake?.invoke("POST", url, headers, json.toByteArray()) ?: withContext(Dispatchers.IO) {
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
        client.newCall(Request.Builder().url(url).header("User-Agent", USER_AGENT).put(body.toRequestBody(contentType.toMediaType())).build()).execute().use { toResponse(it) }
    }

    /** 中身を取らずに、あるか・種類・大きさだけを聞く(上げた画像が本当に開けるかの確かめ)。リダイレクトはたどる */
    suspend fun head(url: String, userAgent: String = USER_AGENT): HttpResponse = withContext(Dispatchers.IO) {
        getClient.newCall(Request.Builder().url(url).header("User-Agent", userAgent).head().build()).execute().use { res ->
            val h = HashMap<String, String>()
            for (name in res.headers.names()) h[name.lowercase()] = res.header(name) ?: ""
            HttpResponse(res.code, h, ByteArray(0))
        }
    }

    private fun toResponse(res: okhttp3.Response, maxBytes: Long = PAGE_MAX_BYTES): HttpResponse {
        val h = HashMap<String, String>()
        for (name in res.headers.names()) h[name.lowercase()] = res.header(name) ?: ""
        return HttpResponse(res.code, h, readBody(res, maxBytes))
    }

    /** 本文を上限まで読む。Content-Length が上限を超えていれば読まずに、途中で超えても失敗にする(メモリを食い尽くさないため) */
    private fun readBody(res: okhttp3.Response, maxBytes: Long): ByteArray {
        val body = res.body ?: return ByteArray(0)
        val url = res.request.url
        if (body.contentLength() > maxBytes) throw IOException("応答が大きすぎます(${maxBytes shr 20}MB まで): $url")
        val source = body.source()
        // 上限より 1 バイト多く頼み、届けば超えている
        if (source.request(maxBytes + 1)) throw IOException("応答が大きすぎます(${maxBytes shr 20}MB まで): $url")
        return source.readByteArray()
    }

    /** POST を送り、リダイレクトを nextRequest の決まりで 1 段ずつたどる。途中で渡される Cookie も置き場に入る */
    private fun execute(req: Request, http: OkHttpClient = client): HttpResponse {
        var cur = req
        repeat(MAX_REDIRECTS + 1) {
            val step = http.newCall(cur).execute().use { res ->
                // res.request は HttpsFirst が https に直したあとの URL
                nextRequest(res.code, res.request.url, res.header("Location")) ?: return toResponse(res)
            }
            val b = cur.newBuilder().url(step.url)
            if (!step.keepHeaders) b.headers(Headers.headersOf("User-Agent", cur.header("User-Agent") ?: USER_AGENT))
            if (!step.keepMethod) b.get()
            cur = b.build()
        }
        throw IOException("リダイレクトが多すぎます")
    }
}

/**
 * 書き込みのリダイレクトの次の一歩。たどらないなら null(受けた応答をそのまま返す)。
 * keepMethod は同じ方法と本文で送り直す(307・308)、そうでなければ本文なしの GET。keepHeaders が false なら User-Agent のほかは渡さない。
 * 決まりは packages/conformance/post-redirect.json(PC 版の post_http.rs と同じ)
 */
internal class NextRequest(val url: HttpUrl, val keepMethod: Boolean, val keepHeaders: Boolean)

internal fun nextRequest(status: Int, from: HttpUrl, location: String?): NextRequest? {
    if (status != 301 && status != 302 && status != 303 && status != 307 && status != 308) return null
    if (location.isNullOrEmpty()) return null
    val next = from.resolve(location) ?: return null
    // https から http へは落とさない
    if (from.isHttps && !next.isHttps) return null
    val upgrade = !from.isHttps && next.isHttps && from.port == 80 && next.port == 443
    val sameSite = from.host == next.host && (from.port == next.port || upgrade)
    val resend = status == 307 || status == 308
    // 本文を別のサイトへ渡さない
    if (resend && !sameSite) return null
    return NextRequest(next, resend, sameSite)
}

/** Cookie を保存する形(期限のないものも残す) */
internal fun cookieToJson(c: Cookie): JSONObject = JSONObject().apply {
    put("name", c.name); put("value", c.value); put("domain", c.domain); put("path", c.path)
    put("expiresAt", c.expiresAt); put("persistent", c.persistent); put("secure", c.secure); put("httpOnly", c.httpOnly); put("hostOnly", c.hostOnly)
}

internal fun cookieFromJson(o: JSONObject): Cookie {
    val b = Cookie.Builder().name(o.getString("name")).value(o.getString("value")).path(o.getString("path"))
    // persistent がないのは、期限のあるものだけを保存していたころのデータ
    if (o.optBoolean("persistent", true)) b.expiresAt(o.getLong("expiresAt"))
    if (o.getBoolean("hostOnly")) b.hostOnlyDomain(o.getString("domain")) else b.domain(o.getString("domain"))
    if (o.getBoolean("secure")) b.secure()
    if (o.getBoolean("httpOnly")) b.httpOnly()
    return b.build()
}

/** Cookie を SharedPreferences に保存する置き場。期限の切れたものは読むときに捨てる */
private class SavedCookieJar(context: Context, name: String) : CookieJar {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)
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
        for (c in cookies) arr.put(cookieToJson(c))
        prefs.edit().putString("all", arr.toString()).apply()
    }

    private fun load(): MutableList<Cookie> {
        val out = ArrayList<Cookie>()
        val arr = runCatching { JSONArray(prefs.getString("all", "[]")) }.getOrNull() ?: return out
        // 壊れた 1 件のために起動で落ちないよう、読めないものだけを捨てる
        for (i in 0 until arr.length()) runCatching { cookieFromJson(arr.getJSONObject(i)) }.onSuccess { out += it }
        return out
    }
}
