package io.github.contentsview08.obb.data

import android.content.Context
import androidx.compose.runtime.mutableStateMapOf
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * 画像のダウンロードと置き場(サムネイル・ビューアー・画像一覧・保存で共通)。
 * - 1 つの URL は 1 回だけ取る(取っている途中に別の画面から頼まれても、同じダウンロードを待つ)
 * - タイムアウト: つながるまで 10 秒、データが 15 秒届かなければ、全体で 3 分を超えたら切って「失敗」にする(押すと取り直す)
 * - 待ち行列: サムネイルは同時に 4 つまで。ビューアーで開いた画像は別の枠(同時に 2 つ)で、サムネイルの順番待ちに並ばない
 * - 進み具合(読んだバイト数 / 全体)を画面に出せるように持つ
 * - 取った画像はアプリのキャッシュのフォルダにファイルで置き、どの画面からも同じファイルを使う(大きくなりすぎたら古い順に消す)
 */
object ImageStore {
    sealed interface State {
        data object Queued : State
        data class Loading(val read: Long, val total: Long) : State
        data class Done(val file: File) : State
        data class Failed(val message: String) : State
    }

    /** URL → 状態。画面はここを読む(書き換えは画面のスレッドで) */
    val states = mutableStateMapOf<String, State>()

    private lateinit var dir: File
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val thumbSlots = Semaphore(4)
    private val viewerSlots = Semaphore(2)
    private val inFlight = HashMap<String, CompletableDeferred<File?>>()
    private const val MAX_BYTES = 300L * 1024 * 1024

    private val client by lazy {
        // タイムアウト: つながるまで 10 秒・データが 15 秒届かなければ切る(止まったまま回り続けないように)・全体で 3 分まで
        OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).callTimeout(3, TimeUnit.MINUTES)
            .followRedirects(true).followSslRedirects(true).build()
    }

    fun init(context: Context) {
        if (::dir.isInitialized) return
        dir = File(context.cacheDir, "images").apply { mkdirs() }
        // 大きくなりすぎていたら、古い順に消す
        scope.launch { trim() }
    }

    private fun fileOf(url: String): File {
        val h = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(dir, h)
    }

    /** もう手元にある画像のファイル(なければ null)。画面を作るときに、読み込み中を出さずに済むように */
    fun cached(url: String): File? = fileOf(url).takeIf { it.exists() && it.length() > 0 }

    /**
     * 画像を頼む(画面に出たとき・押したとき)。手元にあればすぐ Done。viewer = true ならビューアーの枠で取る。
     * 失敗していたら、もう一度取り直す
     */
    fun request(url: String, viewer: Boolean = false) {
        cached(url)?.let { f -> if (states[url] !is State.Done) states[url] = State.Done(f); return }
        val s = states[url]
        if (s is State.Queued || s is State.Loading) return
        states[url] = State.Queued
        start(url, viewer)
    }

    /** ファイルが取れるまで待つ(保存など)。取れなければ例外 */
    suspend fun get(url: String): File {
        cached(url)?.let { return it }
        val d = synchronized(inFlight) { inFlight[url] } ?: run {
            withContext(Dispatchers.Main) { states[url] = State.Queued }
            start(url, viewer = true)
        }
        return d.await() ?: error((states[url] as? State.Failed)?.message ?: "取れませんでした")
    }

    private fun start(url: String, viewer: Boolean): CompletableDeferred<File?> {
        synchronized(inFlight) { inFlight[url]?.let { return it } }
        val d = CompletableDeferred<File?>()
        synchronized(inFlight) { inFlight[url] = d }
        scope.launch {
            val result = (if (viewer) viewerSlots else thumbSlots).withPermit { download(url) }
            synchronized(inFlight) { inFlight.remove(url) }
            d.complete(result)
        }
        return d
    }

    private suspend fun setState(url: String, s: State) = withContext(Dispatchers.Main) { states[url] = s }

    private suspend fun download(url: String): File? {
        val out = fileOf(url)
        val part = File(dir, out.name + ".part")
        return try {
            val req = Request.Builder().url(url).header("Accept", "image/*,*/*;q=0.8").build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) error("HTTP ${res.code}")
                val body = res.body ?: error("中身がありません")
                val total = body.contentLength()
                setState(url, State.Loading(0, total))
                var read = 0L
                var lastShown = 0L
                body.byteStream().use { input ->
                    part.outputStream().use { output ->
                        val buf = ByteArray(32 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            output.write(buf, 0, n)
                            read += n
                            // 進み具合は 0.1 秒ごとに知らせる(細かすぎると画面が重くなる)
                            val now = System.currentTimeMillis()
                            if (now - lastShown > 100) { lastShown = now; setState(url, State.Loading(read, total)) }
                        }
                    }
                }
                if (read == 0L) error("中身がありません")
            }
            if (!part.renameTo(out)) error("置けませんでした")
            setState(url, State.Done(out))
            out
        } catch (e: Exception) {
            part.delete()
            val msg = when (e) {
                is java.net.SocketTimeoutException -> "時間切れ(止まったまま進まなかった)"
                is java.io.InterruptedIOException -> "時間切れ"
                is java.net.UnknownHostException -> "つながりませんでした"
                else -> e.message ?: e.toString()
            }
            setState(url, State.Failed(msg))
            null
        }
    }

    private fun trim() {
        val files = dir.listFiles()?.filter { !it.name.endsWith(".part") } ?: return
        dir.listFiles()?.filter { it.name.endsWith(".part") }?.forEach { it.delete() }
        var size = files.sumOf { it.length() }
        if (size <= MAX_BYTES) return
        for (f in files.sortedBy { it.lastModified() }) {
            if (size <= MAX_BYTES * 3 / 4) break
            size -= f.length()
            f.delete()
        }
    }

    /** 進み具合の見せ方(「320 KB / 1.2 MB」) */
    fun progressText(s: State.Loading): String {
        fun fmt(b: Long) = when {
            b < 1024 -> "$b B"
            b < 1024 * 1024 -> "${b / 1024} KB"
            else -> "%.1f MB".format(b / 1024.0 / 1024.0)
        }
        return if (s.total > 0) "${fmt(s.read)} / ${fmt(s.total)}" else fmt(s.read)
    }
}
