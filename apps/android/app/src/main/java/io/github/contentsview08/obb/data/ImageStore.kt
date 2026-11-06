package io.github.contentsview08.obb.data

import android.content.Context
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
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
import java.util.concurrent.atomic.AtomicBoolean

/** 動いている 1 つの仕事の取り消しを受ける。取り消しは画面のスレッドからも呼ばれるので、待たない処理だけを渡す */
internal class DownloadRun {
    private var action: (() -> Unit)? = null
    @Volatile var canceled = false
        private set

    fun onCancel(f: () -> Unit) {
        synchronized(this) { if (!canceled) { action = f; return } }
        f()
    }

    fun cancel() {
        val f = synchronized(this) { canceled = true; action }
        f?.invoke()
    }
}

/**
 * 1 つの鍵の仕事を 1 回だけ、サムネイルかビューアーの枠で動かす。サムネイルの枠で待っている間にビューアーから頼まれたら、
 * ビューアーの枠にも並べ、先に順番が来たほうが動かす(順番が来ても動かしたあとなら、すぐ枠を返す)
 */
internal class DownloadLanes<T>(private val scope: CoroutineScope, thumbs: Int, viewers: Int) {
    private class Entry<T>(var viewer: Boolean) {
        val result = CompletableDeferred<T>()
        val taken = AtomicBoolean(false)
        val run = DownloadRun()
    }

    private val thumbSlots = Semaphore(thumbs)
    private val viewerSlots = Semaphore(viewers)
    private val entries = HashMap<String, Entry<T>>()

    fun isRunning(key: String) = synchronized(entries) { key in entries }

    fun start(key: String, viewer: Boolean, work: suspend (DownloadRun) -> T): CompletableDeferred<T> = synchronized(entries) {
        val running = entries[key]
        if (running == null) {
            Entry<T>(viewer).also { entries[key] = it; line(key, it, viewer, work) }.result
        } else {
            if (viewer && !running.viewer) { running.viewer = true; line(key, running, true, work) }
            running.result
        }
    }

    /** 待っている・動いている仕事をやめる。待っている人には value を返す。やめる仕事がなければ false */
    fun cancel(key: String, value: T): Boolean {
        val e = synchronized(entries) { entries.remove(key) } ?: return false
        e.taken.set(true)
        e.run.cancel()
        e.result.complete(value)
        return true
    }

