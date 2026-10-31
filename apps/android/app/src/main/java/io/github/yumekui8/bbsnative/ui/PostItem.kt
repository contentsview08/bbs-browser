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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.draw.clip
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.clickable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Discord 風・LINE 風で、頭の上に出す返信先(本文の頭のアンカー) */
/**
 * 頭の行の置き場所と字の並び(レスごと)。長押しした位置が ID・名前の上なら、その ID・名前の操作を出すために使う
 */
object HeaderHits {
    val coords = java.util.WeakHashMap<RenderedPost, androidx.compose.ui.layout.LayoutCoordinates>()
    val layouts = java.util.WeakHashMap<RenderedPost, androidx.compose.ui.text.TextLayoutResult>()

    /** row の中の位置 pos が、レス r の頭の行の押せる所(ID「i:」・名前「n:」)の上なら、そのタグ */
    fun tagAt(r: RenderedPost, row: androidx.compose.ui.layout.LayoutCoordinates, pos: androidx.compose.ui.geometry.Offset): String? {
        val c = coords[r]?.takeIf { it.isAttached } ?: return null
        val l = layouts[r] ?: return null
        val p = runCatching { c.localPositionOf(row, pos) }.getOrNull() ?: return null
        if (p.x < 0 || p.y < 0 || p.x > c.size.width || p.y > c.size.height) return null
        val i = l.getOffsetForPosition(p)
        return r.header.getLinkAnnotations(maxOf(0, i - 1), i + 1).mapNotNull { (it.item as? androidx.compose.ui.text.LinkAnnotation.Clickable)?.tag }
            .firstOrNull { it.startsWith("i:") || it.startsWith("n:") }
    }
}

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
    /** タイムライン: 本文の下に出す返信(2 件まで)と、返信の数・押したとき */
    replies: List<ReplyPreview> = emptyList(), replyTotal: Int = 0, onReplies: () -> Unit = {},
    /** アイコンを押したとき(その ID のレスを出す)。null なら押せない */
    onAvatar: (() -> Unit)? = null,
) {
    val avatarMod = if (onAvatar != null) Modifier.clip(androidx.compose.foundation.shape.CircleShape).clickable(onClick = onAvatar) else Modifier
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
    // 頭の行の字の並びと位置を覚えておく(長押しした所が ID・名前の上か、スレ表示が調べる)
    val track = Modifier.onGloballyPositioned { HeaderHits.coords[r] = it }
    val header = @Composable {
        if (own || toOwn) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(r.header, Modifier.weight(1f, fill = false).then(track), fontSize = headSize, lineHeight = 1.4.em, inlineContent = chips, onTextLayout = { HeaderHits.layouts[r] = it })
                Spacer(Modifier.width(6.dp))
                OwnChip(if (own) "自分" else "→あなた宛")
            }
        } else Text(r.header, track, fontSize = headSize, lineHeight = 1.4.em, inlineContent = chips, onTextLayout = { HeaderHits.layouts[r] = it })
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
                    Box(Modifier.width(AVATAR)) { if (!continued) Identicon(id, AVATAR, avatarMod) }
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
                    if (!own) { Box(Modifier.width(AVATAR)) { if (!continued) Identicon(id, AVATAR, avatarMod) }; Spacer(Modifier.width(8.dp)) }
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
        "timeline" -> {
            // 返信は人気順に 2 件まで。「ほか N 件」を押すと、その場で下に全部を広げる(ポップアップは出さない)
            var expanded by androidx.compose.runtime.saveable.rememberSaveable(r.hashCode()) { androidx.compose.runtime.mutableStateOf(false) }
            val shownReplies = if (expanded) replies else replies.take(2)
            // X 風: アイコン左、名前と時刻・本文。返信先は本文の下に枠で(引用リツイートのように)。
            // 本文の下の返信は、アイコンを元のレスと同じ横の位置にそろえて小さく並べ、縦の線でつなぐ(X のスレッドのように)
            Column(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = pad + 2.dp, bottom = pad)) {
                // 返信があれば、アイコンの下から返信のアイコンまで線を下ろす(描くだけ。高さの見積もりはしない)
                val lineC = Palette.borderStrong
                Row(Modifier.fillMaxWidth().drawBehind {
                    if (shownReplies.isNotEmpty()) { val x = AVATAR.toPx() / 2; drawLine(lineC, androidx.compose.ui.geometry.Offset(x, AVATAR.toPx() + 4.dp.toPx()), androidx.compose.ui.geometry.Offset(x, size.height), 2.dp.toPx()) }
                }) {
                    Box(Modifier.width(AVATAR)) { Identicon(id, AVATAR, avatarMod) }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        header()
                        body(Modifier.padding(top = 2.dp))
                        media()
                        if (reply != null) Column(
                            Modifier.padding(top = 8.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp))
                                .border(1.dp, Palette.borderStrong, RoundedCornerShape(10.dp)).clickable { onReply(reply.no) }
                                .padding(horizontal = 10.dp, vertical = 7.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Identicon(reply.id, 16.dp)
                                Spacer(Modifier.width(6.dp))
                                Text("${reply.name}  >>${reply.no}", color = Palette.textMuted, fontSize = 12.sp, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            }
                            Text(reply.text, Modifier.padding(top = 2.dp), color = Palette.textBody, fontSize = 13.sp, maxLines = 3, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        }
                        if (shownReplies.isNotEmpty()) Spacer(Modifier.height(14.dp))
                    }
                }
                for ((k, rp) in shownReplies.withIndex()) Row(
                    Modifier.fillMaxWidth().clickable { onReply(rp.no) }.drawBehind {
                        // 次の返信(か「ほか N 件」)まで線を続ける
                        if (k < shownReplies.lastIndex || replyTotal > shownReplies.size) { val x = AVATAR.toPx() / 2; drawLine(lineC, androidx.compose.ui.geometry.Offset(x, 29.dp.toPx()), androidx.compose.ui.geometry.Offset(x, size.height), 2.dp.toPx()) }
                    },
                ) {
                    Box(Modifier.width(AVATAR), contentAlignment = Alignment.TopCenter) { Identicon(rp.id, 26.dp) }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f).padding(bottom = 10.dp)) {
                        Text(rp.name, color = Palette.textMuted, fontSize = 12.sp, maxLines = 1)
                        Text(rp.text, color = Palette.textBody, fontSize = 14.sp, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    }
                }
                if (replyTotal > shownReplies.size) Text(
                    "ほか ${replyTotal - shownReplies.size} 件の返信を見る",
                    Modifier.padding(start = AVATAR + 10.dp).clickable { if (replies.size > shownReplies.size) expanded = true else onReplies() }.padding(vertical = 2.dp),
                    color = Palette.link, fontSize = 13.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                )
            }
        }
        "classic" -> {
            // 専ブラ風: 余白を詰め、頭の行を小さく。1 画面にたくさん並ぶ
            Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = pad / 2 + 1.dp)) {
                if (own || toOwn) header() else Text(r.header, fontSize = headSize * 0.92f, lineHeight = 1.3.em, inlineContent = chips)
                if (aa) AaBody(r) else Text(r.body, Modifier.padding(top = 1.dp), color = Palette.textBody, fontSize = bodySize * 0.95f, lineHeight = (prefs.lineHeight - 0.1f).em)
            }
            media()
        }
        "matome" -> {
            // まとめ風: 返信の多いレス(人気)は字を大きく濃く、ほかは小さめに。読み飛ばしながら見どころが拾える
            Column(Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = if (heat != null) pad + 2.dp else pad / 2 + 2.dp)) {
                    header()
                    if (aa) AaBody(r)
                    else if (heat != null) Text(r.body, Modifier.padding(top = 4.dp), color = Palette.textStrong, fontSize = bodySize * 1.2f, lineHeight = prefs.lineHeight.em, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium)
                    else Text(r.body, Modifier.padding(top = 2.dp), color = Palette.textBody.copy(alpha = 0.85f), fontSize = bodySize * 0.88f, lineHeight = prefs.lineHeight.em)
                }
                media()
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
    // 帯は描くだけにする(中身の高さを先に見積もる形だと、サムネイルやリンクのカードの分が足りず、本文と重なって出ることがあった)
    Box(
        Modifier.fillMaxWidth().then(
            when {
                toOwn -> Modifier.background(Palette.own.copy(alpha = 0.09f))
                showHeat && heat != null -> Modifier.background(heat.copy(alpha = 0.06f))
                else -> Modifier
            },
        ).drawBehind {
            val w = 3.dp.toPx()
            if (leftBar != null) drawRect(leftBar, size = androidx.compose.ui.geometry.Size(w, size.height))
            if (rightBar != null) drawRect(rightBar, topLeft = androidx.compose.ui.geometry.Offset(size.width - w, 0f), size = androidx.compose.ui.geometry.Size(w, size.height))
        }.padding(start = if (leftBar != null) 3.dp else 0.dp, end = if (rightBar != null) 3.dp else 0.dp),
    ) { inner() }
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

