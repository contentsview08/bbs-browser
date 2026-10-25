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
import java.io.ByteArrayOutputStream

/**
 * 画像のアップロード(catbox.moe。PC 版の host/uploader.ts と同じ)。公式の API に匿名で 1 枚ずつ上げる。
 * JPEG・PNG・WebP は描き直して EXIF(撮影場所など)を取り除き、長い辺が 4096px を超えれば縮める。GIF・動画はそのまま。
 * 利用規約(https://catbox.moe/legal.php): 商用でなければ使える。公開されている窓口だけを使い、負荷をかけないこと
 */
object Uploader {
    private const val ENDPOINT = "https://catbox.moe/user/api.php"
    private const val USER_AGENT = "bbs-native/0.1.0"
    private const val MAX_BYTES = 50L * 1024 * 1024
    private const val MAX_GIF_BYTES = 20L * 1024 * 1024
    private const val MAX_DIMENSION = 4096

    /** 上げて、ファイルの URL を返す。だめなら理由を書いた例外 */
    suspend fun upload(context: Context, uri: Uri): String {
        val (name, type, bytes) = withContext(Dispatchers.IO) { prepare(context, uri) }
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("reqtype", "fileupload")
            .addFormDataPart("fileToUpload", name, bytes.toRequestBody(type.toMediaType()))
            .build()
        val res = Http.postMultipart(ENDPOINT, body, USER_AGENT)
        val text = String(res.body).trim()
        // 成功すると、本文にファイルの URL だけが返る。それ以外はエラーの文面
        if (res.status in 200..299 && Regex("^https://files\\.catbox\\.moe/\\S+$").matches(text)) return text
        error("アップロードできませんでした: ${text.ifEmpty { "HTTP ${res.status}" }}")
    }

    private fun prepare(context: Context, uri: Uri): Triple<String, String, ByteArray> {
        val cr = context.contentResolver
        val type = cr.getType(uri) ?: "application/octet-stream"
        if (!type.startsWith("image/") && !type.startsWith("video/")) error("画像か動画だけを上げられます")
        val raw = cr.openInputStream(uri)?.use { it.readBytes() } ?: error("ファイルを読めませんでした")
        if (type == "image/gif" && raw.size > MAX_GIF_BYTES) error("GIF は 20MB までです")
        if (raw.size > MAX_BYTES) error("このアプリから上げられるのは 50MB までです")
        val format = when (type) {
            "image/jpeg" -> Bitmap.CompressFormat.JPEG
            "image/png" -> Bitmap.CompressFormat.PNG
            "image/webp" -> Bitmap.CompressFormat.WEBP_LOSSY
            else -> return Triple("file.${type.substringAfter('/')}", type, raw)
        }
        // 描き直す(EXIF は付かなくなる)。JPEG の向き(EXIF の Orientation)は、描き直すと失われるので先に回しておく
        var bmp = BitmapFactory.decodeByteArray(raw, 0, raw.size) ?: error("画像を読めませんでした")
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
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        }
        val long = maxOf(bmp.width, bmp.height)
        if (long > MAX_DIMENSION) {
            val s = MAX_DIMENSION.toFloat() / long
            bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * s).toInt(), (bmp.height * s).toInt(), true)
        }
        val out = ByteArrayOutputStream()
        bmp.compress(format, 90, out)
        val ext = when (format) { Bitmap.CompressFormat.JPEG -> "jpg"; Bitmap.CompressFormat.PNG -> "png"; else -> "webp" }
        return Triple("image.$ext", type, out.toByteArray())
    }
}
