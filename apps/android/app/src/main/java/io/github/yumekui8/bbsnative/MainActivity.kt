package io.github.yumekui8.bbsnative

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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.ui.BbsTheme
import io.github.yumekui8.bbsnative.ui.BoardsScreen
import io.github.yumekui8.bbsnative.ui.DrawerContent
import io.github.yumekui8.bbsnative.ui.Palette
import io.github.yumekui8.bbsnative.ui.PostHistoryScreen
import io.github.yumekui8.bbsnative.ui.SettingsScreen
import io.github.yumekui8.bbsnative.ui.ThreadEntryList
import io.github.yumekui8.bbsnative.ui.ThreadListScreen
import io.github.yumekui8.bbsnative.ui.ThreadScreen
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        // 背景は暗いので、時計などのアイコンは明るい色で出す
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        setContent {
            BbsTheme {
                // 文字の大きさの設定は、アプリ全体の文字の倍率にかける
                val d = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(d.density, d.fontScale * vm.prefs.fontScale)) {
                    val drawer = rememberDrawerState(DrawerValue.Closed)
                    // 引き出しの開け閉めは ViewModel の drawerOpen に合わせる(画面の ☰ から開く)
                    LaunchedEffect(vm.drawerOpen) { if (vm.drawerOpen) drawer.open() else drawer.close() }
                    LaunchedEffect(drawer) { snapshotFlow { drawer.currentValue }.collect { vm.drawerOpen = it == DrawerValue.Open } }
                    BackHandler(enabled = vm.drawerOpen) { vm.drawerOpen = false }
                    BackHandler(enabled = !vm.drawerOpen && vm.stack.size > 1) { vm.back() }
                    // 引き出しの指の操作は、開いているとき(閉じる)だけ。開くのはスワイプの操作(左の端から右へ)に任せる
                    ModalNavigationDrawer(drawerState = drawer, gesturesEnabled = vm.drawerOpen, drawerContent = { DrawerContent(vm) }) {
                        Box(Modifier.fillMaxSize().background(Palette.base).statusBarsPadding()) {
                            when (val page = vm.stack.lastOrNull()) {
                                is Page.Threads -> ThreadListScreen(vm, page)
                                is Page.Thread -> ThreadScreen(vm, page)
                                is Page.Boards -> BoardsScreen(vm)
                                is Page.History -> ThreadEntryList(vm, "閲覧履歴", vm.history, "閲覧履歴はありません")
                                is Page.FavThreads -> ThreadEntryList(vm, "お気に入りのスレ", vm.favThreads, "お気に入りのスレはありません(スレの ︙ から足せます)")
                                is Page.PostHistory -> PostHistoryScreen(vm)
                                is Page.Settings -> SettingsScreen(vm)
                                null -> {}
                            }
                            // 一瞬出す知らせ
                            vm.toast?.let { msg ->
                                LaunchedEffect(msg) { delay(2200); if (vm.toast == msg) vm.toast = null }
                                Text(
                                    msg, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 96.dp)
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
