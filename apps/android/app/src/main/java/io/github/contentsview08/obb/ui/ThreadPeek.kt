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
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Title
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
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.Page
import io.github.contentsview08.obb.bbs.BodyToken
import io.github.contentsview08.obb.bbs.Post
import io.github.contentsview08.obb.bbs.bodyTokens
import io.github.contentsview08.obb.bbs.isYoutubeUrl
import io.github.contentsview08.obb.bbs.splitBeIcon
import io.github.contentsview08.obb.bbs.toImageUrl
import io.github.contentsview08.obb.bbs.youtubeIdOf
import io.github.contentsview08.obb.data.normalizeForSearch
import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.bbs.TwoCh
import io.github.contentsview08.obb.data.NgRule
import io.github.contentsview08.obb.data.ThreadLog
import io.github.contentsview08.obb.bbs.PostIndex
import io.github.contentsview08.obb.bbs.legacyAuthorId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch

// ── 中身の選び方(画面から切り離してテストする) ──

/** のぞいたときの開く位置の決まり: 開いたことがない(1 番目から)・新着(新着の頭から)・新着がない(一番下) */
enum class PeekKind { FIRST, NEW, LAST }

/**
 * のぞく窓に並べるもの。posts は手元のレス全部(番号順)。
 * newFrom: 新着の頭の posts の中の位置(新着のないときは -1)。見出し「新着 N 件」はその前に置く
 */
class PeekPick(val kind: PeekKind, val posts: List<Post>, val newCount: Int = 0, val newFrom: Int = -1)

/** 頭から読むスレで、先に組み立てて出すレスの数(窓に入りきる分より多め) */
internal const val PEEK_FIRST_BATCH = 30

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

/**
 * レスの本文にある画像(サムネイルの URL)と YouTube(動画の ID と URL)。見分け方はスレ表示(PostIndex)と同じ。
 * 同じものは 1 つにする
 */
internal fun peekMedia(body: String): Pair<List<String>, List<Pair<String, String>>> {
    val images = ArrayList<String>()
    val youtube = ArrayList<Pair<String, String>>()
    for (t in bodyTokens(splitBeIcon(body).second)) if (t is BodyToken.Url) {
        val img = toImageUrl(t.url)
        if (img != null) { if (img !in images) images += img }
        else if (isYoutubeUrl(t.url)) youtubeIdOf(t.url)?.let { id -> if (youtube.none { it.first == id }) youtube += id to t.url }
    }
    return images to youtube
}

