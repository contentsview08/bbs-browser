package io.github.contentsview08.obb.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.bbs.TwoCh
import io.github.contentsview08.obb.data.NgRule

/** スレを長押ししたときのメニュー(PC 版の ThreadCard と同じ) */
@Composable
fun ThreadMenu(vm: AppViewModel, t: ThreadSummary, hasLog: Boolean, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var fav by remember(t.id) { mutableStateOf(false) }
    var ngDraft by remember(t.id) { mutableStateOf<String?>(null) }
    var confirmDel by remember(t.id) { mutableStateOf(false) }
    if (confirmDel) { ConfirmDeleteDialog(vm.prefs, onDelete = { vm.deleteLogOf(t) }) { confirmDel = false; onDismiss() }; return }
    LaunchedEffect(t.id) { fav = vm.isFavoriteThread(t) }
    if (ngDraft == null) {
        MenuSheet(
            listOf(
                listOf(
                    MenuItem("開く", Icons.AutoMirrored.Filled.OpenInNew) { vm.openThread(t) },
                    MenuItem(if (fav) "お気に入りのスレから外す" else "お気に入りのスレに足す", if (fav) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder) { vm.toggleFavoriteThread(t) },
                    MenuItem("スレタイと URL をコピー", Icons.Filled.ContentCopy) { copyText(context, "${t.title}\n${TwoCh.webUrl(t)}"); vm.toast = "コピーしました" },
                ),
                listOfNotNull(
                    MenuItem("NG", Icons.Filled.Block, children = listOfNotNull(
                    // authorId はエッヂ・hono-bbs の ID、BE 番号、スレタイの後ろの [名前]。ID の NG なので、立てたスレも書いたレスも隠れる
                    t.authorId?.let { a ->
                        MenuItem("立てた人を NG に追加($a)", Icons.Filled.Block, danger = true) { vm.addNg(NgRule("posterId", a)); vm.toast = "立てた人を NG にしました" }
                    },
                    MenuItem("スレタイを NG に追加", Icons.Filled.Block, danger = true) { ngDraft = t.title },
                    )) {},
                    if (hasLog) MenuItem("履歴から外す", Icons.Filled.History) { vm.removeFromHistory(t) } else null,
                    if (hasLog) MenuItem("ログを削除", Icons.Filled.Delete, danger = true) { if (vm.prefs.confirmDeleteLog) confirmDel = true else vm.deleteLogOf(t) } else null,
                ),
            ),
            MenuAt.Center,
        ) { if (ngDraft == null && !confirmDel) onDismiss() }
    } else {
        var word by remember(t.id) { mutableStateOf(ngDraft ?: "") }
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("スレタイを NG") },
            text = { OutlinedTextField(word, { word = it }, label = { Text("この言葉を含むスレを一覧に出さない") }) },
            confirmButton = { TextButton(onClick = { if (word.isNotBlank()) vm.addNg(NgRule("threadTitle", word.trim())); onDismiss() }) { Text("NG に足す") } },
            dismissButton = { TextButton(onClick = onDismiss) { Text("やめる") } },
        )
    }
}
