package io.github.contentsview08.obb.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.bbs.Post
import io.github.contentsview08.obb.bbs.PostIndex
import io.github.contentsview08.obb.data.BoardMeta
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll

// 設定画面の共通の部品(PC 版・Web の components/SettingParts.tsx と同じ形・同じ言葉)。
// 考え方: 少ない設定はその場で操作し、多いデータは件数を出して専用の画面でまとめて扱う。
// - SamplePosts: 見た目の設定を、本物のレスの部品で描いた見本で見ながら変える
// - EditableWordList: 言葉の一覧。足す・押して直す・消す・≡ で並べ替え・まとめて編集。多くなったら絞り込み
// - ThumbSample: サムネイルの大きさの枠

/** 見本のレス(どの掲示板にもありそうな形。PC 版・Web と同じ文) */
private val SAMPLE = listOf(
    Post(1, "名無しさん", "", "2026/11/02(月) 19:01:15.32", "Ab3dE9fG0", "見本のスレです\n文字の大きさ・行間・レスの見た目は、ここで確かめられます"),
    Post(2, "名無しさん", "sage", "2026/11/02(月) 19:02:40.11", "xY7kLm2Q0", ">>1\n乙です\n長めの本文は、行間を変えると読みやすさが変わります。行の高さ・余白・文字の大きさを見ながら決めてください"),
    Post(3, "名無しさん", "", "2026/11/02(月) 19:03:05.87", "Ab3dE9fG0", ">>2\nありがとう\nhttps://example.com/"),
)

/** 設定のスイッチの色(オンのときは差し色) */
@Composable
fun accentSwitchColors() = androidx.compose.material3.SwitchDefaults.colors(checkedTrackColor = Palette.accent, checkedThumbColor = Palette.accentText)

/** 見本のレス。いまの設定で組み立てて描く(押しても何もしない) */
@Composable
fun SamplePosts(vm: AppViewModel) {
    val p = vm.prefs
    val o = vm.sampleRenderOptions(if (p.omitNoname) "名無しさん" else null)
    val links = remember { PostLinks() }
    val (index, rendered) = remember(o, p.tidyBlankLines, Palette.scheme.key) {
        val i = PostIndex.build(SAMPLE, p.tidyBlankLines, emptyList())
        i to renderPosts(i, links, o)
    }
    Column(Modifier.fillMaxWidth().background(Palette.base)) {
        for ((n, post) in SAMPLE.withIndex()) {
            val r = rendered[post.no] ?: continue
            val prev = SAMPLE.getOrNull(n - 1)
            val so = p.styleOptions(p.postStyle)
            val continued = so.group && (p.postStyle == "discord" || p.postStyle == "line") && prev != null && prev.id == post.id && r.replyTo == null
            // 返信先の引用も見た目の設定どおりに(1 行・全文)
            val reply = r.replyTo?.takeIf { so.quote != "none" }?.let { to ->
                SAMPLE.firstOrNull { it.no == to }?.let { t ->
                    val text = index.info[to]?.display ?: t.body
                    ReplyPreview(to, t.id, text.lineSequence().firstOrNull { it.isNotBlank() && !it.trimStart().startsWith(">>") }?.trim() ?: "", if (so.quote == "full") text else null)
                }
            }
            WithoutBaseFont { PostItem(r, style = p.postStyle, id = post.id, continued = continued, reply = reply, heat = Palette.heat(index.replyCount[post.no] ?: 0), autoLoad = false) }
        }
    }
}

/** サムネイルの大きさの見本(枠だけ) */
@Composable
fun ThumbSample(size: Int) {
    Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
        repeat(3) {
            Box(
                Modifier.size(size.dp).background(Palette.surface3, RoundedCornerShape(6.dp)).border(1.dp, Palette.border, RoundedCornerShape(6.dp)),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Image, null, tint = Palette.textMuted, modifier = Modifier.size(20.dp)) }
        }
    }
}

/** これより多いと、絞り込みの欄を出す */
private const val FILTER_FROM = 8

/**
 * 言葉の一覧(改行区切りの文字列で持つ)。押すと直せ、× で消し、下の欄で足す。sortable なら ≡ を掴んで並べ替える。
 * 同じ言葉は重ねない。onRename は直したとき(ほかの設定がその言葉を覚えているなら、いっしょに直すため)
 */