    private fun line(key: String, e: Entry<T>, viewer: Boolean, work: suspend (DownloadRun) -> T) {
        scope.launch {
            (if (viewer) viewerSlots else thumbSlots).withPermit {
                if (e.taken.compareAndSet(false, true)) {
                    val r = work(e.run)
                    // 取り消したあとに頼み直された仕事を消さない
                    synchronized(entries) { if (entries[key] === e) entries.remove(key) }
                    e.result.complete(r)
                }
            }
        }
    }
}

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
        /** 長押しで取り消した。押すまで読み直さない */
        data object Canceled : State
    }

    /** URL → 状態(書き換えは画面のスレッドで)。1 枚の進み具合でほかの画像の画面まで組み直さないよう、URL ごとに別の State に持つ */
    private val states = java.util.concurrent.ConcurrentHashMap<String, MutableState<State?>>()
    private fun cell(url: String): MutableState<State?> = states.getOrPut(url) { mutableStateOf(null) }

    /** その URL の状態。画面はここを読む */
    fun stateOf(url: String): State? = cell(url).value

    private lateinit var dir: File
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lanes = DownloadLanes<File?>(scope, thumbs = 4, viewers = 2)
    private const val MAX_BYTES = 300L * 1024 * 1024
    private const val HEX = "0123456789abcdef"

    private val client by lazy {
        // 止まったまま回り続けないように、データが届かないときと全体の時間で切る
        OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).callTimeout(3, TimeUnit.MINUTES)
            .followRedirects(true).followSslRedirects(true).addInterceptor(HttpsFirst).build()
    }

    fun init(context: Context) {
        if (::dir.isInitialized) return
        dir = File(context.cacheDir, "images").apply { mkdirs() }
        scope.launch { trim() }
    }

    /** URL → 置き場のファイル。画面を作るたびに呼ばれるので、ハッシュの計算を覚えておく */
    private val files = object : LinkedHashMap<String, File>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, File>?) = size > 2000
    }

    private fun fileOf(url: String): File = synchronized(files) {
        files.getOrPut(url) {
            val digest = MessageDigest.getInstance("SHA-1").digest(url.toByteArray())
            val hex = CharArray(digest.size * 2)
            digest.forEachIndexed { i, b ->
                hex[i * 2] = HEX[(b.toInt() and 0xff) ushr 4]
                hex[i * 2 + 1] = HEX[b.toInt() and 0x0f]
            }
            File(dir, String(hex))
        }
    }

    /** もう手元にある画像のファイル(なければ null)。画面を作るときに、読み込み中を出さずに済むように */
    fun cached(url: String): File? = fileOf(url).takeIf { it.exists() && it.length() > 0 }

    /**
     * 画像を頼む(画面に出たとき・押したとき)。手元にあればすぐ Done。viewer = true ならビューアーの枠で取る。
     * 失敗していたら、もう一度取り直す。取り消したものは、ビューアーで開くか retry = true(押したとき)でだけ取り直す
     */
    fun request(url: String, viewer: Boolean = false, retry: Boolean = false) {
        cached(url)?.let { f -> if (stateOf(url) !is State.Done) cell(url).value = State.Done(f); return }
        val s = stateOf(url)
        if (s is State.Canceled && !viewer && !retry) return
        if (s is State.Queued || s is State.Loading) {
            // サムネイルの順番待ちをビューアーの枠へ移す
            if (viewer) start(url, viewer = true)
            return
        }
        cell(url).value = State.Queued
        start(url, viewer)
    }

    /** 待っている・取っている画像をやめる。画面のスレッドから呼ぶ */
    fun cancel(url: String) {
        val s = stateOf(url)
        if (s !is State.Queued && s !is State.Loading) return
        cell(url).value = State.Canceled
        lanes.cancel(url, null)
    }

    /** ファイルが取れるまで待つ(保存など)。取れなければ例外 */
    suspend fun get(url: String): File {
        cached(url)?.let { return it }
        if (!lanes.isRunning(url)) withContext(Dispatchers.Main) { cell(url).value = State.Queued }
        return start(url, viewer = true).await() ?: error((stateOf(url) as? State.Failed)?.message ?: "取れませんでした")
    }

    private fun start(url: String, viewer: Boolean): CompletableDeferred<File?> = lanes.start(url, viewer) { run -> download(url, run) }

    private suspend fun download(url: String, run: DownloadRun): File? {
        // 取り消したあとの遅れた知らせで、頼み直した分の状態を上書きしない
        suspend fun setState(s: State) = withContext(Dispatchers.Main) { if (!run.canceled) cell(url).value = s }
        val out = fileOf(url)
        // 取り消した分の後始末と、頼み直した分のファイルが重ならないように、回ごとに別の名前にする
        val part = File(dir, "${out.name}.${System.nanoTime()}.part")
        return try {
            val req = Request.Builder().url(url).header("Accept", "image/*,*/*;q=0.8").build()
            val call = client.newCall(req)
            run.onCancel { call.cancel() }
            call.execute().use { res ->
                if (!res.isSuccessful) error("HTTP ${res.code}")
                val body = res.body ?: error("中身がありません")
                val total = body.contentLength()
                setState(State.Loading(0, total))
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
                            if (now - lastShown > 100) { lastShown = now; setState(State.Loading(read, total)) }
                        }
                    }
                }
                if (read == 0L) error("中身がありません")
            }
            if (run.canceled) { part.delete(); return null }
            if (!part.renameTo(out)) error("置けませんでした")
            setState(State.Done(out))
            out
        } catch (e: Exception) {
            part.delete()
            val msg = when (e) {
                is java.net.SocketTimeoutException -> "時間切れ(止まったまま進まなかった)"
                is java.io.InterruptedIOException -> "時間切れ"
                is java.net.UnknownHostException -> "つながりませんでした"
                else -> e.message ?: e.toString()
            }
            setState(State.Failed(msg))
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
