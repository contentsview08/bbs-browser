package io.github.contentsview08.obb

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.ui.unit.IntOffset
import androidx.compose.animation.togetherWith
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.fadeOut
import androidx.compose.animation.fadeIn
import androidx.compose.animation.core.tween
import androidx.compose.animation.AnimatedContent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.serviceLoaderEnabled
import io.github.contentsview08.obb.ui.BbsTheme
import io.github.contentsview08.obb.ui.BoardsScreen
import io.github.contentsview08.obb.ui.DrawerContent
import io.github.contentsview08.obb.ui.Palette
import io.github.contentsview08.obb.ui.PostHistoryScreen
import io.github.contentsview08.obb.ui.UploadsScreen
import io.github.contentsview08.obb.ui.SettingsScreen
import io.github.contentsview08.obb.ui.ThreadEntryList
import io.github.contentsview08.obb.ui.swipeGestures
import io.github.contentsview08.obb.ui.ThreadListScreen
import io.github.contentsview08.obb.ui.ThreadScreen
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    /** ネットワークの復帰を、前面の間だけ見る */
    private val network = object : android.net.ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: android.net.Network) = runOnUiThread { vm.syncNetworkBack() }
    }

    override fun onStart() {
        super.onStart()
        vm.appVisible = true
        vm.syncForeground()
        runCatching { getSystemService(android.net.ConnectivityManager::class.java).registerDefaultNetworkCallback(network) }
    }

    /** 画面に触れるたび(指を置いたとき・キー)。読んでいる間は同期の確認を選んだ間隔のままにする */
    override fun onUserInteraction() {
        super.onUserInteraction()
        vm.syncActivity()
    }

    override fun onStop() {
        super.onStop()
        vm.appVisible = false
        runCatching { getSystemService(android.net.ConnectivityManager::class.java).unregisterNetworkCallback(network) }
        vm.syncBackground()
    }

    /**
     * 通知を押して開いたとき: そのスレ・板をアプリの中で開く。
     * この Activity は exported なので、自前の action が付いた intent だけを読み、URL も掲示板の板・スレの形(家の中のアドレスでない)に限る
     */
    private fun openFromNotification(intent: android.content.Intent?) {
        if (intent?.action != io.github.contentsview08.obb.data.Notifier.ACTION_OPEN_URL) return
        val url = intent.getStringExtra(io.github.contentsview08.obb.data.Notifier.OPEN_URL) ?: return
        intent.removeExtra(io.github.contentsview08.obb.data.Notifier.OPEN_URL)
        if (!io.github.contentsview08.obb.data.isAutoLoadable(url) || io.github.contentsview08.obb.bbs.UrlRoute.parse(url) == null) return
        vm.openUrl(url)
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openFromNotification(intent)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // 本文の画像は ImageStore が取る(待ち行列・進み具合・タイムアウト)。Coil はファイルを絵にするのと、リンクのカードの絵だけに使う
        // AsyncImage の画像も https を先に試す。
        // coil-gif(ビューアーのアニメーション用)は ServiceLoader で全部の ImageLoader に自動で入るので、ここでは切る
        // (サムネイルまで GIF が動くと電池と描画が重い。使う部品はこの下で明示的に足す)
        coil3.SingletonImageLoader.setSafe { context ->
            coil3.ImageLoader.Builder(context).serviceLoaderEnabled(false).components {
                add(coil3.network.okhttp.OkHttpNetworkFetcherFactory(callFactory = {
                    okhttp3.OkHttpClient.Builder().addInterceptor(io.github.contentsview08.obb.data.HttpsFirst).build()
                }))
            }.build()
        }
        // 背景は暗いので、時計などのアイコンは明るい色で出す
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        openFromNotification(intent)
        setContent {
            // 配色: 設定の配色か、スマホのダーク・ライトに合わせた配色
            val systemDark = androidx.compose.foundation.isSystemInDarkTheme()
            val p = vm.prefs
            io.github.contentsview08.obb.ui.Haptics.enabled = p.haptics
            io.github.contentsview08.obb.ui.Motion.pref = p.reduceMotion
            LaunchedEffect(Unit) { io.github.contentsview08.obb.ui.Motion.read(this@MainActivity) }
            LaunchedEffect(p.fontFamily) { io.github.contentsview08.obb.data.Fonts.apply(this@MainActivity, p.fontFamily) }
            // AI NG のモデルは、使う設定のときだけ動かす(取ってあれば通信しない)
            LaunchedEffect(p.aiNgEnabled) { if (p.aiNgEnabled) io.github.contentsview08.obb.data.AiModel.start(this@MainActivity) else io.github.contentsview08.obb.data.AiModel.stop() }
            val key = if (p.followOsTheme) (if (systemDark) p.darkScheme else p.lightScheme) else p.scheme
            LaunchedEffect(key, p.customScheme) {
                io.github.contentsview08.obb.ui.CustomSchemes.def = io.github.contentsview08.obb.ui.CustomDef.parse(p.customScheme)
                Palette.scheme = io.github.contentsview08.obb.ui.schemeOf(key)
            }
            LaunchedEffect(p.accent) { Palette.accentPick = io.github.contentsview08.obb.ui.accentOf(p.accent) }
            // 時計などのアイコンの色を、配色の明るさに合わせる
            LaunchedEffect(Palette.dark) {
                val t = android.graphics.Color.TRANSPARENT
                val style = if (Palette.dark) SystemBarStyle.dark(t) else SystemBarStyle.light(t, t)
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }
            BbsTheme {
                // 基本の文字は、メニュー・ボタン・ポップアップなどの部品の字。レスとスレ一覧の行は WithoutBaseFont で外す
                val d = LocalDensity.current
                // 上の帯の左のボタンの長押し: たどってきた画面の一覧(押すとそこまで戻る)
                var backMenu by remember { mutableStateOf(false) }
                val navLong: (() -> Unit)? = if (vm.stack.size > 1) ({ backMenu = true }) else null
                CompositionLocalProvider(LocalDensity provides Density(d.density, d.fontScale * vm.prefs.fontScale), io.github.contentsview08.obb.ui.LocalDeviceFontScale provides d.fontScale, io.github.contentsview08.obb.ui.LocalPrefs provides vm.prefs, io.github.contentsview08.obb.ui.LocalNavLong provides navLong) {
                    if (backMenu) io.github.contentsview08.obb.ui.MenuSheet(
                        listOf(
                            vm.stack.toList().withIndex().reversed().drop(1).map { (i, pg) ->
                                io.github.contentsview08.obb.ui.MenuItem(
                                    "${"› ".repeat(i)}${vm.pageName(pg)}",
                                    if (pg is Page.Thread) androidx.compose.material.icons.Icons.Filled.Forum else androidx.compose.material.icons.Icons.AutoMirrored.Filled.List) { vm.popTo(i) }
                            },
                        ),
                        io.github.contentsview08.obb.ui.MenuAt.TopStart,
                    ) { backMenu = false }
                    val drawer = rememberDrawerState(DrawerValue.Closed)
                    // 引き出しの開け閉めは ViewModel の drawerOpen に合わせる(画面の ☰ から開く)
                    LaunchedEffect(vm.drawerOpen) { if (vm.drawerOpen) drawer.open() else drawer.close() }
                    // 動きが止まった所で実際の状態に合わせる。開く途中で外を押されると currentValue は Closed のまま変わらず、drawerOpen が true に残って ☰ が効かなくなる
                    LaunchedEffect(drawer) {
                        snapshotFlow { drawer.isAnimationRunning to drawer.currentValue }.collect { (running, value) ->
                            if (!running) vm.drawerOpen = value == DrawerValue.Open
                        }
                    }
                    BackHandler(enabled = vm.drawerOpen) { vm.drawerOpen = false }
                    // 戻る(なぞって戻る途中も): なぞっている間は今の画面が指についてきて、後ろに前の画面が見える。離せば戻り、引き返せばやめる
                    androidx.activity.compose.PredictiveBackHandler(enabled = !vm.drawerOpen && vm.stack.size > 1) { progress ->
                        try {
                            progress.collect { e -> vm.backDrag = e.progress }
                            // 指で最後まで動かしたので、移り変わりの動きはなしで戻る
                            val dragged = vm.backDrag > 0f
                            vm.back()
                            if (dragged) vm.navDir = 2
                        } catch (e: kotlinx.coroutines.CancellationException) {
                            // やめた: 元の位置へ戻す
                            val a = androidx.compose.animation.core.Animatable(vm.backDrag)
                            a.animateTo(0f, tween(180)) { vm.backDrag = value }
                            throw e
                        } finally {
                            if (vm.navDir == 2 || vm.backDrag != 0f) vm.backDrag = 0f
                        }
                    }
                    // いちばん下の画面で戻ると、すぐには閉じず「もう一度戻ると終了します」を出す。2 秒以内にもう一度戻ったら閉じる
                    var lastBack by androidx.compose.runtime.remember { androidx.compose.runtime.mutableLongStateOf(0L) }
                    BackHandler(enabled = !vm.drawerOpen && vm.stack.size <= 1) {
                        val now = System.currentTimeMillis()
                        if (now - lastBack < 2000) finish() else { lastBack = now; vm.toast = "もう一度戻るとアプリを終了します" }
                    }
                    // 引き出しの指の操作は、開いているとき(閉じる)だけ。開くのはスワイプの操作(左の端から右へ)に任せる
                    ModalNavigationDrawer(drawerState = drawer, gesturesEnabled = vm.drawerOpen, drawerContent = { DrawerContent(vm) }) {
                        Box(Modifier.fillMaxSize().background(Palette.base).statusBarsPadding()) {
                            val pageContent: @androidx.compose.runtime.Composable (Page?) -> Unit = { page ->
                            // スレ一覧・スレ表示のほかの画面(閲覧履歴・書き込み履歴など)も、右へなぞるとメニューを開く。設定は SettingsScreen が大項目の画面でだけ受ける
                            val swipe = io.github.contentsview08.obb.ui.rememberSwipeState()
                            val others = page !is Page.Threads && page !is Page.Thread && page !is Page.Settings
                            val drawerGesture = mapOf("right" to io.github.contentsview08.obb.ui.SwipeAction("メニュー") { vm.drawerOpen = true })
                            Box(
                                Modifier.fillMaxSize().background(Palette.base).then(
                                    if (others && vm.prefs.gesturesEnabled) Modifier.swipeGestures(swipe, drawerGesture, sensitivity = vm.prefs.gestureSensitivity) else Modifier,
                                ),
                            ) {
                            when (page) {
                                is Page.Threads -> ThreadListScreen(vm, page)
                                is Page.Thread -> ThreadScreen(vm, page)
                                is Page.Boards -> BoardsScreen(vm, page)
                                is Page.History -> ThreadEntryList(vm, "history", vm.history, "閲覧履歴はありません")
                                is Page.AllUnread -> io.github.contentsview08.obb.ui.ThreadEntryList(vm, "unread", vm.allUnread, "新着のある読んだスレはありません(更新で確かめます)", onRefresh = { vm.loadAllUnread() })
                                is Page.FavThreads -> ThreadEntryList(vm, "fav", vm.favThreads, "お気に入りのスレはありません(スレの ︙ から足せます)")
                                is Page.PostHistory -> PostHistoryScreen(vm)
                                is Page.Uploads -> UploadsScreen(vm)
                                is Page.Settings -> SettingsScreen(vm, page.start)
                                null -> {}
                            }
                            }
                            }
                            // なぞって戻っている途中は、前の画面を後ろに置く(今の画面は上で指の分だけ右へずれる)
                            val behind = vm.stack.getOrNull(vm.stack.lastIndex - 1)
                            // 指の量は描くときにだけ読む(合成で読むと、指が動くたびに後ろの画面ごと作り直しになる)
                            val dragging by remember { androidx.compose.runtime.derivedStateOf { vm.backDrag > 0f } }
                            if (dragging && behind != null) Box(Modifier.fillMaxSize().graphicsLayer { translationX = -(1f - vm.backDrag) * size.width * 0.25f }) {
                                pageContent(behind)
                                Box(Modifier.fillMaxSize().drawBehind { drawRect(Color.Black.copy(alpha = 0.25f * (1f - vm.backDrag))) })
                            }
                            AnimatedContent(
                                targetState = vm.stack.lastOrNull(),
                                modifier = Modifier.graphicsLayer { translationX = vm.backDrag * size.width; shadowElevation = if (vm.backDrag > 0f) 24f else 0f },
                                transitionSpec = {
                                    // 何が起きたか分かるように: 開くと新しい画面が右端からすべり込み、前の画面は少し左へ下がって暗くなる。
                                    // 戻ると今の画面が右へ抜け、前の画面が左から戻る(スマホのふつうの画面の移り方)
                                    val ease = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
                                    val move = tween<IntOffset>(320, easing = ease)
                                    val fade = tween<Float>(320, easing = ease)
                                    if (vm.navDir == 2) androidx.compose.animation.EnterTransition.None togetherWith androidx.compose.animation.ExitTransition.None
                                    // 動きを減らすときは、すっと切り替えるだけ
                                    else if (io.github.contentsview08.obb.ui.Motion.reduced) fadeIn(tween(90)) togetherWith fadeOut(tween(90))
                                    else when (vm.navDir) {
                                        1 -> slideInHorizontally(move) { it } togetherWith (slideOutHorizontally(move) { -it / 4 } + fadeOut(fade, targetAlpha = 0.5f))
                                        -1 -> (slideInHorizontally(move) { -it / 4 } + fadeIn(fade, initialAlpha = 0.5f)) togetherWith slideOutHorizontally(move) { it }
                                        else -> fadeIn(tween(200)) togetherWith fadeOut(tween(200))
                                    }.apply { targetContentZIndex = if (vm.navDir == -1) -1f else 1f }
                                },
                                contentKey = { it?.hashCode() },
                                label = "page",
                            ) { page -> pageContent(page) }
                            io.github.contentsview08.obb.ui.QuickAccess(vm)
                            // 一瞬出す知らせ
                            vm.toast?.let { msg ->
                                LaunchedEffect(msg) { delay(2200); if (vm.toast == msg) vm.toast = null }
                                // 右からすべり込む
                                val slide = androidx.compose.runtime.remember(msg) { androidx.compose.animation.core.Animatable(0f) }
                                LaunchedEffect(msg) { slide.animateTo(1f, tween(260, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f))) }
                                Text(
                                    msg, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 96.dp)
                                        .graphicsLayer { alpha = slide.value; translationX = (1f - slide.value) * size.width * 1.1f }
                                        .background(Palette.surface3, RoundedCornerShape(20.dp)).padding(horizontal = 16.dp, vertical = 10.dp),
                                    color = Palette.textStrong, fontSize = 14.sp,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
