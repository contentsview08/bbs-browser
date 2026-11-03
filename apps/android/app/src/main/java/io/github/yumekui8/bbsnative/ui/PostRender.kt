package io.github.yumekui8.bbsnative.ui

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.LinkInteractionListener
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.bbs.Post
import io.github.yumekui8.bbsnative.bbs.PostIndex
import io.github.yumekui8.bbsnative.bbs.Span

/** 組み立て済みのレス(頭の行と本文)。スクロール中は、これを Text に渡すだけにする */
/** aa: アスキーアートらしい本文(スペースが 5 つ以上続く。今のスマホ版と同じ判定)。AA 用の字で、折り返さず画面の幅に収める */
/** replyTo: Discord 風・LINE 風で、本文の頭のアンカーを「返信」として頭の上に出すときの返信先(その分は本文から省いてある) */
class RenderedPost(val header: AnnotatedString, val body: AnnotatedString, val aa: Boolean = false, val replyTo: Int? = null, val beIcon: String? = null)

/** 本文の頭の 1 つだけのアンカー(PC 版の dropLeadingAnchor と同じ形)。範囲や並び(>>1-3、>>1,2)は対象にしない */
private val LEADING_ANCHOR = Regex("^(?:[ \t　]*\n)*[ \t　]*(?:>>|＞＞)([0-9０-９]+)(?![0-9０-９,，\\-－ー〜~、])[ \t　]*")
private val BLANK_AFTER = Regex("^\n(?:[ \t　]*\n)*")

/** 「2026/10/26(月) 07:37:30.214」→「10/26 07:37」(Discord 風・LINE 風の頭を短く) */
// 日付の読み取り(何度も呼ぶので、作っておいて使い回す)
private val DATE_TIME = Regex("(\\d{4})/(\\d{1,2})/(\\d{1,2})[^\\d]*(\\d{1,2}):(\\d{2})")
private val DATE_DAY = Regex("(\\d{4})/(\\d{1,2})/(\\d{1,2})(\\([^)]*\\))?")
private val minutesCache = java.util.concurrent.ConcurrentHashMap<String, Long>()

/** 年・月・日・曜日・時・分・秒(・秒の下の桁)を読む(2026/11/02(月) 19:01:15.960)。曜日と秒はないこともある */
private val DATE_PARTS = Regex("(\\d{4})/(\\d{1,2})/(\\d{1,2})\\s*(?:\\(([^)]*)\\))?\\s*(\\d{1,2}):(\\d{2})(?::(\\d{2}))?")

/**
 * レスの頭の日時(設定「日時の出し方」)。スマホでは頭を短くしたいので、既定は年と秒の下の桁を省く:
 * md_w_hms = 11/02(月) 19:01:15 / md_hm = 11/02 19:01 / full = 掲示板が出したまま(2026/11/02(月) 19:01:15.960)。読めない形はそのまま
 */
fun displayDate(date: String, style: String): String {
    if (style == "full") return date
    val m = DATE_PARTS.find(date) ?: return date
    val (_, mo, d, w, h, mi, s) = m.destructured
    val md = "${mo.padStart(2, '0')}/${d.padStart(2, '0')}"
    val rest = date.substring(m.range.last + 1).replace(Regex("^[.,]\\d+"), "").trim()
    val out = if (style == "md_hm") "$md ${h.padStart(2, '0')}:$mi" else "$md${if (w.isNotEmpty()) "($w)" else ""} ${h.padStart(2, '0')}:$mi${if (s.isNotEmpty()) ":$s" else ""}"
    // 日時の後ろに付く印(BE の番号など)は残す
    return if (rest.isNotEmpty()) "$out $rest" else out
}

/** 頭に出す ID(設定「ID を短く出す」がオンなら先頭の 6 文字だけで、「ID:」も省く。数えるのと色は ID 全体で決める) */
fun displayId(id: String, short: Boolean): String = if (short) id.take(6) else "ID:$id"

fun shortDate(date: String): String =
    DATE_TIME.find(date)?.let { m -> "${m.groupValues[2]}/${m.groupValues[3]} ${m.groupValues[4]}:${m.groupValues[5]}" } ?: date

/** 日付の文字列(2026/10/31(金) 01:23:45.67)を分単位の通し番号にする。読めなければ null(日付の差を出すためだけに使う) */
fun postMinutes(date: String): Long? {
    minutesCache[date]?.let { return if (it == Long.MIN_VALUE) null else it }
    val v = DATE_TIME.find(date)?.let { m ->
        val (y, mo, d, h, mi) = m.destructured
        runCatching { java.time.LocalDateTime.of(y.toInt(), mo.toInt(), d.toInt(), h.toInt(), mi.toInt()).toEpochSecond(java.time.ZoneOffset.UTC) / 60 }.getOrNull()
    }
    if (minutesCache.size > 20000) minutesCache.clear()
    minutesCache[date] = v ?: Long.MIN_VALUE
    return v
}


