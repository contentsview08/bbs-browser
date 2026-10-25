package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.AppViewModel
import io.github.yumekui8.bbsnative.Page
import io.github.yumekui8.bbsnative.bbs.ThreadSummary
import io.github.yumekui8.bbsnative.data.ThreadState

private enum class Sort(val label: String) { SERVER("更新順"), MOMENTUM("勢い"), NEWEST("新しい"), COUNT("レス数"), UNREAD("未読") }

/** 勢い(1 日あたりのレス数) */
private fun momentum(t: ThreadSummary, now: Long): Double {
    val c = t.createdAt ?: return 0.0
    val days = maxOf(now - c, 60_000L) / 86_400_000.0
    return t.postCount / days
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThreadListScreen(vm: AppViewModel, page: Page.Threads, modifier: Modifier = Modifier) {
    var sort by rememberSaveable { mutableStateOf(Sort.SERVER) }
    val now = remember(page.threads) { System.currentTimeMillis() }
    val shown = remember(page.threads, page.states, sort) {
        val base = page.threads
        val list = when (sort) {
            Sort.SERVER -> base
            Sort.MOMENTUM -> base.sortedByDescending { momentum(it, now) }
            Sort.NEWEST -> base.sortedByDescending { it.createdAt ?: 0 }
            Sort.COUNT -> base.sortedByDescending { it.postCount }
            Sort.UNREAD -> base.filter { unreadOf(it, page.states) > 0 }
        }
        // 運営のお知らせは一番下に
        list.filterNot { it.announcement } + list.filter { it.announcement }
    }
    Column(modifier.fillMaxSize()) {
        TopBar(page.board.name, onBack = { vm.back() }, onRefresh = { vm.refreshBoard(page) }, refreshing = page.loading)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (s in Sort.entries) FilterChip(selected = sort == s, onClick = { sort = s }, label = { Text(s.label, fontSize = 14.sp) })
        }
        PullToRefreshBox(isRefreshing = page.loading, onRefresh = { vm.refreshBoard(page) }, modifier = Modifier.fillMaxSize()) {
            when {
                page.error != null && page.threads.isEmpty() -> Hint("読み込めませんでした: ${page.error}")
                page.threads.isEmpty() && page.loading -> Hint("読み込み中…")
                else -> LazyColumn(Modifier.fillMaxSize()) {
                    items(shown, key = { it.key }, contentType = { 0 }) { t ->
                        ThreadRow(t, page.states[t.key], momentum(t, now)) { vm.openThread(t) }
                    }
                }
            }
        }
    }
}

private fun unreadOf(t: ThreadSummary, states: Map<String, ThreadState>): Int {
    val s = states[t.key] ?: return 0
    return maxOf(0, t.postCount - s.readNo)
}

@Composable
private fun ThreadRow(t: ThreadSummary, state: ThreadState?, momentum: Double, onClick: () -> Unit) {
    val unread = if (state == null) 0 else maxOf(0, t.postCount - state.readNo)
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                t.title, Modifier.weight(1f), maxLines = 3, overflow = TextOverflow.Ellipsis, fontSize = 15.sp,
                // 開いたことのあるスレで未読がなければ薄く
                color = if (state != null && unread == 0) Palette.textMuted else Palette.textStrong,
                fontWeight = if (unread > 0) FontWeight.Bold else FontWeight.Normal,
            )
            if (unread > 0) {
                Spacer(Modifier.width(8.dp))
                Text(
                    "+$unread", Modifier.background(Palette.unread, RoundedCornerShape(10.dp)).padding(horizontal = 7.dp, vertical = 2.dp),
                    color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                )
            }
        }
        Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("${t.postCount}", color = Palette.textMuted, fontSize = 12.sp)
            Text(
                "勢い ${"%.0f".format(momentum)}", fontSize = 12.sp,
                color = when {
                    momentum >= 10000 -> Palette.heatVeryHot
                    momentum >= 3000 -> Palette.heatHot
                    momentum >= 1000 -> Palette.heatWarm
                    else -> Palette.textMuted
                },
            )
            t.authorId?.let { Text("ID:$it", color = Palette.textMuted, fontSize = 12.sp) }
        }
    }
    HorizontalDivider(color = Palette.border)
}
