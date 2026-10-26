package io.github.yumekui8.bbsnative.data

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
        val res = Http.get(url)
        if (res.status !in 200..299 || res.body.isEmpty()) error("取れませんでした(HTTP ${res.status})")
        val type = res.headers["content-type"]?.substringBefore(';')?.trim()?.takeIf { it.startsWith("image/") }
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
            cr.openOutputStream(uri)?.use { it.write(res.body) } ?: error("書き込めませんでした")
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            cr.update(uri, values, null, null)
            "ピクチャ/bbs に保存しました"
        } else {
            val dir = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES) ?: error("保存先がありません")
            File(dir, name).writeBytes(res.body)
            "保存しました"
        }
    }
}
