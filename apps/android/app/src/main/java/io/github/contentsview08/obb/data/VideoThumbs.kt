package io.github.contentsview08.obb.data

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaDataSource
import android.media.MediaMetadataRetriever
import android.os.Build
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
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
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * 動画のファイル(mp4 など)のサムネイル。PC 版の <video preload="metadata"> と同じく、最初のコマに要る所だけを Range で読んで 1 コマ取り出す。
 * 本体は押すまで取りに行かない。取り出したコマは小さな JPEG にして置いておく(次からは通信しない)
 */
object VideoThumbs {
    sealed interface State {
        data object Loading : State
        data class Done(val file: File) : State
        /** 取れなかった(Range に応じない・形式を読めない・大きすぎる)。「動画」の札だけ出す */
        data object Failed : State
    }

    private val states = java.util.concurrent.ConcurrentHashMap<String, MutableState<State?>>()
    private fun cell(url: String): MutableState<State?> = states.getOrPut(url) { mutableStateOf(null) }
    fun stateOf(url: String): State? = cell(url).value

    private lateinit var dir: File
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    // 動画を解く処理は重いので、同時に 2 本まで
    private val slots = Semaphore(2)
    private const val MAX_DIR_BYTES = 20L * 1024 * 1024
    /** サムネイルの長い辺(px)。サムネイルの枠は 100dp 前後なので、これで足りる */
    private const val FRAME_PX = 320

    private val client by lazy {
        // ImageStore と同じ決まり: リダイレクトは自分でたどり、行き先ごとに isAutoLoadable を確かめる
        OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).callTimeout(1, TimeUnit.MINUTES)
            .followRedirects(false).followSslRedirects(false).addInterceptor(HttpsFirst).build()
    }

    fun init(context: Context) {
        if (::dir.isInitialized) return
        dir = File(context.cacheDir, "video-thumbs").apply { mkdirs() }
        scope.launch { trim() }
    }

    private fun fileOf(url: String): File {
        val d = MessageDigest.getInstance("SHA-1").digest(url.toByteArray())
        return File(dir, d.joinToString("") { "%02x".format(it) } + ".jpg")
    }

    fun cached(url: String): File? = if (!::dir.isInitialized) null else fileOf(url).takeIf { it.exists() && it.length() > 0 }

    /** コマを頼む(画面に出たとき)。画面のスレッドから呼ぶ */
    fun request(url: String) {
        if (!::dir.isInitialized) return
        cached(url)?.let { cell(url).value = State.Done(it); return }
        if (stateOf(url) != null) return
        // 家の中のアドレスなどは、押しても動画を解きに行かない(押せば再生側で開く)
        if (!isAutoLoadable(url)) { cell(url).value = State.Failed; return }
        cell(url).value = State.Loading
        scope.launch {
            val file = slots.withPermit { runCatching { extract(url) }.getOrNull() }
            withContext(Dispatchers.Main) { cell(url).value = if (file != null) State.Done(file) else State.Failed }
        }
    }

    private fun extract(url: String): File? {
        val r = MediaMetadataRetriever()
        try {
            RangeSource(client, url).use { src ->
                r.setDataSource(src)
                // 真っ黒なことの多い 0 秒を避ける(PC 版の #t=0.1 と同じ)
                val frame = if (Build.VERSION.SDK_INT >= 27) {
                    r.getScaledFrameAtTime(100_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, FRAME_PX, FRAME_PX)
                } else {
                    r.getFrameAtTime(100_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)?.let { scaleDown(it) }
                } ?: return null
                val out = fileOf(url)
                val part = File(dir, "${out.name}.${System.nanoTime()}.part")
                part.outputStream().use { frame.compress(Bitmap.CompressFormat.JPEG, 80, it) }
                frame.recycle()
                if (!part.renameTo(out)) { part.delete(); return null }
                return out
            }
        } finally {
            runCatching { r.release() }
        }
    }

    private fun scaleDown(b: Bitmap): Bitmap {
        val scale = FRAME_PX.toFloat() / maxOf(b.width, b.height)
        if (scale >= 1f) return b
        val s = Bitmap.createScaledBitmap(b, maxOf(1, (b.width * scale).toInt()), maxOf(1, (b.height * scale).toInt()), true)
        if (s !== b) b.recycle()
        return s
    }

    private fun trim() {
        dir.listFiles()?.filter { it.name.endsWith(".part") }?.forEach { it.delete() }
        val files = dir.listFiles()?.toList() ?: return
        var size = files.sumOf { it.length() }
        if (size <= MAX_DIR_BYTES) return
        for (f in files.sortedBy { it.lastModified() }) {
            if (size <= MAX_DIR_BYTES * 3 / 4) break
            size -= f.length()
            f.delete()
        }
    }
}

