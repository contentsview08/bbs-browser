package io.github.contentsview08.obb.ui

import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.background
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.em
import io.github.contentsview08.obb.R
import io.github.contentsview08.obb.bbs.PostInfo
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.layout.offset
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.clickable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Discord 風・LINE 風で、頭の上に出す返信先(本文の頭のアンカー) */
/**
 * 頭の行の置き場所と字の並び(レスごと)。長押しした位置が ID・名前の上なら、その ID・名前の操作を出すために使う
 */
object HeaderHits {
    /**
     * row の中の位置 pos が、レス r の頭の行の押せる所(ID「i:」・名前「n:」)の上なら、そのタグ。
     * 頭の行の位置は、描いた行ごとに覚える(hit)。同じレスがスレ表示とポップアップの両方に出ても取り違えないように
     */
    fun tagAt(r: RenderedPost, hit: HeaderHit, pos: androidx.compose.ui.geometry.Offset): String? {
        val row = hit.row?.takeIf { it.isAttached } ?: return null
        val c = hit.coords?.takeIf { it.isAttached } ?: return null
        val l = hit.layout ?: return null
        val p = runCatching { c.localPositionOf(row, pos) }.getOrNull() ?: return null
        if (p.x < 0 || p.y < 0 || p.x > c.size.width || p.y > c.size.height) return null
        val i = l.getOffsetForPosition(p)
        return r.header.getLinkAnnotations(maxOf(0, i - 1), i + 1).mapNotNull { (it.item as? androidx.compose.ui.text.LinkAnnotation.Clickable)?.tag }
            .firstOrNull { it.startsWith("i:") || it.startsWith("n:") }
    }
}

/** 描いた 1 行の、行・頭の行の位置と、頭の行の字の並び(長押しした所が ID・名前の上かを調べる) */
class HeaderHit {
    var row: androidx.compose.ui.layout.LayoutCoordinates? = null
    var coords: androidx.compose.ui.layout.LayoutCoordinates? = null
    var layout: androidx.compose.ui.text.TextLayoutResult? = null
}

/** いま描いている行の HeaderHit(スレ表示・ポップアップの行が渡す) */
val LocalHeaderHit = androidx.compose.runtime.compositionLocalOf<HeaderHit?> { null }

