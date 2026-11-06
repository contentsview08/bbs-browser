package io.github.contentsview08.obb.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * 選べる字(フォント)。アプリに入れると重くなるので、選んだときに Google Fonts のリポジトリ(github.com/google/fonts、
 * どれも SIL Open Font License)から 1 回だけ取り、アプリの中に置いて使う。選んだ字は取り終えてから切り替える
 */
object Fonts {
    class Choice(val key: String, val name: String, val desc: String, val regular: String, val bold: String)

    /** 端末の標準の字 */
    const val SYSTEM = "system"
    private const val BASE = "https://github.com/google/fonts/raw/main/ofl/"
    val CHOICES = listOf(
        Choice("biz-ud", "BIZ UDPゴシック", "読みやすさを重視した UD 書体(約 9MB)", "bizudpgothic/BIZUDPGothic-Regular.ttf", "bizudpgothic/BIZUDPGothic-Bold.ttf"),
        Choice("zen-maru", "Zen 丸ゴシック", "角の丸いやわらかい字(約 8MB)", "zenmarugothic/ZenMaruGothic-Regular.ttf", "zenmarugothic/ZenMaruGothic-Bold.ttf"),
        Choice("m-plus-1p", "M PLUS 1p", "すっきりした細身の字(約 4MB)", "mplus1p/MPLUS1p-Regular.ttf", "mplus1p/MPLUS1p-Bold.ttf"),
    )

    /** いま使う字(null なら端末の標準) */
    var family by mutableStateOf<FontFamily?>(null)
        private set
    /** 取っているところ(キー)。一度に 1 つだけ */
    var loading by mutableStateOf<String?>(null)
        private set
    /** 取っている字の進み具合(0〜1)。全体の大きさが分からない間は null */
    var progress by mutableStateOf<Float?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    /** 取れなかった字のキー */
    var errorKey by mutableStateOf<String?>(null)
        private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var job: Job? = null
    @Volatile private var call: Call? = null
    private val client by lazy { OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build() }

    private fun dir(context: Context) = File(context.filesDir, "fonts").apply { mkdirs() }
    private fun fileOf(context: Context, path: String) = File(dir(context), path.substringAfterLast('/'))

    fun isDownloaded(context: Context, key: String) =
        CHOICES.firstOrNull { it.key == key }?.let { c -> fileOf(context, c.regular).exists() && fileOf(context, c.bold).exists() } == true

    /**
     * 字を選んだとき。手元にある字(と端末の標準)はすぐ onReady に渡す。ない字は取り終えてから渡す(それまで今の字のまま)。
     * 取っている字をもう一度選ぶと取り消し、別の字を選ぶと取っている分をやめて選び直す
     */
    fun pick(context: Context, key: String, onReady: (String) -> Unit) {
        val again = loading == key
        cancel()
        error = null
        errorKey = null
        if (again) return
        if (key == SYSTEM || isDownloaded(context, key)) onReady(key) else download(context, key, onReady)
    }

    /** 取っている字をやめる */
    fun cancel() {
        job?.cancel()
        call?.cancel()
        job = null
        loading = null
        progress = null
    }

    /** 設定の字を使う。設定にあるのに手元にない字(バックアップから戻したときなど)は、取るまで端末の標準 */
    fun apply(context: Context, key: String) {
        val c = CHOICES.firstOrNull { it.key == key }
        if (c == null) { family = null; return }
        if (isDownloaded(context, key)) { family = load(context, c); return }
        family = null
        if (loading != key) { cancel(); download(context, key) { family = load(context, c) } }
    }

    private fun load(context: Context, c: Choice) =
        runCatching { FontFamily(Font(fileOf(context, c.regular), FontWeight.Normal), Font(fileOf(context, c.bold), FontWeight.Bold)) }.getOrNull()

    private fun download(context: Context, key: String, onReady: (String) -> Unit) {
        val c = CHOICES.first { it.key == key }
        loading = key
        progress = 0f
        job = scope.launch {
            try {
                val paths = listOf(c.regular, c.bold)
                paths.forEachIndexed { i, path ->
                    val f = fileOf(context, path)
                    if (!f.exists()) fetch(BASE + path, f) { part -> progress = part?.let { (i + it) / paths.size } }
                    progress = (i + 1f) / paths.size
                }
                loading = null
                progress = null
                onReady(key)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // 取り消しで切ったときは、すぐ下の isActive で知らせない
                if (isActive) {
                    error = "字を取れませんでした: ${reason(e)}"
                    errorKey = key
                    loading = null
                    progress = null
                }
            }
        }
    }

    private fun reason(e: Exception) = when (e) {
        is java.net.UnknownHostException, is java.net.ConnectException -> "つながりませんでした"
        is java.net.SocketTimeoutException -> "時間切れ(止まったまま進まなかった)"
        else -> e.message ?: e.toString()
    }

    /** 1 つのファイルを取る。途中で切れたファイルを残さないよう、書き終えてから名前を付ける */
    private suspend fun fetch(url: String, to: File, onProgress: suspend (Float?) -> Unit) = withContext(Dispatchers.IO) {
        val tmp = File(to.parentFile, "${to.name}.${System.nanoTime()}.part")
        try {
            // 全体の大きさが分かるように、圧縮しないで受け取る
            val c = client.newCall(Request.Builder().url(url).header("Accept-Encoding", "identity").build())
            call = c
            c.execute().use { res ->
                if (!res.isSuccessful) throw IllegalStateException("HTTP ${res.code}")
                val body = res.body ?: throw IllegalStateException("中身がありません")
                val total = body.contentLength()
                var read = 0L
                var shown = 0L
                body.byteStream().use { input ->
                    tmp.outputStream().use { output ->
                        val buf = ByteArray(32 * 1024)
                        while (true) {
                            ensureActive()
                            val n = input.read(buf)
                            if (n < 0) break
                            output.write(buf, 0, n)
                            read += n
                            val now = System.currentTimeMillis()
                            if (now - shown > 100) {
                                shown = now
                                withContext(Dispatchers.Main) { onProgress(if (total > 0) (read.toFloat() / total).coerceIn(0f, 1f) else null) }
                            }
                        }
                    }
                }
                if (read < 100_000) throw IllegalStateException("中身が足りません")
            }
            if (!tmp.renameTo(to)) throw IllegalStateException("置けませんでした")
        } finally {
            tmp.delete()
        }
    }

    /** 取った字を消す(使っていないもの。取っている途中の字は残す) */
    fun deleteUnused(context: Context, keep: String) {
        for (c in CHOICES) if (c.key != keep && c.key != loading) listOf(c.regular, c.bold).forEach { fileOf(context, it).delete() }
    }
}
