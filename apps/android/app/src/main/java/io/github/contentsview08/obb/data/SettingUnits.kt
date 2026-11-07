package io.github.contentsview08.obb.data

import org.json.JSONArray
import kotlin.math.roundToInt

// 文字と余白は PC の AppSettings と同じ px で保存する。0・-1 は「決めていない」で、スマホの既定を使う

/** 基本の文字の既定(PC の mobileFontPx と同じ)。倍率 1 にあたる */
const val MOBILE_FONT_PX = 14f
const val POST_BODY_BASE_PX = 15
const val POST_HEAD_BASE_PX = 12
const val LIST_FONT_BASE_PX = 15
const val POST_LINE_HEIGHT = 1.47f
const val POST_PAD_PX = 8
const val LIST_PAD_PX = 9
const val HEADER_PX = 54
const val FOOTER_PX = 52

/** PC の scaledPxRange と同じ丸め(小数 2 桁) */
private fun round2(v: Float) = (v * 100).roundToInt() / 100f

internal fun scaleOfPx(px: Int, base: Int): Float = if (px > 0) px.toFloat() / base else 1f

/** 既定と同じ大きさは 0 にする(端末ごとの既定に任せる) */
internal fun pxOfScale(scale: Float, base: Int): Int = (scale * base).roundToInt().let { if (it == base) 0 else it }

internal fun baseScaleOfPx(px: Float): Float = px / MOBILE_FONT_PX
internal fun basePxOfScale(scale: Float): Float = round2(scale * MOBILE_FONT_PX)

/** 帯の文字は PC と同じく基本の文字に対する比で、0 なら基本の文字のまま */
internal fun barScaleOfPx(barPx: Float, basePx: Float): Float = if (barPx > 0) barPx / basePx else 1f
internal fun barPxOfScale(scale: Float, basePx: Float): Float = if (scale == 1f) 0f else round2(scale * basePx)

/** 未設定の印(unset)なら既定 */
internal fun orDefault(value: Int, unset: Int, def: Int): Int = if (value == unset || value < 0) def else value

/** 既定と同じなら未設定の印にする */
internal fun orUnset(value: Int, unset: Int, def: Int): Int = if (value == def) unset else value

/** PC の string[] と同じ JSON の配列 → sep でつないだ文字。読めない値は def */
internal fun joinedWords(json: String, sep: String, def: String): String = runCatching {
    val a = JSONArray(json)
    List(a.length()) { a.getString(it) }.joinToString(sep)
}.getOrDefault(def)

/** JSON の配列 → 文字のリスト。読めなければ例外 */
internal fun wordsOfJson(json: String): List<String> = JSONArray(json).let { a -> List(a.length()) { a.getString(it) } }

/** sep でつないだ文字 → JSON の配列(空の要素は入れない) */
internal fun wordsJson(joined: String, sep: String): String = JSONArray().apply { for (w in joined.split(sep)) if (w.isNotBlank()) put(w) }.toString()
