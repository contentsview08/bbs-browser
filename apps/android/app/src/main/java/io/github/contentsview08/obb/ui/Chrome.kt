package io.github.contentsview08.obb.ui

import androidx.compose.material.icons.filled.Refresh
import androidx.compose.foundation.background
import androidx.compose.animation.core.animateFloat
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ColorLens
import androidx.compose.material.icons.filled.FormatSize
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.ViewAgenda
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.animation.togetherWith
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.offset
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlin.math.roundToInt
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * スクロールで上下の帯を隠す(PC 版の useHideOnScroll を写したもの):
 * - 向きが変わった所からの合計が 8dp を超えたら、下へ送るときは隠し、上へ戻すときは出す。出し入れは 0.2 秒ですべらせる
 * - 一番上・一番下では両方出す
 * - 指で動かしたスクロールでだけ隠す(開いた直後の、未読への飛び・位置の戻しでは隠さない)
 * 帯の高さは onSizeChanged で測って入れる。動いている値は graphicsLayer と barPadding で描く・置くときにだけ読み、画面を組み直さない
 */
@Stable
class HideOnScroll(private val threshold: Float) {
    var topHeight by mutableFloatStateOf(0f)
    var bottomHeight by mutableFloatStateOf(0f)
    /** 隠すか(目標)。hidden・footerHidden がそこへ向かって動く */
    var headerOff by mutableStateOf(false)
    var footerOff by mutableStateOf(false)
    private val headerAnim = androidx.compose.animation.core.Animatable(0f)
    private val footerAnim = androidx.compose.animation.core.Animatable(0f)
    /** 0(出ている)〜1(隠れている)。上の帯。読むと毎フレーム変わるので、組み立ての中では読まない */
    val hidden get() = headerAnim.value
    /** 0(出ている)〜1(隠れている)。下の帯。読むと毎フレーム変わるので、組み立ての中では読まない */
    val footerHidden get() = footerAnim.value

    /** 目標(headerOff・footerOff)が変わるたびに、0.2 秒ですべらせる */
    suspend fun animate() = kotlinx.coroutines.coroutineScope {
        launch { slide(headerAnim) { headerOff } }
        launch { slide(footerAnim) { footerOff } }
    }

    private suspend fun slide(anim: androidx.compose.animation.core.Animatable<Float, androidx.compose.animation.core.AnimationVector1D>, off: () -> Boolean) {
        androidx.compose.runtime.snapshotFlow(off).collectLatest { anim.animateTo(if (it) 1f else 0f, androidx.compose.animation.core.tween(200)) }
    }

    /** 設定で切ったら隠さない */
    var enabled by mutableStateOf(true)
    /** 一番上・一番下にいるか(画面が渡す) */
    var atTop: () -> Boolean = { false }
    var atBottom: () -> Boolean = { false }
    private var direction = 0
    private var moved = 0f

    fun show() { headerOff = false; footerOff = false }

    val connection = object : NestedScrollConnection {
        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            if (!enabled) { show(); return Offset.Zero }
            // 指で動かしたスクロールと、その慣性だけ
            if (source != NestedScrollSource.UserInput && source != NestedScrollSource.SideEffect) return Offset.Zero
            if (atTop()) { show(); direction = 0; moved = 0f; return Offset.Zero }
            val bottom = atBottom()
            if (bottom) { show(); direction = 0; moved = 0f; return Offset.Zero }
            val delta = -consumed.y
            if (delta == 0f) return Offset.Zero
            val dir = if (delta > 0) 1 else -1
            if (dir != direction) { direction = dir; moved = 0f }
            moved += kotlin.math.abs(delta)
            if (moved > threshold) {
                if (dir > 0) { headerOff = true; footerOff = true } else show()
            }
            return Offset.Zero
        }
    }
}

@Composable
fun rememberHideOnScroll(): HideOnScroll {
    val px = with(androidx.compose.ui.platform.LocalDensity.current) { 8.dp.toPx() }
    val bars = remember { HideOnScroll(px) }
    androidx.compose.runtime.LaunchedEffect(bars) { bars.animate() }
    return bars
}

/**
 * 帯の出し入れに合わせて動く上下の余白(padding と同じ測り方。px で返す)。置く段階で読むので、帯が動いても画面を組み直さない
 */
fun Modifier.barPadding(top: androidx.compose.ui.unit.Density.() -> Float = { 0f }, bottom: androidx.compose.ui.unit.Density.() -> Float = { 0f }): Modifier = layout { m, c ->
    val t = top().roundToInt().coerceAtLeast(0)
    val b = bottom().roundToInt().coerceAtLeast(0)
    val p = m.measure(c.offset(vertical = -(t + b)))
    layout(c.constrainWidth(p.width), c.constrainHeight(p.height + t + b)) { p.place(0, t) }
}

/** 上の帯の左のボタンを長押ししたとき(戻る先の一覧を出す)。MainActivity が入れる */
val LocalNavLong = androidx.compose.runtime.compositionLocalOf<(() -> Unit)?> { null }

