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

/** 画像の載っていたスレ(保存先の {board}・{thread} など)。site・board は表示している名前 */
data class SavePlace(val boardUrl: String, val site: String?, val board: String?, val thread: String, val threadKey: String)

/** 保存先: 土台(pictures・download)と、その下の書き方(data/SaveName.kt) */
data class SaveTarget(val base: String, val pattern: String, val place: SavePlace? = null)

/** 土台の画面に出す名前 */
fun saveBaseLabel(base: String) = if (base == "download") "ダウンロード" else "ピクチャ"

/**
 * ビューアーの「保存」: 画像を取ってきて、端末の「ピクチャ」か「ダウンロード」の下の、書き方で決めたフォルダに入れる
 * (MediaStore。権限は要らない。同じ名前があれば MediaStore が「名前 (1).jpg」にする)。
 * Android 9 以前は、アプリ用のピクチャ・ダウンロードのフォルダの下に同じ並びで入れる
 */
object ImageSaver {
    suspend fun save(context: Context, url: String, to: SaveTarget, no: Int? = null): String = withContext(Dispatchers.IO) {
        // 画像は ImageStore の置き場から(見たことのある画像は取り直さない)
        val file = ImageStore.get(url)
        // 形式は先頭だけで分かる。大きな画像を全部メモリに読まない
        val head = ByteArray(12)
        val n = file.inputStream().use { it.read(head) }
        val type = sniffImageType(head.copyOf(maxOf(n, 0))) ?: error("画像ではありません")
        val ext = when (type) { "image/png" -> "png"; "image/gif" -> "gif"; "image/webp" -> "webp"; "image/avif" -> "avif"; else -> "jpg" }
        val (time, unix) = SaveVars.timeOf()
        val p = to.place
        val vars = SaveVars(p?.boardUrl, p?.site, p?.board, p?.thread, p?.threadKey, no, time, unix)
        val parts = savePath(to.pattern, url, ext, vars)
        val folders = parts.dropLast(1)
        val download = to.base == "download"
        val top = if (download) Environment.DIRECTORY_DOWNLOADS else Environment.DIRECTORY_PICTURES
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, parts.last())
                put(MediaStore.MediaColumns.MIME_TYPE, type)
                put(MediaStore.MediaColumns.RELATIVE_PATH, (listOf(top) + folders).joinToString("/"))
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val cr = context.contentResolver
            val collection = if (download) MediaStore.Downloads.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
            val uri = cr.insert(collection, values) ?: error("保存先を作れませんでした")
            try {
                cr.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } } ?: error("書き込めませんでした")
            } catch (e: Throwable) {
                cr.delete(uri, null, null)
                throw e
            }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            cr.update(uri, values, null, null)
            // 同じ名前があったときは MediaStore が付け直した名前になっている
            val saved = cr.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: parts.last()
            "${(listOf(saveBaseLabel(to.base)) + folders + saved).joinToString("/")} に保存しました"
        } else {
            val root = context.getExternalFilesDir(top) ?: error("保存先がありません")
            val dir = folders.fold(root) { d, f -> File(d, f) }
            if (!dir.isDirectory && !dir.mkdirs()) error("フォルダを作れませんでした")
            // 上書きしない。「ないときだけ作る」で空いている名前を確保する
            val dest = generateSequence(0) { it + 1 }.map { File(dir, numberedName(parts.last(), it)) }.first { it.createNewFile() }
            file.copyTo(dest, overwrite = true)
            "保存しました"
        }
    }
}
