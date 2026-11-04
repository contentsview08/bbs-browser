package io.github.contentsview08.obb.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * ID のアイコン(GitHub 風の Identicon)。PC 版の utils/identicon.ts と同じ計算(cyrb53 → mulberry32 → 5x5 の左右対称の模様と色)
 * なので、同じ ID なら PC 版と同じ模様になる
 */
class IdenticonData(val pattern: List<BooleanArray>, val color: Color)

private val cache = HashMap<String, IdenticonData>()

fun identicon(seed: String): IdenticonData = synchronized(cache) {
    cache[seed] ?: generate(seed).also { if (cache.size > 5000) cache.clear(); cache[seed] = it }
}

private fun cyrb53(str: String): Long {
    var h1 = 0xdeadbeef.toInt()
    var h2 = 0x41c6ce57
    for (ch in str) {
        h1 = (h1 xor ch.code) * 2654435761L.toInt()
        h2 = (h2 xor ch.code) * 1597334677
    }
    h1 = ((h1 xor (h1 ushr 16)) * 2246822507L.toInt()) xor ((h2 xor (h2 ushr 13)) * 3266489909L.toInt())
    h2 = ((h2 xor (h2 ushr 16)) * 2246822507L.toInt()) xor ((h1 xor (h1 ushr 13)) * 3266489909L.toInt())
    return 4294967296L * (2097151L and h2.toLong()) + (h1.toLong() and 0xFFFFFFFFL)
}

private fun hexDigits(seed: Long, count: Int): IntArray {
    // JS の `seed >>> 0`: 53bit の値の下 32bit
    var a = (seed and 0xFFFFFFFFL).toInt()
    val out = IntArray(count)
    var n = 0
    while (n < count) {
        a += 0x6d2b79f5
        var t = (a xor (a ushr 15)) * (1 or a)
        t = (t + ((t xor (t ushr 7)) * (61 or t))) xor t
        val v = t xor (t ushr 14)
        var shift = 28
        while (shift >= 0 && n < count) {
            out[n++] = (v ushr shift) and 0xf
            shift -= 4
        }
    }
    return out
}

private fun generate(seed: String): IdenticonData {
    val d = hexDigits(cyrb53(seed), 15 + 3 + 2 + 2)
    val pattern = (0 until 5).map { row ->
        val h = BooleanArray(3) { d[row * 3 + it] % 2 == 0 }
        booleanArrayOf(h[2], h[1], h[0], h[1], h[2])
    }
    val hueRaw = d[15] * 256 + d[16] * 16 + d[17]
    val satRaw = d[18] * 16 + d[19]
    val lumRaw = d[20] * 16 + d[21]
    val hue = hueRaw / 4095f * 360f
    val sat = (65f - satRaw / 255f * 20f) / 100f
    val lum = (70f - lumRaw / 255f * 20f) / 100f
    return IdenticonData(pattern, Color.hsl(hue, sat, lum))
}

/** ID のアイコンを描く(丸く切り抜く)。ID がなければ何も描かない丸 */
@Composable
fun Identicon(seed: String?, size: Dp, modifier: Modifier = Modifier) {
    val data = remember(seed) { seed?.let { identicon(it) } }
    Canvas(modifier.size(size).clip(CircleShape).background(Palette.surface3)) {
        if (data == null) return@Canvas
        val cell = this.size.width / 5f
        for (r in 0 until 5) for (c in 0 until 5) {
            if (data.pattern[r][c]) drawRect(data.color, Offset(c * cell, r * cell), Size(cell + 0.5f, cell + 0.5f))
        }
    }
}

val AVATAR = 36.dp