/**
 * 動画を Range で少しずつ読む MediaMetadataRetriever の読み口。読んだ量の合計に上限を置き(通信量)、
 * 手元に置く塊の数も絞る(メモリ)。Range に応じないサーバーは、小さいファイルだけ丸ごと読む
 */
internal class RangeSource(private val client: OkHttpClient, url: String) : MediaDataSource() {
    private var target = url
    private var total = -1L
    private var fetched = 0L
    /** Range に応じないサーバーから丸ごと読んだ中身 */
    private var whole: ByteArray? = null
    private val blocks = object : LinkedHashMap<Long, ByteArray>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, ByteArray>?) = size > MAX_BLOCKS
    }

    init {
        // 頭の塊を取りながらリダイレクトをたどり、行き先と大きさを決める
        val res = openCheckingRedirects(client, url) { u -> rangeRequest(u, 0) } ?: throw IOException("読みに行けない場所へのリダイレクト")
        res.use {
            target = it.request.url.toString()
            val body = it.body ?: throw IOException("中身がありません")
            when (it.code) {
                206 -> {
                    total = contentRangeTotal(it.header("Content-Range")) ?: throw IOException("大きさが分かりません")
                    blocks[0] = readCapped(body.byteStream(), BLOCK.toLong())
                }
                200 -> {
                    if (body.contentLength() > MAX_FETCH) throw IOException("大きすぎます")
                    val all = readCapped(body.byteStream(), MAX_FETCH)
                    whole = all
                    total = all.size.toLong()
                }
                else -> throw IOException("HTTP ${it.code}")
            }
        }
    }

    private fun rangeRequest(u: String, block: Long): Request =
        Request.Builder().url(u).header("Range", "bytes=${block * BLOCK}-${(block + 1) * BLOCK - 1}").header("Accept", "video/*,*/*;q=0.8").build()

    private fun readCapped(input: java.io.InputStream, cap: Long): ByteArray = input.use {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (true) {
            val n = it.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            fetched += n
            if (out.size() > cap || fetched > MAX_FETCH) throw IOException("読む量が多すぎます")
        }
        out.toByteArray()
    }

    private fun blockAt(i: Long): ByteArray {
        blocks[i]?.let { return it }
        client.newCall(rangeRequest(target, i)).execute().use { res ->
            if (res.code != 206) throw IOException("HTTP ${res.code}")
            val b = readCapped(res.body?.byteStream() ?: throw IOException("中身がありません"), BLOCK.toLong())
            blocks[i] = b
            return b
        }
    }

    override fun getSize(): Long = total

    @Synchronized
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (size <= 0) return 0
        if (position >= total) return -1
        whole?.let { all ->
            val n = minOf(size.toLong(), all.size - position).toInt()
            System.arraycopy(all, position.toInt(), buffer, offset, n)
            return n
        }
        val i = position / BLOCK
        val block = blockAt(i)
        val at = (position - i * BLOCK).toInt()
        if (at >= block.size) return -1
        val n = minOf(size, block.size - at)
        System.arraycopy(block, at, buffer, offset, n)
        return n
    }

    @Synchronized
    override fun close() {
        blocks.clear()
        whole = null
    }

    companion object {
        private const val BLOCK = 128 * 1024
        /** 手元に置く塊の数(128 KB × 16 = 2 MB) */
        private const val MAX_BLOCKS = 16
        /** 1 本で読む量の上限。最初のコマに要る所(頭・目次・最初のコマ)はたいていこれに収まる */
        const val MAX_FETCH = 4L * 1024 * 1024
    }
}

/** Content-Range(bytes 0-131071/12345678)の全体の大きさ */
internal fun contentRangeTotal(header: String?): Long? =
    header?.let { Regex("""^bytes\s+\d+-\d+/(\d+)$""", RegexOption.IGNORE_CASE).find(it.trim())?.groupValues?.get(1)?.toLongOrNull() }