/** 上の帯。左に ☰(メニュー)か ←(戻る)、真ん中に題、右にボタン */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun HeaderBar(
    title: String,
    onNav: () -> Unit,
    navIsBack: Boolean = false,
    leading: (@Composable () -> Unit)? = null,
    onTitle: (() -> Unit)? = null,
    actions: @Composable () -> Unit = {},
) {
    val prefs = LocalPrefs.current
    Row(
        Modifier.fillMaxWidth().background(Palette.bar).heightIn(min = prefs.headerHeight.dp).padding(start = 4.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 長押しで、たどってきた画面の一覧(戻る先を選べる)
        val navLong = LocalNavLong.current
        Box(
            Modifier.size(barButtonSize(prefs.headerHeight).dp).clip(androidx.compose.foundation.shape.CircleShape)
                .combinedClickable(onLongClick = navLong, onClick = onNav),
            contentAlignment = Alignment.Center,
        ) {
            Icon(if (navIsBack) Icons.AutoMirrored.Filled.ArrowBack else Icons.Filled.Menu, if (navIsBack) "戻る" else "メニュー", tint = Palette.textMuted, modifier = Modifier.size(minOf(28, prefs.headerHeight - 4).dp))
        }
        if (leading != null) {
            Spacer(Modifier.width(4.dp))
            leading()
        }
        Spacer(Modifier.width(8.dp))
        // 題は 2 行まで。入りきらなければ字を小さくして収める。押すとメニュー(スレ・板の操作)
        val size = 15f * prefs.barFontScale
        androidx.compose.foundation.text.BasicText(
            title,
            Modifier.weight(1f).then(if (onTitle != null) Modifier.clickable(onClick = onTitle) else Modifier).padding(vertical = 4.dp),
            style = androidx.compose.ui.text.TextStyle(color = Palette.textStrong, fontWeight = FontWeight.Bold, lineHeight = 1.25.em),
            // 帯を低くしたときは 1 行にして、帯からはみ出さないように
            maxLines = if (prefs.headerHeight < 44) 1 else 2, overflow = TextOverflow.Ellipsis,
            autoSize = androidx.compose.foundation.text.TextAutoSize.StepBased(minFontSize = (size * 0.7f).sp, maxFontSize = size.sp, stepSize = 0.5.sp),
        )
        actions()
    }
}

/** 帯のボタンの大きさ。48dp まで帯に合わせる。低くしても、押せる範囲は Compose が 48dp まで広げる */
fun barButtonSize(barHeight: Int): Int = minOf(48, barHeight)

/** 帯の右のボタン(︙ など) */
@Composable
fun BarIcon(icon: ImageVector, label: String, tint: Color = Palette.textMuted, onClick: () -> Unit) {
    val h = LocalPrefs.current.headerHeight
    Box(
        Modifier.size(barButtonSize(h).dp).clip(androidx.compose.foundation.shape.CircleShape).clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, label, tint = tint, modifier = Modifier.size(minOf(26, h - 6).dp)) }
}

@Composable
fun MoreButton(onClick: () -> Unit) = BarIcon(Icons.Filled.MoreVert, "その他", onClick = onClick)

/** メニューの 1 行 */
class MenuItem(val label: String, val icon: ImageVector, val danger: Boolean = false, /** あれば、押すと小項目の画面に切り替える */ val children: List<MenuItem>? = null, /** 今選んでいるものの印 */ val checked: Boolean = false, val onClick: () -> Unit)

/**
 * 画面全体を覆う窓(網掛けのあるメニュー・シート・全画面の画面はみなこれで開く)。
 * Popup は開く瞬間の「キーボードを除いた高さ」で測られ、キーボードが引っ込むとその分だけ下が空く。
 * Dialog の窓はキーボードの有無で大きさが変わらない。中に入力欄があるときのキーボードの分は、中身が imePadding で空ける
 */
@Composable
fun FullWindow(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    androidx.compose.ui.window.Dialog(
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        // 暗さと出入りの動きは中身が描く
        val view = androidx.compose.ui.platform.LocalView.current
        androidx.compose.runtime.SideEffect {
            (view.parent as? androidx.compose.ui.window.DialogWindowProvider)?.window?.let { w ->
                w.setDimAmount(0f)
                w.clearFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
                w.setWindowAnimations(0)
                w.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            }
        }
        content()
    }
}

/** ︙ の一番上の情報(スレタイ・板名は省略しない) */
@Composable
fun MenuInfo(title: String, detail: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(title, color = Palette.textStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold, lineHeight = 20.sp)
        Text(detail, Modifier.padding(top = 2.dp), color = Palette.textMuted, fontSize = 12.sp)
    }
    HorizontalDivider(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), color = Palette.border)
}

/** ︙ の「表示スタイル」とその小項目(スレ一覧・スレ表示で共通) */
fun styleMenuItem(p: io.github.contentsview08.obb.data.Prefs, onTheme: () -> Unit, onSize: () -> Unit) =
    MenuItem("表示スタイル", Icons.Filled.Palette, children = listOf(
        MenuItem("テーマと差し色", Icons.Filled.ColorLens, onClick = onTheme),
        MenuItem("レスの見た目", Icons.Filled.ViewAgenda, children = POST_STYLES.map { (k, name) ->
            MenuItem(name, Icons.Filled.ViewAgenda, checked = p.postStyle == k) { p.postStyle = k }
        }) {},
        MenuItem("文字の大きさ・余白", Icons.Filled.FormatSize, onClick = onSize),
    )) {}