private val AA = Regex("[ \t　]{5,}")

/**
 * レスの中の押せるところ(番号・ID・アンカー)を押したときに呼ぶ先。組み立てた文字列は使い回すので、
 * 押したときの動きは、ここに入れた関数を差し替えて変える。tag は「a:から-まで」「r:番号」「i:ID」「u:URL」
 */
class PostLinks : LinkInteractionListener {
    var onTag: (String) -> Unit = {}
    override fun onClick(link: LinkAnnotation) {
        (link as? LinkAnnotation.Clickable)?.let { onTag(it.tag) }
    }
}

private val plain = TextLinkStyles(null)

/** レスの見た目のうち、会話の形(アイコン・短い頭・返信先の 1 行)にするもの */
fun isChatStyle(style: String) = style == "discord" || style == "line"

/** 選べるレスの見た目(キーと名前) */
val POST_STYLES = listOf(
    "card" to "カード", "classic" to "専ブラ風(詰めて)", "matome" to "まとめ風(人気を大きく)",
    "discord" to "Discord 風", "line" to "LINE 風",
)

/** ID の字の色: ID ごとの色(設定がオンで 2 回以上書いた ID)か、薄い字 */
private fun idC(id: String, count: Int, o: RenderOptions) =
    if (o.idColor && count >= 2) Palette.idColor(id, sky = o.onSky) else mutedC(o)

/** レスの組み立て方の設定(設定画面の「スレ表示」。変えたら組み立て直す) */
data class RenderOptions(
    val noname: String? = null,
    /** 板の既定の名前のほかに、名無しとみなす名前(板ごとの設定) */
    val extraNonames: List<String> = emptyList(),
    val highlightOp: Boolean = true,
    val idHeat: Boolean = true,
    /** 2 回以上書いた ID に、ID ごとの色を付ける(同じ人の書き込みを目で追えるように) */
    val idColor: Boolean = false,
    val urlShorten: Boolean = true,
    val imageUrlOmit: Boolean = true,
    val imageUrlCollapse: Boolean = true,
    val aaAutoDetect: Boolean = true,
    /** 人気のレスの本文に色を付ける(人気のレスの示し方が「本文の色」のとき) */
    val heatText: Boolean = false,
    /** 頭の字(名前・日付・ID)を白っぽくする(空色の地の上で読めるように) */
    val onSky: Boolean = false,
    /** レスの見た目: card / discord / line */
    val style: String = "card",
    /** 日時の出し方(displayDate) */
    val dateStyle: String = "md_w_hms",
    /** ID を短く出す(displayId) */
    val idShort: Boolean = true,
)

/**
 * 全部のレスを組み立てる。レスが届いたときに、画面とは別のスレッド(Dispatchers.Default)で 1 回だけ呼ぶ。
 * 1 レスの部品を「頭の行の Text 1 つ・本文の Text 1 つ」にし、スクロールで出てきたときの組み立てを軽くする
 */
