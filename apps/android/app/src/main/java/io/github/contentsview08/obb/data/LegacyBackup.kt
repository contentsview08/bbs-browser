package io.github.contentsview08.obb.data

import org.json.JSONArray
import org.json.JSONObject

// TODO(公開前に消す): 古い bbs-native のバックアップを今の形に直して読む。
// 消すもの: このファイル、Backup.kt の parseBackup の currentFromLegacy の分かれ道、test の LegacyBackupTest.kt

internal const val LEGACY_BACKUP_APP = "bbs-native"

/** 名前だけが変わった項目 */
private val RENAMED = mapOf(
    "followSystem" to "followOsTheme",
    "listDensity" to "listShape",
    "collapseBlankLines" to "tidyBlankLines",
    "thumbSize" to "postThumbSize",
    "showRefreshButton" to "showRefreshFab",
)

/** 文字列の JSON のまま持っていた項目 */
private val JSON_TEXT = setOf("aiNgRules", "aiNgOverrides", "boardMeta", "boardVisits", "recentBoards", "newThreadDrafts")

/** 下で別の項目に直すものと、もう使わないもの */
private val HANDLED = setOf(
    "fontScale", "bodyScale", "postHeadScale", "listFontScale", "barFontScale", "baseFontSplit",
    "lineHeight", "postPad", "listPad", "headerHeight", "footerHeight",
    "keywords", "grossWords", "quickPhrases", "listTabs", "presetsApplied",
    "ngRules", "ngStyle", "uploads", "font", "thumbMode", "showThumbnails", "idHeat", "idColor",
    "notifyReply", "notifyFav", "notifyKeyword", "gesturesList", "gesturesThread",
    "pullToRefreshList", "aaAutoDetect", "sendDelay", "phraseBar", "uploadEnabled", "imageUrlOmit", "imageUrlCollapse",
)

private val NG_TARGET = mapOf("body" to "content", "name" to "posterName", "id" to "posterId", "title" to "threadTitle")
private val FONT_KEY = mapOf("" to Fonts.SYSTEM, "biz-udp" to "biz-ud", "mplus-1p" to "m-plus-1p")

private fun retiredScheme(key: String): String = when (key) {
    "soft-light", "sepia", "discord-light", "light", "2ch-classic" -> "light-gray"
    "night" -> "soft-dark"
    else -> key
}

private fun words(text: String, sep: String): JSONArray = JSONArray().apply { for (w in text.split(sep)) if (w.isNotBlank()) put(w.trim()) }

private fun legacyNg(text: String): JSONArray {
    val a = JSONArray(text)
    return JSONArray().apply {
        for (i in 0 until a.length()) {
            val o = a.getJSONObject(i)
            val out = JSONObject(o.toString()).put("target", NG_TARGET[o.getString("target")] ?: o.getString("target"))
            o.optString("expiresOn").ifEmpty { null }?.let { out.put("expiresOnDate", it) }
            out.remove("expiresOn")
            put(out)
        }
    }
}

private fun legacyUploads(text: String): JSONArray {
    val a = JSONArray(text)
    return JSONArray().apply {
        for (i in 0 until a.length()) {
            val o = a.getJSONObject(i)
            val url = o.getString("url")
            put(
                JSONObject().put("url", url).put("name", url.substringAfterLast('/')).put("size", 0).put("uploadedAt", o.getLong("t")).put("withAccount", false)
                    .put("hash", o.optString("h").ifEmpty { null }).put("deleteUrl", o.optString("d").ifEmpty { null }),
            )
        }
    }
}