/** メニューの出る所: 右上(︙)・左上(題)・真ん中(長押し) */
enum class MenuAt { TopEnd, TopStart, Center }

/**
 * メニュー(︙ ・題・長押し)。押した所の近くにふわっと出る(右上の ︙ なら右上の角から広がる)。
 * groups の間に線を引く。危ない項目(削除)は赤く。外を押すか戻るで閉じる。header は大項目の一番上に出す
 */
@Composable
fun MenuSheet(groups: List<List<MenuItem>>, at: MenuAt = MenuAt.TopEnd, header: (@Composable () -> Unit)? = null, onDismiss: () -> Unit) {
    val show = remember { androidx.compose.animation.core.Animatable(0f) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    androidx.compose.runtime.LaunchedEffect(Unit) {
        if (Motion.reduced) show.snapTo(1f)
        else show.animateTo(1f, androidx.compose.animation.core.tween(180, easing = androidx.compose.animation.core.CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
    }
    fun close() { scope.launch { if (!Motion.reduced) show.animateTo(0f, androidx.compose.animation.core.tween(120)); onDismiss() } }
    val origin = when (at) {
        MenuAt.TopEnd -> androidx.compose.ui.graphics.TransformOrigin(1f, 0f)
        MenuAt.TopStart -> androidx.compose.ui.graphics.TransformOrigin(0f, 0f)
        MenuAt.Center -> androidx.compose.ui.graphics.TransformOrigin.Center
    }
    /** 開いている小項目の親(大項目から順に) */
    var path by remember { mutableStateOf<List<MenuItem>>(emptyList()) }
    // 戻るは、小項目を開いていれば 1 つ上へ
    FullWindow(onDismiss = { if (path.isNotEmpty()) path = path.dropLast(1) else close() }) {
        Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.25f * show.value))
                .clickable(remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, null) { close() },
        ) {
            val shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp)
            Column(
                Modifier
                    .align(when (at) { MenuAt.TopEnd -> Alignment.TopEnd; MenuAt.TopStart -> Alignment.TopStart; MenuAt.Center -> Alignment.Center })
                    .statusBarsPadding().navigationBarsPadding()
                    .padding(top = if (at == MenuAt.Center) 0.dp else 52.dp, start = 10.dp, end = 10.dp)
                    .width(288.dp)
                    .graphicsLayer {
                        val p = show.value
                        alpha = p; scaleX = 0.9f + 0.1f * p; scaleY = 0.9f + 0.1f * p; transformOrigin = origin
                        if (at != MenuAt.Center) translationY = (1f - p) * -6.dp.toPx()
                    }
                    .shadow(16.dp, shape).clip(shape).background(Palette.surface).border(1.dp, Palette.border, shape)
                    .heightIn(max = 560.dp).verticalScroll(androidx.compose.foundation.rememberScrollState())
                    .clickable(remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, null) {}
                    .padding(vertical = 6.dp),
            ) {
                val itemRow = @Composable { it: MenuItem ->
                        Row(
                            Modifier.fillMaxWidth().clickable { if (it.children != null) path = path + it else { it.onClick(); onDismiss() } }.heightIn(min = 46.dp).padding(horizontal = 16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            // アイコンは色を付けず控えめに(色が多いと、どれが大事か分からなくなる)。危ない項目だけ赤
                            Icon(it.icon, null, tint = if (it.danger) Palette.markDanger else Palette.textMuted, modifier = Modifier.size(21.dp))
                            Text(it.label, Modifier.weight(1f), color = if (it.danger) Palette.markDanger else Palette.textStrong, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (it.children != null) Icon(Icons.Filled.ChevronRight, null, tint = Palette.textMuted, modifier = Modifier.size(20.dp))
                            if (it.checked) Icon(Icons.Filled.Check, "選んでいます", tint = Palette.accent, modifier = Modifier.size(18.dp))
                        }
                }
                // 小項目は右から入ってくる。戻るときは逆向き(PC 版と同じ)
                androidx.compose.animation.AnimatedContent(
                    path,
                    transitionSpec = {
                        val forward = targetState.size > initialState.size
                        val tween = androidx.compose.animation.core.tween<androidx.compose.ui.unit.IntOffset>(180)
                        if (Motion.reduced) (androidx.compose.animation.EnterTransition.None togetherWith androidx.compose.animation.ExitTransition.None).using(null)
                        else androidx.compose.animation.slideInHorizontally(tween) { if (forward) it else -it } togetherWith
                            androidx.compose.animation.slideOutHorizontally(tween) { if (forward) -it else it }
                    },
                    label = "menu",
                ) { opened ->
                    val parent = opened.lastOrNull()
                    Column {
                        if (parent != null) {
                            Row(
                                Modifier.fillMaxWidth().clickable { path = path.dropLast(1) }.heightIn(min = 44.dp).padding(horizontal = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, "戻る", tint = Palette.textMuted, modifier = Modifier.size(22.dp))
                                Text(parent.label, color = Palette.textStrong, fontSize = 15.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                            }
                            HorizontalDivider(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), color = Palette.border)
                            for (it in parent.children.orEmpty()) itemRow(it)
                        } else {
                            header?.invoke()
                            groups.filter { it.isNotEmpty() }.forEachIndexed { gi, items ->
                                if (gi > 0) HorizontalDivider(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), color = Palette.border)
                                for (it in items) itemRow(it)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** 「3 分前」「約 2 か月前」の形 */
fun relativeTime(millis: Long?, now: Long = System.currentTimeMillis()): String {
    if (millis == null) return ""
    val s = (now - millis) / 1000
    return when {
        s < 60 -> "たった今"
        s < 3600 -> "${s / 60}分前"
        s < 86400 -> "${s / 3600}時間前"
        s < 86400 * 30 -> "${s / 86400}日前"
        s < 86400 * 365 -> "約${s / (86400 * 30)}か月前"
        else -> "約${s / (86400 * 365)}年前"
    }
}

/**
 * 動きを減らす: 端末の「アニメーションを削除」(アニメーターの速さが 0)か、設定の「動きを減らす」のとき。
 * 新着の浮き上がり・光り方・数字の繰り上がりなどを省く
 */
object Motion {
    var system by mutableStateOf(false)
    var pref by mutableStateOf(false)
    val reduced get() = system || pref
    fun read(context: android.content.Context) {
        system = runCatching { android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
    }
}

/** 数の札の数字。+ は付けない。4 桁からは 999+ */
fun badgeCount(n: Int): String = if (n > 999) "999+" else "$n"

/** 札の地。高さ 20dp・左右 6dp・角丸は高さの半分。1 桁なら幅も 20dp で丸くなる */
fun Modifier.badgeShape(bg: Color, border: Color? = null): Modifier =
    heightIn(min = 20.dp).widthIn(min = 20.dp)
        .then(if (border != null) border(1.dp, border, RoundedCornerShape(10.dp)) else Modifier)
        .background(bg, RoundedCornerShape(10.dp)).padding(horizontal = 6.dp)

/** 札の字。12sp の太字(基本の文字に連動しない)。行の高さを字に合わせて、札の縦の真ん中に置く */
@Composable
fun BadgeText(text: String, color: Color) = WithoutBaseFont {
    Text(
        text, color = color, maxLines = 1, softWrap = false, fontSize = 12.sp, fontWeight = FontWeight.Bold, lineHeight = 14.sp,
        style = androidx.compose.ui.text.TextStyle(
            platformStyle = androidx.compose.ui.text.PlatformTextStyle(includeFontPadding = false),
            lineHeightStyle = androidx.compose.ui.text.style.LineHeightStyle(androidx.compose.ui.text.style.LineHeightStyle.Alignment.Center, androidx.compose.ui.text.style.LineHeightStyle.Trim.None),
        ),
    )
}

/** 札(未読の数・自分のレス・返信で共通) */
@Composable
fun Badge(text: String, bg: Color, fg: Color, modifier: Modifier = Modifier, border: Color? = null) {
    Box(modifier.badgeShape(bg, border), contentAlignment = Alignment.Center) { BadgeText(text, fg) }
}

/** 中身のない画面の案内 */
@Composable
fun Hint(text: String) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Text(text, color = Palette.textMuted, fontSize = 14.sp) }
}

/**
 * 読み込めなかったときの画面: 理由と「もう一度読み込む」ボタン。
 * 引っぱって更新の指の動きが届くよう、スクロールできる部品の上に置く(ただの文字だと届かない)
 */
@Composable
fun LoadError(message: String?, loading: Boolean, topPadding: androidx.compose.ui.unit.Dp, onBack: (() -> Unit)? = null, externalUrl: String? = null, onRetry: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(top = topPadding)) {
        item {
            Column(Modifier.fillParentMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Text("読み込めませんでした", color = Palette.textStrong, fontSize = 15.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                if (!message.isNullOrBlank()) Text(message, Modifier.padding(top = 6.dp), color = Palette.textMuted, fontSize = 13.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                Row(
                    Modifier.padding(top = 18.dp).clip(RoundedCornerShape(8.dp)).background(Palette.accent).clickable(enabled = !loading, onClick = onRetry)
                        .padding(horizontal = 18.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (loading) androidx.compose.material3.CircularProgressIndicator(Modifier.size(16.dp), color = Palette.accentText, strokeWidth = 2.dp)
                    else Icon(androidx.compose.material.icons.Icons.Filled.Refresh, null, tint = Palette.accentText, modifier = Modifier.size(18.dp))
                    Text(if (loading) "読み込んでいます…" else "もう一度読み込む", color = Palette.accentText, fontSize = 14.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold)
                }
                Text("下へ引っぱっても読み込み直せます", Modifier.padding(top = 10.dp), color = Palette.textMuted, fontSize = 12.sp)
                // 板・スレとして読めなかったときは、ブラウザで開ける
                if (externalUrl != null) Text(
                    "ブラウザで開く", Modifier.padding(top = 14.dp).clip(RoundedCornerShape(8.dp)).clickable { openExternal(context, externalUrl, false) }.padding(horizontal = 14.dp, vertical = 8.dp),
                    color = Palette.accent, fontSize = 14.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                )
                // 前の画面へ戻る道(読めないままでも帰れるように。なぞる操作でも戻れる)
                if (onBack != null) Text(
                    "前の画面に戻る", Modifier.padding(top = 6.dp).clip(RoundedCornerShape(8.dp)).clickable(onClick = onBack).padding(horizontal = 14.dp, vertical = 8.dp),
                    color = Palette.accent, fontSize = 14.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                )
            }
        }
    }
}

/**
 * 読み込み中の仮の行(スケルトン)。文字の代わりに、ゆっくり明滅する灰色の棒を、本物の行と同じ並びで置く。
 * post = true でレスの形(頭の短い棒 + 本文の長い棒 2〜3 本)、false でスレ一覧の行の形
 */
@Composable
fun Skeleton(top: androidx.compose.ui.unit.Dp, post: Boolean) {
    val t = androidx.compose.animation.core.rememberInfiniteTransition(label = "skeleton")
    val a by t.animateFloat(
        0.45f, 0.9f,
        androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween<Float>(800), androidx.compose.animation.core.RepeatMode.Reverse),
        label = "pulse",
    )
    val bar = Palette.textMuted.copy(alpha = 0.18f)
    Column(Modifier.fillMaxSize().padding(top = top).graphicsLayer { alpha = a }) {
        // 長さを行ごとに少し変えて、それらしく見せる
        val widths = listOf(0.92f, 0.7f, 0.85f, 0.6f, 0.95f, 0.75f, 0.8f, 0.66f, 0.9f, 0.72f)
        for (i in 0 until if (post) 7 else 12) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = if (post) 12.dp else 10.dp)) {
                if (post) {
                    Box(Modifier.fillMaxWidth(0.42f).height(10.dp).background(bar, RoundedCornerShape(3.dp)))
                    Spacer(Modifier.height(10.dp))
                    for (j in 0 until 2 + i % 2) {
                        Box(Modifier.fillMaxWidth(widths[(i + j) % widths.size]).height(12.dp).background(bar, RoundedCornerShape(3.dp)))
                        Spacer(Modifier.height(7.dp))
                    }
                } else {
                    Box(Modifier.fillMaxWidth(widths[i % widths.size]).height(13.dp).background(bar, RoundedCornerShape(3.dp)))
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.fillMaxWidth(0.3f).height(9.dp).background(bar, RoundedCornerShape(3.dp)))
                }
            }
            HorizontalDivider(color = Palette.border.copy(alpha = 0.5f))
        }
    }
}

/** 「文字の大きさ・余白」の小さな画面で、いま動かしているスライダー(動かしている間は、ほかを透かして後ろの画面を見せる) */
class SizeDrag { var active by mutableStateOf<String?>(null) }
val LocalSizeDrag = androidx.compose.runtime.compositionLocalOf<SizeDrag?> { null }

/** 「文字の大きさ・余白」の 1 行(名前・いまの値・スライダー・元に戻す) */
@Composable
fun SizeSlider(label: String, value: Float, range: ClosedFloatingPointRange<Float>, steps: Int, text: String, default: Float, onChange: (Float) -> Unit) {
    val drag = LocalSizeDrag.current
    val source = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    val dragged by source.collectIsDraggedAsState()
    val pressed by source.collectIsPressedAsState()
    androidx.compose.runtime.LaunchedEffect(dragged || pressed) {
        if (drag != null) { if (dragged || pressed) drag.active = label else if (drag.active == label) drag.active = null }
    }
    // ほかのスライダーを動かしている間は、この行を隠す
    val hidden = drag?.active != null && drag.active != label
    val a by androidx.compose.animation.core.animateFloatAsState(if (hidden) 0f else 1f, androidx.compose.animation.core.tween(150), label = "row")
    Column(Modifier.fillMaxWidth().graphicsLayer { alpha = a }.padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, Modifier.weight(1f), color = Palette.textBody, fontSize = 14.sp)
            // 値の桁や「元に戻す」で名前の折り返しが変わると、窓の高さが変わってスライダーが指から逃げる
            Text(text, Modifier.widthIn(min = 44.dp), color = Palette.accent, fontSize = 13.sp, textAlign = androidx.compose.ui.text.style.TextAlign.End)
            val canReset = value != default
            Text(
                "元に戻す",
                Modifier.padding(start = 10.dp).graphicsLayer { alpha = if (canReset) 1f else 0f }.clickable(enabled = canReset) { onChange(default) },
                color = Palette.textMuted, fontSize = 12.sp, maxLines = 1,
            )
        }
        androidx.compose.material3.Slider(
            value, onChange, valueRange = range, steps = steps, interactionSource = source,
            colors = androidx.compose.material3.SliderDefaults.colors(thumbColor = Palette.accent, activeTrackColor = Palette.accent),
        )
    }
}

/** 文字の大きさのスライダー。base は倍率 1 のときの大きさ */
@Composable
fun FontSizeSlider(label: String, scale: Float, base: Int, onChange: (Float) -> Unit) {
    SizeSlider(label, scale * base, FONT_MIN.toFloat()..FONT_MAX.toFloat(), FONT_MAX - FONT_MIN - 1, "${fontSizeOf(scale, base)}", base.toFloat()) { onChange(scaleOf(it.roundToInt(), base)) }
}

/** 基本の文字と、ヘッダー・フッターの高さと文字 */
@Composable
fun BarSliders(p: io.github.contentsview08.obb.data.Prefs) {
    SizeSlider("ヘッダーの高さ", p.headerHeight.toFloat(), 32f..120f, 0, "${p.headerHeight}dp", 54f) { p.headerHeight = it.toInt() }
    SizeSlider("フッターの高さ", p.footerHeight.toFloat(), 32f..110f, 0, "${p.footerHeight}dp", 52f) { p.footerHeight = it.toInt() }
    SizeSlider("ヘッダー・フッターの文字", p.barFontScale, 0.6f..1.6f, 19, "${percent(p.barFontScale)}%", 1f) { p.barFontScale = snapTo(it, 20) }
    // 動かすと帯やメニューの字が変わって確かめやすいよう、一番下に置く
    SizeSlider("基本の文字(メニュー・ボタン・ポップアップ)", p.fontScale, 0.6f..1.6f, 19, "${percent(p.fontScale)}%", 1f) { p.fontScale = snapTo(it, 20) }
}

/**
 * 真ん中に出す「文字の大きさ・余白」の小さな画面。動かすと後ろの画面がすぐ変わる。
 * スライダーを動かしている間は、そのスライダーだけを残して、画面の地や暗い幕を透かす(後ろの字の大きさを見ながら合わせられるように)
 */
@Composable
fun SizeDialog(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    val drag = remember { SizeDrag() }
    val dragging = drag.active != null
    val bg by androidx.compose.animation.core.animateFloatAsState(if (dragging) 0f else 1f, androidx.compose.animation.core.tween(150), label = "bg")
    // Dialog は密度が変わると窓を作り直すので、外側から基本の文字を外す(内側だけだと、動かした瞬間につかみが離れる)
    WithoutBaseFont { FullWindow(onDismiss = onDismiss) {
        val shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp)
        Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f * bg))
                .clickable(remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, null) { onDismiss() },
            contentAlignment = Alignment.Center,
        ) {
            Column(
                Modifier.padding(horizontal = 24.dp).fillMaxWidth()
                    .background(Palette.surface.copy(alpha = bg), shape).border(1.dp, Palette.border.copy(alpha = bg), shape)
                    .clickable(remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, null) {}
                    .padding(20.dp),
            ) {
                Text("文字の大きさ・余白", Modifier.graphicsLayer { alpha = bg }, color = Palette.textStrong, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                Column(Modifier.heightIn(max = 480.dp).verticalScroll(androidx.compose.foundation.rememberScrollState(), enabled = !dragging)) {
                    androidx.compose.runtime.CompositionLocalProvider(LocalSizeDrag provides drag) { content() }
                }
                Row(Modifier.fillMaxWidth().graphicsLayer { alpha = bg }, horizontalArrangement = Arrangement.End) {
                    androidx.compose.material3.TextButton(onClick = onDismiss) { Text("閉じる") }
                }
            }
        }
    } }
}