fun renderPosts(index: PostIndex, links: PostLinks, o: RenderOptions = RenderOptions()): Map<Int, RenderedPost> {
    val out = HashMap<Int, RenderedPost>(index.posts.size * 2)
    val noname = o.noname
    // 色は組み立てるときの配色で決める(配色を変えたら組み立て直す)
    val linkStyle = TextLinkStyles(SpanStyle(color = Palette.link))
    val imageChip = SpanStyle(color = Palette.markImage, background = Palette.surface2, fontSize = 13.sp)
    // スレ主: >>1 と同じ ID
    val opId = index.posts.firstOrNull()?.id
    for (p in index.posts) {
        val replies = index.replyCount[p.no] ?: 0
        val idCount = p.id?.let { index.idCount[it] } ?: 0
        val replyHeat = Palette.heat(replies)
        val name = displayName(p.name, noname, o.extraNonames)
        val isOp = o.highlightOp && opId != null && p.id == opId
        val header = if (isChatStyle(o.style)) compactHeader(p, name, replies, idCount, isOp, o, links) else buildAnnotatedString {
            // 番号(返信の数): 返信が多いほど暖色。返信があれば押すと返信を出す
            val noStyle = SpanStyle(color = replyHeat ?: mutedC(o), fontWeight = FontWeight.Bold, fontSize = 13.sp)
            val noText = if (replies > 0) "${p.no} ($replies)" else "${p.no}"
            if (replies > 0) withLink(LinkAnnotation.Clickable("r:${p.no}", plain, links)) { withStyle(noStyle) { append(noText) } }
            else withStyle(noStyle) { append(noText) }
            append("  ")
            // 名前: 板の既定の名前(名無し)は省く(後ろのワッチョイなどは残す)。押すと同じ名前のレスを出す
            if (name.isNotEmpty()) withLink(LinkAnnotation.Clickable("n:${p.no}", plain, links)) { withStyle(SpanStyle(color = nameC(o), fontWeight = FontWeight.Bold)) { append(name) } }
            if (p.mail.isNotEmpty()) withStyle(SpanStyle(color = mutedC(o))) { append("  [${p.mail}]") }
            if (isOp) {
                append("  ")
                appendInlineContent("op", "[主]")
            }
            append("  ")
            // 日付の途中で折り返さない(日と時刻の間の空白を、折り返さない空白に)
            withStyle(SpanStyle(color = mutedC(o))) { append(displayDate(p.date, o.dateStyle).replace(' ', '\u00A0')) }
            if (p.id != null) {
                append("  ")
                // 書き込みの多い ID は暖色。押すと同じ ID のレスを出す
                val heat = if (o.idHeat) Palette.heat(idCount) else null
                withLink(LinkAnnotation.Clickable("i:${p.id}", plain, links)) {
                    withStyle(SpanStyle(color = heat ?: idC(p.id, idCount, o), fontFamily = FontFamily.Monospace, fontWeight = if (idCount >= 5) FontWeight.Bold else FontWeight.Normal)) {
                        append(displayId(p.id, o.idShort))
                        if (idCount >= 2) append("($idCount)")
                    }
                }
            }
        }
        // 人気のレス(返信 3 件から)は、本文を暖色に(5 件から太字)
        // 人気のレスは本文の色を変えず、レスの左の線と淡い地で示す(PostItem の heat)。本文は読みやすい色のまま
        val bodyStyle: SpanStyle? = if (o.heatText) replyHeat?.let { SpanStyle(color = it, fontWeight = if (replies >= 5) FontWeight.Bold else FontWeight.Normal) } else null
        val info = index.info[p.no]
        val full = info?.display ?: p.body
        // Discord 風・LINE 風: 頭のアンカーを返信として外に出し、本文からは省く(その分だけ押せるところの位置をずらす)
        var skip = 0
        var replyTo: Int? = null
        if (isChatStyle(o.style)) LEADING_ANCHOR.find(full)?.let { m ->
            val n = m.groupValues[1].map { if (it in '０'..'９') '0' + (it - '０') else it }.joinToString("").toIntOrNull()
            if (n != null && n < p.no && n >= 1) {
                replyTo = n
                skip = m.range.last + 1
                // アンカーだけの行なら、その行と続く空行も省く
                BLANK_AFTER.find(full.substring(skip))?.let { skip += it.value.length }
            }
        }
        val body = buildAnnotatedString {
            if (bodyStyle != null) pushStyle(bodyStyle)
            val src = full
            val spans = info?.spans ?: emptyList()
            var at = skip
            var i = 0
            while (i < spans.size) {
                val s = spans[i]
                if (s.start < at || s.start < skip) { i++; continue }
                append(src, at, s.start)
                val text = src.substring(s.start, s.end)
                when {
                    s is Span.Anchor -> { withLink(LinkAnnotation.Clickable("a:${s.from}-${s.to}", linkStyle, links)) { append(text) }; at = s.end }
                    // 画像の URL は「画像」の札に。空白だけを挟んで続いたものは「画像 ×3」にまとめる(PC 版と同じ)
                    s is Span.Url && isImageUrl(s.url) && (o.imageUrlOmit || o.imageUrlCollapse) -> {
                        var end = s.end
                        var n = 1
                        while (o.imageUrlCollapse && i + 1 < spans.size) {
                            val next = spans[i + 1]
                            if (next !is Span.Url || !isImageUrl(next.url) || src.substring(end, next.start).isNotBlank()) break
                            end = next.end; n++; i++
                        }
                        if (o.imageUrlOmit) withLink(LinkAnnotation.Clickable("u:${s.url}", plain, links)) {
                            withStyle(imageChip) { append("\u00A0▣\u00A0画像" + (if (n > 1) "\u00A0×$n" else "") + "\u00A0") }
                        }
                        // 札にしないときは、最初の URL に「ほか n 件」を添える
                        else withLink(LinkAnnotation.Clickable("u:${s.url}", linkStyle, links)) {
                            append(if (o.urlShorten) shortUrl(s.url) else s.url)
                            if (n > 1) append(" ほか ${n - 1} 件")
                        }
                        at = end
                    }
                    // URL は https:// を外し、長いものは後ろを省く。押したときに画面が決める(同じ掲示板のスレならアプリの中で開く)
                    s is Span.Url -> { withLink(LinkAnnotation.Clickable("u:${s.url}", linkStyle, links)) { append(if (o.urlShorten) shortUrl(s.url) else text) }; at = s.end }
                }
                i++
            }
            append(src, at, src.length)
            if (bodyStyle != null) pop()
        }
        out[p.no] = RenderedPost(header, body, o.aaAutoDetect && AA.containsMatchIn(p.body), replyTo, info?.beIcon)
    }
    return out
}

