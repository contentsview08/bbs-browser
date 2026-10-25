package io.github.yumekui8.bbsnative.bbs

import java.text.Normalizer

// 次スレ探し・次の未読スレ。専ブラの apps/desktop/src/utils/nextThread.ts を Kotlin に写したもの

/** 番号・記号・空白を除き、全角英数を半角に、英字を小文字にそろえる */
fun normalizeTitle(title: String): String =
    Normalizer.normalize(title, Normalizer.Form.NFKC).lowercase()
        .replace(Regex("(part|ｐａｒｔ|その|第|vol\\.?|no\\.?)\\s*\\d+\\s*(弾|章|話|回|スレ|目)?"), "")
        .replace(Regex("[★☆◆◇■□●○#＃]+\\s*\\d+"), "")
        .replace(Regex("\\d+"), "")
        .replace(Regex("[\\s\\p{P}\\p{S}]+"), "")

/** スレタイの通し番号(Part12・その12・★12・末尾の数字の順に探す) */
fun titleNumber(title: String): Int? {
    val t = Normalizer.normalize(title, Normalizer.Form.NFKC)
    val m = Regex("(?:part|その|第|vol\\.?|no\\.?)\\s*(\\d+)", RegexOption.IGNORE_CASE).find(t)
        ?: Regex("[★☆◆◇■□●○#]\\s*(\\d+)").find(t)
        ?: Regex("(\\d+)\\s*(?:スレ|章|弾|話|回|目)?\\s*(?:【[^】]*】|\\[[^\\]]*]|\\([^)]*\\))?\\s*$").find(t)
    return m?.groupValues?.get(1)?.toIntOrNull()
}

private fun bigrams(s: String): Set<String> {
    val cps = s.codePoints().toArray().map { String(Character.toChars(it)) }
    if (cps.size < 2) return cps.toSet()
    return (0 until cps.size - 1).map { cps[it] + cps[it + 1] }.toSet()
}

/** 2 つのスレタイの似ている度合い(0〜1) */
fun titleSimilarity(a: String, b: String): Double {
    val x = bigrams(normalizeTitle(a))
    val y = bigrams(normalizeTitle(b))
    if (x.isEmpty() || y.isEmpty()) return 0.0
    return 2.0 * x.count { it in y } / (x.size + y.size)
}

class NextThreadCandidate(val thread: ThreadSummary, val score: Double, val isNextNumber: Boolean)

/** 次スレの候補を、それらしい順に(番号がちょうど次 → 似ている順 → 新しい順) */
fun findNextThreads(current: ThreadSummary, title: String, list: List<ThreadSummary>, limit: Int = 5): List<NextThreadCandidate> {
    val num = titleNumber(title)
    val since = current.createdAt
    return list.asSequence()
        .filter { it.key != current.key && (since == null || it.createdAt == null || it.createdAt >= since) }
        .map { NextThreadCandidate(it, titleSimilarity(title, it.title), num != null && titleNumber(it.title) == num + 1) }
        .filter { it.score >= 0.45 }
        .sortedWith(compareByDescending<NextThreadCandidate> { it.isNextNumber }.thenByDescending { it.score }.thenByDescending { it.thread.createdAt ?: 0 })
        .take(limit).toList()
}
