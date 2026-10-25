package io.github.yumekui8.bbsnative.bbs

// レスの下ごしらえ。アンカー(>>番号)・画像・動画・リンクを見つけ、人気(アンカーの数)と ID の数を数える。
// 画面とは別のスレッド(Dispatchers.Default)で、レスが届いたときに 1 回だけ作る。絞り込みはこの結果を見るだけなので軽い

/** 本文の中の、押せるところ(アンカー・URL)。start・end は本文の中の位置 */
sealed class Span(val start: Int, val end: Int) {
    class Anchor(start: Int, end: Int, val from: Int, val to: Int) : Span(start, end)
    class Url(start: Int, end: Int, val url: String) : Span(start, end)
}

enum class Filter(val label: String) { POPULAR("人気"), IMAGE("画像"), VIDEO("動画"), LINK("リンク"), OWN("自分") }

class PostInfo(val spans: List<Span>, val image: Boolean, val video: Boolean, val link: Boolean)

class PostIndex(
    val posts: List<Post>,
    val info: Map<Int, PostInfo>,
    /** そのレスに付いたアンカーの数(返信の数) */
    val replyCount: Map<Int, Int>,
    /** そのレスに返信したレスの番号 */
    val replies: Map<Int, List<Int>>,
    val idCount: Map<String, Int>,
) {
    /** own: 自分の書き込みのレス番号(「自分」の絞り込み) */
    fun matches(p: Post, f: Filter, own: Set<Int> = emptySet()): Boolean {
        val i = info[p.no] ?: return false
        return when (f) {
            Filter.OWN -> p.no in own
            Filter.POPULAR -> (replyCount[p.no] ?: 0) >= 3
            Filter.IMAGE -> i.image
            Filter.VIDEO -> i.video
            Filter.LINK -> i.link
        }
    }

    fun count(f: Filter, own: Set<Int> = emptySet()): Int = posts.count { matches(it, f, own) }

    companion object {
        private val ANCHOR = Regex("(?:>>|＞＞|>|＞)(\\d{1,4})(?:[-ー－](\\d{1,4}))?")
        private val URL = Regex("(?:h?ttps?)://[\\w\\-.~:/?#\\[\\]@!$&'()*+,;=%]+")
        private val IMAGE = Regex("\\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)", RegexOption.IGNORE_CASE)
        private val VIDEO = Regex("(?:youtube\\.com/(?:watch|shorts|live)|youtu\\.be/|\\.(?:mp4|webm|mov)(?:[?#]|$))", RegexOption.IGNORE_CASE)

        fun build(posts: List<Post>): PostIndex {
            val info = HashMap<Int, PostInfo>(posts.size * 2)
            val replyCount = HashMap<Int, Int>()
            val replies = HashMap<Int, MutableList<Int>>()
            val idCount = HashMap<String, Int>()
            for (p in posts) {
                val spans = ArrayList<Span>()
                var image = false
                var video = false
                var link = false
                for (m in URL.findAll(p.body)) {
                    val raw = m.value
                    val url = if (raw.startsWith("ttp")) "h$raw" else raw
                    spans += Span.Url(m.range.first, m.range.last + 1, url)
                    when {
                        IMAGE.containsMatchIn(url) -> image = true
                        VIDEO.containsMatchIn(url) -> video = true
                        else -> link = true
                    }
                }
                val targets = HashSet<Int>()
                for (m in ANCHOR.findAll(p.body)) {
                    if (spans.any { it is Span.Url && m.range.first in it.start until it.end }) continue
                    val from = m.groupValues[1].toInt()
                    val to = m.groupValues[2].toIntOrNull()?.coerceAtMost(from + 50) ?: from
                    spans += Span.Anchor(m.range.first, m.range.last + 1, from, maxOf(from, to))
                    for (n in from..maxOf(from, to)) if (n != p.no && n < p.no) targets += n
                }
                for (n in targets) {
                    replyCount[n] = (replyCount[n] ?: 0) + 1
                    replies.getOrPut(n) { ArrayList() } += p.no
                }
                spans.sortBy { it.start }
                info[p.no] = PostInfo(spans, image, video, link)
                p.id?.let { idCount[it] = (idCount[it] ?: 0) + 1 }
            }
            return PostIndex(posts, info, replyCount, replies, idCount)
        }
    }
}