private val IMAGE_URL = Regex("\\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)", RegexOption.IGNORE_CASE)
private fun isImageUrl(url: String) = IMAGE_URL.containsMatchIn(url)

/** 見せる URL(PC 版の shortUrl と同じ): https:// と www. を外し、36 文字を超えたら後ろを省く */
fun shortUrl(url: String, max: Int = 36): String {
    val s = url.replace(Regex("^h?ttps?://", RegexOption.IGNORE_CASE), "").replace(Regex("^www\\.", RegexOption.IGNORE_CASE), "")
    return if (s.length > max) s.take(max - 1) + "…" else s
}

/**
 * Discord 風・LINE 風の頭(PC 版の discord の headerBlock と同じ並び): 名前を大きめに、主・#番号・短い日付・ID・返信の数を小さく横に
 */
private fun compactHeader(p: io.github.yumekui8.bbsnative.bbs.Post, name: String, replies: Int, idCount: Int, isOp: Boolean, o: RenderOptions, links: PostLinks): AnnotatedString =
    buildAnnotatedString {
        val small = SpanStyle(color = mutedC(o), fontSize = 11.sp)
        withLink(LinkAnnotation.Clickable("n:${p.no}", plain, links)) {
            withStyle(SpanStyle(color = nameC(o), fontWeight = FontWeight.Bold, fontSize = 13.sp)) { append(name.ifEmpty { "名無し" }) }
        }
        if (isOp) {
            append(" ")
            appendInlineContent("op", "[主]")
        }
        append("  ")
        withStyle(small) { append("#${p.no}") }
        append("  ")
        withStyle(small) { append(shortDate(p.date).replace(' ', '\u00A0')) }
        if (p.id != null) {
            append("  ")
            val heat = if (o.idHeat) Palette.heat(idCount) else null
            withLink(LinkAnnotation.Clickable("i:${p.id}", plain, links)) {
                withStyle(SpanStyle(color = heat ?: idC(p.id, idCount, o), fontSize = 11.sp, fontFamily = FontFamily.Monospace)) {
                    append(displayId(p.id, o.idShort))
                    if (idCount >= 2) append("($idCount)")
                }
            }
        }
        if (replies > 0) {
            append("  ")
            withLink(LinkAnnotation.Clickable("r:${p.no}", plain, links)) {
                // 吹き出しの印と数だけ(返信が多いほど数を暖色に)
                appendInlineContent("reply", "[返信]")
                withStyle(SpanStyle(color = Palette.heat(replies) ?: if (o.onSky) Palette.skyText else Palette.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)) { append("\u2009$replies") }
            }
        }
        if (p.mail.isNotEmpty()) { append("  "); withStyle(small) { append("[${p.mail}]") } }
    }

/** 頭の字の色(空色の地の上では白っぽく) */
private fun mutedC(o: RenderOptions) = if (o.onSky) Palette.skyMuted else Palette.textMuted
private fun nameC(o: RenderOptions) = if (o.onSky) Palette.skyText else Palette.posterName

/**
 * 名前の見せ方: 板の既定の名前(と、名無しとみなす名前)で始まるなら、その部分を省く(後ろのトリップなどは残す)。
 * 長い名前から当てる(「名無しさん」と「名無しさん@実況」のように、片方がもう片方の頭のとき)。PC 版の utils/postBody.tsx の displayName と同じ
 */
/** 名前の、トリップ・キャップ(◆・★・◇ から後ろ)を除いた頭の部分 */
fun nameHead(name: String): String = name.split('◆', '★', '◇')[0].trim()

/**
 * スレで一番多い名前(名無し)。トリップ・キャップを除いた頭で数え、10 件以上のスレでレスの 3 割以上を占めるときだけ。なければ null
 * (PC・Web の utils/postBody の mostCommonName と同じ決まり)
 */
fun mostCommonName(posts: List<Post>): String? {
    if (posts.size < 10) return null
    val counts = HashMap<String, Int>()
    for (p in posts) {
        val h = nameHead(p.name)
        if (h.isNotEmpty()) counts[h] = (counts[h] ?: 0) + 1
    }
    val best = counts.maxByOrNull { it.value } ?: return null
    return if (best.value >= posts.size * 0.3) best.key else null
}

fun displayName(name: String, noname: String?, extra: List<String>): String {
    if (noname == null && extra.isEmpty()) return name
    val hit = (listOfNotNull(noname) + extra).filter { it.isNotEmpty() }.sortedByDescending { it.length }.firstOrNull { name.startsWith(it) }
    return if (hit != null) name.substring(hit.length).trim() else name
}