/**
 * テーマと差し色。真ん中に浮かぶ(レスの見た目と文字の大きさは ︙ の「表示スタイル」の別の小項目)
 */
@Composable
fun StyleSheet(p: io.github.contentsview08.obb.data.Prefs, onDismiss: () -> Unit) {
    CenterPanel("テーマと差し色", onDismiss) {
        Column(Modifier.fillMaxWidth().heightIn(max = 520.dp).verticalScroll(androidx.compose.foundation.rememberScrollState())) {
            @Composable fun group(t: String) = Text(t, Modifier.padding(start = 24.dp, top = 8.dp, bottom = 4.dp), color = Palette.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            group("テーマ")
            val current = Palette.scheme.key
            // 2 列の見本(地・帯・面・差し色を小さく描く)。名前だけより、押す前に色が分かる
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (pair in allSchemes().chunked(2)) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (s in pair) {
                        val on = s.key == current
                        val shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp)
                        Row(
                            Modifier.weight(1f).clip(shape).border(if (on) 2.dp else 1.dp, if (on) Palette.accent else Palette.border, shape)
                                .clickable {
                                    // スマホのダーク・ライトに合わせているときは、いまの明るさの方の配色を変える(PC 版の pickSchemeNow)
                                    if (p.followSystem) { if (s.dark == Palette.dark) { if (s.dark) p.darkScheme = s.key else p.lightScheme = s.key } else { p.followSystem = false; p.scheme = s.key } }
                                    else p.scheme = s.key
                                }
                                .padding(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            // 見本: 上に帯、地の上に面の棒 2 本、右下に差し色の丸
                            Column(Modifier.size(width = 34.dp, height = 40.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(5.dp)).background(s.base).border(1.dp, s.border, androidx.compose.foundation.shape.RoundedCornerShape(5.dp))) {
                                Box(Modifier.fillMaxWidth().height(8.dp).background(s.bar))
                                Box(Modifier.padding(start = 4.dp, top = 5.dp).width(24.dp).height(5.dp).background(s.surface2, androidx.compose.foundation.shape.RoundedCornerShape(2.dp)))
                                Box(Modifier.padding(start = 4.dp, top = 3.dp).width(17.dp).height(5.dp).background(s.textMuted.copy(alpha = 0.6f), androidx.compose.foundation.shape.RoundedCornerShape(2.dp)))
                                Box(Modifier.padding(start = 20.dp, top = 3.dp).size(8.dp).background(s.accent, androidx.compose.foundation.shape.CircleShape))
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(s.name, Modifier.weight(1f), color = if (on) Palette.textStrong else Palette.textBody, fontSize = 13.sp, fontWeight = if (on) FontWeight.Bold else null, maxLines = 2)
                        }
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
            Spacer(Modifier.height(6.dp))
            HorizontalDivider(Modifier.padding(vertical = 4.dp), color = Palette.border)
            group("差し色")
            // 丸を押して選ぶ。左端の「テーマ」はテーマの色に戻す
            Row(Modifier.fillMaxWidth().horizontalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                @Composable fun dot(c: Color, label: String, on: Boolean, onClick: () -> Unit) {
                    Column(Modifier.clickable(onClick = onClick).padding(2.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(
                            Modifier.size(30.dp).background(c, androidx.compose.foundation.shape.CircleShape)
                                .border(if (on) 3.dp else 1.dp, if (on) Palette.textStrong else Palette.border, androidx.compose.foundation.shape.CircleShape),
                        )
                        Text(label, color = if (on) Palette.textStrong else Palette.textMuted, fontSize = 11.sp, modifier = Modifier.padding(top = 3.dp))
                    }
                }
                dot(Palette.scheme.accent, "テーマ", p.accent.isEmpty()) { p.accent = "" }
                for (a in ACCENTS) dot(if (Palette.dark) a.dark else a.light, a.name, p.accent == a.key) { p.accent = a.key }
            }
        }
    }
}

/**
 * ログを削除する前に確かめる。「次回から表示しない」を入れて削除すると、次からは確かめずに消す(設定の「スクロールと更新」で戻せる)。
 * count を渡すと選んだスレをまとめて消すときの言葉にする。一度に多く消えるので、「次回から表示しない」は出さない
 */
@Composable
fun ConfirmDeleteDialog(prefs: io.github.contentsview08.obb.data.Prefs, count: Int? = null, onDelete: () -> Unit, onDismiss: () -> Unit) {
    var dontAsk by remember { mutableStateOf(false) }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("ログを削除しますか") },
        text = {
            Column {
                Text(if (count == null) "このスレの手元のログを消します。もう一度開けば取り直します。" else "選んだ $count 件のスレの手元のログを消します。もう一度開けば取り直します。", color = Palette.textBody, fontSize = 14.sp)
                if (count == null) Row(Modifier.padding(top = 8.dp).clickable { dontAsk = !dontAsk }, verticalAlignment = Alignment.CenterVertically) {
                    androidx.compose.material3.Checkbox(dontAsk, { dontAsk = it }, colors = androidx.compose.material3.CheckboxDefaults.colors(checkedColor = Palette.accent))
                    Text("次回から表示しない", color = Palette.textBody, fontSize = 14.sp)
                }
            }
        },
        confirmButton = { androidx.compose.material3.TextButton(onClick = { if (dontAsk) prefs.confirmDeleteLog = false; onDismiss(); onDelete() }) { Text("削除する", color = Palette.markDanger) } },
        dismissButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { Text("やめる") } },
    )
}

/** 板のファビコン。取れるまで(取れなければ)は fallback を出す */
@Composable
fun BoardIcon(boardUrl: String, size: androidx.compose.ui.unit.Dp, fallback: @Composable () -> Unit) {
    var bytes by remember(boardUrl) { mutableStateOf<ByteArray?>(null) }
    androidx.compose.runtime.LaunchedEffect(boardUrl) { bytes = io.github.contentsview08.obb.data.Favicons.of(boardUrl) }
    val b = bytes
    if (b == null) fallback()
    else coil3.compose.AsyncImage(b, null, Modifier.size(size).clip(androidx.compose.foundation.shape.RoundedCornerShape(3.dp)), error = null)
}

/**
 * 真ん中に浮かぶ小さな画面(表示スタイル・画像一覧・次スレの候補など)。
 * 少し小さく・少し下から浮き上がって出て、外を押すか戻るで閉じる
 */
@Composable
fun CenterPanel(title: String? = null, onDismiss: () -> Unit, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    val show = remember { androidx.compose.animation.core.Animatable(0f) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    androidx.compose.runtime.LaunchedEffect(Unit) { if (Motion.reduced) show.snapTo(1f) else show.animateTo(1f, androidx.compose.animation.core.tween(200, easing = androidx.compose.animation.core.CubicBezierEasing(0.22f, 1f, 0.36f, 1f))) }
    fun close() { scope.launch { if (!Motion.reduced) show.animateTo(0f, androidx.compose.animation.core.tween(120)); onDismiss() } }
    FullWindow(onDismiss = { close() }) {
        Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f * show.value))
                .clickable(remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, null) { close() },
            contentAlignment = Alignment.Center,
        ) {
            val shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp)
            Column(
                Modifier.padding(horizontal = 20.dp, vertical = 48.dp).fillMaxWidth()
                    .graphicsLayer { val p = show.value; alpha = p; val s = 0.94f + 0.06f * p; scaleX = s; scaleY = s; translationY = (1f - p) * 12.dp.toPx() }
                    .shadow(16.dp, shape).clip(shape).background(Palette.surface).border(1.dp, Palette.border, shape)
                    .clickable(remember { androidx.compose.foundation.interaction.MutableInteractionSource() }, null) {}
                    .padding(vertical = 8.dp),
            ) {
                if (title != null) Text(title, Modifier.padding(horizontal = 20.dp, vertical = 10.dp), color = Palette.textStrong, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                content()
            }
        }
    }
}

