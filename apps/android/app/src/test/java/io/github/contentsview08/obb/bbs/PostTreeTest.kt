package io.github.contentsview08.obb.bbs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// ツリー表示の並べ方(決まりの例は packages/conformance/tree.json。ここは数の多いスレ・重さ・崩れないことを見る)
class PostTreeTest {
    private fun post(no: Int, body: String) = Post(no, "", "", "", null, body)
    private fun tree(vararg bodies: String, aborn: Set<Int> = emptySet(), maxDepth: Int = 6) =
        threadTree(PostIndex.build(bodies.mapIndexed { i, b -> post(i + 1, b) }), aborn, maxDepth)
    private fun show(lines: List<TreeLine>) = lines.joinToString(" ") { "${"-".repeat(it.depth)}${it.no}${if (it.ghost) "~" else ""}" }

    @Test fun 範囲のアンカーは広げて数える() {
        assertEquals("1 -4 2 -4~ 3 -4~", show(tree("a", "b", "c", ">>1-3")))
    }

    @Test fun 範囲と複数を混ぜても本文の順の最初が親() {
        assertEquals("1 -5~ 2 -5 3 4 -5~", show(tree("a", "b", "c", "d", ">>2,4 >>1")))
    }

    @Test fun 自分より後ろへのアンカーは無視して根() {
        assertEquals("1 2 3 -4", show(tree("a", ">>3", ">>5", ">>3")))
    }

    @Test fun あぼーんのレスは親にならない() {
        assertEquals("1 -3 2 4", show(tree("a", "荒らし", ">>2 >>1", ">>2", aborn = setOf(2))))
    }

    @Test fun 深さの上限で字下げが止まり順は保つ() {
        val lines = tree("a", ">>1", ">>2", ">>3", ">>4", ">>1", maxDepth = 2)
        assertEquals("1 -2 --3 --4 --5 -6", show(lines))
    }

    @Test fun 重ねて出すのは3つまで4つ以上は最初の親だけ() {
        assertEquals("1 -4 2 -4~ 3 -4~", show(tree("a", "b", "c", ">>1 >>2 >>3")))
        assertEquals("1 -5 2 3 4", show(tree("a", "b", "c", "d", ">>1 >>2 >>3 >>4")))
    }

    @Test fun 本当の出現はどのレスもちょうど1回で薄い出現には子がない() {
        val r = java.util.Random(7)
        val bodies = (1..1000).map { no ->
            val n = r.nextInt(4)
            (0 until n).joinToString(" ") { ">>${1 + r.nextInt(no + 5)}" } + " 本文 $no"
        }
        val lines = tree(*bodies.toTypedArray(), aborn = (1..1000 step 37).toSet(), maxDepth = 3)
        val real = lines.filter { !it.ghost }.map { it.no }
        assertEquals((1..1000).toList(), real.sorted())
        for ((i, l) in lines.withIndex()) {
            assertTrue(l.depth in 0..3)
            if (l.ghost) lines.getOrNull(i + 1)?.let { n -> assertTrue("薄い出現 ${l.no} の下に子", n.depth <= l.depth) }
        }
    }

    @Test fun 長いつながりでも落ちない() {
        val lines = threadTree((1..5000).toList(), { no -> if (no > 1) listOf(no - 1) else emptyList() }, emptySet(), 3)
        assertEquals(5000, lines.size)
        assertEquals(3, lines.last().depth)
    }

    @Test fun 千レスを素早く組める() {
        val r = java.util.Random(1)
        val anchors = (1..1000).associateWith { no -> List(r.nextInt(5)) { 1 + r.nextInt(no) } }
        val nos = (1..1000).toList()
        // 温めてから測る(最初の 1 回は JIT の分が乗る)
        repeat(5) { threadTree(nos, { anchors.getValue(it) }, emptySet(), 6) }
        val t0 = System.nanoTime()
        repeat(20) { threadTree(nos, { anchors.getValue(it) }, emptySet(), 6) }
        val ms = (System.nanoTime() - t0) / 1e6 / 20
        assertTrue("1000 レスで $ms ms", ms < 20)
    }
}
