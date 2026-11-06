package io.github.contentsview08.obb.bbs

import java.text.Normalizer

// 次スレ探し・次の未読スレ。専ブラの apps/desktop/src/utils/nextThread.ts を Kotlin に写したもの

private val COUNTER_WORD = Regex("(part|ｐａｒｔ|その|第|vol\\.?|no\\.?)\\s*[0-9]+\\s*(弾|章|話|回|スレ|目)?")
private val MARK_NUMBER = Regex("[★☆◆◇■□●○#＃]+\\s*[0-9]+")
private val DIGITS = Regex("[0-9]+")
private val SPACE_SYMBOL = Regex("[\\s\\p{P}\\p{S}]+")
private val NUMBER_AFTER_WORD = Regex("(?:part|その|第|vol\\.?|no\\.?)\\s*([0-9]+)", RegexOption.IGNORE_CASE)
private val NUMBER_AFTER_MARK = Regex("[★☆◆◇■□●○#]\\s*([0-9]+)")
private val NUMBER_AT_END = Regex("([0-9]+)\\s*(?:スレ|章|弾|話|回|目)?\\s*(?:【[^】]*】|\\[[^\\]]*]|\\([^)]*\\))?\\s*$")

/** 番号・記号・空白を除き、全角英数を半角に、英字を小文字にそろえる */
fun normalizeTitle(title: String): String =
    Normalizer.normalize(title, Normalizer.Form.NFKC).lowercase()
        .replace(COUNTER_WORD, "")
        .replace(MARK_NUMBER, "")
        .replace(DIGITS, "")
        .replace(SPACE_SYMBOL, "")

/** スレタイの通し番号(Part12・その12・★12・末尾の数字の順に探す) */
fun titleNumber(title: String): Int? {
    val t = Normalizer.normalize(title, Normalizer.Form.NFKC)
    val m = NUMBER_AFTER_WORD.find(t) ?: NUMBER_AFTER_MARK.find(t) ?: NUMBER_AT_END.find(t)
    return m?.groupValues?.get(1)?.toIntOrNull()
}

private fun bigrams(s: String): Set<String> {
    val cps = s.codePoints().toArray().map { String(Character.toChars(it)) }
    if (cps.size < 2) return cps.toSet()
    return (0 until cps.size - 1).map { cps[it] + cps[it + 1] }.toSet()
}

/** 2 つのスレタイ(bigrams にしたもの)の似ている度合い(0〜1) */
private fun similarity(x: Set<String>, y: Set<String>): Double {
    if (x.isEmpty() || y.isEmpty()) return 0.0
    return 2.0 * x.count { it in y } / (x.size + y.size)
}

class NextThreadCandidate(val thread: ThreadSummary, val score: Double, val isNextNumber: Boolean)

/** 次スレの候補を、それらしい順に(番号がちょうど次 → 似ている順 → 新しい順) */
fun findNextThreads(current: ThreadSummary, title: String, list: List<ThreadSummary>, limit: Int = 5): List<NextThreadCandidate> {
    val num = titleNumber(title)
    val base = bigrams(normalizeTitle(title))
    val since = current.createdAt
    return list.asSequence()
        .filter { it.key != current.key && (since == null || it.createdAt == null || it.createdAt >= since) }
        .map { NextThreadCandidate(it, similarity(base, bigrams(normalizeTitle(it.title))), num != null && titleNumber(it.title) == num + 1) }
        .filter { it.score >= 0.45 }
        .sortedWith(compareByDescending<NextThreadCandidate> { it.isNextNumber }.thenByDescending { it.score }.thenByDescending { it.thread.createdAt ?: 0 })
        .take(limit).toList()
}
