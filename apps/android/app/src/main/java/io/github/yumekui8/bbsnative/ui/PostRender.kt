package io.github.yumekui8.bbsnative.ui

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.LinkInteractionListener
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.bbs.PostIndex
import io.github.yumekui8.bbsnative.bbs.Span

/** 組み立て済みのレス(頭の行と本文)。スクロール中は、これを Text に渡すだけにする */
class RenderedPost(val header: AnnotatedString, val body: AnnotatedString)

/**
 * レスの中の押せるところ(番号・ID・アンカー)を押したときに呼ぶ先。組み立てた文字列は使い回すので、
 * 押したときの動きは、ここに入れた関数を差し替えて変える。tag は「a:から-まで」「r:番号」「i:ID」
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
    for (p in index.posts) {
        val replies = index.replyCount[p.no] ?: 0
        val idCount = p.id?.let { index.idCount[it] } ?: 0
        val header = buildAnnotatedString {
            // 番号: 返信が多いほど暖色。返信があれば押すと返信を出す
            val noColor = when {
                replies >= 5 -> Palette.heatVeryHot
                replies >= 3 -> Palette.heatHot
                replies >= 1 -> Palette.accent
                else -> Palette.textMuted
            }
            val noText = "${p.no}"
            if (replies > 0) withLink(LinkAnnotation.Clickable("r:${p.no}", plain, links)) { withStyle(SpanStyle(color = noColor, fontWeight = FontWeight.Bold)) { append(noText) } }
            else withStyle(SpanStyle(color = noColor, fontWeight = FontWeight.Bold)) { append(noText) }
            append("  ")
            withStyle(SpanStyle(color = Palette.posterName)) { append(p.name) }
            append("  ")
            withStyle(SpanStyle(color = Palette.textMuted, fontSize = 11.sp)) { append(p.date) }
            if (p.id != null) {
                append("  ")
                // 書き込みの多い ID は赤く。押すと同じ ID のレスを出す
                withLink(LinkAnnotation.Clickable("i:${p.id}", plain, links)) {
                    withStyle(SpanStyle(color = if (idCount >= 5) Palette.heatVeryHot else Palette.textMuted, fontSize = 11.sp)) {
                        append("ID:${p.id}")
                        if (idCount > 1) append("($idCount)")
                    }
                }
            }
        }
        val info = index.info[p.no]
        val body = buildAnnotatedString {
            var at = 0
            for (s in info?.spans ?: emptyList()) {
                if (s.start < at) continue
                append(p.body, at, s.start)
                val text = p.body.substring(s.start, s.end)
                when (s) {
                    is Span.Anchor -> withLink(LinkAnnotation.Clickable("a:${s.from}-${s.to}", linkStyle, links)) { append(text) }
                    is Span.Url -> withLink(LinkAnnotation.Url(s.url, linkStyle)) { append(text) }
                }
                at = s.end
            }
            append(p.body, at, p.body.length)
        }
        out[p.no] = RenderedPost(header, body)
    }
    return out
}
