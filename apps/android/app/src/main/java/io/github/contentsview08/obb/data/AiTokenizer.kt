package io.github.contentsview08.obb.data

import java.text.Normalizer

/**
 * AI NG の判定モデル(mDeBERTa-v3)の字の切り方。SentencePiece の Unigram(語彙 25 万)を、Hugging Face の tokenizers と同じ決まりで写したもの:
 * 前後の空白を除き、NFKC にそろえ、空白を「▁」にして頭にも「▁」を付け、語彙の点数の合計がいちばん大きい切り方(Viterbi)を選ぶ。
 * 語彙にない字は [UNK](点数は語彙の最小 − 10)。2 つの文は [CLS] A [SEP] B [SEP]。
 * 正しさは test/AiTokenizerTest.kt で transformers.js の結果と突き合わせる
 */
class AiTokenizer(pieces: List<String>, scores: FloatArray) {
    private val ids = HashMap<String, Int>(pieces.size * 2)
    private val scores = scores
    private val maxLen: Int
    private val unkScore: Float

    init {
        var longest = 1
        for ((i, p) in pieces.withIndex()) {
            // 特別な印([CLS] など)は文の中では当てない
            if (i <= UNK || p == "[MASK]") continue
            ids.putIfAbsent(p, i)
            longest = maxOf(longest, p.codePointCount(0, p.length))
        }
        maxLen = minOf(longest, 32)
        unkScore = (scores.minOrNull() ?: 0f) - 10f
    }

    /** 1 つの文を語彙の番号に */
    fun encode(text: String): IntArray {
        val norm = Normalizer.normalize(text.trim(), Normalizer.Form.NFKC)
        if (norm.isEmpty()) return IntArray(0)
        val s = "▁" + norm.replace(Regex("\\s+"), "▁")
        // 字(サロゲートペアは 1 字)ごとの位置
        val cps = s.codePoints().toArray()
        val n = cps.size
        val best = FloatArray(n + 1) { Float.NEGATIVE_INFINITY }
        val from = IntArray(n + 1)
        val tok = IntArray(n + 1)
        best[0] = 0f
        for (i in 0 until n) {
            if (best[i] == Float.NEGATIVE_INFINITY) continue
            val sb = StringBuilder()
            var matched = false
            for (j in i until minOf(n, i + maxLen)) {
                sb.appendCodePoint(cps[j])
                val id = ids[sb.toString()] ?: continue
                matched = matched || j == i
                val v = best[i] + scores[id]
                if (v > best[j + 1]) { best[j + 1] = v; from[j + 1] = i; tok[j + 1] = id }
            }
            // 1 字が語彙にないときは [UNK] で進める
            if (!matched) {
                val v = best[i] + unkScore
                if (v > best[i + 1]) { best[i + 1] = v; from[i + 1] = i; tok[i + 1] = UNK }
            }
        }
        val out = ArrayList<Int>()
        var k = n
        while (k > 0) { out += tok[k]; k = from[k] }
        out.reverse()
        // 続いた [UNK] は 1 つにまとめる(tokenizers の Unigram と同じ)
        val merged = ArrayList<Int>(out.size)
        for (t in out) if (!(t == UNK && merged.lastOrNull() == UNK)) merged += t
        return merged.toIntArray()
    }

    /** 2 つの文を [CLS] A [SEP] B [SEP] に。長すぎれば A の後ろを切る */
    fun encodePair(a: String, b: String, max: Int = 512): IntArray {
        val ea = encode(a)
        val eb = encode(b)
        val room = max - 3 - eb.size
        val ta = if (ea.size > room) ea.copyOf(maxOf(0, room)) else ea
        return intArrayOf(CLS) + ta + intArrayOf(SEP) + eb + intArrayOf(SEP)
    }

    companion object {
        const val CLS = 1
        const val SEP = 2
        const val UNK = 3
    }
}
