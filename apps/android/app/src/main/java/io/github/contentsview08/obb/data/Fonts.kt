package io.github.contentsview08.obb.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import java.io.File

/**
 * 選べる字(フォント)。アプリに入れると重くなるので、選んだときに Google Fonts のリポジトリ(github.com/google/fonts、
 * どれも SIL Open Font License)から 1 回だけ取り、アプリの中に置いて使う。取れるまでは端末の標準の字
 */
object Fonts {
    class Choice(val key: String, val name: String, val desc: String, val regular: String, val bold: String)

    private const val BASE = "https://github.com/google/fonts/raw/main/ofl/"
    val CHOICES = listOf(
        Choice("biz-udp", "BIZ UDPゴシック", "読みやすさを重視した UD 書体(約 9MB)", "bizudpgothic/BIZUDPGothic-Regular.ttf", "bizudpgothic/BIZUDPGothic-Bold.ttf"),
        Choice("zen-maru", "Zen 丸ゴシック", "角の丸いやわらかい字(約 8MB)", "zenmarugothic/ZenMaruGothic-Regular.ttf", "zenmarugothic/ZenMaruGothic-Bold.ttf"),
        Choice("mplus-1p", "M PLUS 1p", "すっきりした細身の字(約 4MB)", "mplus1p/MPLUS1p-Regular.ttf", "mplus1p/MPLUS1p-Bold.ttf"),
    )

    /** いま使う字(null なら端末の標準) */
    var family by mutableStateOf<FontFamily?>(null)
        private set
    /** 取っているところ(キー) */
    var loading by mutableStateOf<String?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    private fun dir(context: Context) = File(context.filesDir, "fonts").apply { mkdirs() }
    private fun fileOf(context: Context, path: String) = File(dir(context), path.substringAfterLast('/'))

    fun isDownloaded(context: Context, key: String) =
        CHOICES.firstOrNull { it.key == key }?.let { c -> fileOf(context, c.regular).exists() && fileOf(context, c.bold).exists() } == true

    /** 設定の字を使う。まだ手元になければ取ってから */
    suspend fun apply(context: Context, key: String) {
        error = null
        val c = CHOICES.firstOrNull { it.key == key }
        if (c == null) { family = null; return }
        val files = listOf(c.regular, c.bold).map { fileOf(context, it) }
        if (!files.all { it.exists() }) {
            loading = key
            try {
                for ((path, f) in listOf(c.regular, c.bold).zip(files)) {
                    if (f.exists()) continue
                    val res = Http.get(BASE + path)
                    if (res.status !in 200..299 || res.body.size < 100_000) throw IllegalStateException("取れませんでした(${res.status})")
                    // 途中で切れたファイルを残さないよう、書き終えてから名前を付ける
                    val tmp = File(f.parentFile, f.name + ".part")
                    tmp.writeBytes(res.body)
                    tmp.renameTo(f)
                }
            } catch (e: Exception) {
                error = "字を取れませんでした: ${e.message ?: e}"
                family = null
                return
            } finally {
                loading = null
            }
        }
        family = runCatching { FontFamily(Font(files[0], FontWeight.Normal), Font(files[1], FontWeight.Bold)) }.getOrNull()
    }

    /** 取った字を消す(使っていないもの) */
    fun deleteUnused(context: Context, keep: String) {
        for (c in CHOICES) if (c.key != keep) listOf(c.regular, c.bold).forEach { fileOf(context, it).delete() }
    }
}
