package io.github.contentsview08.obb.data

import kotlinx.coroutines.CompletableDeferred
import java.util.concurrent.ConcurrentHashMap

/**
 * 条件付きの取得(PC 版の connectors/conditional.ts にあたる)。前に取った応答の ETag・Last-Modified を覚えておき、
 * 次は If-None-Match・If-Modified-Since を付けて取る。変わっていなければ掲示板は 304 を返すだけで済み
 * (スレ一覧は毎回 100KB 前後。裏の確認の大半がこれ)、こちらは覚えた本文をそのまま使う。
 * 同じ URL を同時に取りに行ったときは、1 本の通信を共有する(裏の確認・引っぱって更新・未読のパネルが重なったとき)
 */
object ConditionalGet {
    private class Entry(val etag: String?, val lastModified: String?, val res: HttpResponse)

    /** 覚える URL の数の上限(お気に入り板・履歴の板の数より十分多い。古いものから捨てる) */
    private const val MAX_ENTRIES = 300
    private val cache = object : LinkedHashMap<String, Entry>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Entry>) = size > MAX_ENTRIES
    }
    private val inflight = ConcurrentHashMap<String, CompletableDeferred<HttpResponse>>()

    /** 試験用: 覚えたものを全部捨てる */
    internal fun reset() {
        synchronized(cache) { cache.clear() }
        inflight.clear()
    }

    /** GET。前の応答に ETag か Last-Modified があれば条件を付け、304 なら前の本文を返す(status は前のまま 200) */
    suspend fun get(url: String): HttpResponse {
        val mine = CompletableDeferred<HttpResponse>()
        val running = inflight.putIfAbsent(url, mine)
        if (running != null) return running.await()
        try {
            val res = fetch(url)
            mine.complete(res)
            return res
        } catch (e: Throwable) {
            mine.completeExceptionally(e)
            throw e
        } finally {
            inflight.remove(url, mine)
        }
    }

    private suspend fun fetch(url: String): HttpResponse {
        val prev = synchronized(cache) { cache[url] }
        val headers = HashMap<String, String>()
        prev?.etag?.let { headers["If-None-Match"] = it }
        prev?.lastModified?.let { headers["If-Modified-Since"] = it }
        val res = Http.get(url, headers)
        if (res.status == 304 && prev != null) return prev.res
        if (res.status in 200..299) {
            val etag = res.headers["etag"]
            val lastModified = res.headers["last-modified"]
            synchronized(cache) {
                if (etag != null || lastModified != null) cache[url] = Entry(etag, lastModified, res) else cache.remove(url)
            }
        }
        return res
    }
}
