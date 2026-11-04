package io.github.contentsview08.obb.data

import org.junit.Assert.assertArrayEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * 字の切り方を、transformers.js(PC 版・Web と同じ)の結果と突き合わせる。
 * 語彙(vocab.tsv: 字 タブ 点数)と正解(tok_cases.tsv: 文 タブ 条件 タブ 番号,…)のある所を、環境変数 AI_TOK_DIR で渡す
 * (25 万語の語彙はリポジトリに入れない。なければ飛ばす)
 */
class AiTokenizerTest {
    @Test
    fun sameAsTransformersJs() {
        val dir = System.getenv("AI_TOK_DIR")?.let(::File)
        assumeTrue("AI_TOK_DIR がない", dir != null && File(dir, "vocab.tsv").exists())
        val pieces = ArrayList<String>()
        val scores = ArrayList<Float>()
        File(dir, "vocab.tsv").forEachLine(Charsets.UTF_8) { line ->
            val t = line.lastIndexOf('\t')
            pieces += line.substring(0, t).replace("\\n", "\n").replace("\\t", "\t").replace("\\\\", "\\")
            scores += line.substring(t + 1).toFloat()
        }
        val tok = AiTokenizer(pieces, scores.toFloatArray())
        File(dir, "tok_cases.tsv").forEachLine(Charsets.UTF_8) { line ->
            val (text, hyp, ids) = line.split('\t')
            val want = ids.split(',').map { it.toInt() }.toIntArray()
            assertArrayEquals(text, want, tok.encodePair(text, hyp))
        }
    }
}
