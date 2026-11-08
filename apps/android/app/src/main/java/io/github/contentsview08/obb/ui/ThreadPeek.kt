package io.github.contentsview08.obb.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.Page
import io.github.contentsview08.obb.bbs.Post
import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.bbs.TwoCh
import io.github.contentsview08.obb.data.NgRule
import io.github.contentsview08.obb.data.ThreadLog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

// ── 中身の選び方(画面から切り離してテストする) ──

/** のぞいたときの開く位置の決まり: 開いたことがない(1 番目から)・新着(新着の頭から)・新着がない(一番下) */
enum class PeekKind { FIRST, NEW, LAST }

/**
 * のぞく窓に並べるもの。posts は手元のレス全部(番号順)。
 * newFrom: 新着の頭の posts の中の位置(新着のないときは -1)。見出し「新着 N 件」はその前に置く
 */
class PeekPick(val kind: PeekKind, val posts: List<Post>, val newCount: Int = 0, val newFrom: Int = -1)

/** 長すぎる本文だけ、この行数で切る */
internal const val PEEK_BODY_LINES = 12

/** readNo: 開いたことがあれば既読の番号、なければ null */
internal fun peekPick(posts: List<Post>, readNo: Int?): PeekPick {
    val sorted = posts.distinctBy { it.no }.sortedBy { it.no }
    if (readNo == null) return PeekPick(PeekKind.FIRST, sorted)
    val from = sorted.indexOfFirst { it.no > readNo }
    if (from >= 0) return PeekPick(PeekKind.NEW, sorted, sorted.size - from, from)
    return PeekPick(PeekKind.LAST, sorted)
}

/**
 * 並べる項目の数と、開いたときに見せる項目の位置。新着の見出しは新着の頭の前に、新着がないときの見出しは一番下に置く
 * (見出しも 1 項目に数える)
 */
internal fun peekItemCount(pick: PeekPick): Int = pick.posts.size + if (pick.kind == PeekKind.FIRST) 0 else 1

internal fun peekStartIndex(pick: PeekPick): Int = when (pick.kind) {
    PeekKind.FIRST -> 0
    PeekKind.NEW -> pick.newFrom
    PeekKind.LAST -> peekItemCount(pick) - 1
}

/**
 * 取りに行くか。開いたことがないスレは一覧のレス数より手元が少なければ(全部を取って並べる)、開いたスレは新着が手元になければ。
 * knownCount: 一覧で分かっているレス数(分からなければ 0)。dat 落ちのスレは新着が増えないので取りに行かない
 */
internal fun peekNeedsFetch(posts: List<Post>, readNo: Int?, knownCount: Int, archived: Boolean): Boolean {
    if (readNo == null) return posts.isEmpty() || posts.size < knownCount
    return !archived && posts.none { it.no > readNo }
}

/** 本文。前後の空行は省き、長すぎるものだけ頭の数行で切って「…」で閉じる */
internal fun peekBody(body: String, lines: Int = PEEK_BODY_LINES): String {
    val all = body.lines().dropWhile { it.isBlank() }.dropLastWhile { it.isBlank() }
    return if (all.size <= lines) all.joinToString("\n") else all.take(lines).joinToString("\n").trimEnd() + "…"
}

/** 中身を押したときに開く位置。頭から読むスレは 1 レス目なら位置を決めない(ふつうに開く) */
internal fun peekJumpNo(kind: PeekKind, no: Int): Int? = if (kind == PeekKind.FIRST && no == 1) null else no

// ── 元の行の位置 ──

/** のぞく元の行。窓は行から広がって出て、閉じると行へ縮む */
class PeekAnchor { internal var coords: LayoutCoordinates? = null }

@Composable
fun rememberPeekAnchor() = remember { PeekAnchor() }

/** 置かれるたびに位置の持ち手だけ覚える(スクロールのたびに測り直さない) */
fun Modifier.peekAnchor(a: PeekAnchor) = onPlaced { a.coords = it }

/** 行の画面の上での位置。窓は別のウィンドウなので、画面の座標で受け渡す */
fun PeekAnchor.screenRect(view: android.view.View): Rect? {
    val c = coords?.takeIf { it.isAttached } ?: return null
    val loc = IntArray(2)
    view.rootView.getLocationOnScreen(loc)
    return c.boundsInWindow().translate(loc[0].toFloat(), loc[1].toFloat())
}

