package io.github.yumekui8.bbsnative.data

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
 * - ほかの板: 設定の上げ先(uploadHost)。自動なら catbox.moe → 0x0.st → imgur(Client-ID があれば)→ uguu.se の順に試す
 *   (2026-11 に catbox が「保存先の不具合で止めている」、0x0.st が 503 で止まったことがあった)
 * どこに上げても、返ってきた URL を開いて画像が返るかを確かめる(URL だけ返して中身がない、ということがあった)。
 * JPEG・PNG・WebP は描き直して EXIF(撮影場所など)を取り除き、長い辺が決めた大きさを超えれば縮める。GIF・動画はそのまま。
 * 利用規約: catbox(https://catbox.moe/legal.php)は商用でなければ使える。0x0.st(https://0x0.st)はプログラムを名乗る User-Agent で使い、
 * ポルノ・グロ・暗号資産などは上げない。uguu.se(https://uguu.se)は 3 時間で消える。imgur(https://api.imgur.com)は本人が登録した Client-ID で使う。
 * どれも公開されている窓口だけを使い、負荷をかけない
 */
object Uploader {
    private const val CATBOX = "https://catbox.moe/user/api.php"
    private const val NULL_POINTER = "https://0x0.st"
    private const val UGUU = "https://uguu.se/upload?output=json"
    private const val IMGUR = "https://api.imgur.com/3/image"
    private const val USER_AGENT = "bbs-native/0.1.0 (+https://red-edge.net)"
    private const val MAX_BYTES = 50L * 1024 * 1024
    private const val MAX_GIF_BYTES = 20L * 1024 * 1024
    private const val MAX_DIMENSION = 4096

    /** 上げた結果。host は上げ先の名前(知らせに出す) */
    data class Result(val url: String, val host: String)

    /** 上げられなかった。message は人に見せる理由 */
    class UploadException(message: String) : Exception(message)

    /**
     * 上げて URL を返す。honoApi は hono-bbs の板のときの API の場所(それ以外は null)。
     * maxDimension: 長い辺がこれを超える画像は縮める(0 なら縮めない)
     */
    suspend fun upload(
        context: Context, uri: Uri, maxDimension: Int = MAX_DIMENSION, honoApi: String? = null,
        /** 上げ先(設定の uploadHost): auto / catbox / 0x0 / imgur / uguu */
        host: String = "auto", imgurClientId: String = "",
    ): Result {
        val (name, type, bytes) = withContext(Dispatchers.IO) { prepare(context, uri, maxDimension) }
        if (honoApi != null) return toHono(honoApi, name, type, bytes)
        val all = listOf<Pair<String, suspend () -> String>>(
            "catbox" to { toCatbox(name, type, bytes) },
            "0x0.st" to { toNullPointer(name, type, bytes) },
            "imgur" to { toImgur(name, type, bytes, imgurClientId) },
            "uguu.se" to { toUguu(name, type, bytes) },
        )
        // 自動なら上から順に試す(imgur は Client-ID があるときだけ)。選んだ上げ先だけなら、それだけ
        val tries = when (host) {
            "catbox" -> all.filter { it.first == "catbox" }
            "0x0" -> all.filter { it.first == "0x0.st" }
            "imgur" -> all.filter { it.first == "imgur" }
            "uguu" -> all.filter { it.first == "uguu.se" }
            else -> all.filter { it.first != "imgur" || imgurClientId.isNotBlank() }
        }
        // どこもだめなら、全部の理由を出す
        val reasons = ArrayList<String>()
        for ((host, up) in tries) {
            try {
                val url = up()
                verify(url, host)
                return Result(url, host)
            } catch (e: UploadException) {
                reasons += "$host: ${e.message}"
            } catch (e: java.io.IOException) {
                reasons += "$host: つながりませんでした(${e.message ?: e.javaClass.simpleName})"
            }
        }
        throw UploadException(reasons.joinToString(" / "))
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

    private suspend fun toNullPointer(name: String, type: String, bytes: ByteArray): String {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", name, bytes.toRequestBody(type.toMediaType()))
            .build()
        val res = Http.postMultipart(NULL_POINTER, body, USER_AGENT)
        val text = String(res.body).trim()
        // 成功すると、本文にファイルの URL だけが返る(https://0x0.st/XXXX.png)
        if (res.status in 200..299 && Regex("^https://0x0\\.st/\\S+$").matches(text)) return text
        throw UploadException(explain(res.status, text))
    }

    /** uguu.se: 3 時間で消える。返事は JSON(files[0].url) */
    private suspend fun toUguu(name: String, type: String, bytes: ByteArray): String {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("files[]", name, bytes.toRequestBody(type.toMediaType()))
            .build()
        val res = Http.postMultipart(UGUU, body, USER_AGENT)
        val text = String(res.body).trim()
        val url = runCatching { JSONObject(text).getJSONArray("files").getJSONObject(0).getString("url") }.getOrNull()
        if (res.status in 200..299 && url != null && url.startsWith("https://")) return url
        throw UploadException(explain(res.status, runCatching { JSONObject(text).optString("description") }.getOrNull()?.ifEmpty { null } ?: text))
    }

    /** imgur: 本人が登録した Client-ID で、匿名の画像として上げる。返事は JSON(data.link) */
    private suspend fun toImgur(name: String, type: String, bytes: ByteArray, clientId: String): String {
        if (clientId.isBlank()) throw UploadException("Client-ID が設定されていません(設定 → 書き込み → 画像のアップロード)")
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

    private fun prepare(context: Context, uri: Uri, maxDimension: Int): Triple<String, String, ByteArray> {
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
        val out = ByteArrayOutputStream()
        bmp.compress(format, 90, out)
        bmp.recycle()
        val ext = when (format) { Bitmap.CompressFormat.JPEG -> "jpg"; Bitmap.CompressFormat.PNG -> "png"; else -> "webp" }
        return Triple("image.$ext", type, out.toByteArray())
    }
}
