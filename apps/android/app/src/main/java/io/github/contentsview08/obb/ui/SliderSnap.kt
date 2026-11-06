package io.github.contentsview08.obb.ui

import kotlin.math.roundToInt

// スライダーの値は目盛りの少し下の float で届くことがある(1.1 が 1.0999999 など)ので、切り捨てずに丸める

/** 1 あたり perUnit 目盛りの、いちばん近い目盛りの値 */
fun snapTo(value: Float, perUnit: Int): Float = (value * perUnit).roundToInt() / perUnit.toFloat()

/** step ごとの整数の目盛りの、いちばん近い値 */
fun snapInt(value: Float, step: Int = 1): Int = (value / step).roundToInt() * step

/** 倍率を % の数字に(1.05f が 104 にならないように) */
fun percent(value: Float): Int = (value * 100).roundToInt()
