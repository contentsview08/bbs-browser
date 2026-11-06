package io.github.contentsview08.obb.bbs

import io.github.contentsview08.obb.data.normalizeForSearch

// レスの下ごしらえ。本文の解析(PostBody.kt)から、画像・動画・リンクを分け、人気(アンカーの数)と ID の数を数える。
// 画面とは別のスレッド(Dispatchers.Default)で、レスが届いたときに 1 回だけ作る。絞り込みはこの結果を見るだけなので軽い

enum class Filter(val label: String) { POPULAR("人気"), IMAGE("画像"), VIDEO("動画"), LINK("リンク"), OWN("自分") }

/**
 * spans: 本文の中の、押せるところ。images: 本文の画像の URL(サムネイルに出す)。display: 画面に出す本文(続いた空行を 1 つにまとめ、最後の空行を消したもの。
 * spans の位置はこの文字列の中の位置)
 */
class PostInfo(
    val spans: List<BodyToken>, val image: Boolean, val video: Boolean, val link: Boolean, val images: List<String> = emptyList(), val display: String = "",
    /** リンクのカードに出す URL(画像・動画・掲示板のスレ以外) */
    val links: List<String> = emptyList(),
    /** YouTube の動画 ID と元の URL(サムネイルに出す) */
    val youtube: List<Pair<String, String>> = emptyList(),
    /** BE のアイコン(本文の 1 行目の sssp://…。PC 版の splitBeIcon と同じ)。本文からは除いてある */
    val beIcon: String? = null,
)

private val BE_ICON = Regex("^[$WS]*sssp://(([^$WS/]+)/[^$WS]+\\.(?:gif|png|jpe?g|webp))[ \t\u3000]*(?:\n|$)", RegexOption.IGNORE_CASE)

/** BE のアイコンを置いているドメイン。名前だけを許す(ポートや user@ の付いたものは当たらない) */
private val BE_ICON_HOST = Regex("^(?:[a-z0-9-]+\\.)*(?:5ch\\.io|5ch\\.net|2ch\\.net|bbspink\\.com)$", RegexOption.IGNORE_CASE)

/** 本文の 1 行目の BE のアイコン(sssp は https の読み替え)と、その行を除いた本文 */
fun splitBeIcon(body: String): Pair<String?, String> {
    val m = BE_ICON.find(body) ?: return null to body
    // アイコンはレスを出しただけで読みに行くので、本文に書けるだけのほかのホストへは送らない
    if (!BE_ICON_HOST.containsMatchIn(m.groupValues[2])) return null to body
    return "https://${m.groupValues[1]}" to body.substring(m.range.last + 1)
}

private val BLANK_LINES = Regex("\n[ \t\u3000]*(?:\n[ \t\u3000]*){3,}")
private val TRAILING_SPACE = Regex("[$WS]+$")

/** 画面に出す本文(PC 版の displayBody と同じ): 3 つ以上続いた空行を 1 つの空行に、最後の空白を消す */
fun displayBody(body: String): String = body.replace(BLANK_LINES, "\n\n").replace(TRAILING_SPACE, "")

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
    /** 作ったときの設定(build で前の結果を使い回してよいかの判断に使う) */
    private val collapse: Boolean = true,
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
        // まだ書かれていないレスへのアンカーもあるので、スレにあるレスだけをたどる
        val exists = posts.mapTo(HashSet()) { it.no }
        val seen = linkedSetOf(start)
        val queue = ArrayDeque(listOf(start))
        while (queue.isNotEmpty()) {
            val cur = queue.removeFirst()
            for (n in (targets[cur] ?: emptyList()) + (replies[cur] ?: emptyList())) if (n in exists && seen.add(n)) queue += n
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

    /** グロ注意のレス(本文に「グロ」があるレスと、そのアンカー先)。サムネイルをぼかす。言葉の比べ方は検索と同じ(PC 版と同じ) */
    val gross: Set<Int> by lazy {
        val set = HashSet<Int>()
        val words = grossWords.map { normalizeForSearch(it.trim()) }.filter { it.isNotEmpty() }
        if (words.isNotEmpty()) for (p in posts) {
            val text = normalizeForSearch(p.body)
            if (words.any { text.contains(it) }) { set += p.no; set += targets[p.no] ?: emptyList() }
        }
        set
    }

    /** スレの中の画像を、出てきた順に全部(ビューアーで左右に送る) */
    val allImages: List<String> by lazy { posts.flatMap { info[it.no]?.images ?: emptyList() } }
    /** allImages と同じ並びの、その画像が載っていたレス(ビューアーの下の帯に出す) */
    val allImagePosts: List<Post> by lazy { posts.flatMap { p -> (info[p.no]?.images ?: emptyList()).map { p } } }

    companion object {
        /** 1 レスの解析。番号と本文と collapse だけで決まるので、同じなら前の結果を使い回せる */
        private fun infoOf(p: Post, collapse: Boolean): PostInfo {
            var image = false
            var video = false
            var link = false
            val images = ArrayList<String>()
            val links = ArrayList<String>()
            val youtube = ArrayList<Pair<String, String>>()
            val (beIcon, body0) = splitBeIcon(p.body)
            val text = if (collapse) displayBody(body0) else body0
            val spans = bodyTokens(text)
            for (t in spans) if (t is BodyToken.Url) {
                val url = t.url
                val img = toImageUrl(url)
                when {
                    img != null -> {
                        image = true
                        images += img
                    }
                    isVideoFileUrl(url) -> video = true
                    isYoutubeUrl(url) -> {
                        video = true
                        youtubeIdOf(url)?.let { id -> if (youtube.none { it.first == id }) youtube += id to url }
                    }
                    else -> {
                        link = true
                        // 掲示板のスレはアプリの中で開くので、カードにしない
                        if (!UrlRoute.isThreadUrl(url) && url !in links) links += url
                    }
                }
            }
            return PostInfo(spans, image, video, link, images, text, links, youtube, beIcon)
        }

        /**
         * collapse: 続いた空行をまとめる(設定)。grossWords: グロ注意とみなす言葉。
         * previous: 前の結果。番号と本文が同じレスは解析し直さない(新着が 1 件でも全レスを字句解析しないように)
         */
        fun build(posts: List<Post>, collapse: Boolean = true, grossWords: List<String> = listOf("グロ"), previous: PostIndex? = null): PostIndex {
            val info = HashMap<Int, PostInfo>(posts.size * 2)
            val replyCount = HashMap<Int, Int>()
            val replies = HashMap<Int, MutableList<Int>>()
            val idCount = HashMap<String, Int>()
            val reuse = previous?.takeIf { it.collapse == collapse }
            val oldPosts = reuse?.posts?.associateBy { it.no }
            for (p in posts) {
                val i = (if (oldPosts?.get(p.no)?.body == p.body) reuse?.info?.get(p.no) else null) ?: infoOf(p, collapse)
                val targets = HashSet<Int>()
                for (s in i.spans) if (s is BodyToken.Anchor) for (n in s.nos) if (n != p.no) targets += n
                for (n in targets) {
                    replyCount[n] = (replyCount[n] ?: 0) + 1
                    replies.getOrPut(n) { ArrayList() } += p.no
                }
                info[p.no] = i
                p.id?.let { idCount[it] = (idCount[it] ?: 0) + 1 }
            }
            return PostIndex(posts, info, replyCount, replies, idCount, grossWords, collapse)
        }
    }
}
