"""顔文字用の予備フォント(BBS Kaomoji Fallback)を作る。

日本語フォントには、文字に重ねる記号(U+1DC4 など)やギリシャ文字の拡張(ὢ)が入っていない。
WebView は「文字 + 重ねる記号」の組を 1 つのフォントで描こうとするので、`･᷄` のように
日本語フォントにしかない文字(半角の中黒)に記号が付くと、どのフォントでも描けずに豆腐になる。
そこで Noto Sans(OFL)から欧文・ギリシャ文字・キリル文字・重ねる記号を抜き出し、
顔文字でよく使う中黒(･ U+FF65、・ U+30FB)を足したフォントを作り、本文のフォントの後ろに置く。

使い方(fontTools が要る):
  python build_kaomoji_font.py NotoSans-Regular.ttf ../src/assets/fonts/BBSKaomojiFallback.woff
元のフォント: https://github.com/notofonts/notofonts.github.io/raw/main/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf
"""

import sys

from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

FAMILY = "BBS Kaomoji Fallback"

# 抜き出す文字。顔文字に出てくる欧文・ギリシャ・キリル・記号と、重ねる記号のすべて
RANGES = [
    (0x0020, 0x024F),  # 欧文
    (0x0250, 0x02FF),  # IPA・修飾文字
    (0x0300, 0x036F),  # 重ねる記号
    (0x0370, 0x03FF),  # ギリシャ文字
    (0x0400, 0x04FF),  # キリル文字(Д など)
    (0x1AB0, 0x1AFF),  # 重ねる記号(拡張)
    (0x1D00, 0x1DBF),  # 音声記号
    (0x1DC0, 0x1DFF),  # 重ねる記号(補助)
    (0x1E00, 0x1FFF),  # 欧文・ギリシャ文字の拡張(ὢ など)
    (0x2000, 0x206F),  # 句読点
    (0x20D0, 0x20FF),  # 記号に重ねる記号
]

# 足す中黒: (文字, 送り幅)。Noto Sans の · を真ん中に置き直して作る
DOTS = [(0xFF65, 500), (0x30FB, 1000)]


def main(src: str, dest: str) -> None:
    font = TTFont(src)
    opts = Options()
    opts.layout_features = ["*"]
    opts.name_IDs = []
    opts.hinting = False
    opts.notdef_outline = True
    sub = Subsetter(opts)
    unicodes = [c for a, b in RANGES for c in range(a, b + 1)]
    sub.populate(unicodes=unicodes)
    sub.subset(font)

    glyf = font["glyf"]
    hmtx = font["hmtx"]
    cmap = font.getBestCmap()
    base = cmap[0x00B7]
    base_adv, _ = hmtx[base]
    glyph_set = font.getGlyphSet()
    order = font.getGlyphOrder()
    for code, adv in DOTS:
        name = f"uni{code:04X}"
        pen = TTGlyphPen(glyph_set)
        # 元の · の送り幅の真ん中を、新しい送り幅の真ん中に合わせる
        glyph_set[base].draw(TransformPen(pen, (1, 0, 0, 1, (adv - base_adv) / 2, 0)))
        glyph = pen.glyph()
        order.append(name)
        glyf[name] = glyph
        glyph.recalcBounds(glyf)
        hmtx[name] = (adv, glyph.xMin)
        for table in font["cmap"].tables:
            if table.isUnicode():
                table.cmap[code] = name
    font.setGlyphOrder(order)
    font["maxp"].numGlyphs = len(order)

    # 名前を変える(元の Noto Sans と取り違えないように。OFL の改変版の決まりにも沿う)
    name = font["name"]
    name.names = []
    for nid, value in [
        (0, "Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic). Subset for bbs-browser."),
        (1, FAMILY),
        (2, "Regular"),
        (3, f"{FAMILY} Regular"),
        (4, f"{FAMILY} Regular"),
        (5, "Version 1.0"),
        (6, "BBSKaomojiFallback-Regular"),
        (13, "This Font Software is licensed under the SIL Open Font License, Version 1.1."),
    ]:
        name.setName(value, nid, 3, 1, 0x409)

    font.flavor = "woff"
    font.save(dest)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
