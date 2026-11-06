package io.github.contentsview08.obb.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.FormatSize
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.FormatQuote
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.KeyboardDoubleArrowDown
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.UnfoldLess
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.HowToReg
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.GroupRemove
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.VerticalAlignBottom
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import kotlin.math.roundToInt
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.imePadding
import kotlinx.coroutines.flow.first
import androidx.compose.ui.draw.shadow
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.ui.draw.drawBehind
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.Animatable
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.Page
import io.github.contentsview08.obb.bbs.Filter
import io.github.contentsview08.obb.bbs.Post
import io.github.contentsview08.obb.bbs.TwoCh
import io.github.contentsview08.obb.bbs.toImageUrl
import io.github.contentsview08.obb.data.NgRule
import io.github.contentsview08.obb.data.ThumbMode
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/** 絞り込みのタブ。「すべて」は FilterTabs で足す */
private val TABS: List<Pair<Filter, ImageVector>> = listOf(
    Filter.POPULAR to Icons.Filled.LocalFireDepartment,
    Filter.IMAGE to Icons.Filled.Image,
    Filter.VIDEO to Icons.Filled.PlayCircle,
    Filter.LINK to Icons.Filled.Link,
)

/** スレタイの後ろの番号([1234567890])。見せるときは省く */
private val TITLE_THREAD_NO = Regex("\\s*[\\[［][0-9]{6,12}[\\]］]\\s*$")

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ThreadScreen(vm: AppViewModel, page: Page.Thread, modifier: Modifier = Modifier) {
    val index = page.index
    // AI NG: レス・条件・手の印が変わったときと、当たり具合が届いたときに判定し直す
    val ai = io.github.contentsview08.obb.data.AiModel
    LaunchedEffect(index, ai.version, ai.status, vm.prefs.aiNgEnabled, vm.prefs.aiNgRules, vm.prefs.aiNgOverrides) { vm.applyAiNg(page) }
    val context = LocalContext.current
    val view = androidx.compose.ui.platform.LocalView.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val bars = rememberHideOnScroll()
    // 一覧へ戻って「進む」で開き直しても残すためページに持つ
    var filter by page::filter
    var searching by page::searching
    var query by page::query
    // 下から順に。押した所の高さ・押したレスは、指を置いたときに控えておく
    val popups = remember { mutableStateListOf<PopupEntry>() }
    // アンカーをたどったレス。ポップアップを閉じたあとも少しのあいだ色を付け、どこだったか分かるようにする
    var traced by remember { mutableStateOf<Set<Int>>(emptySet()) }
    LaunchedEffect(popups.isEmpty(), traced) { if (popups.isEmpty() && traced.isNotEmpty()) { delay(1800); traced = emptySet() } }
    var popupSeq by remember { mutableIntStateOf(0) }
    var downY by remember { mutableFloatStateOf(0f) }
    var downX by remember { mutableFloatStateOf(-1f) }
    var downNo by remember { mutableIntStateOf(0) }
    fun openPopup(posts: List<Post>, tree: List<io.github.contentsview08.obb.bbs.TreeRow>? = null, focus: Int? = null) {
        if (posts.isNotEmpty()) popups += PopupEntry(++popupSeq, posts, tree, downY, focus, downX)
    }
    // ポップアップを閉じて帯を出してから欄に入る。ポップアップが残ると欄を隠し、メニューの窓が閉じきる前だとキーボードが出ない
    fun replyWith(text: String?) {
        popups.clear()
        bars.show()
        vm.openReply(page, text)
    }
    var menu by remember { mutableStateOf(false) }
    var postMenu by remember { mutableStateOf<Post?>(null) }
    var ngWordFor by remember { mutableStateOf<Post?>(null) }
    /** 種類「i」「n」と、そのレス */
    var headMenu by remember { mutableStateOf<Pair<Char, Post>?>(null) }
    var gallery by remember { mutableStateOf(false) }
    var nextSheet by remember { mutableStateOf(false) }
    /** 中身を見せている NG のレス */
    var revealed by remember { mutableStateOf(emptySet<Int>()) }
    var viewer by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    fun askDeleteLog() { if (vm.prefs.confirmDeleteLog) confirmDelete = true else vm.deleteLog(page) }
    fun favoriteItem() = MenuItem(if (page.favorite) "お気に入りのスレから外す" else "お気に入りのスレに足す", if (page.favorite) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder) { vm.toggleFavoriteThread(page) }
    var fontDialog by remember { mutableStateOf(false) }
    var styleSheet by remember { mutableStateOf(false) }
    val safeName = remember(page.title) { page.title.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(60) }
    val saveText = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.CreateDocument("text/plain")) { uri -> if (uri != null) vm.saveThread(page, uri, html = false) }
    val saveHtml = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.CreateDocument("text/html")) { uri -> if (uri != null) vm.saveThread(page, uri, html = true) }
    /** 長押しで「AAとして表示」「文字列として表示」を選んだレス */
    var aaOverride by remember { mutableStateOf(mapOf<Int, Boolean>()) }
    var aaZoom by remember { mutableStateOf<Int?>(null) }
    var pinchLabel by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(pinchLabel) { if (pinchLabel != null) { delay(900); pinchLabel = null } }
    val swipe = rememberSwipeState()
    var ngEditing by remember { mutableStateOf<NgRule?>(null) }
    // NG のレスだけ調べる。レスの数だけ毎回は調べない
    fun ngHitsOf(p: Post) = if (p.no in page.ngNos) io.github.contentsview08.obb.data.NgMatcher(vm.prefs.ngRules).postHits(p, page.summary.boardUrl) else null
    // その文字ちょうどの NG は押すだけで外す。正規表現・部分一致は別のレスにも効いているので編集を開く
    fun ngOffItems(rules: List<NgRule>, what: String, value: String?): List<MenuItem> {
        val (exact, others) = io.github.contentsview08.obb.data.splitNgHits(rules, value)
        return (if (exact.isEmpty()) emptyList() else listOf(MenuItem("この${if (what == "ID") " ID " else what}を NG から外す", Icons.AutoMirrored.Filled.Undo) {
            exact.forEach { vm.removeNg(it) }
            vm.toast = "NG から外しました"
        })) + others.map { r ->
            MenuItem("$what の NG「${if (r.pattern.length > 12) r.pattern.take(12) + "…" else r.pattern}」を開く", Icons.Filled.EditNote) { ngEditing = r }
        }
    }
    fun idNgItems(p: Post): List<MenuItem> = p.id?.let { id ->
        listOf(
            MenuItem("この ID を NG に(今日だけ)", Icons.Filled.Schedule) { vm.addNg(NgRule("id", id, expiresOn = io.github.contentsview08.obb.data.today())) },
            MenuItem("この ID を NG に", Icons.Filled.Block) { vm.addNg(NgRule("id", id)) },
        )
    }.orEmpty()
    fun nameNgItem(p: Post) = MenuItem("この名前を NG に", Icons.Filled.Block) { vm.addNg(NgRule("name", p.name)) }
    val own = page.ownNos
    val toOwn = remember(index, own) { own.flatMap { index.replies[it] ?: emptyList() }.toSet() - own }
    val autoLoad = remember(vm.prefs.thumbMode) {
        when (vm.prefs.thumbMode) {
            ThumbMode.ALWAYS -> true
            ThumbMode.WIFI -> isWifi(context)
            ThumbMode.TAP, ThumbMode.NEVER -> false
        }
    }
    val counts = remember(index, own) { Filter.entries.associateWith { index.count(it, own) } }
    val shown = remember(index, filter, own, query) {
        var list = index.posts
        val f = filter
        if (f != null) list = list.filter { index.matches(it, f, own) }
        val terms = io.github.contentsview08.obb.data.searchTerms(query)
        if (terms.isNotEmpty()) list = list.filter { io.github.contentsview08.obb.data.matchesTerms("${it.no} ${it.name} ${it.id ?: ""} ${it.body}", terms) }
        list
    }
    // 続けて並んだあぼーんのまとまり。絞り込み・検索の間はまとめない。薄く表示の NG は読めるのでまとめない
    val ngStyleNow = vm.prefs.ngStyle
    val ngGroups = remember(index, page.ngNos, page.aiNg, ngStyleNow, vm.prefs.groupNg, filter, query, page.unreadFrom) {
        if (!vm.prefs.groupNg || filter != null || query.isNotBlank()) io.github.contentsview08.obb.data.NgRuns.NONE
        else io.github.contentsview08.obb.data.ngRuns(index.posts.map { it.no }, page.unreadFrom) { no ->
            val ai = page.aiNg[no]
            when {
                no in page.ngNos -> when (ngStyleNow) {
                    "fold" -> io.github.contentsview08.obb.data.NgRunKind.RULE
                    "hide" -> io.github.contentsview08.obb.data.NgRunKind.SKIP
                    else -> null
                }
                ai?.rule?.show == "fold" -> io.github.contentsview08.obb.data.NgRunKind.AI
                ai?.rule?.show == "hide" -> io.github.contentsview08.obb.data.NgRunKind.SKIP
                else -> null
            }
        }
    }
    /** 広げたまとまり(先頭のレス番号) */
    var openRuns by remember { mutableStateOf(emptySet<Int>()) }
    val listState = page.listState

    val ctl = page.scroll
    var footerH by remember { mutableFloatStateOf(0f) }
    // 作ったときの並びを覚えたままだと、開いたときに位置が見つからず一番下へ飛ぶ
    val shownNow = androidx.compose.runtime.rememberUpdatedState(shown)
    val scroller = remember(page, listState) {
        ThreadScroller(ctl, listState, scope, { shownNow.value }, { footerH }, with(density) { 80.dp.toPx() })
    }
    // 更新の前に既読を知らせる。「ここから未読」を古い位置で引き直さないように
    fun refresh(): kotlinx.coroutines.Job? { reportRead(ctl, scroller, vm, page); return vm.refreshThread(page) }
    LaunchedEffect(page, index.posts.isNotEmpty()) {
        if (ctl.positioned || index.posts.isEmpty()) return@LaunchedEffect
        snapshotFlow { listState.layoutInfo.totalItemsCount }.first { it > 0 }
        // レスへ飛ぶときは、ふだんの開く位置を読んだことにしない
        val jumping = page.jumpNo != null
        ctl.keepJump = jumping
        if (jumping) scroller.open(null, "top") else scroller.open(vm.position(page.summary.id), vm.prefs.openPosition)
        if (!jumping) reportRead(ctl, scroller, vm, page)
    }
    // 飛ぶ先のレスは新着の取得で届くことがあるので、取り終えるまで待つ
    val fetched = page.loaded && !page.loading
    LaunchedEffect(page, page.jumpNo, ctl.positioned, index.posts.size, fetched) {
        val no = page.jumpNo ?: return@LaunchedEffect
        if (!ctl.positioned) return@LaunchedEffect
        if (index.posts.any { it.no == no }) {
            scroller.toUnreadNow(no)
            ctl.jumpFlash = no to System.nanoTime()
            page.jumpNo = null
            reportRead(ctl, scroller, vm, page)
        } else if (fetched) {
            page.jumpNo = null
            vm.toast = "$no 番のレスはありません"
        }
    }
    // 一覧へ戻って「進む」で開き直したとき: 一番下まで読んでいたなら一番下へ(戻る前と同じ所から続けて読めるように)
    LaunchedEffect(page) {
        if (ctl.positioned && vm.position(page.summary.id)?.bottom == true) {
            snapshotFlow { listState.layoutInfo.totalItemsCount }.first { it > 0 }
            scroller.toBottomNow()
            bars.show()
        }
    }
    LaunchedEffect(index.posts.size) { scroller.grew(vm.prefs.autoScrollOnNew) }
    // grew のあとに外す(同じ組み立てで新着と取得の終わりが届いたときも、新着で位置を動かさないように)
    LaunchedEffect(fetched) { if (fetched) ctl.keepJump = false }
    LaunchedEffect(listState) {
        snapshotFlow { Triple(listState.firstVisibleItemIndex, listState.firstVisibleItemScrollOffset, listState.layoutInfo.totalItemsCount) }
            .collectLatest {
                delay(300)
                if (ctl.positioned) reportRead(ctl, scroller, vm, page)
            }
    }
    // 利用者がスクロールしたら、それ以降の新着へは動かして見せる
    LaunchedEffect(listState) {
        listState.interactionSource.interactions.collect { if (it is androidx.compose.foundation.interaction.DragInteraction.Start) ctl.untouched = false }
    }
    // 新着の頭が見えたら(通り越したときも)札を消す
    LaunchedEffect(ctl.newToast) {
        val t = ctl.newToast ?: return@LaunchedEffect
        snapshotFlow { scroller.isVisible(t.second) || (listState.layoutInfo.visibleItemsInfo.firstOrNull { it.key is Int }?.key as Int? ?: 0) > t.second }.first { it }
        ctl.newToast = null
    }

    // 番号・ID・アンカー・URL を押したとき(組み立て済みの文字列から呼ばれる)
    SideEffect {
        page.links.onTag = { tag ->
            val v = tag.drop(2)
            when (tag[0]) {
                'a' -> {
                    val nos = v.split(',').map { it.toInt() }.toSet()
                    val list = index.posts.filter { it.no in nos }
                    traced = list.map { it.no }.toSet()
                    openPopup(list)
                }
                'r' -> {
                    val no = v.toInt()
                    val list = (index.replies[no] ?: emptyList()).mapNotNull { n -> index.posts.getOrNull(n - 1)?.takeIf { it.no == n } }
                    openPopup(list)
                }
                'i' -> openPopup(index.posts.filter { it.id == v }, focus = downNo)
                // 名前: 同じ名前のレス(タグはレス番号。名前に何が入っていてもよいように)
                'n' -> index.posts.getOrNull(v.toInt() - 1)?.let { src -> openPopup(index.posts.filter { it.name == src.name }, focus = src.no) }
                'x' -> v.toIntOrNull()?.let { if (it !in page.expandedImages) page.expandedImages += it }
                'u' -> when {
                    // 画像はサムネイルから見るので URL はブラウザで開く。サムネイルを出さない設定ならビューアーでしか見られない
                    toImageUrl(v)?.let { it in index.allImages } == true && vm.prefs.thumbMode == io.github.contentsview08.obb.data.ThumbMode.NEVER -> viewer = toImageUrl(v)
                    toImageUrl(v)?.let { it in index.allImages } == true -> openExternal(context, v, vm.prefs.openLinksInApp)
                    // 動画はアプリの中のブラウザの再生に任せる。10 秒送り・速さの切り替えなどがそのまま使える
                    Regex("\\.(mp4|webm|mov|m4v)(\\?|#|$)", RegexOption.IGNORE_CASE).containsMatchIn(v) -> openExternal(context, v, true)
                    !vm.openUrl(v) -> openExternal(context, v, vm.prefs.openLinksInApp)
                }
            }
        }
    }

    val ended = page.archived || index.posts.size >= 1000

    /** 戻る操作で、スレを閉じる前に外すもの。外したら true */
    fun localBack(): Boolean {
        when {
            page.reply.open -> { page.reply.blurSeq++; vm.saveDraft(page) }
            searching || query.isNotEmpty() -> { searching = false; query = "" }
            popups.isNotEmpty() -> popups.clear()
            filter != null -> filter = null
            else -> return false
        }
        return true
    }
    BackHandler(enabled = page.reply.open || searching || query.isNotEmpty() || popups.isNotEmpty() || filter != null) { localBack() }

    val style = vm.prefs.postStyle
    fun iconKey(p: Post): String? = if (vm.prefs.iconFromWatchoi) watchoiOf(p.name) ?: p.id else p.id
    val iconCounts = remember(index, vm.prefs.iconFromWatchoi) { index.posts.mapNotNull { iconKey(it) }.groupingBy { it }.eachCount() }
    fun previewOf(no: Int): ReplyPreview? {
        val t = index.posts.getOrNull(no - 1)?.takeIf { it.no == no } ?: return null
        return ReplyPreview(no, iconKey(t), io.github.contentsview08.obb.bbs.splitBeIcon(t.body).second.lineSequence().firstOrNull { it.isNotBlank() && !it.trimStart().startsWith(">>") }?.trim() ?: "")
    }
    fun replyOf(r: RenderedPost?): ReplyPreview? = r?.replyTo?.let { previewOf(it) }
    val postRow = @Composable { p: Post, prev: Post?, inMain: Boolean ->
        val hit = remember(p.no) { HeaderHit() }
        // 出る動きは、届いた時に画面に出ていたレスだけ。あとからスクロールして出てきたレスは、待たせずにすぐ描く
        val delayMs = ctl.flash[p.no]?.takeIf { System.currentTimeMillis() - ctl.flashAt < it + 150 }
        val anim = remember(p.no, delayMs) { if (delayMs != null) Animatable(0f) else null }
        val jf = ctl.jumpFlash?.takeIf { it.first == p.no }
        val jumpGlow = remember(jf) { if (jf != null) Animatable(1f) else null }
        if (jumpGlow != null) LaunchedEffect(jumpGlow) {
            delay(120)
            jumpGlow.animateTo(0f, tween(900, easing = androidx.compose.animation.core.LinearEasing))
            if (ctl.jumpFlash == jf) ctl.jumpFlash = null
        }
        val flash = remember(p.no, delayMs) { if (anim != null) Animatable(1f) else null }
        if (anim != null) LaunchedEffect(anim) {
            delay(delayMs!!.toLong())
            launch { flash!!.animateTo(0f, tween(1000, easing = androidx.compose.animation.core.LinearEasing)) }
            anim.animateTo(1f, tween(180, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
        }
        // 光る色は色みのない白か黒。強調色だと配色によって見分けにくい
        val whiteFlash = Palette.dark || Palette.onSky(style)
        val flashColor = if (whiteFlash) Color.White else Color.Black
        Box(
            Modifier
                .then(if (anim != null) Modifier.graphicsLayer { alpha = anim.value; translationY = (1f - anim.value) * 8.dp.toPx() } else Modifier)
                .then(if (jumpGlow != null) Modifier.drawBehind { drawRect(flashColor.copy(alpha = 0.28f * jumpGlow.value)) } else Modifier)
                .then(if (inMain && p.no in traced) Modifier.drawBehind { drawRect(if (Palette.onSky(style)) Palette.selectionWash(style) else Palette.accent.copy(alpha = 0.14f)); drawRect(Palette.accent, size = androidx.compose.ui.geometry.Size(3.dp.toPx(), size.height)) } else Modifier)
                .then(if (flash != null) Modifier.drawBehind {
                    val f = flash.value
                    val a = if (f > 0.55f) 0.16f + (f - 0.55f) / 0.45f * 0.08f else f / 0.55f * 0.16f
                    drawRect(flashColor.copy(alpha = a * if (whiteFlash) 0.8f else 0.5f))
                } else Modifier)
                .onGloballyPositioned { hit.row = it }
                .pointerInput(p.no) {
                    awaitEachGesture {
                        val d = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                        downNo = p.no
                        // ID・名前の上での長押しは、字のリンクより先にここで受ける。リンクが指を受け取ると、離したときに押したことになる
                        val tag = hit.tagAt(d.position) ?: return@awaitEachGesture
                        val up = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                            var e: androidx.compose.ui.input.pointer.PointerEvent
                            do {
                                e = awaitPointerEvent(PointerEventPass.Initial)
                                val c = e.changes.firstOrNull { it.id == d.id } ?: break
                                if ((c.position - d.position).getDistance() > viewConfiguration.touchSlop) break
                            } while (e.changes.any { it.pressed })
                            true
                        }
                        if (up == null) {
                            // 離すまでの指の動きは下へ渡さない(リンクも行の長押しも動かさない)
                            Haptics.longPress(view)
                            headMenu = tag[0] to p
                            do { val e = awaitPointerEvent(PointerEventPass.Initial); e.changes.forEach { it.consume() } } while (e.changes.any { it.pressed })
                        }
                    }
                }
                .combinedClickable(
                    interactionSource = null, indication = null,
                    onClick = { index.treeRows(p.no).takeIf { it.size > 1 }?.let { rows -> openPopup(rows.mapNotNull { r -> index.posts.getOrNull(r.no - 1) }, rows, p.no) } },
                    onLongClick = {
                        // ID・名前の上の長押しは上で受けている
                        if (headMenu == null) { Haptics.longPress(view); postMenu = p }
                    },
                    // オフなら 1 回のタップを待たせない
                    onDoubleClick = if (vm.prefs.doubleTapReply) ({ Haptics.tick(view); replyWith(">>${p.no}\n") }) else null,
                ),
        ) {
            val ngStyle = vm.prefs.ngStyle
            val ai = page.aiNg[p.no]
            if (ai != null && ai.rule.show != "mark" && p.no !in page.ngNos && p.no !in revealed) {
                if (ai.rule.show == "fold") Row(Modifier.fillMaxWidth().clickable { revealed = revealed + p.no }.padding(start = 14.dp, end = 8.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${p.no}  あぼーん  ${ai.label}", Modifier.weight(1f), color = Palette.textMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    TextButton(onClick = { vm.markAi(p, ai.rule.id, if (ai.manual) null else false) }) { Text(if (ai.manual) "印を外す" else "当たらない", fontSize = 12.sp) }
                }
            } else if (p.no in page.ngNos && p.no !in revealed && ngStyle != "dim") {
                if (ngStyle == "fold") Text(
                    // 外の行の長押しは、この押せる行に指を取られて届かないので、ここでも受ける
                    "${p.no}  あぼーん", Modifier.fillMaxWidth().combinedClickable(onLongClick = { Haptics.longPress(view); postMenu = p }) { revealed = revealed + p.no }.padding(horizontal = 14.dp, vertical = 10.dp),
                    color = Palette.textMuted, fontSize = 13.sp,
                )
            } else Column {
                if (ai != null && ai.rule.show == "mark") Text(ai.label, Modifier.padding(start = 14.dp, top = 4.dp), color = Palette.markPurple, fontSize = 11.sp)
                androidx.compose.runtime.CompositionLocalProvider(LocalHeaderHit provides hit) { WithoutBaseFont { page.rendered[p.no]?.let {
                val continued = ((index.replyCount[p.no] ?: 0) == 0 || (style == "line" && p.no in own)) && (style == "discord" || style == "line") && prev != null && p.id != null && prev.id == p.id && it.replyTo == null && prev.no !in page.ngNos
                if (p.no in page.ngNos && p.no !in revealed) Box(Modifier.graphicsLayer { alpha = 0.3f }) { PostItem(
                    it, style = style, id = p.id, continued = false, reply = null, onReply = {}, heat = null, aa = it.aa, own = false, toOwn = false,
                    info = null, autoLoad = false, gross = false,
                ) } else PostItem(
                    it, style = style, id = p.id, iconCount = iconCounts[iconKey(p)] ?: 0, continued = continued, reply = if (LocalInTree.current) null else replyOf(it),
                    onReply = { n -> index.posts.getOrNull(n - 1)?.let { t -> traced = setOf(t.no); openPopup(listOf(t)) } },
                    heat = Palette.heat(index.replyCount[p.no] ?: 0),
                    imagesExpanded = p.no in page.expandedImages,
                    onAvatar = iconKey(p)?.let { k -> { openPopup(index.posts.filter { iconKey(it) == k }, focus = p.no) } },
                    aa = aaOverride[p.no] ?: it.aa, own = p.no in own, toOwn = p.no in toOwn, info = index.info[p.no], autoLoad = autoLoad, onImage = { url -> viewer = url }, onUrl = { url -> page.links.onTag("u:$url") }, gross = p.no in index.gross)
            } } }
            }
        }
    }
    val atBottom by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()
            !listState.canScrollForward || (last != null && last.index >= info.totalItemsCount - 2)
        }
    }

    val prefs = vm.prefs
    val gestures = if (!prefs.gesturesEnabled) emptyMap()
    // ポップアップが出ている間: 戻るでまとめて閉じ、先頭へ・一番下へは一番上のポップアップの中を送る。ほかは効かせない
    else if (popups.isNotEmpty()) buildGestures(
        prefs.gestures("thread"), "thread",
        mapOf(
            "back" to { popups.clear() },
            "top" to { scope.launch { popups.lastOrNull()?.state?.scrollToItem(0) }; Unit },
            "bottom" to { scope.launch { popups.lastOrNull()?.let { it.state.scrollToItem(maxOf(0, it.state.layoutInfo.totalItemsCount - 1)) } }; Unit },
        ),
    ).let { if ("right" in it) it else it + ("right" to SwipeAction("閉じる") { popups.clear() }) }
    else buildGestures(
        prefs.gestures("thread"), "thread",
        mapOf(
            "back" to { if (!localBack()) vm.back() },
            "reply" to { replyWith(null) },
            "bottom" to { scroller.toBottom(); bars.show() },
            "top" to { scope.launch { listState.scrollToItem(0); bars.show() }; Unit },
            "refresh" to { refresh(); Unit },
            "deleteLog" to { askDeleteLog() },
            "drawer" to { vm.drawerOpen = true },
            "search" to { searching = true; bars.show() },
            "quick" to { vm.openQuick() },
            "favorite" to { vm.toggleFavoriteThread(page) },
            "next" to { vm.findNext(page); nextSheet = true },
        ),
    )
    bars.enabled = prefs.hideBarsOnScroll
    bars.atTop = { !listState.canScrollBackward }
    bars.atBottom = { !listState.canScrollForward }
    // 書いている間・返事が出ている間はフッターを隠さない
    fun footerShown() = if (page.reply.open || page.reply.done != null || page.reply.notice != null || !bars.enabled) 1f else 1f - bars.footerHidden
    val topPull = remember { PullState { Haptics.confirm(view) } }
    val bottomPull = remember { PullState { Haptics.confirm(view) } }
    val pullConn = remember(page) { PullConnection(topPull, bottomPull, density.density, scope) { refresh()?.join() } }
    if (prefs.autoRefreshSec > 0) LaunchedEffect(prefs.autoRefreshSec, page) {
        while (true) {
            delay(prefs.autoRefreshSec * 1000L)
            // アプリが裏にある間は掲示板へ取りに行かない
            if (vm.appVisible && !page.loading) vm.refreshThread(page, quiet = true)
        }
    }
    // キーボードが出たら、スレ表示ごと縮め、本文をキーボードの高さだけ送る。下のレスが隠れずに上がるように
    val imeInsets = androidx.compose.foundation.layout.WindowInsets.ime
    // 高さはキーボードの動きの間ずっと変わるので、組み立ての外で見る
    LaunchedEffect(listState, density) {
        // 開いたときに残っているキーボード(URL の入力など)は、ここで送った分ではないので、引っ込んでも本文を動かさない
        var lastIme = imeInsets.getBottom(density)
        var sent = 0f
        snapshotFlow { imeInsets.getBottom(density) }.collect { ime ->
            val d = ime - lastIme
            lastIme = ime
            if (d > 0) runCatching { sent += listState.scrollBy(d.toFloat()) }
            else if (d < 0 && sent > 0f) {
                val back = minOf(-d.toFloat(), sent)
                sent -= back
                runCatching { listState.scrollBy(-back) }
            }
        }
    }
    Box(
        modifier.fillMaxSize().background(Palette.threadBg(vm.prefs.postStyle)).imePadding()
            .swipeGestures(swipe, gestures, onEdgeRight = if (prefs.gesturesEnabled && popups.isEmpty()) ({ vm.drawerOpen = true }) else null, sensitivity = prefs.gestureSensitivity)
            .pointerInput(Unit) { awaitEachGesture { awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial).position.let { downY = it.y; downX = it.x } } }
            // ピンチで本文の字の大きさを変える(設定に入る)。1 本指の操作には触らない
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    var acc = 1f
                    val start = vm.prefs.bodyScale
                    do {
                        val e = awaitPointerEvent(PointerEventPass.Initial)
                        if (e.changes.count { it.pressed } >= 2) {
                            acc *= e.calculateZoom()
                            val px = fontSizeOf(start * acc, 15)
                            val v = scaleOf(px, 15)
                            if (v != vm.prefs.bodyScale) { vm.prefs.bodyScale = v; Haptics.tick(view) }
                            pinchLabel = "本文 $px"
                            e.changes.forEach { it.consume() }
                        }
                    } while (e.changes.any { it.pressed })
                }
            },
    ) {
        Box(
            Modifier.fillMaxSize().clipToBounds().nestedScroll(bars.connection).nestedScroll(pullConn),
        ) {
            Box(Modifier.fillMaxSize()) {
                when {
                    !page.loaded -> Skeleton(with(density) { bars.topHeight.toDp() }, post = true)
                    page.error != null && index.posts.isEmpty() -> LoadError(page.error, page.loading, with(density) { bars.topHeight.toDp() }, onBack = { if (!localBack()) vm.back() }, externalUrl = TwoCh.webUrl(page.summary)) { refresh() }
                    else -> LazyColumn(
                        Modifier.fillMaxSize(), state = listState,
                        contentPadding = PaddingValues(
                            top = with(density) { bars.topHeight.toDp() }, end = if (vm.prefs.showMinimap && shown.size > 1) 20.dp else 0.dp,
                            bottom = with(density) { footerH.toDp() },
                        ),
                    ) {
                        itemsIndexed(shown, key = { _, it -> it.no }, contentType = { _, it -> if (it.no in page.ngNos) 1 else 0 }) { i, p ->
                            if (filter == null && query.isBlank() && p.no == page.unreadFrom) UnreadDivider()
                            // まとめた分は高さのない行にする。行の並びはレス番号のまま(スクロールの覚えがレスの並びに頼っているため)
                            val runFirst = ngGroups.firstOf[p.no]
                            val runClosed = runFirst != null && runFirst !in openRuns
                            if (runFirst == p.no) ngGroups.runs[p.no]?.let { run ->
                                NgRunRow(run, open = !runClosed) { openRuns = if (runClosed) openRuns + p.no else openRuns - p.no }
                            }
                            if (!runClosed) postRow(p, shown.getOrNull(i - 1), true)
                            if (!runClosed || runFirst == p.no) {
                                if (style == "matome") HorizontalDivider(color = Palette.border.copy(alpha = 0.3f))
                                else if (style != "discord" && style != "line") HorizontalDivider(color = Palette.border)
                            }
                        }
                        item(key = "end") {
                            Row(
                                Modifier.fillMaxWidth().clickable {
                                    val mine = index.posts.filter { it.no in own }
                                    if (mine.isEmpty()) vm.toast = "このスレに自分の書き込みはありません" else openPopup(mine)
                                }.padding(horizontal = 6.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                val sky = Palette.onSky(style)
                                Box(Modifier.weight(1f).height(3.dp).background(if (sky) Palette.skyMuted.copy(alpha = 0.5f) else Palette.border))
                                Text(
                                    if (page.archived) "-END-(dat 落ち)" else "-END-", Modifier.padding(horizontal = 12.dp),
                                    color = if (sky) Palette.skyText else Palette.textMuted, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 3.sp,
                                )
                                Box(Modifier.weight(1f).height(3.dp).background(if (sky) Palette.skyMuted.copy(alpha = 0.5f) else Palette.border))
                            }
                        }
                        if (filter == null && query.isBlank()) item(key = "nextUnread") {
                            val next = remember(index.posts.size, page.readNo) { vm.nextUnread(page) }
                            if (next == null) { Spacer(Modifier.height(16.dp)); return@item }
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 16.dp)
                                    .border(1.dp, Palette.border, RoundedCornerShape(6.dp)).background(Palette.surface, RoundedCornerShape(6.dp))
                                    .clickable { vm.openNextUnread(page, next.second) }
                                    .padding(horizontal = 14.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.AutoMirrored.Filled.ArrowForward, null, tint = Palette.accent, modifier = Modifier.size(22.dp))
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text("次の未読スレへ(${next.first})", color = Palette.textMuted, fontSize = 11.sp, maxLines = 1)
                                    Text(next.second.title, color = Palette.textStrong, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                Spacer(Modifier.width(8.dp))
                                Badge(badgeCount(next.third), Palette.unread, Palette.unreadText)
                            }
                        }
                        if (ended && filter == null && query.isBlank()) item(key = "next") {
                            LaunchedEffect(Unit) { if (page.nextCandidates == null) vm.findNext(page) }
                            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 24.dp).border(1.dp, Palette.border, RoundedCornerShape(6.dp)).background(Palette.surface, RoundedCornerShape(6.dp))) {
                                NextCandidates(page) { vm.openThread(it) }
                            }
                        }
                    }
                }
            }

            if (vm.prefs.showMinimap && shown.size > 1) {
                Minimap(
                    shown, index, own, toOwn, if (filter == null && query.isBlank()) page.unreadFrom else null, listState,
                    // フッターが隠れても伸ばさない。伸び縮みすると縮図が動いて見にくい
                    Modifier.align(Alignment.TopEnd).barPadding(top = { bars.topHeight * (1f - bars.hidden) + 4.dp.toPx() }, bottom = { footerH + 4.dp.toPx() }).padding(end = 2.dp),
                    onJumped = { no -> ctl.jumpFlash = no to System.nanoTime(); bars.show() },
                    readNo = page.readNo,
                )
            } else if (shown.size > 1) {
                val progress by remember(shown) {
                    derivedStateOf {
                        val last = listState.layoutInfo.visibleItemsInfo.lastOrNull { it.key is Int }?.index ?: 0
                        (last + 1f) / shown.size
                    }
                }
                Box(
                    Modifier.align(Alignment.TopStart).barPadding(top = { bars.topHeight * (1f - bars.hidden) })
                        .fillMaxWidth(progress.coerceIn(0f, 1f)).height(2.dp).background(Palette.accent.copy(alpha = 0.7f)),
                )
            }

            SwipeLabel(swipe)

            Column(Modifier.fillMaxWidth().onSizeChanged { bars.topHeight = it.height.toFloat() }.graphicsLayer { translationY = -bars.hidden * bars.topHeight }) {
                if (searching) {
                    SearchBar(query, { query = it }, "レスを探す(本文・名前・ID)") { searching = false; query = "" }
                } else {
                    HeaderBar(remember(page.title) { page.title.replace(TITLE_THREAD_NO, "") }, onNav = { vm.drawerOpen = true }, onTitle = { menu = true }) {
                        BarIcon(Icons.Filled.Search, "探す") { searching = true }
                        MoreButton { menu = true }
                    }
                }
                FilterTabs(filter, counts) { filter = it }
                HorizontalDivider(color = Palette.border)
            }

            if (!atBottom && index.posts.isNotEmpty()) {
                Box(
                    Modifier.align(Alignment.BottomEnd).barPadding(bottom = { 14.dp.toPx() + footerH * footerShown() }).padding(end = if (vm.prefs.showMinimap) 34.dp else 16.dp).size(48.dp)
                        .background(Palette.surface2, RoundedCornerShape(6.dp)).border(1.dp, Palette.borderStrong, RoundedCornerShape(6.dp))
                        .clickable { scroller.toBottom(); bars.show() },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.KeyboardDoubleArrowDown, "一番下へ", tint = Palette.textBody) }
            }

            PullSpinner(topPull, 1, Modifier.align(Alignment.TopCenter).barPadding(top = { bars.topHeight * (1f - bars.hidden) }))
            PullSpinner(bottomPull, -1, Modifier.align(Alignment.BottomCenter).barPadding(bottom = { footerH * footerShown() }))

            ctl.newToast?.let { (count, first) ->
                val slide = remember(first) { Animatable(0f) }
                LaunchedEffect(first) { slide.animateTo(1f, tween(260, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f))) }
                Row(
                    Modifier.align(Alignment.BottomCenter).barPadding(bottom = { footerH * footerShown() + 20.dp.toPx() })
                        .graphicsLayer { alpha = slide.value; translationX = (1f - slide.value) * size.width * 1.1f }
                        .shadow(8.dp, RoundedCornerShape(50)).background(Palette.accent, RoundedCornerShape(50))
                        .clickable { ctl.newToast = null; scroller.toUnread(first, animate = true); ctl.jumpFlash = first to System.nanoTime() }.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.ArrowDownward, null, tint = Palette.accentText, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("新着 +$count", color = Palette.accentText, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                }
            }

            Box(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().onSizeChanged { footerH = it.height.toFloat() }
                    .graphicsLayer { translationY = (1f - footerShown()) * footerH },
            ) { ThreadFooter(vm, page) { refresh() } }

        }
        pinchLabel?.let {
            Text(
                it, Modifier.align(Alignment.Center).background(Palette.surface3.copy(alpha = 0.95f), RoundedCornerShape(8.dp)).padding(horizontal = 16.dp, vertical = 10.dp),
                color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold,
            )
        }
        // 本文のスクロールの外に置く。中をスクロールしても、後ろの帯が隠れたり、引っぱって更新が動いたりしないように
        PopupLayer(
            popups, bg = Palette.threadBg(style), topInset = { bars.topHeight * (1f - bars.hidden) }, endInset = 0.dp,
            onCloseTop = { popups.removeAt(popups.lastIndex) },
        ) { postRow(it, null, false) }
    }

    // ヘッダーのスレタイと ︙ は同じメニュー
    if (menu) {
        MenuSheet(
            listOf(
                listOf(
                    favoriteItem(),
                    MenuItem("更新", Icons.Filled.Refresh) { refresh() },
                    MenuItem("レス検索", Icons.Filled.Search) { searching = true; bars.show() },
                    MenuItem(if (filter == Filter.OWN) "自分の書き込みの絞り込みを外す" else "自分の書き込みだけ(${counts[Filter.OWN] ?: 0})", Icons.Filled.Person) { filter = if (filter == Filter.OWN) null else Filter.OWN },
                    MenuItem("画像一覧", Icons.Filled.PhotoLibrary) { gallery = true },
                    MenuItem("次スレを探す", Icons.Filled.SkipNext) { vm.findNext(page); nextSheet = true },
                ),
                listOf(
                    MenuItem("板に戻る", Icons.AutoMirrored.Filled.List) { vm.openBoardOf(page) },
                    MenuItem("先頭へ", Icons.Filled.VerticalAlignTop) { scope.launch { listState.scrollToItem(0); bars.show() } },
                    MenuItem("一番下へ", Icons.Filled.VerticalAlignBottom) { scroller.toBottom(); bars.show() },
                ),
                listOf(
                    styleMenuItem(vm.prefs, onTheme = { styleSheet = true }, onSize = { fontDialog = true }),
                    MenuItem("コピー", Icons.Filled.ContentCopy, children = listOf(
                        MenuItem("スレタイをコピー", Icons.Filled.ContentCopy) { copyText(context, page.title); vm.toast = "スレタイをコピーしました" },
                        MenuItem("URL をコピー", Icons.Filled.Link) { copyText(context, TwoCh.webUrl(page.summary)); vm.toast = "URL をコピーしました" },
                        MenuItem("スレタイと URL をコピー", Icons.Filled.ContentCopy) { copyText(context, "${page.title}\n${TwoCh.webUrl(page.summary)}"); vm.toast = "スレタイと URL をコピーしました" },
                    )) {},
                    MenuItem("スレを保存", Icons.Filled.Save, children = listOf(
                        MenuItem("HTML で保存", Icons.Filled.Save) { saveHtml.launch("$safeName.html") },
                        MenuItem("テキストで保存", Icons.Filled.Save) { saveText.launch("$safeName.txt") },
                    )) {},
                    MenuItem("ブラウザで開く", Icons.AutoMirrored.Filled.OpenInNew) { openExternal(context, TwoCh.webUrl(page.summary), false) },
                ),
                listOf(
                    MenuItem("NG", Icons.Filled.Block, children = listOf(
                        MenuItem("スレタイを NG に追加", Icons.Filled.Block, danger = true) { vm.addNg(NgRule("title", page.title)) },
                    )) {},
                    MenuItem("ログを削除して閉じる", Icons.Filled.Delete, danger = true) { askDeleteLog() },
                ),
            ),
            header = {
                val count = index.posts.size
                val heat = page.summary.createdAt?.let { " ・ 勢い ${momentumText(momentumOf(count, it, System.currentTimeMillis()))}" }.orEmpty()
                MenuInfo(page.title.ifEmpty { page.summary.key }, "${count}レス$heat")
            },
        ) { menu = false }
    }
    aaZoom?.let { n -> page.rendered[n]?.let { AaZoom(it) { aaZoom = null } } }
    if (styleSheet) StyleSheet(vm.prefs) { styleSheet = false }

    if (ngEditing != null) {
        val r = ngEditing!!
        NgEditSheet(r, page.summary.boardUrl to (vm.favorites.firstOrNull { it.url == page.summary.boardUrl }?.name ?: page.summary.boardUrl), isNew = false, onDismiss = { ngEditing = null }, onDelete = { vm.removeNg(r); ngEditing = null }) { vm.saveNg(it); ngEditing = null }
    }

    postMenu?.let { p ->
        val isAA = aaOverride[p.no] ?: page.rendered[p.no]?.aa ?: false
        MenuSheet(
            listOf(
                listOf(
                    MenuItem("返信", Icons.AutoMirrored.Filled.Reply) { replyWith(">>${p.no}\n") },
                    MenuItem("引用して返信", Icons.Filled.FormatQuote) {
                        val quote = p.body.lines().filter { it.isNotBlank() && !it.trimStart().startsWith(">>") }.take(3).joinToString("\n") { "> ${it.trim()}" }
                        replyWith(">>${p.no}\n$quote\n")
                    },
                ) +
                    vm.prefs.quickPhraseList.map { ph ->
                        MenuItem("「$ph」とすぐ書き込む", Icons.Filled.Bolt) { vm.quickPost(page, p.no, ph) }
                    } +
                    listOfNotNull(
                        if (index.tree(p.no).size > 1) MenuItem("アンカーツリーを表示", Icons.Filled.AccountTree) {
                            val rows = index.treeRows(p.no)
                            openPopup(rows.mapNotNull { r -> index.posts.getOrNull(r.no - 1) }, rows, p.no)
                        } else null,
                    ),
                listOf(
                    MenuItem("ヘッダ含めてコピー", Icons.Filled.ContentCopy) {
                        copyText(context, "${p.no} ${p.name} ${p.date}${p.id?.let { " ID:$it" } ?: ""}\n${p.body}"); vm.toast = "コピーしました"
                    },
                    MenuItem("本文のみコピー", Icons.Filled.ContentCopy) { copyText(context, p.body); vm.toast = "コピーしました" },
                    MenuItem(if (isAA) "文字列として表示" else "AAとして表示", if (isAA) Icons.AutoMirrored.Filled.Notes else Icons.Filled.GridOn) { aaOverride = aaOverride + (p.no to !isAA) },
                ) + listOfNotNull(
                    // 縮めて収めた AA は字が小さすぎて読めないことがある
                    if (isAA) MenuItem("AA を拡大して見る", Icons.Filled.ZoomIn) { aaZoom = p.no } else null,
                ),
                // ほかの専ブラ・ブラウザから書いたレスにも自分の印を付けられるように、手で付け外しする
                (p.no in own).let { isOwn ->
                    listOfNotNull(
                        if (isOwn) MenuItem("自分のレスの印を外す", Icons.Filled.PersonRemove) { vm.markOwn(page, p, own = false, sameId = false) }
                        else MenuItem("自分のレスの印を付ける", Icons.Filled.HowToReg) { vm.markOwn(page, p, own = true, sameId = false) },
                        if (p.id == null) null
                        else if (isOwn) MenuItem("同じ ID のレスすべての印を外す", Icons.Filled.GroupRemove) { vm.markOwn(page, p, own = false, sameId = true) }
                        else MenuItem("同じ ID のレスすべてに印を付ける", Icons.Filled.Group) { vm.markOwn(page, p, own = true, sameId = true) },
                    )
                },
                // すでに当たっている NG があれば、足す項目の代わりに外す項目を出す
                listOf(MenuItem("NG", Icons.Filled.Block, children = ngHitsOf(p).let { hits ->
                    (if (!hits?.id.isNullOrEmpty()) ngOffItems(hits!!.id, "ID", p.id) else idNgItems(p)) +
                        (if (!hits?.name.isNullOrEmpty()) ngOffItems(hits!!.name, "名前", p.name) else listOf(nameNgItem(p))) +
                        ngOffItems(hits?.body.orEmpty(), "本文", null) +
                        MenuItem("本文の言葉を NG に(直して足す)", Icons.Filled.Block) { ngWordFor = p }
                } +
                vm.aiRulesFor(page).map { r ->
                    val on = page.aiNg[p.no]?.rule?.id == r.id
                    if (on) MenuItem("AI NG「${r.name}」に当たらない(誤判定)", Icons.Filled.Psychology) { vm.markAi(p, r.id, if (page.aiNg[p.no]?.manual == true) null else false) }
                    else MenuItem("AI NG「${r.name}」に当たる", Icons.Filled.Psychology) { vm.markAi(p, r.id, true) }
                }) {}),
            ),
            MenuAt.Center,
        ) { postMenu = null }
    }

    headMenu?.let { (kind, p) ->
        val sameId = if (kind == 'i' && p.id != null) index.posts.filter { it.id == p.id } else emptyList()
        val sameName = if (kind == 'n') index.posts.filter { it.name == p.name } else emptyList()
        MenuSheet(
            listOf(
                if (kind == 'i' && p.id != null) listOf(MenuItem("NG", Icons.Filled.Block, children = ngHitsOf(p)?.id.orEmpty().let { hits -> if (hits.isNotEmpty()) ngOffItems(hits, "ID", p.id) else idNgItems(p) }) {}) + listOf(
                    MenuItem("この ID のレスを見る(${sameId.size})", Icons.Filled.Search) { openPopup(sameId, focus = p.no) },
                    MenuItem("ID をコピー", Icons.Filled.ContentCopy) { copyText(context, p.id); vm.toast = "コピーしました" },
                ) else listOf(MenuItem("NG", Icons.Filled.Block, children = ngHitsOf(p)?.name.orEmpty().let { hits -> if (hits.isNotEmpty()) ngOffItems(hits, "名前", p.name) else listOf(nameNgItem(p)) }) {}) + listOf(
                    MenuItem("同じ名前のレスを見る(${sameName.size})", Icons.Filled.Search) { openPopup(sameName, focus = p.no) },
                    MenuItem("名前をコピー", Icons.Filled.ContentCopy) { copyText(context, p.name); vm.toast = "コピーしました" },
                ),
            ),
            MenuAt.Center,
        ) { headMenu = null }
    }
    ngWordFor?.let { p ->
        var word by remember(p.no) { mutableStateOf(p.body.lineSequence().firstOrNull()?.take(30) ?: "") }
        AlertDialog(
            onDismissRequest = { ngWordFor = null },
            title = { Text("言葉を NG") },
            text = { OutlinedTextField(word, { word = it }, singleLine = true, label = { Text("この言葉を含むレスをあぼーんにする") }) },
            confirmButton = { TextButton(onClick = { vm.addNg(NgRule("body", word.trim())); ngWordFor = null }) { Text("NG に足す") } },
            dismissButton = { TextButton(onClick = { ngWordFor = null }) { Text("やめる") } },
        )
    }

    if (gallery) GalleryPanel(index.allImages, onOpen = { viewer = it }, save = vm::saveImages) { gallery = false }

    if (nextSheet) {
        CenterPanel(onDismiss = { nextSheet = false }) {
            Column(Modifier.padding(bottom = 4.dp)) {
                NextCandidates(page) { nextSheet = false; vm.openThread(it) }
            }
        }
    }

    if (fontDialog) SizeDialog({ fontDialog = false }) {
        val pr = vm.prefs
        FontSizeSlider("レスの本文", pr.bodyScale, 15) { pr.bodyScale = it }
        FontSizeSlider("レスの頭(名前・日付・ID)", pr.postHeadScale, 12) { pr.postHeadScale = it }
        SizeSlider("レスの本文の行間", pr.lineHeight, 1.0f..3.0f, 39, "%.2f".format(pr.lineHeight), 1.47f) { pr.lineHeight = if (it == 1.47f) it else snapTo(it, 20) }
        SizeSlider("レスの上下の余白", pr.postPad.toFloat(), 0f..40f, 39, "${pr.postPad}dp", 8f) { pr.postPad = snapInt(it) }
        BarSliders(pr)
    }

    if (confirmDelete) ConfirmDeleteDialog(vm.prefs, onDelete = { vm.deleteLog(page) }) { confirmDelete = false }

    viewer?.let { url ->
        if (url in index.allImages) ImageViewer(index.allImages, url, onClose = { viewer = null }, posts = index.allImagePosts)
        else ImageViewer(listOf(url), url, onClose = { viewer = null })
    }
}

