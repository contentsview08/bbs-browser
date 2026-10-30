#!/usr/bin/env python3
"""
設定の検索に使う索引(ui/SettingsIndex.kt)を、ui/Settings.kt の項目から作る。
各ページ(XxxPage)の中の SwitchRow・ChoiceRow・SliderRow・TextRow・ActionRow・NavRow の名前と説明を拾い、
TITLES の対応(ページのキー)と組にする。設定の項目を足したら流し直す。
使い方: python3 apps/android/tools/gen_settings_index.py
"""
import pathlib
import re

UI = pathlib.Path(__file__).resolve().parent.parent / "app/src/main/java/io/github/yumekui8/bbsnative/ui"
src = (UI / "Settings.kt").read_text(encoding="utf-8")

# when (sub) の "theme" -> ThemePage(vm) から、関数名 → ページのキー
keys = dict((fn, k) for k, fn in re.findall(r'"(\w+)" -> (\w+Page)\(', src))
rows = []
for m in re.finditer(r"private fun (\w+Page)\(", src):
    fn = m.group(1)
    if fn not in keys:
        continue
    end = src.find("\nprivate fun ", m.end())
    end = src.find("\n@", m.end()) if end < 0 else min(end, src.find("\n@", m.end()) if src.find("\n@", m.end()) > 0 else end)
    body = src[m.end():end]
    for r in re.finditer(r'(?:SwitchRow|ChoiceRow|SliderRow|TextRow|ActionRow|NavRow)\(\s*(?:[^"()]*?,\s*)?"([^"$]+)"(?:[^\n]*?desc = "([^"$]+)")?', body):
        rows.append((keys[fn], r.group(1), r.group(2) or ""))

out = ['package io.github.yumekui8.bbsnative.ui', '',
       '// tools/gen_settings_index.py で ui/Settings.kt から作ったもの。手で直さない', '',
       '/** 設定の検索の索引: ページのキー・項目の名前・説明 */',
       'val SETTINGS_INDEX = listOf(']
seen = set()
for k, label, desc in rows:
    if (k, label) in seen:
        continue
    seen.add((k, label))
    esc = lambda s: s.replace("\\", "\\\\").replace('"', '\\"')
    out.append(f'    Triple("{k}", "{esc(label)}", "{esc(desc)}"),')
out.append(')')
(UI / "SettingsIndex.kt").write_text("\n".join(out) + "\n", encoding="utf-8")
print(len(seen), "items")