/** id はアイコンの種(設定でワッチョイがあればワッチョイ、なければ ID) */
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
    style: String = "card", id: String? = null, /** アイコンの右下の数字(2 以上で出す) */ iconCount: Int = 0, continued: Boolean = false, reply: ReplyPreview? = null, onReply: (Int) -> Unit = {},
    /** 人気のレス(返信 3 件から)の色。左に線、淡い地 */
    heat: Color? = null,
    /** アイコンを押したとき(その ID のレスを出す)。null なら押せない */
    onAvatar: (() -> Unit)? = null,
) {
    val avatarMod = if (onAvatar != null) Modifier.clip(androidx.compose.foundation.shape.CircleShape).clickable(onClick = onAvatar) else Modifier
    val chips = chipInlineContent()
    val prefs = LocalPrefs.current
    // アイコンの種: 設定でワッチョイから作ることにしていて、名前にワッチョイがあればそれ。なければ ID
    val seed = if (prefs.iconFromWatchoi) r.watchoi ?: id else id
    val showThumbs = prefs.thumbMode != io.github.contentsview08.obb.data.ThumbMode.NEVER
    val images = if (showThumbs) info?.images ?: emptyList() else emptyList()
    val youtube = if (showThumbs) info?.youtube ?: emptyList() else emptyList()
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
    val hit = LocalHeaderHit.current
    val track = Modifier.onGloballyPositioned { hit?.coords = it }
    // ID の位置(設定): 日時の後ろは頭の中(r.header)。右上は頭の行の右端、右下は本文の下の右端(r.idText)
    val idTopRight = r.idText?.takeIf { prefs.idPosition == "topRight" }
    val idBottomRight = r.idText?.takeIf { prefs.idPosition == "bottomRight" }
    val idLine = @Composable {
        if (idBottomRight != null) Row(Modifier.fillMaxWidth().padding(top = 2.dp), horizontalArrangement = Arrangement.End) { Text(idBottomRight, fontSize = headSize) }
    }
    val header = @Composable {
        if (own || toOwn || idTopRight != null) {
            // 右上の ID の幅だけを除いて、残りを全部頭に使う(頭と余白の両方に weight を付けると幅を半分ずつ分け合い、まだ入るのに折り返していた)
            Row(if (idTopRight != null) Modifier.fillMaxWidth() else Modifier, horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f, fill = false), verticalAlignment = Alignment.CenterVertically) {
                    Text(r.header, Modifier.weight(1f, fill = false).then(track), fontSize = headSize, lineHeight = 1.4.em, inlineContent = chips, onTextLayout = { hit?.layout = it })
                    if (own || toOwn) {
                        Spacer(Modifier.width(6.dp))
                        OwnChip(if (own) "自分" else "→あなた宛")
                    }
                }
                if (idTopRight != null) Text(idTopRight, Modifier.padding(start = 6.dp), fontSize = headSize, maxLines = 1, softWrap = false)
            }
        } else Text(r.header, track, fontSize = headSize, lineHeight = 1.4.em, inlineContent = chips, onTextLayout = { hit?.layout = it })
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
        toOwn && ownSide == "left" -> Palette.toOwn
        showHeat && heatSide == "left" -> heat
        else -> null
    }
    val rightBar = when {
        own && ownSide == "right" -> Palette.own
        toOwn && ownSide == "right" -> Palette.toOwn
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
                    Box(Modifier.width(AVATAR)) { if (!continued) { Avatar(seed, r.beIcon, AVATAR, avatarMod); IconCount(iconCount) } }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        if (!continued) header()
                        body(Modifier.padding(top = if (continued) 0.dp else 4.dp))
                        idLine()
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
            // アイコンは頭の行(名前・ID)の横に置き、その下に吹き出しを続ける(頭の行の左が空いて見えないように)
            Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.Top) {
                if (!own) { Box(Modifier.width(AVATAR)) { if (!continued) { Avatar(seed, r.beIcon, AVATAR, avatarMod); IconCount(iconCount) } }; Spacer(Modifier.width(8.dp)) }
                Column(Modifier.weight(1f), horizontalAlignment = if (own) Alignment.End else Alignment.Start) {
                    if (!continued || own) Box(Modifier.padding(bottom = 4.dp)) { header() }
                    Column(
                        Modifier.widthIn(max = 320.dp).background(bubble, RoundedCornerShape(8.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
                    ) {
                        if (reply != null) ReplyLine(reply, indent = 0.dp, onDark = own) { onReply(reply.no) }
                        if (aa) AaBody(r) else Text(r.body, color = textColor, fontSize = bodySize, lineHeight = prefs.lineHeight.em)
                        idLine()
                    }
                    Box(Modifier.offset(x = (-14).dp)) { Column { media() } }
                }
            }
        }
        "classic" -> {
            // 専ブラ風: 余白を詰め、頭の行を小さく。1 画面にたくさん並ぶ
            // 頭と本文・画像は 1 つの縦の並びにまとめる(並べたままだと、人気の帯を描く Box の中で画像が頭と本文の上に重なった)
            Column(Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = pad / 2 + 1.dp)) {
                    // 頭の行の位置と字の並びを覚える(ID・名前の長押しのメニュー。付けていなかったので、専ブラ風では長押しが効かなかった)
                    if (own || toOwn || idTopRight != null) header() else Text(r.header, track, fontSize = headSize * 0.92f, lineHeight = 1.3.em, inlineContent = chips, onTextLayout = { hit?.layout = it })
                    BeIcon(r.beIcon)
                    if (aa) AaBody(r) else Text(r.body, Modifier.padding(top = 1.dp), color = Palette.textBody, fontSize = bodySize * 0.95f, lineHeight = (prefs.lineHeight - 0.1f).em)
                    idLine()
                }
                media()
            }
        }
        "matome" -> {
            // まとめ風: 返信の多いレス(人気)は字を大きく濃く、ほかは小さめに。読み飛ばしながら見どころが拾える
            Column(Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = if (heat != null) pad + 2.dp else pad / 2 + 2.dp)) {
                    header()
                    BeIcon(r.beIcon)
                    if (aa) AaBody(r)
                    else if (heat != null) Text(r.body, Modifier.padding(top = 4.dp), color = Palette.textStrong, fontSize = bodySize * 1.2f, lineHeight = prefs.lineHeight.em, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium)
                    else Text(r.body, Modifier.padding(top = 2.dp), color = Palette.textBody.copy(alpha = 0.85f), fontSize = bodySize * 0.88f, lineHeight = prefs.lineHeight.em)
                    idLine()
                }
                media()
            }
        }
        else -> {
            Column(Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = pad)) {
                    header()
                    BeIcon(r.beIcon)
                    body(Modifier.padding(top = 4.dp))
                    idLine()
                }
                media()
            }
        }
    }
    }
    // ツリーの中では、左の帯はツリーの 1 行が枠の左端に描く(ここで描くと段の線より右に出る)
    val edge = LocalEdgeBar.current
    if (edge != null) androidx.compose.runtime.SideEffect { edge.color = leftBar }
    val ownLeft = if (edge != null) null else leftBar
    if (ownLeft == null && rightBar == null) return inner()
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
            if (ownLeft != null) drawRect(ownLeft, size = androidx.compose.ui.geometry.Size(w, size.height))
            if (rightBar != null) drawRect(rightBar, topLeft = androidx.compose.ui.geometry.Offset(size.width - w, 0f), size = androidx.compose.ui.geometry.Size(w, size.height))
        }.padding(start = if (ownLeft != null) 3.dp else 0.dp, end = if (rightBar != null) 3.dp else 0.dp),
    ) {
        // Box の中に部品を並べると重なるので、見た目の作りに関係なくいつも縦に積む
        Column(Modifier.fillMaxWidth()) { inner() }
    }
}

