package io.github.contentsview08.obb.ui

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import io.github.contentsview08.obb.data.normalizeForSearch

/**
 * 検索の語(normalizeForSearch した語)に当たる所を、元の文字の位置で返す(重なりはまとめる)。
 * 元の文字を 1 字ずつそろえて、そろえた文字列の位置から元の位置へ戻す(全角→半角などで長さが変わっても、元の字を正しく囲める)。
 * PC 版の utils/postBody の highlightRanges と同じ
 */
fun highlightRanges(text: String, terms: List<String>): List<IntRange> {
    if (terms.isEmpty() || text.isEmpty()) return emptyList()
    val map = ArrayList<Int>(text.length)
    val norm = StringBuilder(text.length)
    for (i in text.indices) {
        val n = normalizeForSearch(text[i].toString())
        repeat(n.length) { map.add(i) }
        norm.append(n)
    }
    val found = ArrayList<IntRange>()
    for (t in terms) {
        if (t.isEmpty()) continue
        var at = norm.indexOf(t)
        while (at >= 0) {
            found += map[at]..map[at + t.length - 1]
            at = norm.indexOf(t, at + t.length)
        }
    }
    found.sortBy { it.first }
    val out = ArrayList<IntRange>()
    for (r in found) {
        val last = out.lastOrNull()
        if (last != null && r.first <= last.last + 1) out[out.lastIndex] = last.first..maxOf(last.last, r.last)
        else out += r
    }
    return out
}

/** 検索の語に当たる所に薄い金色の地を敷く(スレ内検索・スレ一覧の検索の見た目。PC 版の mark.search-hit と同じ色)。語がなければそのまま */
fun AnnotatedString.withHighlight(terms: List<String>): AnnotatedString {
    if (terms.isEmpty()) return this
    val ranges = highlightRanges(text, terms)
    if (ranges.isEmpty()) return this
    val src = this
    return buildAnnotatedString {
        append(src)
        val style = SpanStyle(background = Palette.markFav.copy(alpha = 0.42f))
        for (r in ranges) addStyle(style, r.first, r.last + 1)
    }
}
