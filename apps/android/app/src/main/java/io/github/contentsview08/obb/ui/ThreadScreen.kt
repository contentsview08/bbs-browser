package io.github.contentsview08.obb.ui

import android.content.Intent
import android.net.Uri
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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DoneAll
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
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import kotlinx.coroutines.withTimeoutOrNull
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.draw.clip
import kotlin.math.roundToInt
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.imePadding
import kotlinx.coroutines.flow.first
import androidx.compose.ui.draw.shadow
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
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

/** 絞り込みのタブ(今のスマホ版と同じ 4 つ + すべて。アイコンに意味の色) */
// 色は配色を変えたら変わるよう、読むたびに Palette から取る(get())
private val TABS: List<Triple<Filter, ImageVector, Color>> get() = listOf(
    Triple(Filter.POPULAR, Icons.Filled.LocalFireDepartment, Palette.markHot),
    Triple(Filter.IMAGE, Icons.Filled.Image, Palette.markImage),
    Triple(Filter.VIDEO, Icons.Filled.PlayCircle, Palette.markVideo),
    Triple(Filter.LINK, Icons.Filled.Link, Palette.markLink),
)

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
    // 絞り込み・検索・スクロールの位置はページに持つ(一覧へ戻って「進む」で開き直しても残す)
    var filter by page::filter
    var searching by page::searching
    var query by page::query
    // 重なったポップアップ(下から順に)。押した所の高さ・押したレスは、指を置いたときに控えておく
    val popups = remember { mutableStateListOf<PopupEntry>() }
    // アンカーをたどったレス(本文側で、ポップアップを閉じたあとも少しのあいだ色を付け、どこだったか分かるように)
    var traced by remember { mutableStateOf<Set<Int>>(emptySet()) }
    // その場で開いたアンカー(レスの番号 → 差し込んだレスの番号)
    LaunchedEffect(popups.isEmpty(), traced) { if (popups.isEmpty() && traced.isNotEmpty()) { delay(1800); traced = emptySet() } }
    var popupSeq by remember { mutableIntStateOf(0) }
    var downY by remember { mutableFloatStateOf(0f) }
    var downX by remember { mutableFloatStateOf(-1f) }
    var downNo by remember { mutableIntStateOf(0) }
    fun openPopup(posts: List<Post>, tree: List<io.github.contentsview08.obb.bbs.TreeRow>? = null, focus: Int? = null) {
        if (posts.isNotEmpty()) popups += PopupEntry(++popupSeq, posts, tree, downY, focus, downX)
    }
    /**
     * 書き込み欄を開く。ポップアップの上から返信したときも、ポップアップを閉じて帯を出してから欄に入る
     * (ポップアップが書き込み欄の上に重なって隠し、メニューの窓が閉じきる前に欄へ入ろうとしてキーボードが出なかった)
     */
    fun replyWith(text: String?) {
        popups.clear()
        bars.show()
        vm.openReply(page, text)
    }
    var menu by remember { mutableStateOf(false) }
    var postMenu by remember { mutableStateOf<Post?>(null) }
    var ngWordFor by remember { mutableStateOf<Post?>(null) }
    /** ID・名前を長押ししたときのメニュー(種類「i」「n」と、そのレス) */
    var headMenu by remember { mutableStateOf<Pair<Char, Post>?>(null) }
    // 長押しの判定のため、レスの行の置き場所と、指を置いた位置(行の中)を覚えておく
    val rowCoords = remember { HashMap<Int, androidx.compose.ui.layout.LayoutCoordinates>() }
    var downInRow by remember { mutableStateOf(androidx.compose.ui.geometry.Offset.Zero) }
    var gallery by remember { mutableStateOf(false) }
    var nextSheet by remember { mutableStateOf(false) }
    /** 中身を見せている NG のレス */
    var revealed by remember { mutableStateOf(emptySet<Int>()) }
    var viewer by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var fontDialog by remember { mutableStateOf(false) }
    var fontOnly by remember { mutableStateOf(false) }
    var titleSheet by remember { mutableStateOf(false) }
    var styleSheet by remember { mutableStateOf(false) }
    var saveSheet by remember { mutableStateOf(false) }
    // スレを保存(テキスト・HTML)。保存先は端末のファイルの画面で選ぶ
    val safeName = remember(page.title) { page.title.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(60) }
    val saveText = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.CreateDocument("text/plain")) { uri -> if (uri != null) vm.saveThread(page, uri, html = false) }
    val saveHtml = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.CreateDocument("text/html")) { uri -> if (uri != null) vm.saveThread(page, uri, html = true) }
    /** 長押しで「AAとして表示」「文字列として表示」を選んだレス */
    var aaOverride by remember { mutableStateOf(mapOf<Int, Boolean>()) }
    /** 拡大して見ている AA のレス */
    var aaZoom by remember { mutableStateOf<Int?>(null) }
    /** ピンチで字の大きさを変えている間の札 */
    var pinchLabel by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(pinchLabel) { if (pinchLabel != null) { delay(900); pinchLabel = null } }
    val swipe = rememberSwipeState()
    // 開いて直している NG(レスのメニューの「○○ の NG を開く」)
    var ngEditing by remember { mutableStateOf<NgRule?>(null) }
    // このレスに当たっている NG。NG のレスだけ調べる(レスの数だけ毎回は調べない)
    fun ngHitsOf(p: Post) = if (p.no in page.ngNos) io.github.contentsview08.obb.data.NgMatcher(vm.prefs.ngRules).postHits(p, page.summary.boardUrl) else null
    // 当たっている NG を外す項目。その文字ちょうどの NG は押すだけで外し、正規表現・部分一致は別のレスにも効いているので編集を開く
    fun ngOffItems(rules: List<NgRule>, what: String, value: String?): List<MenuItem> {
        val (exact, others) = io.github.contentsview08.obb.data.splitNgHits(rules, value)
        return (if (exact.isEmpty()) emptyList() else listOf(MenuItem("この${if (what == "ID") " ID " else what}を NG から外す", Icons.AutoMirrored.Filled.Undo, Palette.markDanger) {
            exact.forEach { vm.removeNg(it) }
            vm.toast = "NG から外しました"
        })) + others.map { r ->
            MenuItem("$what の NG「${if (r.pattern.length > 12) r.pattern.take(12) + "…" else r.pattern}」を開く", Icons.Filled.EditNote, Palette.markDanger) { ngEditing = r }
        }
    }
    fun idNgItems(p: Post, tint: Color): List<MenuItem> = p.id?.let { id ->
        listOf(
            MenuItem("この ID を NG に(今日だけ)", Icons.Filled.Schedule, tint) { vm.addNg(NgRule("id", id, expiresOn = io.github.contentsview08.obb.data.today())) },
            MenuItem("この ID を NG に", Icons.Filled.Block, tint) { vm.addNg(NgRule("id", id)) },
        )
    }.orEmpty()
    fun nameNgItem(p: Post, tint: Color) = MenuItem("この名前を NG に", Icons.Filled.Block, tint) { vm.addNg(NgRule("name", p.name)) }
    val own = page.ownNos
    // 自分への返信(自分のレスにアンカーを付けたレス)
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
        // 全角半角・カナを同一視し、空白で区切った言葉はすべて含むもの。番号・名前・ID・本文から探す(PC 版と同じ)
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

    // スクロールの覚えと操作(今のスマホ版の useThreadScroll と同じ動き)
    val ctl = page.scroll
    var footerH by remember { mutableFloatStateOf(0f) }
    // 並んでいるレスは、いつも今のものを見る(作ったときの並びを覚えたままだと、開いたときに位置が見つからず一番下へ飛んでいた)
    val shownNow = androidx.compose.runtime.rememberUpdatedState(shown)
    val scroller = remember(page, listState) {
        ThreadScroller(ctl, listState, scope, { shownNow.value }, { footerH }, with(density) { 80.dp.toPx() })
    }
    // 更新(更新の前に、いま見えているところまでの既読を知らせる。「ここから未読」を古い位置で引き直さないように)
    fun refresh(): kotlinx.coroutines.Job? { reportRead(ctl, scroller, vm, page); return vm.refreshThread(page) }
    // 開いたら(最初にレスが出て並んだら)、覚えた位置か設定の位置へ
    LaunchedEffect(page, index.posts.isNotEmpty()) {
        if (ctl.positioned || index.posts.isEmpty()) return@LaunchedEffect
        snapshotFlow { listState.layoutInfo.totalItemsCount }.first { it > 0 }
        scroller.open(vm.position(page.summary.id), vm.prefs.openPosition)
        // 書き込み履歴・画像の「貼ったレス」から開いたときは、そのレスへ飛んで光らせる
        page.jumpNo?.let { no ->
            page.jumpNo = null
            if (index.posts.any { it.no == no }) {
                scroller.toUnreadNow(no)
                ctl.jumpFlash = no to System.nanoTime()
            }
        }
        reportRead(ctl, scroller, vm, page)
    }
    // 一覧へ戻って「進む」で開き直したとき: 一番下まで読んでいたなら一番下へ(戻る前と同じ所から続けて読めるように)
    LaunchedEffect(page) {
        if (ctl.positioned && vm.position(page.summary.id)?.bottom == true) {
            snapshotFlow { listState.layoutInfo.totalItemsCount }.first { it > 0 }
            scroller.toBottomNow()
            bars.show()
        }
    }
    // 新着が届いたら
    LaunchedEffect(index.posts.size) { scroller.grew(vm.prefs.autoScrollOnNew) }
    // スクロールが止まって 300ms たったら・中身が変わったら、どこまで読んだかを知らせ、位置を覚える
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
    // 札が出ているあいだに、新着の頭が見えたら(通り越したときも)札を消す
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
                // 画像の URL はビューアーで、2ch 互換のスレ・板の URL はアプリの中で、それ以外はブラウザで
                'u' -> when {
                    // 拡張子のない画像は、読み替えた URL でビューアーに渡す
                    toImageUrl(v)?.let { it in index.allImages } == true -> viewer = toImageUrl(v)
                    // mp4・webm はブラウザ(アプリの中のブラウザ)の再生に任せる(ダブルタップで 10 秒送り・速さの切り替えなどがそのまま使える)
                    Regex("\\.(mp4|webm|mov|m4v)(\\?|#|$)", RegexOption.IGNORE_CASE).containsMatchIn(v) -> openExternal(context, v, true)
                    !vm.openUrl(v) -> openExternal(context, v, vm.prefs.openLinksInApp)
                }
            }
        }
    }

    val ended = page.archived || index.posts.size >= 1000

    /**
     * 戻る操作(戻るボタン・戻るのジェスチャー)で、スレを閉じる前に外すもの。今のスマホ版と同じ順:
     * 書き込み欄 → 検索 → ポップアップ(まとめて)→ 絞り込み。外したら true
     */
    fun localBack(): Boolean {
        when {
            // 書いている(本文の欄に入っている)なら、まず欄から出る
            page.reply.open -> { page.reply.blurSeq++; vm.saveDraft(page) }
            searching || query.isNotEmpty() -> { searching = false; query = "" }
            popups.isNotEmpty() -> popups.clear()
            filter != null -> filter = null
            else -> return false
        }
        return true
    }
    BackHandler(enabled = page.reply.open || searching || query.isNotEmpty() || popups.isNotEmpty() || filter != null) { localBack() }

    // レス 1 件(本文とポップアップで共通)。本文を押すとアンカーツリー、長押しでメニュー
    val style = vm.prefs.postStyle
    // アイコンの右下の数字と押したときの絞り込みの鍵: 設定でワッチョイを使うなら、あればワッチョイ、なければ ID
    fun iconKey(p: Post): String? = if (vm.prefs.iconFromWatchoi) watchoiOf(p.name) ?: p.id else p.id
    val iconCounts = remember(index, vm.prefs.iconFromWatchoi) { index.posts.mapNotNull { iconKey(it) }.groupingBy { it }.eachCount() }
    // 返信先の 1 行に出す中身(Discord 風・LINE 風)
    fun previewOf(no: Int): ReplyPreview? {
        val t = index.posts.getOrNull(no - 1)?.takeIf { it.no == no } ?: return null
        // 引用の行のアイコンも、レスのアイコンと同じ決め方(設定でワッチョイがあればワッチョイ、なければ ID)
        val seed = if (vm.prefs.iconFromWatchoi) watchoiOf(t.name) ?: t.id else t.id
        return ReplyPreview(no, seed, t.name.let { n -> TwoCh.cachedNoname(page.summary.boardUrl)?.let { nn -> n.removePrefix(nn).trim() } ?: n }.ifEmpty { "名無し" }, io.github.contentsview08.obb.bbs.splitBeIcon(t.body).second.lineSequence().firstOrNull { it.isNotBlank() && !it.trimStart().startsWith(">>") }?.trim() ?: "")
    }
    fun replyOf(r: RenderedPost?): ReplyPreview? = r?.replyTo?.let { previewOf(it) }
    val postRow = @Composable { p: Post, prev: Post?, inMain: Boolean ->
        // この行の、頭の行の位置(長押しした所が ID・名前の上かを調べる)
        val hit = remember(p.no) { HeaderHit() }
        // 新着で届いたレスは、下から少し浮き上がって順に出てきて、しばらく光る(今のスマホ版の post-enter と flash-new)
        // 出る動きは、届いた時に画面に出ていたレスだけ。あとからスクロールして(一番下へ飛んで)出てきたレスは、待たせずにすぐ描く
        val delayMs = ctl.flash[p.no]?.takeIf { System.currentTimeMillis() - ctl.flashAt < it + 150 }
        val anim = remember(p.no, delayMs) { if (delayMs != null) Animatable(0f) else null }
        // 押して飛んだレス(ミニマップの印・新着の札)は一瞬光らせる
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
        // 光る色は色みのない白(暗い配色)・黒(明るい配色)。強調色(緑など)だと配色によって見分けにくかった
        val flashColor = if (Palette.dark) Color.White else Color.Black
        Box(
            Modifier
                .then(if (anim != null) Modifier.graphicsLayer { alpha = anim.value; translationY = (1f - anim.value) * 8.dp.toPx() } else Modifier)
                .then(if (jumpGlow != null) Modifier.drawBehind { drawRect(flashColor.copy(alpha = 0.28f * jumpGlow.value)) } else Modifier)
                // たどったレス(本文側だけ)
                .then(if (inMain && p.no in traced) Modifier.drawBehind { drawRect(if (Palette.onSky(style)) Palette.selectionWash(style) else Palette.accent.copy(alpha = 0.14f)); drawRect(Palette.accent, size = androidx.compose.ui.geometry.Size(3.dp.toPx(), size.height)) } else Modifier)
                .then(if (flash != null) Modifier.drawBehind {
                    // 24% → 16%(45% の所)→ 0 と消える
                    val f = flash.value
                    val a = if (f > 0.55f) 0.16f + (f - 0.55f) / 0.45f * 0.08f else f / 0.55f * 0.16f
                    drawRect(flashColor.copy(alpha = a * if (Palette.dark) 0.8f else 0.5f))
                } else Modifier)
                .onGloballyPositioned { hit.row = it; if (inMain) rowCoords[p.no] = it }
                .pointerInput(p.no) {
                    awaitEachGesture {
                        val d = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                        downNo = p.no; downInRow = d.position
                        // ID・名前の上での長押しは、字のリンクより先にここで受ける(リンクが指を受け取り、離したときに押したことになっていた)。
                        // ポップアップ(レス抽出・ツリー)の中でも同じ(行ごとに頭の位置を覚えているので、スレ表示の行と取り違えない)
                        val tag = page.rendered[p.no]?.let { r -> HeaderHits.tagAt(r, hit, d.position) }
                        if (tag == null) return@awaitEachGesture
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
                            // 長押しになった: メニューを出し、離すまでの指の動きは下へ渡さない(リンクも行の長押しも動かさない)
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
                    // ダブルタップで返信(設定がオンのときだけ。オフなら 1 回のタップを待たせない)
                    onDoubleClick = if (vm.prefs.doubleTapReply) ({ Haptics.tick(view); replyWith(">>${p.no}\n") }) else null,
                ),
        ) {
            val ngStyle = vm.prefs.ngStyle
            // AI NG(data/AiNg.kt): 畳む・隠すは、ふつうの NG とは別の 1 行に(理由と「当たらない」)。印だけは、レスの上に小さく
            val ai = page.aiNg[p.no]
            if (ai != null && ai.rule.show != "mark" && p.no !in page.ngNos && p.no !in revealed) {
                if (ai.rule.show == "fold") Row(Modifier.fillMaxWidth().clickable { revealed = revealed + p.no }.padding(start = 14.dp, end = 8.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${p.no}  あぼーん  ${ai.label}", Modifier.weight(1f), color = Palette.textMuted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    TextButton(onClick = { vm.markAi(p, ai.rule.id, if (ai.manual) null else false) }) { Text(if (ai.manual) "印を外す" else "当たらない", fontSize = 12.sp) }
                }
            } else if (p.no in page.ngNos && p.no !in revealed && ngStyle != "dim") {
                // あぼーん(1 行に畳む)か、透明あぼーん(何も出さない)
                if (ngStyle == "fold") Text(
                    // 外の行の長押しは、この押せる行に指を取られて届かないので、ここでも受ける
                    "${p.no}  あぼーん", Modifier.fillMaxWidth().combinedClickable(onLongClick = { Haptics.longPress(view); postMenu = p }) { revealed = revealed + p.no }.padding(horizontal = 14.dp, vertical = 10.dp),
                    color = Palette.textMuted, fontSize = 13.sp,
                )
            } else Column {
                if (ai != null && ai.rule.show == "mark") Text(ai.label, Modifier.padding(start = 14.dp, top = 4.dp), color = Palette.markPurple, fontSize = 11.sp)
                androidx.compose.runtime.CompositionLocalProvider(LocalHeaderHit provides hit) { page.rendered[p.no]?.let {
                // 続けて書いたレス(前のレスと同じ ID で、返信でもない)は、アイコンと頭を省く(Discord 風・LINE 風)
                val continued = (index.replyCount[p.no] ?: 0) == 0 && (style == "discord" || style == "line") && prev != null && p.id != null && prev.id == p.id && it.replyTo == null && prev.no !in page.ngNos
                // 薄く表示する NG(会話の流れは残して、字を 3 割に)
                if (p.no in page.ngNos && p.no !in revealed) Box(Modifier.graphicsLayer { alpha = 0.3f }) { PostItem(
                    it, style = style, id = p.id, continued = false, reply = null, onReply = {}, heat = null, aa = it.aa, own = false, toOwn = false,
                    info = null, autoLoad = false, gross = false,
                ) } else PostItem(
                    it, style = style, id = p.id, iconCount = iconCounts[iconKey(p)] ?: 0, continued = continued, reply = if (LocalInTree.current) null else replyOf(it),
                    onReply = { n -> index.posts.getOrNull(n - 1)?.let { t -> traced = setOf(t.no); openPopup(listOf(t)) } },
                    heat = Palette.heat(index.replyCount[p.no] ?: 0),
                    // アイコンを押すと、数字と同じ数え方のレス(設定でワッチョイを使うなら同じワッチョイ、なければ同じ ID)
                    onAvatar = iconKey(p)?.let { k -> { openPopup(index.posts.filter { iconKey(it) == k }, focus = p.no) } },
                    aa = aaOverride[p.no] ?: it.aa, own = p.no in own, toOwn = p.no in toOwn, info = index.info[p.no], autoLoad = autoLoad, onImage = { url -> viewer = url }, onUrl = { url -> page.links.onTag("u:$url") }, gross = p.no in index.gross)
            } }
            }
        }
    }
    // 一番下へ飛ぶボタンは、一番下から 1 画面ぶん以上離れているときだけ出す(今のスマホ版と同じ)
    val atBottom by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()
            !listState.canScrollForward || (last != null && last.index >= info.totalItemsCount - 2)
        }
    }

    // なぞる操作(今のスマホ版の既定と同じ割り当て)。左の端から右へはメニュー
    val prefs = vm.prefs
    // ポップアップが出ている間は、ほかの操作(先頭へ・書き込むなど)は効かせず、戻る(→)でポップアップをまとめて閉じるだけ(今のスマホ版と同じ)
    val gestures = if (!prefs.gesturesEnabled) emptyMap()
    // ポップアップが出ている間: 戻るでまとめて閉じ、先頭へ・一番下へは一番上のポップアップの中を送る。ほかは効かせない(今のスマホ版と同じ)
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
            "deleteLog" to { if (vm.prefs.confirmDeleteLog) confirmDelete = true else vm.deleteLog(page) },
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
    // フッター(書き込み欄)は本文の上に重ね、下へスクロールすると隠す(書いている間・返事が出ている間は隠さない)。今のスマホ版と同じ
    val footerShown = if (page.reply.open || page.reply.done != null || page.reply.notice != null || !bars.enabled) 1f else 1f - bars.footerHidden
    // 上の端で下へ・下の端で上へ引っぱって更新(今のスマホ版の useTouchPull)
    val topPull = remember { PullState { Haptics.confirm(view) } }
    val bottomPull = remember { PullState { Haptics.confirm(view) } }
    val pullConn = remember(page) { PullConnection(topPull, bottomPull, density.density, scope) { refresh()?.join() } }
    // 開いているスレの自動更新(設定。0 ならしない)
    if (prefs.autoRefreshSec > 0) LaunchedEffect(prefs.autoRefreshSec, page) {
        while (true) {
            delay(prefs.autoRefreshSec * 1000L)
            if (!page.loading) vm.refreshThread(page, quiet = true)
        }
    }
    // 画面全体(本文とポップアップ)で指の動きを受ける: なぞる操作と、押した所の高さ(ポップアップを押した所の真上に出すため)
    // キーボードが出たら、スレ表示ごとその上に縮め、本文をキーボードの高さだけ送る(LINE と同じく、下のレスが隠れずに上がる)
    val imeBottom = androidx.compose.foundation.layout.WindowInsets.ime.getBottom(density)
    var lastIme by remember { mutableIntStateOf(0) }
    LaunchedEffect(imeBottom) {
        val d = imeBottom - lastIme
        lastIme = imeBottom
        if (d != 0) runCatching { listState.scrollBy(d.toFloat()) }
    }
    Box(
        // LINE 風のときは、地を吹き出しと区別できる色に
        modifier.fillMaxSize().background(Palette.threadBg(vm.prefs.postStyle)).imePadding()
            .swipeGestures(swipe, gestures, onEdgeRight = if (prefs.gesturesEnabled && popups.isEmpty()) ({ vm.drawerOpen = true }) else null, sensitivity = prefs.gestureSensitivity)
            .pointerInput(Unit) { awaitEachGesture { awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial).position.let { downY = it.y; downX = it.x } } }
            // 2 本指で広げる・狭めると、本文の字の大きさを変える(設定に入る)。1 本指の操作には触らない
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    var acc = 1f
                    val start = vm.prefs.bodyScale
                    do {
                        val e = awaitPointerEvent(PointerEventPass.Initial)
                        if (e.changes.count { it.pressed } >= 2) {
                            acc *= e.calculateZoom()
                            val v = ((start * acc).coerceIn(0.8f, 1.4f) * 20).roundToInt() / 20f
                            if (v != vm.prefs.bodyScale) { vm.prefs.bodyScale = v; Haptics.tick(view) }
                            pinchLabel = "本文 ${(v * 100).roundToInt()}%"
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
                        // ミニマップの幅だけ右を空けて、レスが下に潜らないようにする
                        contentPadding = PaddingValues(
                            top = with(density) { bars.topHeight.toDp() }, end = if (vm.prefs.showMinimap && shown.size > 1) 20.dp else 0.dp,
                            // 重ねたフッターの下に、最後のレスが隠れないように
                            bottom = with(density) { footerH.toDp() },
                        ),
                    ) {
                        itemsIndexed(shown, key = { _, it -> it.no }, contentType = { _, it -> if (it.no in page.ngNos) 1 else 0 }) { i, p ->
                            if (filter == null && query.isBlank() && p.no == page.unreadFrom) UnreadDivider()
                            // まとめているあいだは、先頭に 1 行だけ出し、ほかは高さのない行にする(行の並びはレス番号のまま。スクロールの覚えがレスの並びに頼っているため)
                            val runFirst = ngGroups.firstOf[p.no]
                            val runClosed = runFirst != null && runFirst !in openRuns
                            if (runFirst == p.no) ngGroups.runs[p.no]?.let { run ->
                                NgRunRow(run, open = !runClosed) { openRuns = if (runClosed) openRuns + p.no else openRuns - p.no }
                            }
                            if (!runClosed) postRow(p, shown.getOrNull(i - 1), true)
                            if (!runClosed || runFirst == p.no) {
                                // 区切り線はカードだけ(Discord 風・LINE 風は平らに並べる)
                                // まとめ風は区切りをごく薄く(まとめサイトのように、レスの切れ目は余白で見せる)
                                if (style == "matome") HorizontalDivider(color = Palette.border.copy(alpha = 0.3f))
                                else if (style != "discord" && style != "line") HorizontalDivider(color = Palette.border)
                            }
                        }
                        // -END-(今のスマホ版の Divider: 両側に線、上下は狭く)。押すと自分の書き込みをレス抽出のポップアップで出す
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
                        // 次の未読スレへ(このスレを開いた一覧で、次に新着のあるスレ)
                        if (filter == null && query.isBlank()) item(key = "nextUnread") {
                            val next = remember(index.posts.size, page.readNo) { vm.nextUnread(page) }
                            // 未読のあるスレがなければ、何も出さない(下に余白だけ)
                            if (next == null) { Spacer(Modifier.height(16.dp)); return@item }
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 16.dp)
                                    .border(1.dp, Palette.border, RoundedCornerShape(6.dp)).background(Palette.surface, RoundedCornerShape(6.dp))
                                    .clickable(enabled = next != null) { next?.let { vm.openNextUnread(page, it.second) } }
                                    .padding(horizontal = 14.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(if (next != null) Icons.AutoMirrored.Filled.ArrowForward else Icons.Filled.DoneAll, null, tint = if (next != null) Palette.accent else Palette.textMuted, modifier = Modifier.size(22.dp))
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    if (next == null) Text("この一覧に未読のあるスレはありません", color = Palette.textMuted, fontSize = 12.sp)
                                    else {
                                        Text("次の未読スレへ(${next.first})", color = Palette.textMuted, fontSize = 11.sp, maxLines = 1)
                                        Text(next.second.title, color = Palette.textStrong, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                                if (next != null) {
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        if (next.third > 999) "+999+" else "+${next.third}",
                                        Modifier.background(Palette.unread, RoundedCornerShape(50)).padding(horizontal = 7.dp, vertical = 1.dp),
                                        color = Palette.unreadText, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                                    )
                                }
                            }
                        }
                        // スレが終わったら(dat 落ち・1000 到達)、一番下に次スレの候補を出す(今のスマホ版と同じ)
                        if (ended && filter == null && query.isBlank()) item(key = "next") {
                            LaunchedEffect(Unit) { if (page.nextCandidates == null) vm.findNext(page) }
                            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(bottom = 24.dp).border(1.dp, Palette.border, RoundedCornerShape(6.dp)).background(Palette.surface, RoundedCornerShape(6.dp))) {
                                NextCandidates(page) { vm.openThread(it) }
                            }
                        }
                    }
                }
            }

            // ミニマップ(右端。上の帯の下から、書き込み欄の上まで)
            if (vm.prefs.showMinimap && shown.size > 1) {
                Minimap(
                    shown, index, own, toOwn, if (filter == null && query.isBlank()) page.unreadFrom else null, listState,
                    // フッターの上で終わらせる(フッターが隠れても伸ばさない。伸び縮みすると縮図が動いて見にくい)
                    Modifier.align(Alignment.TopEnd).padding(top = with(density) { (bars.topHeight * (1f - bars.hidden)).toDp() } + 4.dp, bottom = with(density) { footerH.toDp() } + 4.dp, end = 2.dp),
                    onJumped = { no -> ctl.jumpFlash = no to System.nanoTime(); bars.show() },
                    readNo = page.readNo,
                )
            } else if (shown.size > 1) {
                // ミニマップを出していないときは、上の帯の下端に読み進み具合の細いバー
                val progress by remember(shown) {
                    derivedStateOf {
                        val last = listState.layoutInfo.visibleItemsInfo.lastOrNull { it.key is Int }?.index ?: 0
                        (last + 1f) / shown.size
                    }
                }
                Box(
                    Modifier.align(Alignment.TopStart).padding(top = with(density) { (bars.topHeight * (1f - bars.hidden)).toDp() })
                        .fillMaxWidth(progress.coerceIn(0f, 1f)).height(2.dp).background(Palette.accent.copy(alpha = 0.7f)),
                )
            }

            SwipeLabel(swipe)

            // 上の帯と絞り込みのタブ(スクロールで隠れる)
            Column(Modifier.fillMaxWidth().onSizeChanged { bars.topHeight = it.height.toFloat() }.graphicsLayer { translationY = -bars.hidden * bars.topHeight }) {
                if (searching) {
                    SearchBar(query, { query = it }, "レスを探す(本文・名前・ID)") { searching = false; query = "" }
                } else {
                    HeaderBar(page.title.replace(Regex("\\s*[\\[［][0-9]{6,12}[\\]］]\\s*$"), ""), onNav = { vm.drawerOpen = true }, onTitle = { titleSheet = true }) {
                        BarIcon(Icons.Filled.Search, "探す") { searching = true }
                        MoreButton { menu = true }
                    }
                }
                FilterTabs(filter, counts) { filter = it }
                HorizontalDivider(color = Palette.border)
            }

            // 一番下へ(右下)
            if (!atBottom && index.posts.isNotEmpty()) {
                Box(
                    Modifier.align(Alignment.BottomEnd).padding(end = if (vm.prefs.showMinimap) 34.dp else 16.dp, bottom = 14.dp + with(density) { (footerH * footerShown).toDp() }).size(48.dp)
                        .background(Palette.surface2, RoundedCornerShape(6.dp)).border(1.dp, Palette.borderStrong, RoundedCornerShape(6.dp))
                        .clickable { scroller.toBottom(); bars.show() },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.KeyboardDoubleArrowDown, "一番下へ", tint = Palette.textBody) }
            }

            // 引っぱって更新の印(上は上の帯の下から、下はフッターの上の端から出てくる)
            PullSpinner(topPull, 1, Modifier.align(Alignment.TopCenter).padding(top = with(density) { (bars.topHeight * (1f - bars.hidden)).toDp() }))
            PullSpinner(bottomPull, -1, Modifier.align(Alignment.BottomCenter).padding(bottom = with(density) { (footerH * footerShown).toDp() }))

            // 新着の札: 新着の頭が画面の外なら、下から「新着 +N」を少しのあいだ出す。押すと新着の頭へ
            ctl.newToast?.let { (count, first) ->
                val slide = remember(first) { Animatable(0f) }
                LaunchedEffect(first) { slide.animateTo(1f, tween(260, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f))) }
                Row(
                    Modifier.align(Alignment.BottomCenter).padding(bottom = with(density) { (footerH * footerShown).toDp() } + 20.dp)
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

            // フッター(書き込み欄)。本文の上に重ね、下へスクロールすると隠す
            Box(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().onSizeChanged { footerH = it.height.toFloat() }
                    .graphicsLayer { translationY = (1f - footerShown) * footerH },
            ) { ThreadFooter(vm, page) { refresh() } }

        }
        pinchLabel?.let {
            Text(
                it, Modifier.align(Alignment.Center).background(Palette.surface3.copy(alpha = 0.95f), RoundedCornerShape(8.dp)).padding(horizontal = 16.dp, vertical = 10.dp),
                color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold,
            )
        }
        // ポップアップは本文のスクロールの外に置く(ポップアップの中をスクロールしても、後ろの帯が隠れたり、引っぱって更新が動いたりしないように)
        PopupLayer(
            popups, bg = Palette.threadBg(style), topInset = bars.topHeight * (1f - bars.hidden), endInset = 0.dp,
            onCloseTop = { popups.removeAt(popups.lastIndex) },
        ) { postRow(it, null, false) }
    }

    // ︙ のメニュー(今のスマホ版の並び: お気に入り・画像一覧・次スレ・検索・板・先頭・一番下・表示スタイル・文字の大きさ・URL・ブラウザ・保存・更新・削除)
    if (menu) {
        MenuSheet(
            listOf(
                listOf(
                    MenuItem(if (page.favorite) "お気に入りのスレから外す" else "お気に入りのスレに足す", if (page.favorite) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, Palette.markFav) { vm.toggleFavoriteThread(page) },
                    MenuItem("画像一覧", Icons.Filled.PhotoLibrary, Palette.markImage) { gallery = true },
                    MenuItem("次スレを探す", Icons.Filled.SkipNext, Palette.accent) { vm.findNext(page); nextSheet = true },
                    MenuItem("レス検索", Icons.Filled.Search, Palette.accent) { searching = true; bars.show() },
                    MenuItem("板に戻る", Icons.AutoMirrored.Filled.List) { vm.openBoardOf(page) },
                ),
                listOf(
                    MenuItem("先頭へ", Icons.Filled.VerticalAlignTop) { scope.launch { listState.scrollToItem(0); bars.show() } },
                    MenuItem("一番下へ", Icons.Filled.VerticalAlignBottom) { scroller.toBottom(); bars.show() },
                    MenuItem("表示スタイル", Icons.Filled.Palette, Palette.markPurple) { styleSheet = true },
                    MenuItem("文字の大きさ・余白", Icons.Filled.FormatSize) { fontDialog = true },
                ),
                listOf(
                    MenuItem("URL をコピー", Icons.Filled.Link, Palette.markLink) { copyText(context, TwoCh.webUrl(page.summary)); vm.toast = "URL をコピーしました" },
                    MenuItem("ブラウザで開く", Icons.AutoMirrored.Filled.OpenInNew, Palette.markLink) { openExternal(context, TwoCh.webUrl(page.summary), false) },
                    MenuItem("スレを保存(HTML・テキスト)", Icons.Filled.Save) { saveSheet = true },
                    MenuItem(if (filter == Filter.OWN) "自分の書き込みの絞り込みを外す" else "自分の書き込みだけ(${counts[Filter.OWN] ?: 0})", Icons.Filled.Person, Palette.own) { filter = if (filter == Filter.OWN) null else Filter.OWN },
                    MenuItem("更新", Icons.Filled.Refresh, Palette.accent) { refresh() },
                ),
                listOf(MenuItem("ログを削除して閉じる", Icons.Filled.Delete, danger = true) { if (vm.prefs.confirmDeleteLog) confirmDelete = true else vm.deleteLog(page) }),
            ),
        ) { menu = false }
    }
    // 形式を選ぶと、端末のファイルの画面で保存先を選ぶ
    if (saveSheet) {
        MenuSheet(
            listOf(listOf(
                MenuItem("HTML で保存", Icons.Filled.Save) { saveHtml.launch("$safeName.html") },
                MenuItem("テキストで保存", Icons.Filled.Save) { saveText.launch("$safeName.txt") },
            )),
            MenuAt.Center,
        ) { saveSheet = false }
    }
    // スレタイを押したときのメニュー(今のスマホ版と同じ)
    if (titleSheet) {
        MenuSheet(
            listOf(
                listOf(
                    MenuItem("板を開く", Icons.AutoMirrored.Filled.List) { vm.openBoardOf(page) },
                    MenuItem(if (page.favorite) "お気に入りのスレから外す" else "お気に入りのスレに足す", if (page.favorite) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, Palette.markFav) { vm.toggleFavoriteThread(page) },
                ),
                listOf(
                    MenuItem("スレタイをコピー", Icons.Filled.ContentCopy, Palette.markLink) { copyText(context, page.title); vm.toast = "スレタイをコピーしました" },
                    MenuItem("URL をコピー", Icons.Filled.Link, Palette.markLink) { copyText(context, TwoCh.webUrl(page.summary)); vm.toast = "URL をコピーしました" },
                    MenuItem("スレタイと URL をコピー", Icons.Filled.ContentCopy, Palette.markLink) { copyText(context, "${page.title}\n${TwoCh.webUrl(page.summary)}"); vm.toast = "スレタイと URL をコピーしました" },
                    MenuItem("スレタイを NG に追加", Icons.Filled.Block, danger = true) { vm.addNg(NgRule("title", page.title)) },
                ),
                listOf(
                    MenuItem("先頭へ", Icons.Filled.VerticalAlignTop) { scope.launch { listState.scrollToItem(0); bars.show() } },
                    MenuItem("ブラウザで開く", Icons.AutoMirrored.Filled.OpenInNew, Palette.markLink) { openExternal(context, TwoCh.webUrl(page.summary), false) },
                ),
                listOf(MenuItem("ログを削除して閉じる", Icons.Filled.Delete, danger = true) { if (vm.prefs.confirmDeleteLog) confirmDelete = true else vm.deleteLog(page) }),
            ),
            MenuAt.TopStart,
        ) { titleSheet = false }
    }
    aaZoom?.let { n -> page.rendered[n]?.let { AaZoom(it) { aaZoom = null } } }
    if (styleSheet) StyleSheet(vm.prefs, onFont = { fontOnly = true; fontDialog = true }) { styleSheet = false }

    if (ngEditing != null) {
        val r = ngEditing!!
        NgEditSheet(r, page.summary.boardUrl to (vm.favorites.firstOrNull { it.url == page.summary.boardUrl }?.name ?: page.summary.boardUrl), isNew = false, onDismiss = { ngEditing = null }, onDelete = { vm.removeNg(r); ngEditing = null }) { vm.saveNg(it); ngEditing = null }
    }

    postMenu?.let { p ->
        MenuSheet(
            listOf(
                // 今のスマホ版の長押しと同じ並び: 返信・定型文・アンカーツリー / コピー・AA / NG
                listOf(
                    MenuItem("返信(>>${p.no})", Icons.AutoMirrored.Filled.Reply, Palette.accent) { replyWith(">>${p.no}\n") },
                    // 引用して返信: >>番号 と、本文の頭(アンカーの行を除いて 3 行まで)を「>」付きで
                    MenuItem("引用して返信", Icons.Filled.FormatQuote, Palette.accent) {
                        val quote = p.body.lines().filter { it.isNotBlank() && !it.trimStart().startsWith(">>") }.take(3).joinToString("\n") { "> ${it.trim()}" }
                        replyWith(">>${p.no}\n$quote\n")
                    },
                ) +
                    vm.prefs.quickPhrases.lines().map { it.trim() }.filter { it.isNotEmpty() }.map { ph ->
                        MenuItem("「$ph」とすぐ書き込む", Icons.Filled.Bolt, Palette.markHot) { vm.quickPost(page, p.no, ph) }
                    } +
                    listOfNotNull(
                        if (index.tree(p.no).size > 1) MenuItem("アンカーツリーを表示", Icons.Filled.AccountTree, Palette.markPurple) {
                            val rows = index.treeRows(p.no)
                            openPopup(rows.mapNotNull { r -> index.posts.getOrNull(r.no - 1) }, rows, p.no)
                        } else null,
                    ),
                listOf(
                    MenuItem("ヘッダ含めてコピー", Icons.Filled.ContentCopy, Palette.markLink) {
                        copyText(context, "${p.no} ${p.name} ${p.date}${p.id?.let { " ID:$it" } ?: ""}\n${p.body}"); vm.toast = "コピーしました"
                    },
                    MenuItem("本文のみコピー", Icons.Filled.ContentCopy, Palette.markLink) { copyText(context, p.body); vm.toast = "コピーしました" },
                    (aaOverride[p.no] ?: page.rendered[p.no]?.aa ?: false).let { isAA ->
                        MenuItem(if (isAA) "文字列として表示" else "AAとして表示", if (isAA) Icons.AutoMirrored.Filled.Notes else Icons.Filled.GridOn) { aaOverride = aaOverride + (p.no to !isAA) }
                    },
                ) + listOfNotNull(
                    // AA のレスだけ(縮めて収めた AA は字が小さすぎて読めないことがある)
                    if (aaOverride[p.no] ?: page.rendered[p.no]?.aa ?: false) MenuItem("AA を拡大して見る", Icons.Filled.ZoomIn, Palette.markPurple) { aaZoom = p.no } else null,
                ),
                // 自分のレスの印(書き込んだときに付くもの)を手で付け外しする。ほかの専ブラ・ブラウザから書いたレスにも付けられるように
                (p.no in own).let { isOwn ->
                    listOfNotNull(
                        if (isOwn) MenuItem("自分のレスの印を外す", Icons.Filled.PersonRemove, Palette.own) { vm.markOwn(page, p, own = false, sameId = false) }
                        else MenuItem("自分のレスの印を付ける", Icons.Filled.HowToReg, Palette.own) { vm.markOwn(page, p, own = true, sameId = false) },
                        if (p.id == null) null
                        else if (isOwn) MenuItem("同じ ID のレスすべての印を外す", Icons.Filled.GroupRemove, Palette.own) { vm.markOwn(page, p, own = false, sameId = true) }
                        else MenuItem("同じ ID のレスすべてに印を付ける", Icons.Filled.Group, Palette.own) { vm.markOwn(page, p, own = true, sameId = true) },
                    )
                },
                // すでに当たっている NG があれば、足す項目の代わりに外す項目を出す
                ngHitsOf(p).let { hits ->
                    (if (!hits?.id.isNullOrEmpty()) ngOffItems(hits!!.id, "ID", p.id) else idNgItems(p, Palette.markDanger)) +
                        (if (!hits?.name.isNullOrEmpty()) ngOffItems(hits!!.name, "名前", p.name) else listOf(nameNgItem(p, Palette.markDanger))) +
                        ngOffItems(hits?.body.orEmpty(), "本文", null) +
                        MenuItem("言葉を NG…", Icons.Filled.Block, Palette.markDanger) { ngWordFor = p }
                },
                // AI NG: 条件ごとに「当たる」を手で付ける。当たっているものは「当たらない」
                vm.aiRulesFor(page).map { r ->
                    val on = page.aiNg[p.no]?.rule?.id == r.id
                    if (on) MenuItem("AI NG「${r.name}」に当たらない(誤判定)", Icons.Filled.Psychology, Palette.markPurple) { vm.markAi(p, r.id, if (page.aiNg[p.no]?.manual == true) null else false) }
                    else MenuItem("AI NG「${r.name}」に当たる", Icons.Filled.Psychology, Palette.markPurple) { vm.markAi(p, r.id, true) }
                },
            ),
            MenuAt.Center,
        ) { postMenu = null }
    }

    headMenu?.let { (kind, p) ->
        val sameId = if (kind == 'i' && p.id != null) index.posts.filter { it.id == p.id } else emptyList()
        val sameName = if (kind == 'n') index.posts.filter { it.name == p.name } else emptyList()
        MenuSheet(
            listOf(
                if (kind == 'i' && p.id != null) ngHitsOf(p)?.id.orEmpty().let { hits -> if (hits.isNotEmpty()) ngOffItems(hits, "ID", p.id) else idNgItems(p, Palette.markDanger) } + listOf(
                    MenuItem("この ID のレスを見る(${sameId.size})", Icons.Filled.Search, Palette.markLink) { openPopup(sameId, focus = p.no) },
                    MenuItem("ID をコピー", Icons.Filled.ContentCopy) { copyText(context, p.id); vm.toast = "コピーしました" },
                ) else ngHitsOf(p)?.name.orEmpty().let { hits -> if (hits.isNotEmpty()) ngOffItems(hits, "名前", p.name) else listOf(nameNgItem(p, Palette.markDanger)) } + listOf(
                    MenuItem("同じ名前のレスを見る(${sameName.size})", Icons.Filled.Search, Palette.markLink) { openPopup(sameName, focus = p.no) },
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

    // 画像一覧(ビューアーを閉じたら一覧に戻る。一覧は閉じない)
    if (gallery) GalleryPanel(index.allImages, onOpen = { viewer = it }, onToast = { vm.toast = it }) { gallery = false }

    if (nextSheet) {
        CenterPanel(onDismiss = { nextSheet = false }) {
            Column(Modifier.padding(bottom = 4.dp)) {
                NextCandidates(page) { nextSheet = false; vm.openThread(it) }
            }
        }
    }

    // 文字の大きさ・余白(︙ から。今のスマホ版と同じ: レスの本文・レスの頭・行間・レスの上下の余白・ヘッダーとフッター)
    if (fontDialog) SizeDialog({ fontDialog = false; fontOnly = false }) {
        val pr = vm.prefs
        if (fontOnly) SizeSlider("画面全体の文字", pr.fontScale, 0.85f..1.3f, 8, "${(pr.fontScale * 100).toInt()}%", 1f) { pr.fontScale = (it * 20).toInt() / 20f }
        else {
            SizeSlider("レスの本文", pr.bodyScale, 0.8f..1.4f, 11, "${(pr.bodyScale * 100).toInt()}%", 1f) { pr.bodyScale = (it * 20).toInt() / 20f }
            SizeSlider("レスの頭(名前・日付・ID)", pr.postHeadScale, 0.8f..1.4f, 11, "${(pr.postHeadScale * 100).toInt()}%", 1f) { pr.postHeadScale = (it * 20).toInt() / 20f }
            SizeSlider("レスの本文の行間", pr.lineHeight, 1.2f..1.9f, 13, "%.2f".format(pr.lineHeight), 1.47f) { pr.lineHeight = (it * 20).toInt() / 20f }
            SizeSlider("レスの上下の余白", pr.postPad.toFloat(), 0f..24f, 23, "${pr.postPad}dp", 8f) { pr.postPad = it.toInt() }
            BarSliders(pr)
        }
    }

    if (confirmDelete) ConfirmDeleteDialog(vm.prefs, onDelete = { vm.deleteLog(page) }) { confirmDelete = false }

    viewer?.let { url ->
        if (url in index.allImages) ImageViewer(index.allImages, url, onClose = { viewer = null }, posts = index.allImagePosts)
        else ImageViewer(listOf(url), url, onClose = { viewer = null })
    }
}

/** 見えている一番下のレスを、スクロールが止まって少ししてから既読として知らせる */
/** どこまで読んだかを知らせ、読んでいた位置を覚える(戻って開き直したときに戻す) */
private fun reportRead(ctl: ThreadScrollCtl, scroller: ThreadScroller, vm: AppViewModel, page: Page.Thread) {
    val (last, pos) = scroller.progress()
    if (pos != null) vm.savePosition(page.summary.id, pos)
    if (last > ctl.sent) {
        ctl.sent = last
        vm.markRead(page, last)
    }
}

/** 続けて並んだあぼーんをまとめた 1 行。押すと広げる・まとめ直す */
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

/** 絞り込みのタブ(人気・画像・動画・リンク・すべてを等分に。選んでいるタブは薄く色を敷いて下に線) */
@Composable
private fun FilterTabs(filter: Filter?, counts: Map<Filter, Int>, onSelect: (Filter?) -> Unit) {
    Row(Modifier.fillMaxWidth().background(Palette.bar)) {
        for ((f, icon, color) in TABS) Tab(Modifier.weight(1f), filter == f, { onSelect(if (filter == f) null else f) }) {
            // 絞り込みは大事な情報ではないので、アイコンは色を付けず控えめに(選んでいるときだけ強調色)
            Icon(icon, null, tint = if (filter == f) Palette.accent else Palette.textMuted.copy(alpha = 0.8f), modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(3.dp))
            Text(f.label, fontSize = 14.sp, color = if (filter == f) Palette.accent else Palette.textMuted, maxLines = 1)
            val n = counts[f] ?: 0
            if (n > 0) Text("$n", Modifier.padding(start = 2.dp), fontSize = 10.sp, color = Palette.textMuted)
        }
        // 「すべて」(絞り込んでいない、いつもの状態)は面を塗らず、文字と線だけ。絞り込んだときだけ面を塗って目立たせる
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


/** 次スレの候補の一覧(︙ の「次スレを探す」と、終わったスレの一番下で共通) */
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
