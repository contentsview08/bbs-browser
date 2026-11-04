package io.github.contentsview08.obb.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * 画像のアップロード(PC 版の host/uploader.ts・hono-bbs の web と同じ考え方)。上げ先は板で決める:
 * - hono-bbs の板: その掲示板の画像の置き場(web の書き込み欄と同じ。受け付け → 置き場へ送る → 確定。Turnstile は書き込みと同じつなぎの Cookie)
 * - ほかの板: 設定の上げ先(uploadHost)のうち API のもの(catbox / imgur / imgbb)。サイトの画面で上げるもの(imgur-web / imgbox-web / imgbb-web)は
 *   ui/WebUpload.kt がその画面を開くので、ここには来ない
 * どこに上げても、返ってきた URL を開いて画像が返るかを確かめる(URL だけ返して中身がない、ということがあった)。
 * JPEG・PNG・WebP は描き直して EXIF(撮影場所など)を取り除き、長い辺が決めた大きさを超えれば縮める。GIF・動画はそのまま。
 * 利用規約: catbox(https://catbox.moe/legal.php)は商用でなければ使える。imgur(https://api.imgur.com)は本人が登録した Client-ID、
 * imgbb(https://api.imgbb.com)は本人が登録した API キーで使う。
 * どれも公開されている窓口だけを使い、負荷をかけない
 */
object Uploader {
    private const val CATBOX = "https://catbox.moe/user/api.php"
    private const val IMGUR = "https://api.imgur.com/3/image"
    private const val IMGBB = "https://api.imgbb.com/1/upload"
    private const val USER_AGENT = "bbs-native/0.1.0 (+https://red-edge.net)"
    private const val MAX_BYTES = 50L * 1024 * 1024
    private const val MAX_GIF_BYTES = 20L * 1024 * 1024
    private const val MAX_DIMENSION = 4096

    /** 上げた結果。host は上げ先の名前(知らせに出す) */
    /** deleteUrl: 置き場から消すためのページ(imgbb の delete_url。API では消せないので、ブラウザで開いて消す)。返さない置き場は null */
    data class Result(val url: String, val host: String, val deleteUrl: String? = null)

    /** 上げられなかった。message は人に見せる理由 */
    class UploadException(message: String) : Exception(message)

    /**
     * 上げて URL を返す。honoApi は hono-bbs の板のときの API の場所(それ以外は null)。
     * maxDimension: 長い辺がこれを超える画像は縮める(0 なら縮めない)
     */
    suspend fun upload(
        context: Context, uri: Uri, maxDimension: Int = MAX_DIMENSION, honoApi: String? = null,
        /** 上げ先(設定の uploadHost)。API のもの: catbox / imgur / imgbb */
        host: String = DEFAULT_HOST, imgurClientId: String = "", imgbbApiKey: String = "",
        stamp: Stamp? = null,
    ): Result {
        val (name, type, bytes) = prepareFor(context, uri, maxDimension, stamp)
        return send(name, type, bytes, honoApi, host, imgurClientId, imgbbApiKey)
    }

    /** 画像の隅に描き込む文字(スレタイと URL)。corner は left(左下)か right(右下) */
    class Stamp(val lines: List<String>, val corner: String)

    /** 上げる前に画像を整える(縮める・向きを直す・描き込む)。name・type・中身 */
    suspend fun prepareFor(context: Context, uri: Uri, maxDimension: Int = MAX_DIMENSION, stamp: Stamp? = null): Triple<String, String, ByteArray> =
        withContext(Dispatchers.IO) { prepare(context, uri, maxDimension, stamp) }

    /** 中身の SHA-256(16 進)。同じ画像の判定に使う */
    fun sha256(bytes: ByteArray): String = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    /** 整えた画像を上げて URL を返す */
    suspend fun send(name: String, type: String, bytes: ByteArray, honoApi: String?, host: String, imgurClientId: String, imgbbApiKey: String): Result {
        if (honoApi != null) return toHono(honoApi, name, type, bytes)
        val up: suspend () -> Pair<String, String?> = when (host) {
            "catbox" -> { { toCatbox(name, type, bytes) to null } }
            "imgur" -> { { toImgur(name, type, bytes, imgurClientId) to null } }
            "imgbb" -> { { toImgbb(name, type, bytes, imgbbApiKey) } }
            else -> throw UploadException("この上げ先はサイトの画面で上げます")
        }
        try {
            val (url, deleteUrl) = up()
            verify(url, host)
            return Result(url, host, deleteUrl)
        } catch (e: java.io.IOException) {
            throw UploadException("$host: つながりませんでした(${e.message ?: e.javaClass.simpleName})")
        }
    }

    /**
     * 画像の隅(左下か右下)に文字を描き込む(PC 版の utils/stampImage.ts と同じ見た目)。
     * 文字の大きさは幅の 2.2%(12px から)。半透明の黒い帯の上に白い字。長い行は後ろを「…」で省く
     */
    private fun stampOn(src: Bitmap, stamp: Stamp): Bitmap {
        val bmp = if (src.isMutable) src else src.copy(Bitmap.Config.ARGB_8888, true).also { src.recycle() }
        val canvas = android.graphics.Canvas(bmp)
        val size = maxOf(12f, bmp.width * 0.022f)
        val pad = size * 0.6f
        val lineH = size * 1.35f
        val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { textSize = size; color = android.graphics.Color.WHITE }
        val maxW = bmp.width - pad * 4
        val fit = { t: String ->
            var s = t.trim()
            if (paint.measureText(s) <= maxW) s
            else { while (s.length > 1 && paint.measureText("$s…") > maxW) s = s.dropLast(1); "$s…" }
        }
        val lines = stamp.lines.map { it.trim() }.filter { it.isNotEmpty() }.map(fit)
        val boxW = lines.maxOf { paint.measureText(it) } + pad * 2
        val boxH = lineH * lines.size + pad * 2 - (lineH - size)
        val x = if (stamp.corner == "left") pad else bmp.width - pad - boxW
        val y = bmp.height - pad - boxH
        canvas.drawRect(x, y, x + boxW, y + boxH, android.graphics.Paint().apply { color = android.graphics.Color.argb(140, 0, 0, 0) })
        paint.textAlign = if (stamp.corner == "left") android.graphics.Paint.Align.LEFT else android.graphics.Paint.Align.RIGHT
        val tx = if (stamp.corner == "left") x + pad else x + boxW - pad
        lines.forEachIndexed { i, t -> canvas.drawText(t, tx, y + pad + size + lineH * i, paint) }
        return bmp
    }

    const val DEFAULT_HOST = "imgur-web"
    /** 上げ先(設定に出す並び・言葉。PC 版の UPLOAD_HOSTS と同じ)。kind は web(サイトの画面)か api */
    data class HostDef(val key: String, val name: String, val kind: String, val note: String, val setting: String? = null)
    val HOSTS = listOf(
        HostDef("imgur-web", "imgur", "web", "消えない。ログインなしで上げられる"),
        HostDef("imgur", "imgur", "api", "消えない。Client-ID を登録して、画像からそのまま上げる", "Client-ID"),
        HostDef("catbox", "catbox.moe", "api", "消えない。登録なしで上げられる"),
        HostDef("imgbb", "imgbb", "api", "消えない。API キーを登録して、画像からそのまま上げる", "API キー"),
        HostDef("imgbox-web", "imgbox", "web", "消えない。ログインなしで上げられる"),
        HostDef("imgbb-web", "imgbb", "web", "消えない。ログインなしで上げられる"),
    )
    /** 前の設定(自動・0x0.st・uguu.se)は imgur の画面に読み替える */
    fun migrateHost(v: String?): String = if (HOSTS.any { it.key == v }) v!! else DEFAULT_HOST
    /** API で上げるのに登録が要るのに、まだなら理由 */
    fun hostProblem(host: String, imgurClientId: String, imgbbApiKey: String): String? = when {
        host == "imgur" && imgurClientId.isBlank() -> "imgur の Client-ID が登録されていません(設定 → 画像のアップロード)"
        host == "imgbb" && imgbbApiKey.isBlank() -> "imgbb の API キーが登録されていません(設定 → 画像のアップロード)"
        else -> null
    }

    private suspend fun toCatbox(name: String, type: String, bytes: ByteArray): String {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("reqtype", "fileupload")
            .addFormDataPart("fileToUpload", name, bytes.toRequestBody(type.toMediaType()))
            .build()
        val res = Http.postMultipart(CATBOX, body, USER_AGENT)
        val text = String(res.body).trim()
        // 成功すると、本文にファイルの URL だけが返る。それ以外はエラーの文面
        if (res.status in 200..299 && Regex("^https://files\\.catbox\\.moe/\\S+$").matches(text)) return text
        throw UploadException(explain(res.status, text))
    }

    /** imgur: 本人が登録した Client-ID で、匿名の画像として上げる。返事は JSON(data.link) */
    private suspend fun toImgur(name: String, type: String, bytes: ByteArray, clientId: String): String {
        if (clientId.isBlank()) throw UploadException("Client-ID が設定されていません(設定 → 画像のアップロード)")
        if (!type.startsWith("image/") && !type.startsWith("video/")) throw UploadException("画像か動画だけを上げられます")
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart(if (type.startsWith("video/")) "video" else "image", name, bytes.toRequestBody(type.toMediaType()))
            .build()
        val res = Http.postMultipart(IMGUR, body, USER_AGENT, mapOf("Authorization" to "Client-ID $clientId"))
        val j = runCatching { JSONObject(String(res.body)) }.getOrNull()
        val link = j?.optJSONObject("data")?.optString("link").orEmpty()
        if (res.status in 200..299 && link.startsWith("https://")) return link
        val err = j?.optJSONObject("data")?.opt("error")?.let { e -> (e as? JSONObject)?.optString("message") ?: e.toString() }.orEmpty()
        if (res.status == 403 || res.status == 401) throw UploadException("Client-ID が通りませんでした(${err.ifEmpty { "HTTP ${res.status}" }})")
        throw UploadException(explain(res.status, err))
    }

    /** imgbb: 本人が登録した API キーで上げる(https://api.imgbb.com/)。返事は JSON(data.url。data.delete_url は消すためのページ) */
    private suspend fun toImgbb(name: String, type: String, bytes: ByteArray, apiKey: String): Pair<String, String?> {
        if (apiKey.isBlank()) throw UploadException("API キーが設定されていません(設定 → 画像のアップロード)")
        if (!type.startsWith("image/")) throw UploadException("imgbb に上げられるのは画像だけです")
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("image", name, bytes.toRequestBody(type.toMediaType()))
            .build()
        val res = Http.postMultipart("$IMGBB?key=${java.net.URLEncoder.encode(apiKey, "UTF-8")}", body, USER_AGENT)
        val j = runCatching { JSONObject(String(res.body)) }.getOrNull()
        val url = j?.optJSONObject("data")?.optString("url").orEmpty()
        if (res.status in 200..299 && url.startsWith("https://")) return url to j?.optJSONObject("data")?.optString("delete_url")?.takeIf { it.startsWith("https://") }
        val err = j?.opt("error")?.let { e -> (e as? JSONObject)?.optString("message") ?: e.toString() }.orEmpty()
        if (res.status == 403 || res.status == 401) throw UploadException("API キーが通りませんでした(${err.ifEmpty { "HTTP ${res.status}" }})")
        throw UploadException(explain(res.status, err))
    }

    /** hono-bbs の画像の置き場: 受け付け(署名付きの送り先をもらう)→ 置き場へ送る → 確定(公開の URL をもらう) */
    private suspend fun toHono(api: String, name: String, type: String, bytes: ByteArray): Result {
        if (!type.startsWith("image/")) throw UploadException("この掲示板に上げられるのは画像だけです")
        val req = JSONObject().put("contentType", type).put("filename", name).put("size", bytes.size).toString()
        val r1 = Http.postJson("$api/upload/request", req)
        val j1 = runCatching { JSONObject(String(r1.body)) }.getOrNull()
        if (r1.status !in 200..299) throw UploadException(honoError(r1.status, j1))
        val d1 = j1?.optJSONObject("data") ?: throw UploadException("掲示板の返事を読めませんでした(HTTP ${r1.status})")
        // 同じ画像がもう置いてあれば、その URL を使う(送らない)
        if (d1.optBoolean("deduplicated")) return Result(d1.getString("url").also { verify(it, "この掲示板") }, "この掲示板")
        val put = Http.put(d1.getString("uploadUrl"), bytes, d1.optString("contentType", type))
        if (put.status !in 200..299) throw UploadException("置き場に送れませんでした(HTTP ${put.status})")
        val r2 = Http.postJson("$api/upload/confirm/${d1.getString("imageId")}", "{}")
        val j2 = runCatching { JSONObject(String(r2.body)) }.getOrNull()
        if (r2.status !in 200..299) throw UploadException(honoError(r2.status, j2))
        val url = j2?.optJSONObject("data")?.optString("url").orEmpty()
        if (url.isEmpty()) throw UploadException("掲示板の返事に画像の URL がありませんでした")
        verify(url, "この掲示板")
        return Result(url, "この掲示板")
    }

    private fun honoError(status: Int, j: JSONObject?): String {
        val error = j?.optString("error").orEmpty()
        if (error == "TURNSTILE_REQUIRED" || error == "TURNSTILE_INVALID")
            return "画像を上げるには、人の確認(Turnstile)が要ります。一度書き込んで確認を済ませてから、もう一度上げてください"
        val msg = j?.optString("message").orEmpty()
        return if (msg.isNotEmpty()) "$msg(HTTP $status)" else "掲示板が受け付けませんでした(HTTP $status)"
    }

    /**
     * 上げた URL が本当に開けるかを確かめる。画像・動画の種類で返ってこなければ、上げられなかったとみなす
     * (置き場の不具合で、URL だけ返して中身がないことがあった)。確かめの通信そのものが通らないときは、上げられたとみなす
     */
    private suspend fun verify(url: String, host: String) {
        val res = try { Http.head(url, USER_AGENT) } catch (e: java.io.IOException) { return }
        val type = res.headers["content-type"].orEmpty()
        if (res.status !in 200..299) throw UploadException("上げた URL を開くと HTTP ${res.status} でした(${host} の置き場の不具合)")
        if (!type.startsWith("image/") && !type.startsWith("video/") && type != "application/octet-stream")
            throw UploadException("上げた URL を開いても画像が返りませんでした(${type.ifEmpty { "種類なし" }}。${host} の置き場の不具合)")
    }

    /** 置き場の返事を、人に分かる言葉にする */
    private fun explain(status: Int, text: String): String {
        val t = text.take(200)
        return when {
            t.contains("paused", true) && t.contains("storage", true) -> "今は受け付けを止めています(置き場の不具合。「$t」)"
            status == 413 || t.contains("too large", true) -> "ファイルが大きすぎます"
            status == 429 -> "続けて上げすぎました。少し待ってから上げてください"
            status in 500..599 -> "置き場が落ちています(HTTP $status)"
            t.isEmpty() -> "HTTP $status"
            t.startsWith("<") -> "受け付けませんでした(HTTP $status)"
            else -> "$t(HTTP $status)"
        }
    }

    private fun prepare(context: Context, uri: Uri, maxDimension: Int, stamp: Stamp?): Triple<String, String, ByteArray> {
        val cr = context.contentResolver
        val type = cr.getType(uri) ?: "application/octet-stream"
        if (!type.startsWith("image/") && !type.startsWith("video/")) throw UploadException("画像か動画だけを上げられます")
        val raw = cr.openInputStream(uri)?.use { it.readBytes() } ?: throw UploadException("ファイルを読めませんでした")
        if (type == "image/gif" && raw.size > MAX_GIF_BYTES) throw UploadException("GIF は 20MB までです")
        if (raw.size > MAX_BYTES) throw UploadException("このアプリから上げられるのは 50MB までです")
        val format = when (type) {
            "image/jpeg" -> Bitmap.CompressFormat.JPEG
            "image/png" -> Bitmap.CompressFormat.PNG
            "image/webp" -> Bitmap.CompressFormat.WEBP_LOSSY
            else -> return Triple("file.${type.substringAfter('/')}", type, raw)
        }
        // 大きな写真をそのままの大きさで読むと、1 枚で数十 MB を使い、何枚も続けて上げるとメモリが足りなくなる。
        // 先に大きさだけ読み、縮める先の 2 倍を下回らない所まで間引いて読む(最後に正確な大きさへ縮める)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
        val longSide = maxOf(bounds.outWidth, bounds.outHeight)
        var sample = 1
        if (maxDimension > 0) while (longSide / (sample * 2) >= maxDimension) sample *= 2
        // 描き直す(EXIF は付かなくなる)。JPEG の向き(EXIF の Orientation)は、描き直すと失われるので先に回しておく
        var bmp = BitmapFactory.decodeByteArray(raw, 0, raw.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw UploadException("画像を読めませんでした")
        val rotation = runCatching {
            when (android.media.ExifInterface(raw.inputStream()).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1)) {
                android.media.ExifInterface.ORIENTATION_ROTATE_90 -> 90
                android.media.ExifInterface.ORIENTATION_ROTATE_180 -> 180
                android.media.ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }
        }.getOrDefault(0)
        if (rotation != 0) {
            val m = android.graphics.Matrix().apply { postRotate(rotation.toFloat()) }
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true).also { if (it !== bmp) bmp.recycle() }
        }
        val long = maxOf(bmp.width, bmp.height)
        if (maxDimension > 0 && long > maxDimension) {
            val s = maxDimension.toFloat() / long
            bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * s).toInt(), (bmp.height * s).toInt(), true).also { if (it !== bmp) bmp.recycle() }
        }
        if (stamp != null && stamp.lines.any { it.isNotBlank() }) bmp = stampOn(bmp, stamp)
        val out = ByteArrayOutputStream()
        bmp.compress(format, 90, out)
        bmp.recycle()
        val ext = when (format) { Bitmap.CompressFormat.JPEG -> "jpg"; Bitmap.CompressFormat.PNG -> "png"; else -> "webp" }
        return Triple("image.$ext", type, out.toByteArray())
    }
}