private fun reportRead(ctl: ThreadScrollCtl, scroller: ThreadScroller, vm: AppViewModel, page: Page.Thread) {
    val (last, pos) = scroller.progress()
    if (pos != null) vm.savePosition(page.summary.id, pos)
    if (last > ctl.sent) {
        ctl.sent = last
        vm.markRead(page, last)
    }
}

@Composable
private fun NgRunRow(run: io.github.contentsview08.obb.data.NgRun, open: Boolean, onToggle: () -> Unit) {
    val parts = listOfNotNull(if (run.ai > 0) "AI NG ${run.ai}" else null, if (run.rule > 0) "NG ${run.rule}" else null).joinToString("・")
    Row(Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (open) Icons.Filled.UnfoldLess else Icons.Filled.UnfoldMore, null, tint = Palette.textMuted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(
            "${run.nos.first()}〜${run.nos.last()}  あぼーん × ${run.ai + run.rule}($parts)" + if (open) " — まとめる" else "",
            color = Palette.textMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun FilterTabs(filter: Filter?, counts: Map<Filter, Int>, onSelect: (Filter?) -> Unit) {
    Row(Modifier.fillMaxWidth().background(Palette.bar)) {
        for ((f, icon) in TABS) Tab(Modifier.weight(1f), filter == f, { onSelect(if (filter == f) null else f) }) {
            // 絞り込みは大事な情報ではないので、アイコンは色を付けず控えめにする
            Icon(icon, null, tint = if (filter == f) Palette.accent else Palette.textMuted.copy(alpha = 0.8f), modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(3.dp))
            Text(f.label, fontSize = 14.sp, color = if (filter == f) Palette.accent else Palette.textMuted, maxLines = 1)
            val n = counts[f] ?: 0
            if (n > 0) Text("$n", Modifier.padding(start = 2.dp), fontSize = 10.sp, color = Palette.textMuted)
        }
        // 「すべて」はいつもの状態なので面を塗らない
        Tab(Modifier.weight(1f), filter == null || filter == Filter.OWN, { onSelect(null) }, wash = filter == Filter.OWN) {
            if (filter == Filter.OWN) {
                Icon(Icons.Filled.Person, null, tint = Palette.own, modifier = Modifier.size(17.dp))
                Text("自分", fontSize = 14.sp, color = Palette.accent)
            } else Text("すべて", fontSize = 14.sp, color = Palette.accent)
        }
    }
}

@Composable
private fun Tab(modifier: Modifier, active: Boolean, onClick: () -> Unit, wash: Boolean = true, content: @Composable () -> Unit) {
    Box(modifier.background(if (active && wash) Palette.accentWash else Color.Transparent).clickable(onClick = onClick).heightIn(min = 40.dp), contentAlignment = Alignment.Center) {
        Row(verticalAlignment = Alignment.CenterVertically) { content() }
        if (active) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(2.dp).background(Palette.accent))
    }
}

@Composable
private fun UnreadDivider() {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(3.dp).background(Palette.unreadInk.copy(alpha = 0.4f)))
        Text("ここから未読", Modifier.padding(horizontal = 12.dp), color = Palette.unreadInk, fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.4.sp)
        Box(Modifier.weight(1f).height(3.dp).background(Palette.unreadInk.copy(alpha = 0.4f)))
    }
}


@Composable
private fun NextCandidates(page: Page.Thread, onOpen: (io.github.contentsview08.obb.bbs.ThreadSummary) -> Unit) {
    Text("次スレの候補", Modifier.padding(horizontal = 16.dp, vertical = 10.dp), color = Palette.textStrong, fontWeight = FontWeight.Bold)
    val list = page.nextCandidates
    when {
        list == null -> Text("探しています…", Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 14.sp)
        list.isEmpty() -> Text("似たスレタイのスレは、まだ立っていないようです", Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 14.sp)
        else -> for ((i, c) in list.withIndex()) {
            if (i > 0) HorizontalDivider(color = Palette.border)
            Column(Modifier.fillMaxWidth().clickable { onOpen(c.thread) }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                Text(c.thread.title, color = Palette.textStrong, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text((if (c.isNextNumber) "番号が次 ・ " else "") + "${c.thread.postCount}レス ・ ${relativeTime(c.thread.createdAt)}", color = Palette.textMuted, fontSize = 12.sp)
            }
        }
    }
}