/**
 * AA を拡大して見る: 画面いっぱいに AA だけを出し、2 本指で拡大・縮小、1 本指で動かせる(縮めて収めた AA は字が小さすぎて読めないことがある)。
 * 横向きにすると広く使える。押すか戻るで閉じる
 */
@Composable
fun AaZoom(r: RenderedPost, onDismiss: () -> Unit) {
    androidx.compose.ui.window.Dialog(onDismiss, androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) {
        var scale by androidx.compose.runtime.remember { androidx.compose.runtime.mutableFloatStateOf(1f) }
        var offset by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(androidx.compose.ui.geometry.Offset.Zero) }
        Box(
            Modifier.fillMaxSize().background(Palette.base)
                .pointerInput(Unit) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        scale = (scale * zoom).coerceIn(0.5f, 6f)
                        offset += pan
                    }
                }
                .pointerInput(Unit) { detectTapGestures(onDoubleTap = { scale = 1f; offset = androidx.compose.ui.geometry.Offset.Zero }, onTap = { onDismiss() }) },
            contentAlignment = Alignment.Center,
        ) {
            BasicText(
                r.body, Modifier.wrapContentSize(unbounded = true).graphicsLayer { scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y },
                style = TextStyle(color = Palette.textBody, fontFamily = AaFont, fontSize = 13.sp, lineHeight = 1.15.em, letterSpacing = 0.sp),
                softWrap = false,
            )
            Text("2 本指で拡大 ・ ダブルタップで戻す ・ タップで閉じる", Modifier.align(Alignment.BottomCenter).padding(16.dp), color = Palette.textMuted, fontSize = 11.sp)
        }
    }
}

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
