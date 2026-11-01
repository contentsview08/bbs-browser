package io.github.yumekui8.bbsnative.bbs

// レスの下ごしらえ。アンカー(>>番号)・画像・動画・リンクを見つけ、人気(アンカーの数)と ID の数を数える。
// 画面とは別のスレッド(Dispatchers.Default)で、レスが届いたときに 1 回だけ作る。絞り込みはこの結果を見るだけなので軽い

/** 本文の中の、押せるところ(アンカー・URL)。start・end は本文の中の位置 */
sealed class Span(val start: Int, val end: Int) {
    class Anchor(start: Int, end: Int, val from: Int, val to: Int) : Span(start, end)
    class Url(start: Int, end: Int, val url: String) : Span(start, end)
}

enum class Filter(val label: String) { POPULAR("人気"), IMAGE("画像"), VIDEO("動画"), LINK("リンク"), OWN("自分") }

/**
 * images: 本文の画像の URL(サムネイルに出す)。display: 画面に出す本文(続いた空行を 1 つにまとめ、最後の空行を消したもの。
 * spans の位置はこの文字列の中の位置)
 */
class PostInfo(
    val spans: List<Span>, val image: Boolean, val video: Boolean, val link: Boolean, val images: List<String> = emptyList(), val display: String = "",
    /** リンクのカードに出す URL(画像・動画・掲示板のスレ以外) */
    val links: List<String> = emptyList(),
    /** YouTube の動画 ID と元の URL(サムネイルに出す) */
    val youtube: List<Pair<String, String>> = emptyList(),
    /** BE のアイコン(本文の 1 行目の sssp://…。PC 版の splitBeIcon と同じ)。本文からは除いてある */
    val beIcon: String? = null,
)

private val BE_ICON = Regex("^\\s*sssp://([^\\s/]+/\\S+\\.(?:gif|png|jpe?g|webp))[ \t\u3000]*(?:\n|$)", RegexOption.IGNORE_CASE)

/** 本文の 1 行目の BE のアイコン(sssp は https の読み替え)と、その行を除いた本文 */
fun splitBeIcon(body: String): Pair<String?, String> {
    val m = BE_ICON.find(body) ?: return null to body
    return "https://${m.groupValues[1]}" to body.substring(m.range.last + 1)
}

/** 画面に出す本文(PC 版の displayBody と同じ): 3 つ以上続いた空行を 1 つの空行に、最後の空白を消す */
fun displayBody(body: String): String =
    body.replace(Regex("\n[ \t\u3000]*(?:\n[ \t\u3000]*){3,}"), "\n\n").replace(Regex("[\\s\u3000]+$"), "")

/** アンカーツリーの 1 行 */
/**
 * アンカーツリーの 1 行。rails: 親より上の段ごとに、縦線を下まで続けるか(その段にまだ兄弟が残っているか)。
 * last: 同じ親の最後の子か(最後なら └、まだ兄弟がいれば ├)。PC 版の TreeRow と同じ
 */
class TreeRow(val no: Int, val depth: Int, val alsoTo: List<Int>, val rails: List<Boolean> = emptyList(), val last: Boolean = true)

