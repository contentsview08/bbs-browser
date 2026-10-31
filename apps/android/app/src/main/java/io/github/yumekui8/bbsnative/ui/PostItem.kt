package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.em
import io.github.yumekui8.bbsnative.R
import io.github.yumekui8.bbsnative.bbs.PostInfo
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.clickable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Discord 風・LINE 風で、頭の上に出す返信先(本文の頭のアンカー) */
class ReplyPreview(val no: Int, val id: String?, val name: String, val text: String)

/**
 * レス 1 件。組み立て済み(renderPosts)の頭の行と本文を置くだけ。
 * 頭の行の番号を押すとそのレスへの返信、ID を押すと同じ ID のレス、本文のアンカー・URL も押せる(PostLinks)。
 * 自分の書き込みは左に緑の線と「自分」の札、自分への返信は「→あなた宛」の札(今のスマホ版と同じ)。
 * style が discord / line のときは、今のスマホ版の Discord 風・LINE 風の並び
 */
@Composable
fun PostItem(
    r: RenderedPost, aa: Boolean = r.aa, own: Boolean = false, toOwn: Boolean = false,
    info: PostInfo? = null, autoLoad: Boolean = true, onImage: (String) -> Unit = {}, onUrl: (String) -> Unit = {}, gross: Boolean = false,
    style: String = "card", id: String? = null, continued: Boolean = false, reply: ReplyPreview? = null, onReply: (Int) -> Unit = {},
    /** 人気のレス(返信 3 件から)の色。左に線、淡い地 */
    heat: Color? = null,
) {
    val chips = chipInlineContent()
    val prefs = LocalPrefs.current
    val images = if (prefs.showThumbnails) info?.images ?: emptyList() else emptyList()
    val youtube = if (prefs.showThumbnails) info?.youtube ?: emptyList() else emptyList()
    val bodySize = (15 * prefs.bodyScale).sp
    val headSize = (12 * prefs.postHeadScale).sp
    val pad = prefs.postPad.dp
    val body = @Composable { mod: Modifier ->
        if (aa) AaBody(r) else Text(r.body, mod, color = Palette.textBody, fontSize = bodySize, lineHeight = prefs.lineHeight.em)
    }
    val media = @Composable {
        if (images.isNotEmpty() || youtube.isNotEmpty()) Thumbnails(images, autoLoad, onImage, blur = gross, youtube = youtube, onUrl = onUrl, size = prefs.thumbSize)
        if (prefs.showLinkPreview && !info?.links.isNullOrEmpty()) LinkCards(info!!.links, autoLoad, onUrl)
    }
    val header = @Composable {
        if (own || toOwn) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(r.header, Modifier.weight(1f, fill = false), fontSize = headSize, lineHeight = 1.4.em, inlineContent = chips)
                Spacer(Modifier.width(6.dp))
                OwnChip(if (own) "自分" else "→あなた宛")
            }
        } else Text(r.header, fontSize = headSize, lineHeight = 1.4.em, inlineContent = chips)
    }
    // 左右の帯: 自分の書き込みは左に緑。人気のレスは設定の側(左・右)に暖色(左のときに自分の書き込みと重なれば右へ)と淡い地。
    // 見た目(カード・Discord 風・LINE 風)に関わらず同じ
    val heatSide = prefs.heatStyle
    val showHeat = heat != null && (heatSide == "left" || heatSide == "right")
    // 自分の書き込みの帯は、人気の帯と反対の側にいつも出す(人気が左の帯なら自分は右。人気を帯で示さないときは左)
    val ownSide = if (heatSide == "left") "right" else "left"
    // 自分への返信は、自分の側に半分の濃さの帯と、うっすら自分の色の地(スクロール中でも目に入るように)
    val leftBar = when {
        own && ownSide == "left" -> Palette.own
        toOwn && ownSide == "left" -> Palette.own.copy(alpha = 0.6f)
        showHeat && heatSide == "left" -> heat
        else -> null
    }
    val rightBar = when {
        own && ownSide == "right" -> Palette.own
        toOwn && ownSide == "right" -> Palette.own.copy(alpha = 0.6f)
        showHeat && heatSide == "right" -> heat
        else -> null
    }
    val inner = @Composable {
    when (style) {
        "discord" -> {
            // 左に丸い ID のアイコン、右に頭と本文。続けて書いたレス(同じ ID)はアイコンと頭を省く。返信先は頭の上に 1 行
            Column(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = if (continued) 2.dp else pad + 2.dp, bottom = pad / 2)) {
                if (reply != null) ReplyLine(reply, indent = AVATAR + 10.dp) { onReply(reply.no) }
                Row(Modifier.fillMaxWidth()) {
                    Box(Modifier.width(AVATAR)) { if (!continued) Identicon(id, AVATAR) }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        if (!continued) header()
                        body(Modifier.padding(top = if (continued) 0.dp else 2.dp))
                    }
                }
                Box(Modifier.padding(start = AVATAR - 4.dp)) { Column { media() } }
            }
        }
        "line" -> {
            // 吹き出しで会話のように。自分の書き込みは右に緑の吹き出し、ほかは左にアイコンと吹き出し
            // 地と区別できる吹き出し(今のスマホ版の line-bubble・line-bubble-own)
            val bubble = if (own) Palette.lineOwnBg else Palette.lineBubble
            val textColor = if (own) Palette.lineOwnText else Palette.textBody
            Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp), horizontalAlignment = if (own) Alignment.End else Alignment.Start) {
                if (!continued || own) Box(Modifier.padding(start = if (own) 0.dp else AVATAR + 8.dp, bottom = 2.dp)) { header() }
                Row(verticalAlignment = Alignment.Top) {
                    if (!own) { Box(Modifier.width(AVATAR)) { if (!continued) Identicon(id, AVATAR) }; Spacer(Modifier.width(8.dp)) }
                    Column(
                        Modifier.widthIn(max = 320.dp).background(bubble, RoundedCornerShape(8.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
                    ) {
                        if (reply != null) ReplyLine(reply, indent = 0.dp, onDark = own) { onReply(reply.no) }
                        if (aa) AaBody(r) else Text(r.body, color = textColor, fontSize = bodySize, lineHeight = prefs.lineHeight.em)
                    }
                }
                Box(Modifier.padding(start = if (own) 0.dp else AVATAR - 4.dp)) { Column { media() } }
            }
        }
        else -> {
            Column(Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = pad)) {
                    header()
                    body(Modifier.padding(top = 4.dp))
                }
                media()
            }
        }
    }
    }
    if (leftBar == null && rightBar == null) return inner()
    Row(
        Modifier.height(IntrinsicSize.Min).then(
            when {
                toOwn -> Modifier.background(Palette.own.copy(alpha = 0.09f))
                showHeat && heat != null -> Modifier.background(heat.copy(alpha = 0.06f))
                else -> Modifier
            },
        ),
    ) {
        if (leftBar != null) Box(Modifier.width(3.dp).fillMaxHeight().background(leftBar))
        Box(Modifier.weight(1f)) { inner() }
        if (rightBar != null) Box(Modifier.width(3.dp).fillMaxHeight().background(rightBar))
    }
}