/** 返信先の 1 行(小さいアイコン・名前・本文の頭)。押すと返信先をポップアップで出す */
@Composable
private fun ReplyLine(reply: ReplyPreview, indent: androidx.compose.ui.unit.Dp, onDark: Boolean = false, onClick: () -> Unit) {
    Row(Modifier.padding(start = indent, bottom = 4.dp).clickable(onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
        Text("↱ ", color = if (onDark) Color.White.copy(alpha = 0.8f) else Palette.textMuted, fontSize = 12.sp)
        Identicon(reply.id, 16.dp)
        Spacer(Modifier.width(5.dp))
        Text(
            // 本文だけ
            reply.text, color = if (onDark) Color.White.copy(alpha = 0.85f) else Palette.textMuted, fontSize = 12.sp,
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

/** BE のアイコン(カード・専ブラ風・まとめ風): 本文の上に、高さ 28dp にそろえて(元の絵は小さいので広げる)。取れなければ出さない */
@Composable
private fun BeIcon(url: String?) {
    if (url == null) return
    var failed by androidx.compose.runtime.remember(url) { androidx.compose.runtime.mutableStateOf(false) }
    if (failed) return
    coil3.compose.AsyncImage(
        url, "BE のアイコン", Modifier.padding(top = 4.dp).height(28.dp).widthIn(max = 96.dp),
        contentScale = androidx.compose.ui.layout.ContentScale.Fit, onError = { failed = true },
    )
}

/** アイコンの列(Discord 風・LINE 風): BE のアイコンがあれば ID の模様の代わりに出す(枠に収まるよう縮める・縦横の比は保つ) */
@Composable
private fun androidx.compose.foundation.layout.BoxScope.IconCount(n: Int) {
    if (n < 2) return
    // アイコンの右下に、その人の書き込み数(多いほど暖色。PC 版と同じ)。押す邪魔をしないよう、アイコンの右下の角に重ねるだけ
    Box(
        Modifier.align(Alignment.BottomEnd).offset(x = 2.dp, y = 3.dp).defaultMinSize(minWidth = 15.dp, minHeight = 15.dp)
            .background(Palette.surface, androidx.compose.foundation.shape.CircleShape).border(1.dp, Palette.border, androidx.compose.foundation.shape.CircleShape)
            .padding(horizontal = 2.dp),
        contentAlignment = Alignment.Center,
    ) { Text("$n", color = Palette.heat(n) ?: Palette.textMuted, fontSize = 9.sp, lineHeight = 9.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, maxLines = 1) }
}

@Composable
private fun Avatar(id: String?, beIcon: String?, size: androidx.compose.ui.unit.Dp, modifier: Modifier = Modifier) {
    if (beIcon == null) return Identicon(id, size, modifier)
    var failed by androidx.compose.runtime.remember(beIcon) { androidx.compose.runtime.mutableStateOf(false) }
    if (failed) return Identicon(id, size, modifier)
    Box(modifier.size(size).clip(RoundedCornerShape(10.dp)).background(Palette.surface)) {
        coil3.compose.AsyncImage(beIcon, "BE のアイコン", Modifier.matchParentSize(), contentScale = androidx.compose.ui.layout.ContentScale.Fit, onError = { failed = true })
    }
}
