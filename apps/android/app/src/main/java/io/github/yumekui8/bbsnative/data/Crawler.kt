package io.github.yumekui8.bbsnative.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.github.yumekui8.bbsnative.bbs.Board
import io.github.yumekui8.bbsnative.bbs.HonoBbs
import io.github.yumekui8.bbsnative.bbs.ThreadSummary
import io.github.yumekui8.bbsnative.bbs.TwoCh
import kotlinx.coroutines.delay
import java.util.concurrent.TimeUnit

/**
 * 閲覧履歴(既読のスレ)の定期確認。板ごとにスレ一覧を 1 回だけ読み、いまのレス数を返す(dat は取らない)。
 * OS の通知がオンなら、ついでに知らせる:
 * - お気に入りのスレの新着
 * - あなた宛てのレス(自分が書いたスレに新着があるときだけ、その差分を読む。1 回に MAX_REPLY_FETCH スレまで。保存はしない: 開いたときに取り直す)
 * - キーワードに合うスレ(お気に入り板。そのためにスレ一覧を読む)
 * 初めて見るスレ・板は覚えるだけで知らせない(入れた直後に昔の未読をまとめて知らせないように)
 */
object Crawler {
    private const val MAX_REPLY_FETCH = 5
    private const val MAX_NOTIFY = 3
    private val ANCHOR = Regex("(?:>>|＞＞)\\s*([0-9０-９]+)(?:[-－ー〜~]([0-9０-９]+))?")

    /** スレの id → いまのレス数(-1 は dat 落ち・消えた) */
    suspend fun run(context: Context, db: LogDb, prefs: Prefs): Map<String, Int> {
        val favs = db.favoriteThreads()
        val entries = (favs + db.history()).distinctBy { it.thread.id }
        val counts = HashMap<String, Int>()
        val lists = HashMap<String, List<ThreadSummary>>()
        suspend fun listOf(boardUrl: String): List<ThreadSummary>? =
            lists[boardUrl] ?: runCatching { TwoCh.listThreads(Board(boardUrl, "")) }.getOrNull()?.also { lists[boardUrl] = it }

        // hono-bbs のスレはまとめて 1 回で(POST /threads/status)。返らなかったものは -1(消えた)
        val (hono, others) = entries.partition { HonoBbs.isBoardUrl(it.thread.boardUrl) }
        if (hono.isNotEmpty()) runCatching { HonoBbs.threadStatus(hono.map { it.thread }) }.onSuccess { st ->
            for (e in hono) counts[e.thread.id] = st[e.thread.key]?.first ?: -1
        }
        for ((boardUrl, list) in others.groupBy { it.thread.boardUrl }) {
            val c = (listOf(boardUrl) ?: continue).associate { it.key to it.postCount }
            for (e in list) counts[e.thread.id] = c[e.thread.key] ?: -1
        }
        if (!prefs.osNotify || !Notifier.enabled(context)) return counts

        val seen = context.getSharedPreferences("crawl", Context.MODE_PRIVATE)
        val edit = seen.edit()
        // お気に入りのスレの新着
        if (prefs.notifyFav) {
            val hits = ArrayList<Pair<ThreadSummary, Int>>()
            for (f in favs) {
                val c = counts[f.thread.id] ?: continue
                if (c <= 0) continue
                val key = "f:${f.thread.id}"
                val last = seen.getInt(key, -1)
                if (last >= 0 && c > maxOf(last, f.readNo)) hits += f.thread to c - f.readNo
                edit.putInt(key, c)
            }
            for ((t, n) in hits.take(MAX_NOTIFY)) Notifier.show(context, "お気に入りのスレに新着 +$n", t.title, TwoCh.webUrl(t))
            if (hits.size > MAX_NOTIFY) Notifier.show(context, "お気に入りのスレの新着がほかに ${hits.size - MAX_NOTIFY} スレ", null, null)
        }
        // あなた宛てのレス
        if (prefs.notifyReply) {
            var fetched = 0
            for (t in db.postHistory().map { it.thread }.distinctBy { it.id }) {
                val c = counts[t.id] ?: continue
                if (c <= 0) continue
                val key = "o:${t.id}"
                val last = seen.getInt(key, -1)
                if (last < 0) { edit.putInt(key, c); continue }
                if (c <= last || fetched >= MAX_REPLY_FETCH) continue
                fetched++
                if (fetched > 1) delay(1000) // 続けて取りに行かない
                val own = db.ownPosts(t)
                val log = db.loadThread(t)
                val res = runCatching { TwoCh.fetchPosts(t, log?.cursor) }.getOrNull() ?: continue
                val from = maxOf(last, log?.readNo ?: 0)
                val replies = res.posts.filter { p -> p.no > from && p.no !in own && anchorsOf(p.body).any { it in own } }
                val title = log?.title?.ifEmpty { null } ?: t.title
                for (p in replies.take(MAX_NOTIFY)) Notifier.show(context, "あなた宛てのレス: $title", "${p.no}: ${p.body}", TwoCh.webUrl(t))
                edit.putInt(key, c)
            }
        }
        // キーワードに合うスレ(お気に入り板)
        val keywords = prefs.keywords.lines().map { normalizeForSearch(it.trim()) }.filter { it.isNotEmpty() }
        if (prefs.notifyKeyword && keywords.isNotEmpty()) {
            for (b in db.favorites()) {
                val list = listOf(b.url) ?: continue
                val key = "k:${b.url}"
                val since = seen.getLong(key, -1L)
                val newest = list.mapNotNull { it.createdAt }.maxOrNull() ?: continue
                if (since >= 0) {
                    val hits = list.filter { t -> (t.createdAt ?: 0L) > since && keywords.any { normalizeForSearch(t.title).contains(it) } }
                    for (t in hits.take(MAX_NOTIFY)) Notifier.show(context, "${b.name} にキーワードのスレ", t.title, TwoCh.webUrl(t))
                }
                edit.putLong(key, maxOf(newest, since))
            }
        }
        edit.apply()
        return counts
    }

    private fun anchorsOf(body: String): Set<Int> {
        val out = HashSet<Int>()
        for (m in ANCHOR.findAll(normalizeDigits(body))) {
            val a = m.groupValues[1].toIntOrNull() ?: continue
            val b = m.groupValues[2].toIntOrNull()
            if (b != null && b >= a && b - a < 100) out += a..b else out += a
        }
        return out
    }

    private fun normalizeDigits(s: String) = buildString(s.length) { for (c in s) append(if (c in '０'..'９') '0' + (c - '０') else c) }

    /** 裏の確認を決める: OS の通知がオンで定期確認をしているときだけ。Android の決まりで 15 分より短くはできない(アプリを開いている間は設定の間隔で確かめる) */
    fun schedule(context: Context, prefs: Prefs) {
        val wm = WorkManager.getInstance(context)
        if (!prefs.osNotify || prefs.historyCheckMin <= 0) {
            wm.cancelUniqueWork(WORK)
            return
        }
        val req = PeriodicWorkRequestBuilder<CrawlWorker>(maxOf(15, prefs.historyCheckMin).toLong(), TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, req)
    }

    private const val WORK = "obb_crawl"
}

/** アプリを閉じている間の定期確認(WorkManager。端末の省電力で遅れたり止められたりすることがある) */
class CrawlWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        Http.init(applicationContext)
        return runCatching { Crawler.run(applicationContext, LogDb(applicationContext), Prefs(applicationContext)) }.fold({ Result.success() }, { Result.retry() })
    }
}
