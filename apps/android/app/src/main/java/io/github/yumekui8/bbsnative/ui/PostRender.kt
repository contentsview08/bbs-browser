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

private val linkStyle = TextLinkStyles(SpanStyle(color = Palette.link))
private val plain = TextLinkStyles(null)

/**
 * 全部のレスを組み立てる。レスが届いたときに、画面とは別のスレッド(Dispatchers.Default)で 1 回だけ呼ぶ。
 * 1 レスの部品を「頭の行の Text 1 つ・本文の Text 1 つ」にし、スクロールで出てきたときの組み立てを軽くする
 */
fun renderPosts(index: PostIndex, links: PostLinks): Map<Int, RenderedPost> {
    val out = HashMap<Int, RenderedPost>(index.posts.size * 2)
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
            withStyle(SpanStyle(color = Palette.posterName, fontWeight = FontWeight.Bold)) { append(p.name) }
            if (p.mail.isNotEmpty()) withStyle(SpanStyle(color = Palette.textMuted)) { append("  [${p.mail}]") }
            if (opId != null && p.id == opId) {
                append("  ")
                withStyle(SpanStyle(color = Palette.op, background = Palette.opWash, fontWeight = FontWeight.Bold, fontSize = 11.sp)) { append(" 主 ") }
            }
            append("  ")
            // 日付の途中で折り返さない(日と時刻の間の空白を、折り返さない空白に)
            withStyle(SpanStyle(color = Palette.textMuted)) { append(p.date.replace(' ', '\u00A0')) }
            if (p.id != null) {
                append("  ")
                // 書き込みの多い ID は暖色。押すと同じ ID のレスを出す
                val heat = Palette.heat(idCount)
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
            var at = 0
            for (s in info?.spans ?: emptyList()) {
                if (s.start < at) continue
                append(p.body, at, s.start)
                val text = p.body.substring(s.start, s.end)
                when (s) {
                    is Span.Anchor -> withLink(LinkAnnotation.Clickable("a:${s.from}-${s.to}", linkStyle, links)) { append(text) }
                    // URL も押したときに画面が決める(同じ掲示板のスレならアプリの中で開く)
                    is Span.Url -> withLink(LinkAnnotation.Clickable("u:${s.url}", linkStyle, links)) { append(text) }
                }
                at = s.end
            }
            append(p.body, at, p.body.length)
            if (bodyStyle != null) pop()
        }
        out[p.no] = RenderedPost(header, body, AA.containsMatchIn(p.body))
    }
    return out
}