@Composable
fun EditableWordList(
    value: String,
    noun: String,
    placeholder: String,
    empty: String,
    sortable: Boolean = false,
    onRename: ((String, String) -> Unit)? = null,
    onChange: (String) -> Unit,
) {
    val words = value.lines().map { it.trim() }.filter { it.isNotEmpty() }
    var editing by remember { mutableStateOf<String?>(null) }
    var bulk by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    val shown = if (query.isBlank()) words else words.filter { it.contains(query.trim(), ignoreCase = true) }
    fun save(list: List<String>) = onChange(list.joinToString("\n"))

    if (words.size > FILTER_FROM) OutlinedTextField(
        query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), singleLine = true,
        placeholder = { Text("${words.size} 件から絞り込む") },
    )
    if (words.isEmpty()) Text(empty, Modifier.padding(16.dp), color = Palette.textMuted, fontSize = 14.sp)
    @Composable fun WordRow(w: String, handle: Modifier?) =
        Row(Modifier.fillMaxWidth().clickable { editing = w }.padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(w, Modifier.weight(1f).padding(vertical = 12.dp), color = Palette.textBody, fontSize = 15.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            IconButton(onClick = { save(words - w) }) { Icon(Icons.Filled.Close, "消す", tint = Palette.textMuted) }
            if (handle != null) DragHandleIcon(handle) else Spacer(Modifier.width(4.dp))
        }
    if (sortable && query.isBlank()) ReorderableColumn(words, { it }, { from, to -> save(words.toMutableList().apply { add(to, removeAt(from)) }) }) { w, handle, _ -> WordRow(w, handle) }
    else for (w in shown) WordRow(w, null)
    var text by remember { mutableStateOf("") }
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(text, { text = it; message = null }, Modifier.weight(1f), singleLine = true, placeholder = { Text(placeholder) })
        IconButton(onClick = {
            val t = text.trim()
            if (t.isEmpty()) return@IconButton
            if (t in words) { message = "「$t」はもうあります"; return@IconButton }
            save(words + t); text = ""
        }) { Icon(Icons.Filled.Add, "足す", tint = Palette.accent) }
    }
    message?.let { Text(it, Modifier.padding(horizontal = 16.dp), color = Palette.heatVeryHot, fontSize = 13.sp) }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("${words.size} 件${if (sortable) "・≡ で並べ替え" else ""}", Modifier.weight(1f), color = Palette.textMuted, fontSize = 12.sp)
        TextButton(onClick = { bulk = words.joinToString("\n") }) { Text("まとめて編集", fontSize = 13.sp, color = Palette.accent) }
    }

    editing?.let { from ->
        var t by remember(from) { mutableStateOf(from) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text("${noun}を直す") },
            text = { OutlinedTextField(t, { t = it }, singleLine = true) },
            confirmButton = {
                TextButton(onClick = {
                    val to = t.trim()
                    editing = null
                    if (to.isEmpty() || to == from) return@TextButton
                    if (to in words) { message = "「$to」はもうあります"; return@TextButton }
                    save(words.map { if (it == from) to else it })
                    onRename?.invoke(from, to)
                }) { Text("決める") }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("やめる") } },
        )
    }
    bulk?.let { b ->
        AlertDialog(
            onDismissRequest = { bulk = null },
            title = { Text("${noun}をまとめて編集") },
            text = {
                Column {
                    Text("1 行に 1 つ。ほかのアプリから貼り付けたり、ここからコピーして写したりできます(空の行と、同じものは除きます)", color = Palette.textMuted, fontSize = 13.sp)
                    OutlinedTextField(b, { bulk = it }, Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(min = 160.dp, max = 320.dp))
                }
            },
            confirmButton = { TextButton(onClick = { save(b.lines().map { it.trim() }.filter { it.isNotEmpty() }.distinct()); bulk = null }) { Text("これにする") } },
            dismissButton = { TextButton(onClick = { bulk = null }) { Text("やめる") } },
        )
    }
}

