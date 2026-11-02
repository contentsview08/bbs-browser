package io.github.yumekui8.bbsnative.data

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.util.JsonReader
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.yumekui8.bbsnative.bbs.Post
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.nio.LongBuffer
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * AI NG の判定モデル(PC 版・Web と同じ mDeBERTa-v3-base-mnli-xnli の int8)。本人が「AI NG を使う」をオンにしたときだけ、
 * Hugging Face から一度だけ取ってアプリの中(files/ai)に置き、そのあとは通信しない。判定は ONNX Runtime で、画面とは別の 1 本の流れで行う。
 * レスに条件の文を当てた「含意」の確からしさ(含意と矛盾の 2 つで割ったもの)を当たり具合にする(transformers.js の multi_label と同じ)
 */
object AiModel {
    private const val BASE = "https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-mnli-xnli/resolve/main/"
    private val FILES = listOf("onnx/model_quantized.onnx", "tokenizer.json")
    const val SIZE = "約 355MB"

    sealed interface Status {
        data object Off : Status
        data class Loading(val loaded: Long, val total: Long, val what: String) : Status
        data object Ready : Status
        data class Error(val message: String) : Status
    }

    var status by mutableStateOf<Status>(Status.Off)
        private set
    /** 当たり具合が増えるたびに増える数(描き直しのきっかけ) */
    var version by mutableIntStateOf(0)
        private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    /** 判定は 1 本の流れで(ONNX Runtime の中は複数の CPU を使う) */
    private val one = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private var session: OrtSession? = null
    private var tokenizer: AiTokenizer? = null
    private var loadJob: Job? = null

