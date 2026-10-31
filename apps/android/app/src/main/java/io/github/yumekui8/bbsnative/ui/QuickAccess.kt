package io.github.yumekui8.bbsnative.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.yumekui8.bbsnative.AppViewModel
import io.github.yumekui8.bbsnative.Page
import io.github.yumekui8.bbsnative.bbs.ThreadSummary

/**
 * クイックアクセス: 最近見たスレ・書き込んだスレ・お気に入りのスレへ、どの画面からでもさっと移る小さな画面。
 * 既定では、左右に往復するようになぞると出る(←→ か →←)。押すとそのスレを開く(スレを見ているときは、今のスレの上に開く)
 */
@Composable
fun QuickAccess(vm: AppViewModel) {
    if (!vm.quickOpen) return
    val current = (vm.stack.lastOrNull() as? Page.Thread)?.summary?.id
    var tab by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableStateOf("recent") }
    CenterPanel("クイックアクセス", { vm.quickOpen = false }) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            for ((k, label) in listOf("recent" to "最近見た", "posted" to "書き込んだ", "fav" to "お気に入り")) {
                val on = k == tab
                Text(
                    label,
                    Modifier.weight(1f).clip(RoundedCornerShape(50)).background(if (on) Palette.accentWash else Palette.surface2)
                        .border(1.dp, if (on) Palette.accent else Color.Transparent, RoundedCornerShape(50))
                        .clickable { tab = k }.padding(vertical = 7.dp),
                    color = if (on) Palette.accent else Palette.textBody, fontSize = 13.sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
        // (スレ, 下の行, 未読)
        val rows: List<Triple<ThreadSummary, String, Int>> = when (tab) {
            "posted" -> vm.postHistory.distinctBy { it.thread.id }.take(20).map { e ->
                Triple(e.thread, "${relativeTime(e.postedAt)}に書いた ・ ${e.body.lines().firstOrNull { it.isNotBlank() && !it.trimStart().startsWith(">>") }?.trim() ?: ""}", 0)
            }
            "fav" -> vm.favThreads.map { h -> Triple(h.thread, relativeTime(h.readAt).let { if (h.readAt > 0) "${it}に見た" else "" }, maxOf(0, maxOf(h.thread.postCount, vm.remoteCounts[h.thread.id] ?: 0) - h.readNo)) }
            else -> vm.history.take(20).map { h -> Triple(h.thread, "${relativeTime(h.readAt)}に見た", maxOf(0, maxOf(h.thread.postCount, vm.remoteCounts[h.thread.id] ?: 0) - h.readNo)) }
        }
        if (rows.isEmpty()) Text("まだありません", Modifier.padding(24.dp), color = Palette.textMuted, fontSize = 14.sp)
        else LazyColumn(Modifier.fillMaxWidth().heightIn(max = 460.dp)) {
            items(rows, key = { it.first.id }) { (t, sub, unread) ->
                val here = t.id == current
                Row(
                    Modifier.fillMaxWidth().clickable(enabled = !here) { vm.quickOpen = false; vm.openThread(t) }
                        .background(if (here) Palette.accentWash else Color.Transparent).padding(horizontal = 20.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(t.title.ifEmpty { t.key }, color = Palette.textStrong, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (unread > 0) FontWeight.SemiBold else FontWeight.Normal)
                        Text(if (here) "いま見ているスレ" else sub, color = Palette.textMuted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (unread > 0) {
                        Spacer(Modifier.width(8.dp))
                        Text(if (unread > 999) "+999+" else "+$unread", Modifier.background(Palette.unread, RoundedCornerShape(50)).padding(horizontal = 6.dp, vertical = 1.dp), color = Palette.unreadText, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }
                HorizontalDivider(color = Palette.border)
            }
        }
    }
}