/** 返信先の 1 行(小さいアイコン・名前・本文の頭)。押すと返信先をポップアップで出す */
@Composable
private fun ReplyLine(reply: ReplyPreview, indent: androidx.compose.ui.unit.Dp, onDark: Boolean = false, onClick: () -> Unit) {
    Row(Modifier.padding(start = indent, bottom = 2.dp).clickable(onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
        Text("↱ ", color = if (onDark) Color.White.copy(alpha = 0.8f) else Palette.textMuted, fontSize = 12.sp)
        Identicon(reply.id, 16.dp)
        Spacer(Modifier.width(5.dp))
        Text(
            "${reply.name}  ${reply.text}", color = if (onDark) Color.White.copy(alpha = 0.85f) else Palette.textMuted, fontSize = 12.sp,
            maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
        )
    }
}

/** AA 用の字(aahub_light)。書き込み欄でも使う */
/** AA 用の字(aahub_light)。書き込み欄でも使う */
val AaFont = FontFamily(Font(R.font.aahub_light))

/**
 * AA の本文。AA 用の字で折り返さず、横幅に収まるまで字を小さくする
 * (今のスマホ版の fitAA と同じ。横にずらして読むと、スクロールの操作とぶつかるため)
 */
@Composable
private fun AaBody(r: RenderedPost) {
    BasicText(
        r.body, Modifier.fillMaxWidth().padding(top = 4.dp),
        style = TextStyle(color = Palette.textBody, fontFamily = AaFont, fontSize = 15.sp, lineHeight = 1.15.em, letterSpacing = 0.sp),
        softWrap = false,
        autoSize = TextAutoSize.StepBased(minFontSize = 5.sp, maxFontSize = 15.sp, stepSize = 0.5.sp),
    )
}

@Composable
private fun OwnChip(label: String) {
    Text(
        label,
        Modifier.border(1.dp, Palette.own, RoundedCornerShape(4.dp)).background(Palette.ownWash, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 1.dp),
        color = Palette.own, fontSize = 10.sp, lineHeight = 14.sp,
    )
}
