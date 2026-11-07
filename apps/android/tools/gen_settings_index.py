#!/usr/bin/env python3
"""
設定の検索に使う索引(ui/SettingsIndex.kt)を、ui/Settings.kt の項目から作る。
設定の項目を足したら流し直す。
使い方: python3 apps/android/tools/gen_settings_index.py
"""
import pathlib
import re

UI = pathlib.Path(__file__).resolve().parent.parent / "app/src/main/java/io/github/contentsview08/obb/ui"
src = (UI / "Settings.kt").read_text(encoding="utf-8")

# when (sub) の "theme" -> ThemePage(vm) から、関数名 → ページのキー
keys = dict((fn, k) for k, fn in re.findall(r'"(\w+)" -> (\w+Page)\(', src))
# TITLES: 見出しのない Group の note は、ページの名前の説明として入れる
titles = dict(re.findall(r'"(\w+)" to "([^"]+)"', src[src.index("val TITLES"):src.index("val TITLES") + 800]))
# ページの本体の終わり(次の宣言)
NEXT_DECL = re.compile(r"\n(?:private fun |@)")
rows = []
for m in re.finditer(r"private fun (\w+Page)\(", src):
    fn = m.group(1)
    if fn not in keys:
        continue
    next_decl = NEXT_DECL.search(src, m.end())
    body = src[m.end():next_decl.start() if next_decl else len(src)]
    for r in re.finditer(
        r'(?:SwitchRow|ChoiceRow|SliderRow|TextRow|ActionRow|NavRow|NumberRow)\(\s*(?:[^"()]*?,\s*)?"([^"$]+)"(?:[^\n]*?desc = "([^"$]+)")?'
        r'|\bGroup\(\s*(?:"([^"$]+)"\s*,?\s*)?(?:note = "([^"$]+)")?',
        body,
    ):
        if r.group(1):
            rows.append((keys[fn], r.group(1), r.group(2) or ""))
        elif r.group(3) or r.group(4):
            rows.append((keys[fn], r.group(3) or titles[keys[fn]], r.group(4) or ""))

# 同期の小画面は別のファイル(ui/SyncPage.kt)で、文言は sync-ui.json にある
rows += [
    ("sync", "同期を使う", "別の端末と履歴やお気に入りを同期(実験的)"),
    ("sync", "同期を始める", ""),
    ("sync", "端末を追加", "QR・コードで別の端末をつなぐ"),
    ("sync", "コードで参加", ""),
    ("sync", "今すぐ同期", ""),
    ("sync", "この端末で同期をやめる", ""),
    ("sync", "同期するもの", "閲覧履歴と既読・お気に入り・サイト・書き込み履歴・上げた画像の履歴・NG・設定"),
    ("sync", "画像の削除キー・管理トークン", ""),
    ("sync", "サーバーの URL", "詳しい設定"),
]


def esc(s):
    return s.replace("\\", "\\\\").replace('"', '\\"')


out = ['package io.github.contentsview08.obb.ui', '',
       '// tools/gen_settings_index.py で ui/Settings.kt から作ったもの。手で直さない', '',
       '/** 設定の検索の索引: ページのキー・項目の名前・説明 */',
       'val SETTINGS_INDEX = listOf(']
# 同じ名前の見出しと項目は 1 行にして、説明のあるほうを残す
seen = {}
for k, label, desc in rows:
    if not seen.get((k, label)):
        seen[(k, label)] = desc
for (k, label), desc in seen.items():
    out.append(f'    Triple("{k}", "{esc(label)}", "{esc(desc)}"),')
out.append(')')
(UI / "SettingsIndex.kt").write_text("\n".join(out) + "\n", encoding="utf-8")
print(len(seen), "items")