/** 字の中に置く札(主・新など)。地の色をはっきり塗り、字は地とはっきり差のある色にする(薄い地に同じ系統の字は読みにくい) */
@Composable
fun BadgeChip(text: String, bg: Color, fg: Color) {
    // 字は、字そのものの形の上下(グリフの外枠)で真ん中に置く。字の高さの余白(フォントごとに上下で違う)に左右されないように
    val density = androidx.compose.ui.platform.LocalDensity.current
    val paint = remember(fg) {
        android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            color = fg.toArgb()
            textSize = with(density) { 10.sp.toPx() }
            isFakeBoldText = true
            textAlign = android.graphics.Paint.Align.CENTER
        }
    }
    androidx.compose.foundation.Canvas(Modifier.fillMaxSize().padding(horizontal = 1.dp, vertical = 1.dp)) {
        drawRoundRect(bg, cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx()))
        val bounds = android.graphics.Rect()
        paint.getTextBounds(text, 0, text.length, bounds)
        drawContext.canvas.nativeCanvas.drawText(text, size.width / 2f, size.height / 2f - bounds.exactCenterY(), paint)
    }
}

/** 新(新しいスレ)の札の色。塗りつぶして、字は濃い色(暗い配色)・白(明るい配色) */
fun newChipColors() = if (Palette.dark) Color(0xFFF2C14E) to Color(0xFF221A00) else Color(0xFFB8860B) to Color.White

