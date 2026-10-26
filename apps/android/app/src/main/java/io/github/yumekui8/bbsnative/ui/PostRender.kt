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
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.bbs.PostIndex
import io.github.yumekui8.bbsnative.bbs.Span

/** 組み立て済みのレス(頭の行と本文)。スクロール中は、これを Text に渡すだけにする */
/** aa: アスキーアートらしい本文(スペースが 5 つ以上続く。今のスマホ版と同じ判定)。AA 用の字で、折り返さず画面の幅に収める */
class RenderedPost(val header: AnnotatedString, val body: AnnotatedString, val aa: Boolean = false)

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

/** レスの組み立て方の設定(設定画面の「スレ表示」。変えたら組み立て直す) */
data class RenderOptions(
    val noname: String? = null,
    val highlightOp: Boolean = true,
    val idHeat: Boolean = true,
    val urlShorten: Boolean = true,
    val imageUrlOmit: Boolean = true,
    val imageUrlCollapse: Boolean = true,
    val aaAutoDetect: Boolean = true,
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
        val header = buildAnnotatedString {
            // 番号(返信の数): 返信が多いほど暖色。返信があれば押すと返信を出す
            val noStyle = SpanStyle(color = replyHeat ?: Palette.textMuted, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            val noText = if (replies > 0) "${p.no} ($replies)" else "${p.no}"
            if (replies > 0) withLink(LinkAnnotation.Clickable("r:${p.no}", plain, links)) { withStyle(noStyle) { append(noText) } }
            else withStyle(noStyle) { append(noText) }
            append("  ")
            // 名前: 板の既定の名前(名無し)は省く(後ろのワッチョイなどは残す)。押すと同じ名前のレスを出す
            val name = if (noname != null && p.name.startsWith(noname)) p.name.substring(noname.length).trim() else p.name
            if (name.isNotEmpty()) withLink(LinkAnnotation.Clickable("n:${p.no}", plain, links)) { withStyle(SpanStyle(color = Palette.posterName, fontWeight = FontWeight.Bold)) { append(name) } }
            if (p.mail.isNotEmpty()) withStyle(SpanStyle(color = Palette.textMuted)) { append("  [${p.mail}]") }
            if (o.highlightOp && opId != null && p.id == opId) {
                append("  ")
                withStyle(SpanStyle(color = Palette.op, background = Palette.opWash, fontWeight = FontWeight.Bold, fontSize = 11.sp)) { append(" 主 ") }
            }
            append("  ")
            // 日付の途中で折り返さない(日と時刻の間の空白を、折り返さない空白に)
            withStyle(SpanStyle(color = Palette.textMuted)) { append(p.date.replace(' ', '\u00A0')) }
            if (p.id != null) {
                append("  ")
                // 書き込みの多い ID は暖色。押すと同じ ID のレスを出す
                val heat = if (o.idHeat) Palette.heat(idCount) else null
                withLink(LinkAnnotation.Clickable("i:${p.id}", plain, links)) {
                    withStyle(SpanStyle(color = heat ?: Palette.textMuted, fontFamily = FontFamily.Monospace, fontWeight = if (idCount >= 5) FontWeight.Bold else FontWeight.Normal)) {
                        append("ID:${p.id}")
                        if (idCount >= 2) append("($idCount)")
                    }
                }
            }
        }
        // 人気のレス(返信 3 件から)は、本文を暖色に(5 件から太字)
        val bodyStyle = replyHeat?.let { SpanStyle(color = it, fontWeight = if (replies >= 5) FontWeight.Bold else FontWeight.Normal) }
        val info = index.info[p.no]
        val body = buildAnnotatedString {
            if (bodyStyle != null) pushStyle(bodyStyle)
            val src = info?.display ?: p.body
            val spans = info?.spans ?: emptyList()
            var at = 0
            var i = 0
            while (i < spans.size) {
                val s = spans[i]
                if (s.start < at) { i++; continue }
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
        out[p.no] = RenderedPost(header, body, o.aaAutoDetect && AA.containsMatchIn(p.body))
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