/** サムネイルを並べる数。rows 行に入りきらなければ、最後の 1 枠を「+N」にする。戻りは(出す数, N) */
internal fun peekThumbFit(total: Int, perRow: Int, rows: Int = 2): Pair<Int, Int> {
    val cap = maxOf(1, perRow) * rows
    return if (total <= cap) total to 0 else (cap - 1) to (total - (cap - 1))
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
    /** キーワードに登録する画面(選んだ種類: true なら立てた人で) */
    var keywordDraft by remember(t.id) { mutableStateOf<Boolean?>(null) }
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

    keywordDraft?.let { byAuthor ->
        KeywordDraftDialog(vm, t.title, t.authorId, byAuthor, onDismiss)
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
        // authorId はエッヂ・hono-bbs の ID、subject.txt のスレタイの後ろの [ID]。ID の NG なので、立てたスレも書いたレスも隠れる
        t.authorId?.let { a -> MenuItem("立てた人を NG に追加($a)", Icons.Filled.Block, danger = true) { vm.addNg(NgRule("posterId", a)); vm.toast = "立てた人を NG にしました"; close() } },
        MenuItem("スレタイを NG に追加", Icons.Filled.Block, danger = true) { ngDraft = t.title },
    )
    // キーワードに登録: スレタイで(削って登録する)・立てた人で。どちらも確かめる画面を出してから登録する(PC の KeywordDialog と同じ)
    val keywordItems = listOfNotNull(
        MenuItem("スレタイで登録", Icons.Filled.Title) { keywordDraft = false },
        t.authorId?.let { a -> MenuItem("立てた人で登録($a)", Icons.Filled.Person) { keywordDraft = true } },
    )
    val actions = listOfNotNull(
        PeekAction("開く", "開く", Icons.AutoMirrored.Filled.OpenInNew) { open(null) },
        PeekAction(
            "お気に入り", if (fav) "お気に入りのスレから外す" else "お気に入りのスレに足す",
            if (fav) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, tint = if (fav) Palette.markFav else null,
        ) { vm.toggleFavoriteThread(t); close() },
        PeekAction("コピー", "スレタイと URL をコピー", Icons.Filled.ContentCopy) { copyText(context, "${t.title}\n${TwoCh.webUrl(t)}"); vm.toast = "コピーしました"; close() },
        PeekAction("共有", "共有する", Icons.Filled.Share) { shareText(context, t.title, "${t.title}\n${TwoCh.webUrl(t)}"); close() },
        PeekAction("キーワード", "キーワードに登録", Icons.Filled.Sell, children = keywordItems) { sheet = keywordItems },
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
                // 高さは画面の 65% まで。上下に後ろの画面を残して、外を押せば閉じると分かるようにする。
                // 縦は真ん中より少し下(親指が操作の列に届くように。上には 2 割ほど残る)
                Modifier.align(androidx.compose.ui.BiasAlignment(0f, 0.25f)).systemBarsPadding().padding(horizontal = 20.dp)
                    .heightIn(max = maxHeight * 0.65f).widthIn(max = 560.dp).fillMaxWidth(),
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
                    PeekHeader(vm, t, Modifier.then(dragModifier).clickable { open(null) }, onClose = { close() })
                    HorizontalDivider(color = Palette.border)
                    val livePick = remember(log, readNo) { peekPick(log?.posts.orEmpty(), readNo) }
                    // hono-bbs はスレ一覧の時点で 1 レス目を持っているので、届くまでそれを出す
                    val preview = if (livePick.posts.isEmpty() && livePick.kind == PeekKind.FIRST && t.preview != null) Post(1, "", "", "", t.authorId, t.preview) else null
                    // レスはスレ表示と同じ組み立て・同じ部品(PostItem)で描く。スキン・配色・字と余白の設定がそのまま効くように
                    val style = vm.prefs.postStyle
                    val src = preview?.let { listOf(it) } ?: livePick.posts
                    val recipe = vm.threadRenderRecipe(t.boardUrl)
                    val tidy = vm.prefs.tidyBlankLines
                    val fromWatchoi = vm.prefs.iconFromWatchoi
                    val links = remember { PostLinks() }
                    var own by remember(t.id) { mutableStateOf<Set<Int>>(emptySet()) }
                    LaunchedEffect(t.id) { own = runCatching { vm.peekOwnPosts(t) }.getOrDefault(emptySet()) }
                    var shown by remember(t.id) { mutableStateOf<PeekRendered?>(null) }
                    LaunchedEffect(livePick, preview, recipe, tidy, fromWatchoi, Palette.scheme.key) {
                        // 頭から読むスレは、窓に入る分を先に組み立てて出し、残りはそのあとで足す(長いスレでも待たせない)
                        if (preview == null && livePick.kind == PeekKind.FIRST && livePick.posts.size > PEEK_FIRST_BATCH) {
                            val head = PeekPick(PeekKind.FIRST, livePick.posts.take(PEEK_FIRST_BATCH))
                            shown = withContext(Dispatchers.Default) { peekRender(head, null, tidy, fromWatchoi, links, recipe.build(livePick.posts)) }
                        }
                        shown = withContext(Dispatchers.Default) { peekRender(livePick, preview, tidy, fromWatchoi, links, recipe.build(src)) }
                    }
                    val pick = shown?.pick ?: PeekPick(livePick.kind, emptyList())
                    val list = rememberLazyListState()
                    // 開いたときの位置は、中身がそろったとき(取ってきて新着が見つかったときも)に 1 度だけ決める
                    var placedFor by remember { mutableStateOf<PeekKind?>(null) }
                    LaunchedEffect(pick.kind, pick.posts.isNotEmpty()) {
                        if (pick.posts.isEmpty() || placedFor == pick.kind) return@LaunchedEffect
                        placedFor = pick.kind
                        list.scrollToItem(peekStartIndex(pick))
                    }
                    // 本文の中のアンカー・URL などを押したときも、スレを開く(アンカーはその先へ)
                    links.onTag = { tag ->
                        val n = tag.substringAfter(':').substringBefore(',').toIntOrNull()
                        open(if (n != null && tag[0] in "arxn") peekJumpNo(pick.kind, n) else null)
                    }
                    // サムネイルの読み方はスレ表示と同じ設定に従う
                    val wifi = rememberIsWifi(vm.prefs.thumbMode == io.github.contentsview08.obb.data.ThumbMode.WIFI)
                    val thumbs = remember(vm.prefs.thumbMode, vm.prefs.blurGross, vm.prefs.grossWords, wifi) {
                        val mode = vm.prefs.thumbMode
                        if (mode == io.github.contentsview08.obb.data.ThumbMode.NEVER) null
                        else PeekThumbs(
                            autoLoad = when (mode) {
                                io.github.contentsview08.obb.data.ThumbMode.ALWAYS -> true
                                io.github.contentsview08.obb.data.ThumbMode.WIFI -> wifi
                                else -> false
                            },
                            grossWords = if (vm.prefs.blurGross) vm.prefs.grossWords.lines().map { normalizeForSearch(it.trim()) }.filter { it.isNotEmpty() } else emptyList(),
                        )
                    }
                    val onSky = Palette.onSky(style)
                    val muted = if (onSky) Palette.skyMuted else Palette.textMuted
                    LazyColumn(
                        Modifier.weight(1f, fill = false).background(Palette.threadBg(style)).nestedScroll(pullDown),
                        state = list, contentPadding = PaddingValues(bottom = 6.dp),
                    ) {
                        val r = shown
                        val posts = r?.posts.orEmpty()
                        for (i in posts.indices) {
                            if (r != null && i == pick.newFrom) item(key = "new", contentType = "caption") { PeekCaption("新着 ${pick.newCount} 件", if (onSky) Palette.skyText else Palette.unreadInk, false) }
                            val p = posts[i]
                            // 新着の見出しの後ろは、前のレスと続けない(Discord 風・LINE 風のアイコンを省かない)
                            val prev = if (i == pick.newFrom) null else posts.getOrNull(i - 1)
                            item(key = if (r?.preview == true) "preview" else p.no, contentType = "post") {
                                if (r != null) PeekPost(r, p, prev, style, own, thumbs) { open(if (r.preview) null else peekJumpNo(pick.kind, p.no)) }
                            }
                        }
                        if (r != null && pick.kind == PeekKind.LAST) item(key = "last", contentType = "caption") {
                            PeekCaption(if (fetching) "新着を確かめています" else "新着はありません", muted, fetching)
                        }
                        val empty = r == null || (posts.isEmpty())
                        when {
                            (!localDone || fetching) && livePick.kind == PeekKind.FIRST -> item(key = "skeleton", contentType = "skeleton") { PeekSkeleton(maxOf(1, 3 - posts.size)) }
                            // 組み立てを待つ間(ほんの少し)
                            r == null && livePick.posts.isNotEmpty() -> item(key = "skeleton", contentType = "skeleton") { PeekSkeleton(2) }
                            empty && failed -> item(key = "note", contentType = "note") { PeekNote("読み込めませんでした", muted) }
                            empty && localDone && !fetching && r != null -> item(key = "note", contentType = "note") { PeekNote("レスがありません", muted) }
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
private fun PeekHeader(vm: AppViewModel, t: ThreadSummary, modifier: Modifier, onClose: () -> Unit) = WithoutBaseFont {
    val now = System.currentTimeMillis()
    Column(modifier.fillMaxWidth().padding(start = 16.dp, end = 6.dp, top = 8.dp, bottom = 10.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Text(
                t.title.ifEmpty { t.key }, Modifier.weight(1f).padding(top = 6.dp), color = Palette.textStrong, fontSize = 16.sp, lineHeight = 22.sp,
                fontWeight = FontWeight.Bold, maxLines = 3, overflow = TextOverflow.Ellipsis,
            )
            // 閉じ方が分かるように(外を押す・下へなぞる・戻るでも閉じる)
            Box(Modifier.size(36.dp).clip(androidx.compose.foundation.shape.CircleShape).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Close, "閉じる", tint = Palette.textMuted, modifier = Modifier.size(20.dp))
            }
        }
        val meta = listOfNotNull(
            boardLabel(vm, t.boardUrl),
            if (t.postCount > 0) "${t.postCount}レス" else null,
            if (t.postCount > 0 && t.createdAt != null) "勢い ${momentumText(momentum(t, now))}" else null,
            t.createdAt?.let { relativeTime(it, now) },
        ).joinToString(" ・ ")
        Text(meta, Modifier.padding(top = 2.dp, end = 10.dp), color = Palette.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
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

/**
 * のぞく窓に描く中身: 並べたもの(pick)を、スレ表示と同じ組み立て(renderPosts)にかけたもの。
 * posts は描く順のレス(プレビューのときはそれ 1 件)。preview: hono-bbs のスレ一覧の 1 レス目を仮に出している
 */
private class PeekRendered(
    val pick: PeekPick, val posts: List<Post>, val index: PostIndex, val rendered: Map<Int, RenderedPost>, val preview: Boolean,
    /** アイコンの種(peekIconKey)ごとの書き込み数 */
    val iconCounts: Map<String, Int>,
)

/** アイコンの種: 設定でワッチョイから作ることにしていて、名前にワッチョイがあればそれ。なければ ID(スレ表示と同じ) */
private fun peekIconKey(p: Post, fromWatchoi: Boolean): String? = if (fromWatchoi) watchoiOf(p.name) ?: p.id else p.id

/**
 * のぞく窓のレスを組み立てる(画面とは別のスレッドで)。長すぎる本文は頭の数行で切る。
 * AA は切ると崩れるので切らない(スレ表示と同じく AA 用の字で横幅に収める)
 */
private fun peekRender(pick: PeekPick, preview: Post?, tidy: Boolean, fromWatchoi: Boolean, links: PostLinks, o: RenderOptions): PeekRendered {
    val src = preview?.let { listOf(it) } ?: pick.posts
    val trimmed = src.map { if (looksLikeAa(it.body)) it else it.copy(body = peekBody(it.body)) }
    val index = PostIndex.build(trimmed, tidy, emptyList())
    val icons = trimmed.mapNotNull { peekIconKey(it, fromWatchoi) }.groupingBy { it }.eachCount()
    return PeekRendered(pick, trimmed, index, renderPosts(index, links, o), preview != null, icons)
}

/**
 * レス 1 件。スレ表示と同じ PostItem で、いまのスキン(カード・LINE 風など)・配色・字と余白の設定どおりに描く。
 * アンカーのポップアップ・アイコンのメニューなどは出さず、押せばスレを開く
 */
@Composable
private fun PeekPost(r: PeekRendered, p: Post, prev: Post?, style: String, own: Set<Int>, thumbs: PeekThumbs?, onClick: () -> Unit) {
    val rp = r.rendered[p.no] ?: return
    val prefs = LocalPrefs.current
    val index = r.index
    fun iconKey(x: Post): String? = peekIconKey(x, prefs.iconFromWatchoi)
    val isOwn = p.no in own
    val toOwn = !isOwn && own.isNotEmpty() && own.any { p.no in (index.replies[it] ?: emptyList()) }
    val chat = isChatStyle(style)
    // 続けて書いたレスはアイコンと頭を省く(スレ表示と同じ決まり)
    val continued = chat && prev != null && p.id != null && prev.id == p.id && rp.replyTo == null &&
        ((index.replyCount[p.no] ?: 0) == 0 || (style == "line" && isOwn))
    val reply = rp.replyTo?.let { n ->
        r.posts.firstOrNull { it.no == n }?.let { t ->
            ReplyPreview(n, iconKey(t), io.github.contentsview08.obb.bbs.splitBeIcon(t.body).second.lineSequence().firstOrNull { it.isNotBlank() && !it.trimStart().startsWith(">>") }?.trim() ?: "")
        } ?: ReplyPreview(n, null, ">>$n")
    }
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        WithoutBaseFont {
            PostItem(
                rp, aa = rp.aa, own = isOwn, toOwn = toOwn, info = null, autoLoad = false,
                style = style, id = p.id, iconCount = iconKey(p)?.let { r.iconCounts[it] } ?: 0, continued = continued, reply = reply, onReply = { onClick() },
                heat = Palette.heat(index.replyCount[p.no] ?: 0),
            )
        }
        // 画像は小さく 2 行まで(PostItem のサムネイルは使わない)。字の始まりにそろえる
        if (thumbs != null) {
            val right = style == "line" && isOwn
            val start = when {
                style == "line" && !right -> 10.dp + AVATAR + 8.dp
                style == "discord" -> 12.dp + AVATAR + 10.dp
                style == "line" -> 10.dp
                else -> 14.dp
            }
            PeekThumbRow(p, thumbs, onClick, Modifier.padding(start = start, end = if (chat) 10.dp else 14.dp, bottom = 8.dp), alignEnd = right)
        }
    }
}

/** サムネイルの読み方。autoLoad でなければ「画像」の札を出し、押したものだけ読む。grossWords: 当たるレスはぼかす */
private class PeekThumbs(val autoLoad: Boolean, val grossWords: List<String>)

private const val PEEK_THUMB = 68

/**
 * レスの画像を小さく横に並べる(どんな画像があるかの見本)。右端で折り返して 2 行まで、残りは「+N」。
 * 押してもビューアーは開かず、レスを押したのと同じくスレを開く
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun PeekThumbRow(p: Post, thumbs: PeekThumbs, onClick: () -> Unit, modifier: Modifier = Modifier, alignEnd: Boolean = false) {
    val media = remember(p.no, p.body) { peekMedia(p.body) }
    // YouTube はスレ表示と同じく動画の絵に再生の印を重ねる
    val all = remember(media) { media.first.map { it to false } + media.second.map { (id, _) -> "https://i.ytimg.com/vi/$id/hqdefault.jpg" to true } }
    if (all.isEmpty()) return
    val blurred = remember(p.no, p.body, thumbs) { thumbs.grossWords.isNotEmpty() && normalizeForSearch(p.body).let { b -> thumbs.grossWords.any { b.contains(it) } } }
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val gap = 6.dp
        val perRow = ((maxWidth + gap) / (PEEK_THUMB.dp + gap)).toInt()
        val (n, more) = peekThumbFit(all.size, perRow)
        androidx.compose.foundation.layout.FlowRow(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(gap, if (alignEnd) Alignment.End else Alignment.Start), verticalArrangement = Arrangement.spacedBy(gap),
        ) {
            for ((url, play) in all.take(n)) Thumbnail(url, thumbs.autoLoad, { onClick() }, blurred, play = play, size = PEEK_THUMB)
            if (more > 0) {
                val shape = RoundedCornerShape(5.dp)
                Box(
                    Modifier.size(PEEK_THUMB.dp).clip(shape).background(Palette.surface2).border(1.dp, Palette.border, shape).clickable(onClick = onClick),
                    contentAlignment = Alignment.Center,
                ) { Text("+$more", color = Palette.textMuted, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
            }
        }
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
private fun PeekNote(text: String, color: Color = Palette.textMuted) {
    Text(text, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 20.dp), color = color, fontSize = 13.sp, textAlign = TextAlign.Center)
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

/**
 * キーワードに登録する画面。スレタイは全体で登録することはまずなく、ある言葉まで削って登録するので、全体を選んだ状態で開く。
 * 立てた人は ID のまま、見て確かめてから登録する(PC の components/KeywordDialog.tsx と同じ言葉)
 */
@Composable
private fun KeywordDraftDialog(vm: AppViewModel, title: String, authorId: String?, byAuthorFirst: Boolean, onDismiss: () -> Unit) {
    var byAuthor by remember { mutableStateOf(byAuthorFirst && authorId != null) }
    fun initial(a: Boolean) = if (a) authorId.orEmpty() else title
    var field by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(initial(byAuthor), androidx.compose.ui.text.TextRange(0, initial(byAuthor).length))) }
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    LaunchedEffect(byAuthor) { runCatching { focus.requestFocus() } }
    val w = field.text.trim()
    val list = if (byAuthor) vm.prefs.keywordAuthors.lines().map { legacyAuthorId(it.trim()) } else vm.prefs.keywords.lines().map { it.trim() }
    val dup = w in list
    val ok = w.isNotEmpty() && !dup
    fun submit() {
        if (!ok) return
        if (byAuthor) vm.prefs.keywordAuthors = (vm.prefs.keywordAuthors.lines().filter { it.isNotBlank() } + w).joinToString("\n")
        else vm.prefs.keywords = (vm.prefs.keywords.lines().filter { it.isNotBlank() } + w).joinToString("\n")
        vm.toast = "キーワードに登録しました"
        onDismiss()
    }
    fun pick(a: Boolean) {
        byAuthor = a
        val v = initial(a)
        field = androidx.compose.ui.text.input.TextFieldValue(v, androidx.compose.ui.text.TextRange(0, v.length))
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("キーワードに登録") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (authorId != null) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    KeywordKindChip("スレタイで登録", !byAuthor) { pick(false) }
                    KeywordKindChip("立てた人で登録", byAuthor) { pick(true) }
                }
                OutlinedTextField(
                    field, { field = it },
                    singleLine = true,
                    label = { Text(if (byAuthor) "立てた人の ID" else "キーワード") },
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done),
                    keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { submit() }),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus),
                )
                Text(
                    when {
                        dup -> "もう登録してあります"
                        byAuthor -> "この人が立てたスレを、スレ一覧の上にまとめます(ID が同じときだけ)"
                        else -> "この言葉をスレタイに含むスレを、スレ一覧の上にまとめます。要らない所を削って登録してください"
                    },
                    color = Palette.textMuted, fontSize = 12.sp,
                )
            }
        },
        confirmButton = { TextButton(onClick = { submit() }, enabled = ok) { Text("登録") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("やめる") } },
    )
}

@Composable
private fun KeywordKindChip(label: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.clip(RoundedCornerShape(50)).border(1.dp, if (on) Palette.accent else Palette.border, RoundedCornerShape(50))
            .background(if (on) Palette.accentWash else Color.Transparent).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 6.dp),
    ) { Text(label, color = if (on) Palette.accent else Palette.textBody, fontSize = 14.sp) }
}
