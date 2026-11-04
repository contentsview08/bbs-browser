package io.github.yumekui8.bbsnative.data

import java.text.Normalizer

/** 検索の正規化(PC 版の utils/postBody の normalizeForSearch と同じ): 全角・半角、大文字・小文字、カタカナ・ひらがなを同じものとして扱う */
fun normalizeForSearch(text: String): String {
    val n = Normalizer.normalize(text, Normalizer.Form.NFKC).lowercase()
    val out = StringBuilder(n.length)
    for (c in n) out.append(if (c in 'ァ'..'ヶ') c - 0x60 else c)
    return out.toString()
}

/** 検索の言葉を空白で分ける(正規化済み)。全部を含むものだけを出す(AND) */
fun searchTerms(query: String): List<String> = normalizeForSearch(query.trim()).split(Regex("\\s+")).filter { it.isNotEmpty() }

/** text が言葉を全部含むか */
fun matchesTerms(text: String, terms: List<String>): Boolean {
    if (terms.isEmpty()) return true
    val hay = normalizeForSearch(text)
    return terms.all { hay.contains(it) }
}
