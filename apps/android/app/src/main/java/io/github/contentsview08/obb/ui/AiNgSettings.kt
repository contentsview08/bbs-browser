package io.github.contentsview08.obb.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.contentsview08.obb.AppViewModel
import io.github.contentsview08.obb.data.AI_DEFAULT_THRESHOLD
import io.github.contentsview08.obb.data.AI_MIN_EXAMPLES
import io.github.contentsview08.obb.data.AI_NG_SHOWS
import io.github.contentsview08.obb.data.AiModel
import io.github.contentsview08.obb.data.AiNgRule
import io.github.contentsview08.obb.data.hypothesisOf
import kotlinx.coroutines.launch

/** 設定 → NG の「AI NG」(PC 版・Web の components/AiNgSettings.tsx と同じ項目・同じ言葉) */
@Composable
fun AiNgSettings(vm: AppViewModel) {
    val p = vm.prefs
    val context = LocalContext.current
    var editing by remember { mutableStateOf<AiNgRule?>(null) }
    Row(Modifier.fillMaxWidth().clickable { p.aiNgEnabled = !p.aiNgEnabled }.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("AI NG を使う", color = Palette.textStrong, fontSize = 15.sp)
            Text("はじめてオンにしたとき、判定モデル(${AiModel.SIZE}・MIT ライセンス)を一度だけ取ります(Wi-Fi のときがおすすめ)。そのあとは、この端末の中だけで判定し、レスをどこにも送りません", color = Palette.textMuted, fontSize = 12.sp)
        }
        Switch(p.aiNgEnabled, { p.aiNgEnabled = it }, colors = SwitchDefaults.colors(checkedTrackColor = Palette.accent, checkedThumbColor = Palette.accentText))
    }
    if (p.aiNgEnabled) Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        val mb = { n: Long -> "${n / 1024 / 1024}MB" }
        Text(
            when (val s = AiModel.status) {
                AiModel.Status.Ready -> "判定モデルを使えます"
                is AiModel.Status.Loading -> if (s.total > 0) "判定モデルを取っています(${mb(s.loaded)} / ${mb(s.total)})" else "判定モデルを用意しています…"
                is AiModel.Status.Error -> "判定モデルを使えませんでした: ${s.message}"
                AiModel.Status.Off -> "止まっています"
            },
            Modifier.weight(1f), color = Palette.textBody, fontSize = 13.sp,
        )
        TextButton(onClick = { p.aiNgEnabled = false; AiModel.deleteFiles(context) }) { Text("モデルを消す", fontSize = 12.sp, color = Palette.textMuted) }
    }
    Text(
        "当てる順: 手で足した NG → 手の印(レスを長押しして「AI NG『〜』に当たる・当たらない」)→ モデルの判定。印が当たる・当たらない $AI_MIN_EXAMPLES 件ずつそろうと、印から学んだ判定もいっしょに使います",
        Modifier.padding(horizontal = 16.dp, vertical = 6.dp), color = Palette.textMuted, fontSize = 12.sp,
    )
    for (r in p.aiNgRules) {
        val marks = p.aiNgOverrides[r.id]?.let { it.hit.size + it.miss.size } ?: 0
        Row(Modifier.fillMaxWidth().clickable { editing = r }.padding(start = 4.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(r.enabled, { v -> p.setAiRules(p.aiNgRules.map { if (it.id == r.id) it.copy(enabled = v) else it }) }, colors = CheckboxDefaults.colors(checkedColor = Palette.accent))
            Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                Text(
                    "${r.name}  ${AI_NG_SHOWS.firstOrNull { it.first == r.show }?.second}・${(r.threshold * 100).toInt()}% から${if (marks > 0) "・手の印 $marks 件" else ""}",
                    color = if (r.enabled) Palette.textStrong else Palette.textMuted, fontSize = 15.sp,
                )
                Text(hypothesisOf(r.prompt), color = Palette.textMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
    TextButton(onClick = { editing = AiNgRule(java.util.UUID.randomUUID().toString(), "", "") }, modifier = Modifier.padding(horizontal = 8.dp)) { Text("条件を足す") }
    editing?.let { r -> AiRuleEditor(vm, r) { editing = null } }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AiRuleEditor(vm: AppViewModel, initial: AiNgRule, onDismiss: () -> Unit) {
    val p = vm.prefs
    val isNew = p.aiNgRules.none { it.id == initial.id }
    var r by remember { mutableStateOf(initial) }
    var sample by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val ex = p.aiNgOverrides[r.id]?.examples.orEmpty()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isNew) "AI NG の条件を足す" else "AI NG の条件") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(r.name, { r = r.copy(name = it) }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("名前(短く)") }, placeholder = { Text("例: 煽り") })
                OutlinedTextField(r.prompt, { r = r.copy(prompt = it) }, Modifier.fillMaxWidth(), label = { Text("条件(当てたい書き込みの様子)") }, placeholder = { Text("例: 他人を煽ったり、見下したりしている") })
                Text("当てる当たり具合: ${(r.threshold * 100).toInt()}% から(当たるものは 60〜80% ほどに出ます)", color = Palette.textBody, fontSize = 13.sp)
                Slider(r.threshold, { r = r.copy(threshold = (it * 100).toInt() / 100f) }, valueRange = 0.5f..0.98f, colors = SliderDefaults.colors(thumbColor = Palette.accent, activeTrackColor = Palette.accent))
                Text("当たったレスの見せ方", color = Palette.textBody, fontSize = 13.sp)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((k, name) in AI_NG_SHOWS) {
                        val on = r.show == k
                        Text(
                            name,
                            Modifier.padding(vertical = 4.dp).border(1.dp, if (on) Palette.accent else Palette.border, RoundedCornerShape(16.dp))
                                .clickable { r = r.copy(show = k) }.padding(horizontal = 12.dp, vertical = 6.dp),
                            color = if (on) Palette.accent else Palette.textBody, fontSize = 13.sp,
                        )
                    }
                }
                // スレの話題を踏まえて判定する・同じ ID の続きも当てる(PC 版と同じ)
                Row(Modifier.fillMaxWidth().clickable { r = r.copy(withContext = !r.withContext) }, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("スレの話題を踏まえて判定する", color = Palette.textStrong, fontSize = 14.sp)
                        Text("スレタイと 1 レス目の頭を添えて判定します(「スレの話題と関係ない」のような条件に)", color = Palette.textMuted, fontSize = 12.sp)
                    }
                    androidx.compose.material3.Switch(r.withContext, { r = r.copy(withContext = it) })
                }
                Row(Modifier.fillMaxWidth().clickable { r = r.copy(sameId = !r.sameId) }, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("同じ ID が 2 回以上当たったら、その ID をすべて当てる", color = Palette.textStrong, fontSize = 14.sp)
                        Text("煽りを続けている人をまとめて畳むとき", color = Palette.textMuted, fontSize = 12.sp)
                    }
                    androidx.compose.material3.Switch(r.sameId, { r = r.copy(sameId = it) })
                }
                OutlinedTextField(sample, { sample = it }, Modifier.fillMaxWidth(), label = { Text("試す(書き込みの文)") })
                TextButton(
                    enabled = AiModel.status == AiModel.Status.Ready && r.prompt.isNotBlank() && sample.isNotBlank(),
                    onClick = {
                        result = "判定しています…"
                        scope.launch {
                            result = runCatching { AiModel.test(sample, r.prompt) }.fold(
                                { v -> "当たり具合 ${(v * 100).toInt()}%(${if (v >= r.threshold) "この条件に当たります" else "当たりません"})" },
                                { e -> "うまくいきませんでした: ${e.message}" },
                            )
                        }
                    },
                ) { Text("試す") }
                result?.let { Text(it, color = Palette.textBody, fontSize = 13.sp) }
                if (AiModel.status != AiModel.Status.Ready) Text("AI NG を使う(モデルが使える)ときに試せます", color = Palette.textMuted, fontSize = 12.sp)
                Text(
                    "手の印: 当たる ${ex.count { it.second }}・当たらない ${ex.count { !it.second }}${if (ex.count { it.second } >= AI_MIN_EXAMPLES && ex.count { !it.second } >= AI_MIN_EXAMPLES) "(学んでいます)" else ""}",
                    color = Palette.textMuted, fontSize = 12.sp,
                )
                if (!isNew) Row {
                    TextButton(onClick = { p.setAiOverrides(p.aiNgOverrides - r.id) }) { Text("手の印を消す", fontSize = 12.sp, color = Palette.textMuted) }
                    TextButton(onClick = { p.setAiRules(p.aiNgRules.filter { it.id != r.id }); p.setAiOverrides(p.aiNgOverrides - r.id); onDismiss() }) {
                        Text("この条件を消す", fontSize = 12.sp, color = Palette.heatVeryHot)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(enabled = r.prompt.isNotBlank(), onClick = {
                val done = r.copy(name = r.name.trim().ifEmpty { r.prompt.trim().take(12) }, threshold = r.threshold.takeIf { it > 0f } ?: AI_DEFAULT_THRESHOLD)
                p.setAiRules(if (isNew) p.aiNgRules + done else p.aiNgRules.map { if (it.id == done.id) done else it })
                onDismiss()
            }) { Text(if (isNew) "足す" else "決める") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("やめる") } },
    )
}