    private val scores = object : LinkedHashMap<String, Float>(1024, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Float>?) = size > 50000
    }
    /** 頼まれて、まだ判定していない組(鍵 → 本文と仮説) */
    private val queue = LinkedHashMap<String, Pair<String, String>>()
    private var pumping: Job? = null

    private fun key(body: String, prompt: String) = bodyKey(body) + "|" + bodyKey(hypothesisOf(prompt))

    fun scoreOf(body: String, prompt: String): Float? = synchronized(scores) { scores[key(body, prompt)] }

    private fun dir(context: Context) = File(context.filesDir, "ai")

    /** モデルを用意する(なければ取る)。使えるようになったら Ready */
    fun start(context: Context) {
        if (status is Status.Ready || loadJob?.isActive == true) return
        val app = context.applicationContext
        loadJob = scope.launch {
            try {
                val d = dir(app).apply { mkdirs() }
                val http = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
                for (f in FILES) {
                    val out = File(d, f.substringAfterLast('/'))
                    if (out.exists() && out.length() > 0) continue
                    val tmp = File(d, out.name + ".part")
                    status = Status.Loading(0, 0, f)
                    http.newCall(Request.Builder().url(BASE + f).build()).execute().use { res ->
                        if (!res.isSuccessful) error("取れませんでした(HTTP ${res.code})")
                        val body = res.body ?: error("中身がありません")
                        val total = body.contentLength()
                        body.byteStream().use { input ->
                            tmp.outputStream().use { o ->
                                val buf = ByteArray(1 shl 16)
                                var done = 0L
                                var last = 0L
                                while (true) {
                                    val n = input.read(buf)
                                    if (n < 0) break
                                    o.write(buf, 0, n)
                                    done += n
                                    if (done - last > (2 shl 20)) { last = done; status = Status.Loading(done, total, f) }
                                }
                            }
                        }
                    }
                    if (!tmp.renameTo(out)) error("置けませんでした")
                }
                status = Status.Loading(0, 0, "用意しています")
                withContext(one) {
                    tokenizer = loadTokenizer(File(d, "tokenizer.json"))
                    val env = OrtEnvironment.getEnvironment()
                    session = env.createSession(File(d, "model_quantized.onnx").absolutePath, OrtSession.SessionOptions().apply { setIntraOpNumThreads(4) })
                }
                status = Status.Ready
                pump()
            } catch (e: Throwable) {
                status = Status.Error(e.message ?: e.toString())
            }
        }
    }

    /** 止める(覚えた当たり具合は残す) */
    fun stop() {
        loadJob?.cancel()
        pumping?.cancel()
        synchronized(queue) { queue.clear() }
        scope.launch(one) {
            session?.close()
            session = null
            tokenizer = null
        }
        status = Status.Off
    }

    /** 取ったファイルを消す */
    fun deleteFiles(context: Context) {
        stop()
        dir(context).deleteRecursively()
    }

    /** レスの当たり具合を頼む(まだのものだけ。新しく頼んだものを先に) */
    fun request(posts: List<Post>, prompts: List<String>) {
        if (prompts.isEmpty()) return
        val fresh = LinkedHashMap<String, Pair<String, String>>()
        for (p in posts) {
            if (aiTextOf(p.body).isEmpty()) continue
            for (pr in prompts) {
                val k = key(p.body, pr)
                if (synchronized(scores) { scores.containsKey(k) }) continue
                fresh[k] = p.body to pr
            }
        }
        if (fresh.isEmpty()) return
        synchronized(queue) {
            val rest = LinkedHashMap(queue)
            queue.clear()
            queue.putAll(fresh)
            for ((k, v) in rest) queue.putIfAbsent(k, v)
        }
        pump()
    }

    private fun pump() {
        if (status !is Status.Ready || pumping?.isActive == true) return
        pumping = scope.launch(one) {
            var n = 0
            while (true) {
                val (k, v) = synchronized(queue) { queue.entries.firstOrNull()?.let { e -> queue.remove(e.key); e.key to e.value } } ?: break
                val s = runCatching { score(aiTextOf(v.first), hypothesisOf(v.second)) }.getOrNull() ?: continue
                synchronized(scores) { scores[k] = s }
                if (++n % 6 == 0) version++
            }
            version++
        }
    }

    /** 1 つの文に 1 つの条件を当てる(試す欄でも使う) */
    suspend fun test(text: String, prompt: String): Float = withContext(one) {
        if (status !is Status.Ready) error("モデルがまだ使えません")
        score(aiTextOf(text), hypothesisOf(prompt))
    }

    private fun score(text: String, hyp: String): Float {
        val s = session ?: error("モデルがありません")
        val ids = tokenizer!!.encodePair(text, hyp)
        val env = OrtEnvironment.getEnvironment()
        val shape = longArrayOf(1, ids.size.toLong())
        OnnxTensor.createTensor(env, LongBuffer.wrap(LongArray(ids.size) { ids[it].toLong() }), shape).use { input ->
            OnnxTensor.createTensor(env, LongBuffer.wrap(LongArray(ids.size) { 1L }), shape).use { mask ->
                s.run(mapOf("input_ids" to input, "attention_mask" to mask)).use { r ->
                    @Suppress("UNCHECKED_CAST")
                    val logits = (r[0].value as Array<FloatArray>)[0]
                    // 0: 含意・2: 矛盾(config の label2id)
                    val e = kotlin.math.exp(logits[0].toDouble())
                    val c = kotlin.math.exp(logits[2].toDouble())
                    return (e / (e + c)).toFloat()
                }
            }
        }
    }

    /** tokenizer.json の model.vocab([字, 点数] の並び)だけを読む(16MB あるので、全部は読み込まずに流して読む) */
    private fun loadTokenizer(file: File): AiTokenizer {
        val pieces = ArrayList<String>(260000)
        val scores = ArrayList<Float>(260000)
        JsonReader(file.bufferedReader()).use { r ->
            r.beginObject()
            while (r.hasNext()) {
                if (r.nextName() != "model") { r.skipValue(); continue }
                r.beginObject()
                while (r.hasNext()) {
                    if (r.nextName() != "vocab") { r.skipValue(); continue }
                    r.beginArray()
                    while (r.hasNext()) {
                        r.beginArray()
                        pieces += r.nextString()
                        scores += r.nextDouble().toFloat()
                        r.endArray()
                    }
                    r.endArray()
                }
                r.endObject()
            }
            r.endObject()
        }
        return AiTokenizer(pieces, scores.toFloatArray())
    }
}
