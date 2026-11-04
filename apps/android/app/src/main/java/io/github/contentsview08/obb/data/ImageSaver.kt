package io.github.contentsview08.obb.data

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * ビューアーの「保存」: 画像を取ってきて、端末の「ピクチャ/bbs」に入れる(MediaStore。権限は要らない)。
 * Android 9 以前は、アプリ用のピクチャのフォルダに入れる
 */
object ImageSaver {
    suspend fun save(context: Context, url: String): String = withContext(Dispatchers.IO) {
        // 画像は ImageStore の置き場から(見たことのある画像は取り直さない)
        val bytes = ImageStore.get(url).readBytes()
        val head = bytes.take(12).map { it.toInt() and 0xff }
        val sniffed = when {
            head.size >= 4 && head[0] == 0x89 && head[1] == 0x50 -> "image/png"
            head.size >= 3 && head[0] == 0x47 && head[1] == 0x49 && head[2] == 0x46 -> "image/gif"
            head.size >= 12 && head[8] == 0x57 && head[9] == 0x45 && head[10] == 0x42 && head[11] == 0x50 -> "image/webp"
            head.size >= 2 && head[0] == 0xff && head[1] == 0xd8 -> "image/jpeg"
            else -> null
        }
        val type = sniffed
            ?: when (url.substringAfterLast('.').substringBefore('?').lowercase()) { "png" -> "image/png"; "gif" -> "image/gif"; "webp" -> "image/webp"; else -> "image/jpeg" }
        val ext = when (type) { "image/png" -> "png"; "image/gif" -> "gif"; "image/webp" -> "webp"; else -> "jpg" }
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