/** のぞいているスレと、広がりはじめる行の位置 */
class PeekTarget(val thread: ThreadSummary, val from: Rect?, /** 分かっているレス数(取りに行くかの目安) */ val knownCount: Int = thread.postCount)

// ── のぞく窓 ──

/**
 * スレを長押ししたときの「のぞく」窓。上にスレタイ、真ん中に中身(開いたことがなければ頭のレス、あれば新着)、下に操作の列。
 * のぞいただけでは既読も閲覧履歴も変えない
 */
@Composable
fun ThreadPeek(vm: AppViewModel, target: PeekTarget, hasLog: Boolean, onDismiss: () -> Unit) {
    val t = target.thread
    val context = LocalContext.current
    var fav by remember(t.id) { mutableStateOf(false) }
    var ngDraft by remember(t.id) { mutableStateOf<String?>(null) }
    var confirmDel by remember(t.id) { mutableStateOf(false) }
    LaunchedEffect(t.id) { fav = vm.isFavoriteThread(t) }
    if (confirmDel) { ConfirmDeleteDialog(vm.prefs, onDelete = { vm.deleteLogOf(t) }) { confirmDel = false; onDismiss() }; return }
    ngDraft?.let { draft ->
        var word by remember(t.id) { mutableStateOf(draft) }
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("スレタイを NG") },
            text = { OutlinedTextField(word, { word = it }, label = { Text("この言葉を含むスレを一覧に出さない") }) },
            confirmButton = { TextButton(onClick = { if (word.isNotBlank()) vm.addNg(NgRule("threadTitle", word.trim())); onDismiss() }) { Text("NG に足す") } },
            dismissButton = { TextButton(onClick = onDismiss) { Text("やめる") } },
        )
        return
    }

    // 中身: 手元のログをすぐ出し、足りなければ取りに行く。開いたかどうかは、のぞく前のログで決める
    var log by remember(t.id) { mutableStateOf<ThreadLog?>(null) }
    var readNo by remember(t.id) { mutableStateOf<Int?>(null) }
    var localDone by remember(t.id) { mutableStateOf(false) }
    var fetching by remember(t.id) { mutableStateOf(false) }
    var failed by remember(t.id) { mutableStateOf(false) }
    LaunchedEffect(t.id) {
        val l = vm.peekLog(t)
        log = l
        readNo = l?.readNo?.takeIf { it > 0 }
        localDone = true
        if (peekNeedsFetch(l?.posts.orEmpty(), readNo, target.knownCount, l?.archived == true)) {
            fetching = true
            try { vm.peekFetch(t)?.let { log = it } } catch (e: CancellationException) { throw e } catch (_: Exception) { failed = true }
            fetching = false
        }
    }

    val show = remember { Animatable(0f) }
    val drag = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    var closing by remember { mutableStateOf(false) }
    /** 操作の列から開く小さなメニュー(NG の選び先・その他) */
    var sheet by remember { mutableStateOf<List<MenuItem>?>(null) }
    LaunchedEffect(Unit) {
        if (Motion.reduced) show.snapTo(1f)
        else show.animateTo(1f, tween(PEEK_MS, easing = PeekEasing))
    }
    fun close() {
        if (closing) return
        closing = true
        scope.launch {
            if (!Motion.reduced) {
                // 開くときと同じ道・同じ曲線で行へ戻る。曲線を時間で裏返すと行に着く瞬間が一番速くなり、止まるところで跳ねて見える。
                // なぞって下げた分も同じ時間で戻す
                launch { drag.animateTo(0f, tween(PEEK_MS, easing = PeekEasing)) }
                show.animateTo(0f, tween(PEEK_MS, easing = PeekEasing))
            }
            onDismiss()
        }
    }
    fun open(no: Int?) { vm.openThread(t, no); onDismiss() }

    val danger = Palette.markDanger
    val ngItems = listOfNotNull(
        // authorId はエッヂ・hono-bbs の ID、BE 番号、スレタイの後ろの [名前]。ID の NG なので、立てたスレも書いたレスも隠れる
        t.authorId?.let { a -> MenuItem("立てた人を NG に追加($a)", Icons.Filled.Block, danger = true) { vm.addNg(NgRule("posterId", a)); vm.toast = "立てた人を NG にしました"; close() } },
        MenuItem("スレタイを NG に追加", Icons.Filled.Block, danger = true) { ngDraft = t.title },
    )
    val actions = listOfNotNull(
        PeekAction("開く", "開く", Icons.AutoMirrored.Filled.OpenInNew) { open(null) },
        PeekAction(
            "お気に入り", if (fav) "お気に入りのスレから外す" else "お気に入りのスレに足す",
            if (fav) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, tint = if (fav) Palette.markFav else null,
        ) { vm.toggleFavoriteThread(t); close() },
        PeekAction("コピー", "スレタイと URL をコピー", Icons.Filled.ContentCopy) { copyText(context, "${t.title}\n${TwoCh.webUrl(t)}"); vm.toast = "コピーしました"; close() },
        PeekAction("共有", "共有する", Icons.Filled.Share) { shareText(context, t.title, "${t.title}\n${TwoCh.webUrl(t)}"); close() },
        PeekAction("NG", "NG", Icons.Filled.Block, children = ngItems) { sheet = ngItems },
        if (hasLog) PeekAction("履歴から外す", "履歴から外す", Icons.Filled.History) { vm.removeFromHistory(t); close() } else null,
        if (hasLog) PeekAction("ログを削除", "ログを削除", Icons.Filled.Delete, tint = danger, danger = true) {
            if (vm.prefs.confirmDeleteLog) confirmDel = true else { vm.deleteLogOf(t); close() }
        } else null,
    )

    FullWindow(onDismiss = { close() }) {
        BlurBehind { show.value }
        val density = LocalDensity.current
        val dialogView = LocalView.current
        // 元の行を、この窓の座標に直す
        val from = remember(target) {
            target.from?.let { r -> val loc = IntArray(2); dialogView.rootView.getLocationOnScreen(loc); r.translate(-loc[0].toFloat(), -loc[1].toFloat()) }
        }
        var card by remember { mutableStateOf<Rect?>(null) }
        val closeDrag = with(density) { 110.dp.toPx() }
        fun dragBy(d: Float) { scope.launch { drag.snapTo(maxOf(0f, drag.value + d)) } }
        fun dragEnd(v: Float) { if (drag.value > closeDrag || v > 1800f) close() else scope.launch { drag.animateTo(0f, tween(180)) } }
        // 中身が一番上にあるときに下へなぞると、窓ごと下がって閉じる
        val pullDown = remember {
            object : NestedScrollConnection {
                override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                    if (source != NestedScrollSource.UserInput || drag.value <= 0f || available.y >= 0f) return Offset.Zero
                    val d = maxOf(available.y, -drag.value)
                    dragBy(d)
                    return Offset(0f, d)
                }
                override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                    if (source != NestedScrollSource.UserInput || available.y <= 0f) return Offset.Zero
                    dragBy(available.y)
                    return Offset(0f, available.y)
                }
                override suspend fun onPreFling(available: Velocity): Velocity {
                    if (drag.value <= 0f) return Velocity.Zero
                    dragEnd(available.y)
                    return available
                }
            }
        }
        val dragState = rememberDraggableState { dragBy(it) }
        val dragModifier = Modifier.draggable(dragState, Orientation.Vertical, onDragStopped = { v -> dragEnd(v) })
        BoxWithConstraints(Modifier.fillMaxSize()) {
            Box(
                Modifier.fillMaxSize()
                    .graphicsLayer { alpha = show.value.coerceIn(0f, 1f) * (1f - drag.value / (closeDrag * 4f)).coerceIn(0f, 1f) }
                    .background(Color.Black.copy(alpha = 0.4f))
                    .clickable(remember { MutableInteractionSource() }, null) { close() },
            )
            Column(
                Modifier.align(Alignment.Center).systemBarsPadding().padding(horizontal = 16.dp, vertical = 20.dp).widthIn(max = 560.dp).fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                val radius = with(density) { 14.dp.toPx() }
                Column(
                    Modifier.weight(1f, fill = false).fillMaxWidth()
                        // 閉じる間は測り直さない(届いたレスで高さが変わると、縮む先の大きさが途中で飛ぶ)
                        .onPlaced { c -> if (closing) return@onPlaced; val b = c.boundsInWindow(); if (b != card) card = b }
                        .graphicsLayer {
                            val c = card
                            val p = show.value
                            translationY = drag.value
                            if (c == null || c.width <= 0f) { alpha = 0f; return@graphicsLayer }
                            if (from == null || Motion.reduced) {
                                // 元の行が分からないときは真ん中でふわっと
                                alpha = p.coerceIn(0f, 1f); scaleX = 0.92f + 0.08f * p; scaleY = scaleX
                                shape = RoundedCornerShape(14.dp); clip = true
                                shadowElevation = 16.dp.toPx() * p.coerceIn(0f, 1f)
                                return@graphicsLayer
                            }
                            // 行の幅・位置から広がる。字がゆがまないよう縦横は同じ倍率で、高さは切り抜きで伸ばす
                            val s0 = from.width / c.width
                            val s = s0 + (1f - s0) * p
                            transformOrigin = TransformOrigin(0f, 0f)
                            scaleX = s; scaleY = s
                            translationX = (from.left - c.left) * (1f - p)
                            translationY = (from.top - c.top) * (1f - p) + drag.value
                            val visibleH = from.height + (c.height - from.height) * p
                            shape = PeekClip(visibleH / s, radius * p.coerceIn(0f, 1f))
                            // 行の上に重なる最後のわずかな間に溶かす。窓を消した瞬間に行の字と入れ替わって見えないように
                            alpha = (p / 0.2f).coerceIn(0f, 1f)
                            clip = true
                            shadowElevation = 16.dp.toPx() * p.coerceIn(0f, 1f)
                        }
                        .background(Palette.surface),
                ) {
                    PeekHeader(vm, t, Modifier.then(dragModifier).clickable { open(null) })
                    HorizontalDivider(color = Palette.border)
                    val pick = remember(log, readNo) { peekPick(log?.posts.orEmpty(), readNo) }
                    val list = rememberLazyListState()
                    // 開いたときの位置は、中身がそろったとき(取ってきて新着が見つかったときも)に 1 度だけ決める
                    var placedFor by remember { mutableStateOf<PeekKind?>(null) }
                    LaunchedEffect(pick.kind, pick.posts.isNotEmpty()) {
                        if (pick.posts.isEmpty() || placedFor == pick.kind) return@LaunchedEffect
                        placedFor = pick.kind
                        list.scrollToItem(peekStartIndex(pick))
                    }
                    // hono-bbs はスレ一覧の時点で 1 レス目を持っているので、届くまでそれを出す
                    val preview = if (pick.posts.isEmpty() && pick.kind == PeekKind.FIRST && t.preview != null) Post(1, "", "", "", t.authorId, t.preview) else null
                    LazyColumn(Modifier.weight(1f, fill = false).nestedScroll(pullDown), state = list, contentPadding = PaddingValues(bottom = 6.dp)) {
                        val posts = pick.posts
                        if (preview != null) item(key = "preview", contentType = "post") { PeekPost(preview) { open(null) } }
                        for (i in posts.indices) {
                            if (i == pick.newFrom) item(key = "new", contentType = "caption") { PeekCaption("新着 ${pick.newCount} 件", Palette.unreadInk, false) }
                            val p = posts[i]
                            item(key = p.no, contentType = "post") { PeekPost(p) { open(peekJumpNo(pick.kind, p.no)) } }
                        }
                        if (pick.kind == PeekKind.LAST) item(key = "last", contentType = "caption") {
                            PeekCaption(if (fetching) "新着を確かめています" else "新着はありません", Palette.textMuted, fetching)
                        }
                        when {
                            (!localDone || fetching) && pick.kind == PeekKind.FIRST -> item(key = "skeleton", contentType = "skeleton") { PeekSkeleton(maxOf(1, 3 - posts.size)) }
                            posts.isEmpty() && preview == null && failed -> item(key = "note", contentType = "note") { PeekNote("読み込めませんでした") }
                            posts.isEmpty() && preview == null && localDone && !fetching -> item(key = "note", contentType = "note") { PeekNote("レスがありません") }
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                PeekActions(
                    actions, onMore = { rest -> sheet = rest.map { a -> MenuItem(a.full, a.icon, a.danger, children = a.children) { a.onClick() } } },
                    modifier = dragModifier.graphicsLayer {
                        val p = show.value.coerceIn(0f, 1f)
                        alpha = p
                        translationY = (1f - p) * 24.dp.toPx() + drag.value
                    },
                )
            }
        }
    }
    sheet?.let { items -> MenuSheet(listOf(items), MenuAt.Center) { sheet = null } }
}

/** 切り抜き: 上から h の高さまで(下の角だけでなく、上の角も丸める) */
private class PeekClip(private val h: Float, private val r: Float) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density) =
        Outline.Rounded(RoundRect(0f, 0f, size.width, minOf(h, size.height), CornerRadius(r)))
}