private var chipsScheme: Scheme? = null
private var chips: Map<String, androidx.compose.foundation.text.InlineTextContent> = emptyMap()

/** 札を字の中に置くための登録(appendInlineContent の id → 中身)。レスごとに呼ばれるので、配色が同じ間は使い回す(画面のスレッドでだけ呼ぶ) */
fun chipInlineContent(): Map<String, androidx.compose.foundation.text.InlineTextContent> {
    val scheme = Palette.scheme
    if (scheme !== chipsScheme) {
        chips = buildChipInlineContent()
        chipsScheme = scheme
    }
    return chips
}

/** 幅は字の大きさに合わせる */
private fun buildChipInlineContent(): Map<String, androidx.compose.foundation.text.InlineTextContent> {
    val (nBg, nFg) = newChipColors()
    fun chip(text: String, bg: Color, fg: Color) = androidx.compose.foundation.text.InlineTextContent(
        androidx.compose.ui.text.Placeholder(1.7.em, 1.25.em, androidx.compose.ui.text.PlaceholderVerticalAlign.TextCenter),
    ) { BadgeChip(text, bg, fg) }
    // 返信の数の印(吹き出しの形)。色は数と同じ(返信が多いほど暖色。Palette.heat と同じ段)
    fun replyIcon(tint: Color) = androidx.compose.foundation.text.InlineTextContent(
        androidx.compose.ui.text.Placeholder(1.15.em, 1.15.em, androidx.compose.ui.text.PlaceholderVerticalAlign.TextCenter),
    ) { Icon(Icons.Outlined.ChatBubbleOutline, "返信", tint = tint, modifier = Modifier.fillMaxSize()) }
    // 主は「自分」「あなた宛」と同じ形(枠と字が同じ色、中は地の色)。PC 版と同じ
    val opChip = androidx.compose.foundation.text.InlineTextContent(
        androidx.compose.ui.text.Placeholder(1.7.em, 1.35.em, androidx.compose.ui.text.PlaceholderVerticalAlign.TextCenter),
    ) {
        Box(
            Modifier.fillMaxSize().border(1.dp, Palette.op, RoundedCornerShape(3.dp)).background(Palette.surface, RoundedCornerShape(3.dp)),
            contentAlignment = Alignment.Center,
        ) { Text("主", color = Palette.op, fontSize = 10.sp, lineHeight = 10.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold) }
    }
    return mapOf(
        "op" to opChip, "new" to chip("新", nBg, nFg), "reply" to replyIcon(Palette.textMuted), "replySky" to replyIcon(Palette.skyText),
        "replyWarm" to replyIcon(Palette.heat(3)!!), "replyHot" to replyIcon(Palette.heat(5)!!), "replyVeryHot" to replyIcon(Palette.heat(7)!!),
    )
}

/**
 * 軽い振動(指で「できた」が分かるように)。tick: 向きが変わった・しきい値を越えた。confirm: 操作が決まった・長押しのメニュー
 */
object Haptics {
    var enabled = true
    fun tick(view: android.view.View) { if (enabled) view.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK) }
    fun confirm(view: android.view.View) {
        if (!enabled) return
        val c = if (android.os.Build.VERSION.SDK_INT >= 30) android.view.HapticFeedbackConstants.CONFIRM else android.view.HapticFeedbackConstants.VIRTUAL_KEY
        view.performHapticFeedback(c)
    }
    fun longPress(view: android.view.View) { if (enabled) view.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS) }
}