class PostIndex(
    val posts: List<Post>,
    val info: Map<Int, PostInfo>,
    /** そのレスに付いたアンカーの数(返信の数) */
    val replyCount: Map<Int, Int>,
    /** そのレスに返信したレスの番号 */
    val replies: Map<Int, List<Int>>,
    val idCount: Map<String, Int>,
    private val grossWords: List<String> = listOf("グロ"),
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

    /** そのレスがアンカーを付けた先(replies の逆引き) */
    private val targets: Map<Int, List<Int>> by lazy {
        val m = HashMap<Int, MutableList<Int>>()
        for ((to, froms) in replies) for (f in froms) m.getOrPut(f) { ArrayList() } += to
        m.mapValues { (_, v) -> v.sorted() }
    }

    /** アンカーでつながるレスを、上下どちらへもたどって全部(start を含む。番号順)。PC 版の anchorTree と同じ */
    fun tree(start: Int): List<Int> {
        val seen = linkedSetOf(start)
        val queue = ArrayDeque(listOf(start))
        while (queue.isNotEmpty()) {
            val cur = queue.removeFirst()
            for (n in (targets[cur] ?: emptyList()) + (replies[cur] ?: emptyList())) if (seen.add(n)) queue += n
        }
        return seen.sorted()
    }

    /**
     * ツリーの行に並べる(PC 版の anchorTreeRows と同じ)。親は、ツリーの中でアンカーを付けた先のうち一番小さい番号。
     * alsoTo はほかにアンカーを付けた先(「>>3 にも」と出す)
     */
    fun treeRows(start: Int): List<TreeRow> {
        val nos = tree(start)
        val inTree = nos.toHashSet()
        val parent = HashMap<Int, Int>()
        val alsoTo = HashMap<Int, List<Int>>()
        val children = HashMap<Int, MutableList<Int>>()
        for (no in nos) {
            val t = (targets[no] ?: emptyList()).filter { it in inTree && it < no }
            if (t.isEmpty()) continue
            parent[no] = t[0]
            alsoTo[no] = t.drop(1)
            children.getOrPut(t[0]) { ArrayList() } += no
        }
        val rows = ArrayList<TreeRow>()
        fun walk(no: Int, depth: Int, rails: List<Boolean>, last: Boolean) {
            rows += TreeRow(no, depth, alsoTo[no] ?: emptyList(), rails, last)
            val kids = (children[no] ?: emptyList()).sorted()
            kids.forEachIndexed { i, k -> walk(k, depth + 1, if (depth == 0) emptyList() else rails + !last, i == kids.lastIndex) }
        }
        val roots = nos.filter { it !in parent }
        roots.forEachIndexed { i, r -> walk(r, 0, emptyList(), i == roots.lastIndex) }
        return rows
    }

    /** グロ注意のレス(本文に「グロ」があるレスと、そのアンカー先)。サムネイルをぼかす(PC 版と同じ) */
    val gross: Set<Int> by lazy {
        val set = HashSet<Int>()
        for (p in posts) if (grossWords.any { p.body.contains(it, ignoreCase = true) }) { set += p.no; set += targets[p.no] ?: emptyList() }
        set
    }

    /** スレの中の画像を、出てきた順に全部(ビューアーで左右に送る) */
    val allImages: List<String> by lazy { posts.flatMap { info[it.no]?.images ?: emptyList() } }
    /** allImages と同じ並びの、その画像が載っていたレス(ビューアーの下の帯に出す) */
    val allImagePosts: List<Post> by lazy { posts.flatMap { p -> (info[p.no]?.images ?: emptyList()).map { p } } }

    companion object {
        private val ANCHOR = Regex("(?:>>|＞＞|>|＞)(\\d{1,4})(?:[-ー－](\\d{1,4}))?")
        /**
         * URL。崩した書き方も拾う: h 抜き(ttps://・tps://)、コロンなし(//i.imgur.com/…)、http 抜き(i.imgur.com/a.jpg)。
         * http 抜きは、ふつうの文と取り違えないよう、画像の拡張子で終わるものだけ
         */
        private val URL = Regex(
            "(?:(?<![\\w/])(?:h?t?tps?:)?//|(?<![\\w./@:-])(?=[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+/[\\w\\-.~/%]*\\.(?:jpe?g|png|gif|webp)(?![\\w])))[\\w\\-.~:/?#\\[\\]@!$&'()*+,;=%]+",
            RegexOption.IGNORE_CASE,
        )

        /** 崩した書き方の URL を、開ける形(https://…)に直す。http:// と書いてあるものは http のまま */
        fun normalizeUrl(raw: String): String {
            Regex("^(h?t?tps?:)?//", RegexOption.IGNORE_CASE).find(raw)?.let { m ->
                val rest = raw.substring(m.range.last + 1)
                val scheme = m.groupValues[1].lowercase()
                return (if (scheme.isNotEmpty() && !scheme.contains("s:")) "http://" else "https://") + rest
            }
            return "https://$raw"
        }
        private val IMAGE = Regex("\\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)", RegexOption.IGNORE_CASE)
        private val YOUTUBE_ID = Regex("(?:v=|youtu\\.be/|shorts/|live/)([\\w-]{6,})")
        private val VIDEO = Regex("(?:youtube\\.com/(?:watch|shorts|live)|youtu\\.be/|\\.(?:mp4|webm|mov)(?:[?#]|$))", RegexOption.IGNORE_CASE)

        /** collapse: 続いた空行をまとめる(設定)。grossWords: グロ注意とみなす言葉 */
        fun build(posts: List<Post>, collapse: Boolean = true, grossWords: List<String> = listOf("グロ")): PostIndex {
            val info = HashMap<Int, PostInfo>(posts.size * 2)
            val replyCount = HashMap<Int, Int>()
            val replies = HashMap<Int, MutableList<Int>>()
            val idCount = HashMap<String, Int>()
            for (p in posts) {
                val spans = ArrayList<Span>()
                var image = false
                var video = false
                var link = false
                val images = ArrayList<String>()
                val links = ArrayList<String>()
                val youtube = ArrayList<Pair<String, String>>()
                val (beIcon, body0) = splitBeIcon(p.body)
                val text = if (collapse) displayBody(body0) else body0
                for (m in URL.findAll(text)) {
                    val raw = m.value
                    val url = normalizeUrl(raw)
                    spans += Span.Url(m.range.first, m.range.last + 1, url)
                    when {
                        IMAGE.containsMatchIn(url) -> {
                            image = true
                            images += url
                        }
                        VIDEO.containsMatchIn(url) -> {
                            video = true
                            YOUTUBE_ID.find(url)?.groupValues?.get(1)?.let { id -> if (youtube.none { it.first == id }) youtube += id to url }
                        }
                        else -> {
                            link = true
                            // 掲示板のスレ・板はアプリの中で開くので、カードにしない
                            if (!url.contains("/test/read.cgi/") && url !in links) links += url
                        }
                    }
                }
                val targets = HashSet<Int>()
                for (m in ANCHOR.findAll(text)) {
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
                info[p.no] = PostInfo(spans, image, video, link, images, text, links, youtube, beIcon)
                p.id?.let { idCount[it] = (idCount[it] ?: 0) + 1 }
            }
            return PostIndex(posts, info, replyCount, replies, idCount, grossWords)
        }
    }
}