/** 操作の列の 1 つ。label は列に出す短い名前、full は「その他」のメニューに出す名前 */
private class PeekAction(
    val label: String, val full: String, val icon: ImageVector, val tint: Color? = null, val danger: Boolean = false,
    val children: List<MenuItem>? = null, val onClick: () -> Unit,
)

/** 開き・閉じの長さと曲線(どちらも着く所でゆっくりになる) */
private const val PEEK_MS = 300
private val PeekEasing = CubicBezierEasing(0.2f, 0f, 0f, 1f)

/**
 * 窓の後ろをぼかす(端末がウィンドウをまたぐぼかしに対応していれば)。対応していなければ暗くするだけ。
 * ぼかしの強さは開き具合に合わせて変え、暗さと同じ時間で消す(一度に外すと閉じはじめに後ろが急にはっきりする)
 */
@Composable
private fun BlurBehind(progress: () -> Float) {
    val view = LocalView.current
    val px = with(LocalDensity.current) { 18.dp.toPx() }
    LaunchedEffect(Unit) {
        val w = (view.parent as? androidx.compose.ui.window.DialogWindowProvider)?.window ?: return@LaunchedEffect
        if (android.os.Build.VERSION.SDK_INT < 31 || !w.windowManager.isCrossWindowBlurEnabled) return@LaunchedEffect
        w.addFlags(android.view.WindowManager.LayoutParams.FLAG_BLUR_BEHIND)
        // 窓の設定を毎コマ書き直さないよう、整数の半径が変わったときだけ
        androidx.compose.runtime.snapshotFlow { (px * progress().coerceIn(0f, 1f)).toInt() }.collect { r ->
            w.attributes = w.attributes.also { it.blurBehindRadius = r }
        }
    }
}

