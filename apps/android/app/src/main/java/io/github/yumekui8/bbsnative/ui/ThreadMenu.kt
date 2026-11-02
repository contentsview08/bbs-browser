package io.github.yumekui8.bbsnative.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
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
import io.github.yumekui8.bbsnative.AppViewModel
import io.github.yumekui8.bbsnative.bbs.ThreadSummary
import io.github.yumekui8.bbsnative.bbs.TwoCh
import io.github.yumekui8.bbsnative.data.NgRule

/**
 * スレを長押ししたときのメニュー(今のスマホ版の ThreadCard と同じ): 開く・お気に入りのスレ・スレタイと URL をコピー・
 * 立てた人を NG(立てた人が分かるスレだけ)・スレタイを NG・ログを削除(ログがあるときだけ)
 */
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
                    MenuItem("開く", Icons.AutoMirrored.Filled.OpenInNew, Palette.accent) { vm.openThread(t) },
                    MenuItem(if (fav) "お気に入りのスレから外す" else "お気に入りのスレに足す", if (fav) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, Palette.markFav) { vm.toggleFavoriteThread(t) },
                    MenuItem("スレタイと URL をコピー", Icons.Filled.ContentCopy, Palette.markLink) { copyText(context, "${t.title}\n${TwoCh.webUrl(t)}"); vm.toast = "コピーしました" },
                ),
                listOfNotNull(
                    // 立てた人(エッヂ・hono-bbs の ID、BE 番号、スレタイの後ろの [名前])が分かれば、その人を NG に(ID の NG。その人が立てたスレも、書いたレスも隠れる)
                    t.authorId?.let { a ->
                        MenuItem("立てた人を NG に追加($a)", Icons.Filled.Block, danger = true) { vm.addNg(NgRule("id", a)); vm.toast = "立てた人を NG にしました" }
                    },
                    // メニューを閉じたあと、言葉を直せる欄を出す
                    MenuItem("スレタイを NG に追加", Icons.Filled.Block, danger = true) { ngDraft = t.title },
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
            confirmButton = { TextButton(onClick = { if (word.isNotBlank()) vm.addNg(NgRule("title", word.trim())); onDismiss() }) { Text("NG に足す") } },
            dismissButton = { TextButton(onClick = onDismiss) { Text("やめる") } },
        )
    }
}
