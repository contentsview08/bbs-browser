#!/usr/bin/env python3
"""
配色(ui/Theme.kt の SCHEMES)の、字と地のコントラスト比を確かめる。
WCAG の目安: ふつうの字 4.5 以上、薄い字・リンクなど 3 以上。下回る組み合わせを出す(終了コード 1)。
使い方: python3 apps/android/tools/check_contrast.py
"""
import pathlib
import re
import sys

THEME = pathlib.Path(__file__).resolve().parent.parent / "app/src/main/java/io/github/yumekui8/bbsnative/ui/Theme.kt"
NAMES = ("base bar surface surface2 surface3 border borderStrong textStrong textBody textMuted accent accentText accentWash "
         "unread unreadText link posterName threadReadTitle heatWarm heatHot heatVeryHot").split()
CHECKS = [
    ("本文 / 地", "textBody", "base", 4.5),
    ("強い字 / 面", "textStrong", "surface", 4.5),
    ("薄い字 / 地", "textMuted", "base", 3.0),
    ("薄い字 / 帯", "textMuted", "bar", 3.0),
    ("強調の上の字 / 強調", "accentText", "accent", 3.0),
    ("未読の札の字 / 未読", "unreadText", "unread", 3.0),
    ("リンク / 地", "link", "base", 3.0),
    ("名前 / 地", "posterName", "base", 3.0),
    ("既読のスレタイ / 地", "threadReadTitle", "base", 4.5),
]


def lum(h: str) -> float:
    def f(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a: str, b: str) -> float:
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def main() -> int:
    src = THEME.read_text(encoding="utf-8")
    bad = 0
    # 設定で選べる差し色(ACCENTS)。明るい配色では light、暗い配色では dark を、地と面の上で 3 以上に
    accents = re.findall(r'Accent\("([^"]+)", "[^"]+", Color\(0xFF([0-9A-Fa-f]{6})\), Color\(0xFF([0-9A-Fa-f]{6})\)\)', src)
    for key, name, dark, body in re.findall(r'Scheme\(\s*(?://[^\n]*\n\s*)*"([^"]+)", "([^"]+)", (true|false),(.*?)\n    \),', src, re.S):
        vals = dict(zip(NAMES, re.findall(r"(?:c|wash)\(0x([0-9A-Fa-f]{6})", body)))
        ng = [f"{label} {ratio(vals[a], vals[b]):.1f}" for label, a, b, th in CHECKS if ratio(vals[a], vals[b]) < th]
        for ak, light, darkc in accents:
            c = darkc if dark == "true" else light
            m = min(ratio(c, vals["base"]), ratio(c, vals["surface"]))
            if m < 3.0:
                ng.append(f"差し色 {ak} {m:.1f}")
        print(f"{key:14} {name:12} {'NG: ' + ' / '.join(ng) if ng else 'ok'}")
        bad += bool(ng)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
