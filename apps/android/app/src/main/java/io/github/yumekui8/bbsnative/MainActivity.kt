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
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.ui.Modifier
import io.github.yumekui8.bbsnative.ui.BbsTheme
import io.github.yumekui8.bbsnative.ui.HomeScreen
import io.github.yumekui8.bbsnative.ui.Palette
import io.github.yumekui8.bbsnative.ui.ThreadListScreen
import io.github.yumekui8.bbsnative.ui.ThreadScreen

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
                BackHandler(enabled = vm.stack.size > 1) { vm.back() }
                Box(Modifier.fillMaxSize().background(Palette.base).safeDrawingPadding()) {
                    when (val page = vm.stack.last()) {
                        is Page.Home -> HomeScreen(vm)
                        is Page.Threads -> ThreadListScreen(vm, page)
                        is Page.Thread -> ThreadScreen(vm, page)
                    }
                }
            }
        }
    }
}
