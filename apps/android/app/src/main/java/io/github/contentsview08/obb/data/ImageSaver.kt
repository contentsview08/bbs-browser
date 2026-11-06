package io.github.contentsview08.obb.data

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** 先頭のバイトから画像の形式を見分ける。分からなければ null(URL が .jpg でも HTML のエラーページのことがある) */
internal fun sniffImageType(bytes: ByteArray): String? {
    val head = bytes.take(12).map { it.toInt() and 0xff }
    fun ascii(at: Int, s: String) = head.size >= at + s.length && s.indices.all { head[at + it] == s[it].code }
    return when {
        head.size >= 4 && head[0] == 0x89 && head[1] == 0x50 -> "image/png"
        head.size >= 3 && head[0] == 0x47 && head[1] == 0x49 && head[2] == 0x46 -> "image/gif"
        head.size >= 12 && head[8] == 0x57 && head[9] == 0x45 && head[10] == 0x42 && head[11] == 0x50 -> "image/webp"
        head.size >= 2 && head[0] == 0xff && head[1] == 0xd8 -> "image/jpeg"
        ascii(4, "ftyp") && (ascii(8, "avif") || ascii(8, "avis")) -> "image/avif"
        else -> null
    }
}

/** 順に保存して、保存できた数を返す。1 枚の失敗では止めない。取り消されたら、残りを失敗に数えず止める */
internal suspend fun saveEach(urls: List<String>, save: suspend (String) -> Unit): Int {
    var ok = 0
    for (u in urls) {
        try {
            save(u)
            ok++
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            // 失敗の数は呼び出し元が全体との差で出す
        }
    }
    return ok
}

/**
 * ビューアーの「保存」: 画像を取ってきて、端末の「ピクチャ/bbs」に入れる(MediaStore。権限は要らない)。
 * Android 9 以前は、アプリ用のピクチャのフォルダに入れる
 */
object ImageSaver {
    suspend fun save(context: Context, url: String): String = withContext(Dispatchers.IO) {
        // 画像は ImageStore の置き場から(見たことのある画像は取り直さない)
        val bytes = ImageStore.get(url).readBytes()
        val type = sniffImageType(bytes) ?: error("画像ではありません")
        val ext = when (type) { "image/png" -> "png"; "image/gif" -> "gif"; "image/webp" -> "webp"; "image/avif" -> "avif"; else -> "jpg" }
        val base = url.substringAfterLast('/').substringBefore('?').substringBeforeLast('.').filter { it.isLetterOrDigit() || it == '-' || it == '_' }.take(40).ifEmpty { "image" }
        val name = "${base}_${System.currentTimeMillis() / 1000}.$ext"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, name)
                put(MediaStore.Images.Media.MIME_TYPE, type)
                put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/bbs")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val cr = context.contentResolver
            val uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: error("保存先を作れませんでした")
            cr.openOutputStream(uri)?.use { it.write(bytes) } ?: error("書き込めませんでした")
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            cr.update(uri, values, null, null)
            "ピクチャ/bbs に保存しました"
        } else {
            val dir = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES) ?: error("保存先がありません")
            File(dir, name).writeBytes(bytes)
            "保存しました"
        }
    }
}