/**
 * 板 1 つぶんの設定(PC 版・Web の「掲示板ごとの設定」の板の欄と同じ項目)。入力はすぐに保存し、空にすれば全体の設定に戻る
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BoardMetaSheet(vm: AppViewModel, url: String, name: String, onDismiss: () -> Unit) {
    val m = vm.prefs.boardMeta[url] ?: BoardMeta()
    fun set(next: BoardMeta) = vm.prefs.setBoardMeta(url, next)
    @Composable fun Field(label: String, value: String?, placeholder: String, onChange: (String?) -> Unit) =
        OutlinedTextField(value ?: "", { onChange(it.ifEmpty { null }) }, Modifier.fillMaxWidth(), singleLine = true, label = { Text(label) }, placeholder = { Text(placeholder) })
    @Composable fun Head(t: String) = Text(t, Modifier.padding(top = 12.dp, bottom = 4.dp), color = Palette.textMuted, fontSize = 12.sp)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("${m.alias ?: name} の設定") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text("ここで決めたものだけ、この板で全体の設定の代わりに使います", color = Palette.textMuted, fontSize = 13.sp)
                Head("見せ方")
                Field("別名(板名の代わりに出す名前)", m.alias, name) { set(m.copy(alias = it)) }
                Field("ファビコン(画像の URL)", m.icon, "自動(板のページから探す)") { set(m.copy(icon = it)) }
                Head("書き込み")
                Field("名前欄の既定値", m.defaultName, "ふだんの名前のまま") { set(m.copy(defaultName = it)) }
                Field("メール欄の既定値", m.defaultMail, "ふだんのメールのまま(sage など)") { set(m.copy(defaultMail = it)) }
                Head("名無しの扱い")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((v, label) in listOf(null to "全体の設定に合わせる", true to "名無しの名前を省く", false to "省かない")) {
                        val on = m.omitNoname == v
                        Text(
                            label,
                            Modifier.padding(vertical = 4.dp).border(1.dp, if (on) Palette.accent else Palette.border, RoundedCornerShape(16.dp))
                                .clickable { set(m.copy(omitNoname = v)) }.padding(horizontal = 12.dp, vertical = 6.dp),
                            color = if (on) Palette.accent else Palette.textBody, fontSize = 13.sp,
                        )
                    }
                }
                Head("板の既定の名前のほかに、名無しとみなす名前")
                EditableWordList(m.nonames.joinToString("\n"), "名無しとみなす名前", "例: 風吹けば名無し", "ありません") { v ->
                    set(m.copy(nonames = v.lines().map { it.trim() }.filter { it.isNotEmpty() }))
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("閉じる") } },
    )
}

/**
 * 数を決める行(日数など。PC 版・Web の NumberField と同じ)。押すと数を入れる画面が出て、よく使う値はボタンでも選べる。
 * zeroLabel があれば 0 はその意味(「消さない」など)
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NumberRow(label: String, value: Int, unit: String, range: IntRange, zeroLabel: String? = null, presets: List<Int> = emptyList(), onChange: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val shown = if (value == 0 && zeroLabel != null) zeroLabel else "$value $unit"
    Row(Modifier.fillMaxWidth().clickable { open = true }.heightIn(min = 54.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), color = Palette.textStrong, fontSize = 15.sp)
        Text(shown, color = Palette.accent, fontSize = 14.sp)
    }
    if (open) {
        var text by remember { mutableStateOf(value.toString()) }
        val n = text.trim().toIntOrNull()
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text(label) },
            text = {
                Column {
                    OutlinedTextField(
                        text, { text = it.filter(Char::isDigit).take(5) }, singleLine = true, suffix = { Text(unit) },
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
                    )
                    if (presets.isNotEmpty()) FlowRow(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (v in presets) Text(
                            if (v == 0 && zeroLabel != null) zeroLabel else "$v $unit",
                            Modifier.padding(vertical = 4.dp).border(1.dp, if (n == v) Palette.accent else Palette.border, RoundedCornerShape(16.dp))
                                .clickable { text = v.toString() }.padding(horizontal = 12.dp, vertical = 6.dp),
                            color = if (n == v) Palette.accent else Palette.textBody, fontSize = 13.sp,
                        )
                    }
                }
            },
            confirmButton = { TextButton(enabled = n != null, onClick = { onChange(n!!.coerceIn(range)); open = false }) { Text("決める") } },
            dismissButton = { TextButton(onClick = { open = false }) { Text("やめる") } },
        )
    }
}