internal fun legacySettings(old: JSONObject): JSONObject {
    val out = JSONObject()
    for (k in old.keys()) {
        if (k in HANDLED) continue
        val v = old.get(k)
        when {
            k in JSON_TEXT && v is String -> runCatching { if (v.startsWith("[")) JSONArray(v) else JSONObject(v) }.getOrNull()?.let { out.put(k, it) }
            else -> out.put(RENAMED[k] ?: k, v)
        }
    }
    fun scale(k: String) = old.optDouble(k, 1.0).toFloat()

    // 基本の文字がレスとスレ一覧にも掛かっていたころのファイルは、見えていた大きさを本文などへ移す
    val base = scale("fontScale")
    val content = if (old.has("baseFontSplit")) 1f else base
    if (old.has("fontScale")) out.put("mobileFontPx", basePxOfScale(base).toDouble())
    fun px(from: String, to: String, basePx: Int) {
        val s = scale(from) * content
        if (old.has(from) || s != 1f) pxOfScale(s, basePx).takeIf { it != 0 }?.let { out.put(to, it) }
    }
    px("bodyScale", "postBodyPx", POST_BODY_BASE_PX)
    // 古い倍率はレスの頭の字 12px を基準にしていたので、いまの既定が変わっても同じ大きさに戻す
    px("postHeadScale", "postHeadPx", 12)
    px("listFontScale", "listFontPx", LIST_FONT_BASE_PX)
    if (old.has("barFontScale")) barPxOfScale(scale("barFontScale"), basePxOfScale(base)).takeIf { it != 0f }?.let { out.put("barFontPx", it.toDouble()) }
    if (old.has("lineHeight")) old.optDouble("lineHeight").toFloat().takeIf { it != POST_LINE_HEIGHT }?.let { out.put("postLineHeight", it.toDouble()) }
    // 古いファイルの余白の既定は 8 だった。いまの既定が変わっても「決めていない」の判定は当時の値で
    if (old.has("postPad")) out.put("postPadPx", orUnset(old.getInt("postPad"), -1, 8))
    if (old.has("listPad")) out.put("listPadPx", orUnset(old.getInt("listPad"), -1, LIST_PAD_PX))
    if (old.has("headerHeight")) out.put("headerPx", orUnset(old.getInt("headerHeight"), 0, HEADER_PX))
    if (old.has("footerHeight")) out.put("footerPx", orUnset(old.getInt("footerHeight"), 0, FOOTER_PX))

    if (old.has("keywords")) out.put("keywords", words(old.getString("keywords"), "\n"))
    if (old.has("grossWords")) out.put("grossWords", words(old.getString("grossWords"), "\n"))
    if (old.has("quickPhrases")) out.put("quickPhrases", words(old.getString("quickPhrases"), "\n"))
    if (old.has("listTabs")) out.put("listTabs", words(old.getString("listTabs"), ","))
    if (old.has("presetsApplied")) out.put("presetsApplied", words(old.getString("presetsApplied"), ","))

    // 読めない NG は parseBackup が全体を断るよう、ここでは握りつぶさない
    if (old.has("ngRules")) out.put("ngRules", legacyNg(old.getString("ngRules")))
    if (old.has("ngStyle")) out.put("ngMode", old.getString("ngStyle").let { if (it == "fold") "aborn" else it })
    if (old.has("font")) out.put("fontFamily", old.getString("font").let { FONT_KEY[it] ?: it })

    // 出さない(showThumbnails = false)→ never。古い NEVER は「押したら」
    val thumb = old.optString("thumbMode").ifEmpty { null }
    val mode = when {
        old.has("showThumbnails") && !old.getBoolean("showThumbnails") -> "NEVER"
        old.has("showThumbnails") && thumb == "NEVER" -> "TAP"
        else -> thumb
    }
    if (mode != null) out.put("thumbLoad", mode.lowercase())

    if (old.has("idHeat") || old.has("idColor")) out.put("idStyle", if (old.optBoolean("idColor") || old.optBoolean("idHeat", true)) "color" else "none")
    if (out.optString("heatStyle") == "none") out.put("heatStyle", "left")
    if (out.optString("postStyle") == "timeline") out.put("postStyle", "discord")
    for (k in listOf("scheme", "darkScheme", "lightScheme")) out.optString(k).ifEmpty { null }?.let { out.put(k, retiredScheme(it)) }
    out.optString("uploadHost").ifEmpty { null }?.let { h -> if (Uploader.HOSTS.none { it.key == h }) out.put("uploadHost", Uploader.DEFAULT_HOST) }

    if (old.has("notifyReply") || old.has("notifyFav") || old.has("notifyKeyword")) {
        out.put(
            "notifyKinds",
            JSONObject().put("reply", old.optBoolean("notifyReply", true)).put("fav", old.optBoolean("notifyFav", true)).put("keyword", old.optBoolean("notifyKeyword", true)),
        )
    }
    val swipe = JSONObject()
    for ((from, to) in listOf("gesturesList" to "list", "gesturesThread" to "thread")) {
        old.optString(from).ifEmpty { null }?.let { t -> runCatching { JSONObject(t) }.getOrNull()?.let { swipe.put(to, it) } }
    }
    if (swipe.length() > 0) out.put("swipeGestures", swipe)
    return out
}

/** 今の形のファイルにする。読めない行は例外のまま伝える(半分だけ戻さない) */
internal fun currentFromLegacy(o: JSONObject): JSONObject {
    val out = JSONObject().put("app", BACKUP_APP).put("version", BACKUP_VERSION)
    for (k in listOf("favoriteBoards", "favoriteThreads", "sites")) o.opt(k)?.let { out.put(k, it) }
    val old = o.optJSONObject("settings") ?: return out
    out.put("settings", legacySettings(old))
    if (old.has("uploads")) out.put("uploads", legacyUploads(old.getString("uploads")))
    return out
}
