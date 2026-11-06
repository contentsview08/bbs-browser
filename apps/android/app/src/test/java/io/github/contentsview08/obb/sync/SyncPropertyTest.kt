package io.github.contentsview08.obb.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// 同じ変更の集合を、順番を変え、重複させて適用しても同じになるか。PC 版の property.test.ts と同じ手順
class SyncPropertyTest {
    private val skews = listOf(0L, 3_600_000L, -7_200_000L, 3 * 86_400_000L)

    private fun laws(kind: String, merge: (SyncPayload, SyncPayload) -> SyncPayload) {
        val rng = Rng(20261107)
        fun eq(a: SyncPayload, b: SyncPayload, why: Any?) = assertEquals(canonicalJson(why), canonicalJson(a), canonicalJson(b))
        repeat(20000) {
            val a = randomPayload(rng, kind)
            val b = randomPayload(rng, kind)
            val c = randomPayload(rng, kind)
            eq(merge(a, b), merge(b, a), listOf(a, b))
            eq(merge(merge(a, b), c), merge(a, merge(b, c)), listOf(a, b, c))
            eq(merge(a, a), a, a)
            eq(merge(merge(a, b), b), merge(a, b), listOf(a, b))
        }
    }

    @Test fun lww_laws() = laws("favorite", ::mergeLww)
    @Test fun max_laws() = laws("last_view") { a, b -> mergeWithMax(a, b, LAST_VIEWED_FIELD) }
    @Test fun kind_merge_laws() = laws("last_view", ::mergePayloads)

    @Test fun sim_converges_and_matches_reads() {
        for (seed in 1..300) {
            val r = simulate(SimOptions(seed, 3, 150, skews, maxReads = 8))
            assertTrue("seed $seed", r.converged)
            assertEquals("seed $seed", r.oracle, r.positions)
        }
    }

    @Test fun sim_converges_when_steps_overflow() {
        var under = 0
        for (seed in 1..100) {
            val r = simulate(SimOptions(seed, 3, 1000, skews, decreasingReads = true))
            assertTrue("seed $seed", r.converged)
            for (t in listOf("t0", "t1")) {
                assertTrue("seed $seed", r.positions.getValue(t) <= r.oracle.getValue(t))
                assertTrue("seed $seed", r.positions.getValue(t) >= r.resets.getValue(t))
                if (r.positions.getValue(t) < r.oracle.getValue(t)) under++
            }
        }
        // 溢れの場面を本当に通っているかを確かめる
        assertTrue(under > 0)
    }

    @Test fun recreate_converges_without_revival() {
        var survived = 0
        for (seed in 1..200) {
            val r = simulateRecreate(RecreateOptions(seed, 2 + seed % 3, 150, skews))
            assertTrue("seed $seed", r.converged)
            assertTrue("seed $seed", r.matchesLog)
            assertEquals("seed $seed", 0, r.revived)
            survived += r.survivedTombstones
        }
        // 領域をまたいで残る tombstone の場面を本当に通っているかを確かめる
        assertTrue(survived > 0)
    }
}
