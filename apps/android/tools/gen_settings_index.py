#!/usr/bin/env python3
"""
設定の検索に使う索引(ui/SettingsIndex.kt)を、ui/Settings.kt の項目から作る。
各ページ(XxxPage)の中の SwitchRow・ChoiceRow・SliderRow・TextRow・ActionRow・NavRow・NumberRow の名前と説明、
Group の見出しと note を拾い、
TITLES の対応(ページのキー)と組にする。設定の項目を足したら流し直す。
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
rows = []
for m in re.finditer(r"private fun (\w+Page)\(", src):
    fn = m.group(1)
    if fn not in keys:
        continue
    end = src.find("\nprivate fun ", m.end())
    end = src.find("\n@", m.end()) if end < 0 else min(end, src.find("\n@", m.end()) if src.find("\n@", m.end()) > 0 else end)
    body = src[m.end():end]
    for r in re.finditer(
        r'(?:SwitchRow|ChoiceRow|SliderRow|TextRow|ActionRow|NavRow|NumberRow)\(\s*(?:[^"()]*?,\s*)?"([^"$]+)"(?:[^\n]*?desc = "([^"$]+)")?'
        r'|\bGroup\(\s*(?:"([^"$]+)"\s*,?\s*)?(?:note = "([^"$]+)")?',
        body,
    ):
        if r.group(1):
            rows.append((keys[fn], r.group(1), r.group(2) or ""))
        elif r.group(3) or r.group(4):
            rows.append((keys[fn], r.group(3) or titles[keys[fn]], r.group(4) or ""))

out = ['package io.github.contentsview08.obb.ui', '',
       '// tools/gen_settings_index.py で ui/Settings.kt から作ったもの。手で直さない', '',
       '/** 設定の検索の索引: ページのキー・項目の名前・説明 */',
       'val SETTINGS_INDEX = listOf(']
# 同じ名前の見出しと項目は 1 行にして、説明のあるほうを残す
seen = {}
for k, label, desc in rows:
    if not seen.get((k, label)):
        seen[(k, label)] = desc
esc = lambda s: s.replace("\\", "\\\\").replace('"', '\\"')
for (k, label), desc in seen.items():
    out.append(f'    Triple("{k}", "{esc(label)}", "{esc(desc)}"),')
out.append(')')
(UI / "SettingsIndex.kt").write_text("\n".join(out) + "\n", encoding="utf-8")
print(len(seen), "items")
