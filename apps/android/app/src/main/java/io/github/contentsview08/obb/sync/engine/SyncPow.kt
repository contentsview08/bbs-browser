package io.github.contentsview08.obb.sync.engine

import io.github.contentsview08.obb.sync.sha256
import io.github.contentsview08.obb.sync.utf8
import kotlinx.coroutines.yield

// 領域の作成に要る計算の問題を解く。PC 版の packages/sync/src/engine/pow.ts と packages/conformance/sync-pow.json で揃える

/** これより難しい問題は悪意のあるサーバーとして解かない。端末を止められないように */
const val POW_MAX_BITS = 28L
private const val YIELD_EVERY = 4096L

class PowChallenge(val challenge: String, val bits: Int)

fun checkPowChallenge(v: Any?): PowChallenge {
    val o = v as? Map<*, *> ?: throw IllegalArgumentException("bad_pow")
    val challenge = o["challenge"] as? String ?: throw IllegalArgumentException("bad_pow")
    val bits = o["bits"] as? Long ?: throw IllegalArgumentException("bad_pow")
    if (challenge.isEmpty() || challenge.length > 512 || bits !in 0..POW_MAX_BITS) throw IllegalArgumentException("bad_pow")
    return PowChallenge(challenge, bits.toInt())
}

fun powOk(challenge: String, nonce: String, bits: Int): Boolean {
    val h = sha256(utf8("$challenge:$nonce"))
    var left = bits
    for (b in h) {
        if (left <= 0) return true
        val x = b.toInt() and 0xff
        if (left >= 8) {
            if (x != 0) return false
            left -= 8
        } else return x shr (8 - left) == 0
    }
    return left <= 0
}

/** 古いスマホでは数秒かかる。裏へ回ったときに止められるよう、ときどき譲る */
suspend fun solvePow(challenge: String, bits: Int): String {
    var i = 0L
    while (true) {
        val nonce = i.toString(36)
        if (powOk(challenge, nonce, bits)) return nonce
        if (i % YIELD_EVERY == YIELD_EVERY - 1) yield()
        i++
    }
}