/** 板の名前(呼び名 > お気に入りの板の名前 > 開いている一覧の板の名前) */
private fun boardLabel(vm: AppViewModel, url: String): String =
    vm.prefs.boardMeta[url]?.alias
        ?: vm.favorites.firstOrNull { it.url == url }?.name
        ?: vm.stack.filterIsInstance<Page.Threads>().firstOrNull { it.board.url == url }?.board?.name
        ?: url.removePrefix("https://").removePrefix("http://").trimEnd('/')

@Composable
private fun PeekHeader(vm: AppViewModel, t: ThreadSummary, modifier: Modifier) = WithoutBaseFont {
    val now = System.currentTimeMillis()
    Column(modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 10.dp)) {
        Text(t.title.ifEmpty { t.key }, color = Palette.textStrong, fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Bold, maxLines = 3, overflow = TextOverflow.Ellipsis)
        val meta = listOfNotNull(
            boardLabel(vm, t.boardUrl),
            if (t.postCount > 0) "${t.postCount}レス" else null,
            if (t.postCount > 0 && t.createdAt != null) "勢い ${momentumText(momentum(t, now))}" else null,
            t.createdAt?.let { relativeTime(it, now) },
        ).joinToString(" ・ ")
        Text(meta, Modifier.padding(top = 4.dp), color = Palette.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** 中身の中の小さな見出し(新着の数・新着がないこと)。取りに行っている間は印を添える */
@Composable
private fun PeekCaption(text: String, color: Color, checking: Boolean) = WithoutBaseFont {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        if (checking) {
            androidx.compose.material3.CircularProgressIndicator(Modifier.size(12.dp), color = Palette.textMuted, strokeWidth = 1.5.dp)
            Spacer(Modifier.width(6.dp))
        }
        Text(text, color = color, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun PeekPost(p: Post, onClick: () -> Unit) = WithoutBaseFont {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${p.no}", color = Palette.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            if (p.name.isNotBlank()) {
                Spacer(Modifier.width(8.dp))
                Text(p.name, Modifier.weight(1f, fill = false), color = Palette.posterName, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            val tail = listOfNotNull(p.date.takeIf { it.isNotBlank() }, p.id?.let { "ID:$it" }).joinToString(" ")
            if (tail.isNotEmpty()) {
                Spacer(Modifier.width(8.dp))
                Text(tail, Modifier.weight(1f), color = Palette.textMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Text(
            peekBody(p.body), Modifier.padding(top = 3.dp), color = Palette.textBody, fontSize = 14.sp, lineHeight = 20.sp,
            maxLines = PEEK_BODY_LINES, overflow = TextOverflow.Ellipsis,
        )
    }
}

/** 届くまでの仮のレス(頭の短い棒 + 本文の棒) */
@Composable
private fun PeekSkeleton(count: Int) {
    val tr = androidx.compose.animation.core.rememberInfiniteTransition(label = "peek-skeleton")
    val a by tr.animateFloat(
        0.45f, 0.9f,
        androidx.compose.animation.core.infiniteRepeatable(tween<Float>(800), androidx.compose.animation.core.RepeatMode.Reverse),
        label = "pulse",
    )
    val bar = Palette.textMuted.copy(alpha = 0.18f)
    Column(Modifier.fillMaxWidth().graphicsLayer { alpha = a }) {
        val widths = listOf(0.9f, 0.72f, 0.84f, 0.6f)
        repeat(count) { i ->
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                Box(Modifier.fillMaxWidth(0.4f).height(10.dp).background(bar, RoundedCornerShape(3.dp)))
                Spacer(Modifier.height(9.dp))
                for (j in 0 until 2 + i % 2) {
                    Box(Modifier.fillMaxWidth(widths[(i + j) % widths.size]).height(12.dp).background(bar, RoundedCornerShape(3.dp)))
                    Spacer(Modifier.height(7.dp))
                }
            }
        }
    }
}

@Composable
private fun PeekNote(text: String) {
    Text(text, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 20.dp), color = Palette.textMuted, fontSize = 13.sp, textAlign = TextAlign.Center)
}

/** 操作の列。入りきらない分は右端の「その他」から、ふつうのメニューで出す */
@Composable
private fun PeekActions(actions: List<PeekAction>, onMore: (List<PeekAction>) -> Unit, modifier: Modifier) = WithoutBaseFont {
    val shape = RoundedCornerShape(14.dp)
    BoxWithConstraints(modifier.fillMaxWidth().background(Palette.surface, shape).border(1.dp, Palette.border, shape)) {
        val slots = maxOf(2, (maxWidth / 58.dp).toInt())
        val (row, rest) = if (actions.size <= slots) actions to emptyList() else actions.take(slots - 1) to actions.drop(slots - 1)
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
            for (a in row) PeekActionButton(a.label, a.full, a.icon, a.tint, a.danger, Modifier.weight(1f), a.onClick)
            if (rest.isNotEmpty()) PeekActionButton("その他", "その他", Icons.Filled.MoreHoriz, null, false, Modifier.weight(1f)) { onMore(rest) }
        }
    }
}

@Composable
private fun PeekActionButton(label: String, full: String, icon: ImageVector, tint: Color?, danger: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val color = if (danger) Palette.markDanger else Palette.textBody
    Column(
        modifier.heightIn(min = 60.dp).clip10().clickable(onClick = onClick).padding(horizontal = 2.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, full, tint = tint ?: if (danger) Palette.markDanger else Palette.textMuted, modifier = Modifier.size(22.dp))
        Text(label, Modifier.padding(top = 4.dp), color = color, fontSize = 10.sp, lineHeight = 12.sp, maxLines = 2, textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
    }
}

private fun Modifier.clip10() = padding(horizontal = 2.dp).clip(RoundedCornerShape(10.dp))
