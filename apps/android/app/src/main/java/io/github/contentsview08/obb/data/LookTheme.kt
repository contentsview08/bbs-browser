package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.ui.CustomDef
import org.json.JSONObject

/**
 * 見た目のテーマ(JSON)。配色(自分の配色)・レスの見た目・細かい表示・文字と余白をまとめて受け渡す。形は docs/look-theme.md。
 * - settings: PC 版と同じ名前・同じ意味の項目。android / pc: その版だけの項目(ツリー表示などの styleOptions・字)
 * - 入っている項目だけを上書きする(欠けている JSON も読める。人が作ったテーマを取り込んで、気に入らない所だけ直せる)
 * - scheme があれば自分の配色として入れ、配色をそれにする(settings の scheme があればそちら)
 */
object LookTheme {
    const val FORMAT = "obb-theme"

    /** PC 版の ui/lookTheme.ts の COMMON_KEYS と同じ並び(名前も意味も同じ項目) */
    val COMMON_KEYS = setOf(
        "followOsTheme", "scheme", "darkScheme", "lightScheme", "accent",
        "postStyle",
        "idStyle", "idShort", "idPosition", "dateStyle", "heatStyle", "highlightOp", "nameSubtle", "omitNoname", "watchoiShort", "iconFromWatchoi",
        "urlShorten", "tidyBlankLines", "showMinimap", "showLinkPreview", "openLinksInApp",
        "threadSort", "unreadFirst", "listShape", "keywordBands", "openPosition", "showNextCandidatesAtEnd", "showNextUnreadAtEnd",
        "blurGross", "postThumbSize", "thumbLoad", "reduceMotion", "ngMode", "groupNg", "pastTabsPosition", "hideBarsOnScroll",
        "mobileFontPx", "listFontPx", "postBodyPx", "postHeadPx", "listPadPx", "postPadPx", "postLineHeight", "headerPx", "footerPx",
    )
    /** スマホだけの項目(JSON の android) */
    val ANDROID_KEYS = setOf("fontFamily", "styleOptions")
    val KEYS = COMMON_KEYS + ANDROID_KEYS

    /** 見た目のテーマの JSON か(自分の配色だけの JSON と見分ける) */
    fun isTheme(o: JSONObject) = o.optString("format") == FORMAT || o.has("settings") || o.has("android") || o.has("pc")

    /** いまの見た目をテーマに(自分の配色・差し色・見た目の項目) */
    fun export(prefs: Prefs, name: String = ""): JSONObject = JSONObject().apply {
        put("format", FORMAT)
        put("version", 1)
        if (name.isNotEmpty()) put("name", name)
        CustomDef.parse(prefs.customScheme)?.let { put("scheme", JSONObject(it.toJson())) }
        put("accent", prefs.accent)
        val all = prefs.exportKeys(KEYS)
        val common = JSONObject()
        val android = JSONObject()
        for (k in all.keys()) if (k in COMMON_KEYS) common.put(k, all.get(k)) else android.put(k, all.get(k))
        put("settings", common)
        put("android", android)
    }

    /** テーマを当てる(入っている項目だけ)。当てた項目の数を返す */
    suspend fun apply(prefs: Prefs, o: JSONObject): Int {
        val merged = JSONObject()
        for (section in listOf("settings", "android")) o.optJSONObject(section)?.let { s -> for (k in s.keys()) if (k in KEYS) merged.put(k, s.get(k)) }
        // 自分の配色: 入っていればそれにして、配色を「自分の配色」に(settings で配色を指していればそちら)
        o.optJSONObject("scheme")?.let { sc -> CustomDef.parse(sc.toString()) }?.let { d ->
            merged.put("customScheme", d.copy(accentPick = "").toJson())
            if (!merged.has("scheme")) merged.put("scheme", "custom")
            if (!merged.has("followOsTheme")) merged.put("followOsTheme", false)
            if (d.accentPick.isNotEmpty() && !o.has("accent")) merged.put("accent", d.accentPick)
        }
        if (o.has("accent")) merged.put("accent", o.optString("accent"))
        prefs.import(merged, only = KEYS + "customScheme")
        return merged.length()
    }

    // ── 保存したテーマ(設定 lookThemes。JSON の配列。名前で見分ける) ──

    fun saved(prefs: Prefs): List<JSONObject> = runCatching {
        val a = org.json.JSONArray(prefs.lookThemes)
        List(a.length()) { a.getJSONObject(it) }
    }.getOrDefault(emptyList())

    fun nameOf(o: JSONObject): String = o.optString("name").ifEmpty { "名前なし" }

    /** 保存する(同じ名前があれば入れ替える) */
    fun save(prefs: Prefs, theme: JSONObject) {
        val name = nameOf(theme)
        val list = saved(prefs).filter { nameOf(it) != name } + theme
        prefs.lookThemes = org.json.JSONArray(list).toString()
    }

    fun remove(prefs: Prefs, name: String) {
        prefs.lookThemes = org.json.JSONArray(saved(prefs).filter { nameOf(it) != name }).toString()
    }

    /** ドロップダウンのキー("preset:…" か "saved:名前")からテーマの JSON を。なければ null */
    fun byKey(prefs: Prefs, key: String): String? = when {
        key.startsWith("preset:") -> PRESETS.firstOrNull { it.first == key.removePrefix("preset:") }?.let { preset(it.first) }
        key.startsWith("saved:") -> saved(prefs).firstOrNull { nameOf(it) == key.removePrefix("saved:") }?.toString()
        else -> null
    }

    /** 同梱のテーマ(キーと名前)。中身は bbs-browser の docs/themes にある JSON と同じ */
    val PRESETS = listOf("chmate-dark" to "ChMate 風(ダーク)", "chmate-light" to "ChMate 風(ライト)")

    fun preset(key: String): String = when (key) {
        "chmate-light" -> CHMATE_LIGHT
        else -> CHMATE_DARK
    }

    private val CHMATE_DARK = """
{
  "format": "obb-theme",
  "version": 1,
  "name": "ChMate 風(ダーク)",
  "note": "ChMate のダークに寄せた見た目。濃い灰色の地、紫の新着の札、専ブラ風のレス(番号・名前・日時・ID を 1 行に)、右にミニマップ。人気のレスは本文の色、自分のレス・自分への返信は左の帯",
  "scheme": {
    "from": "gray",
    "base": "#313131",
    "surface": "#313131",
    "text": "#F4F4F4",
    "accent": "#8E6BC8",
    "unread": "#8E6BC8",
    "own": "#FF8FA3",
    "colors": {
      "bar": "#575757",
      "surface2": "#3A3A3A",
      "surface3": "#434343",
      "border": "#262626",
      "borderStrong": "#1A1A1A",
      "textMuted": "#A8A8A8",
      "threadReadTitle": "#64B5F6",
      "posterName": "#B0B0B0",
      "link": "#6AA6E8",
      "newBadge": "#8E6BC8",
      "newBadgeText": "#FFFFFF",
      "heatWarm": "#7986CB",
      "heatHot": "#AB47BC",
      "heatVeryHot": "#EF5350",
      "markFav": "#F2C14E"
    }
  },
  "accent": "",
  "settings": {
    "followOsTheme": false,
    "postStyle": "classic",
    "dateStyle": "full",
    "idPosition": "header",
    "idStyle": "none",
    "idShort": false,
    "heatStyle": "text",
    "highlightOp": true,
    "nameSubtle": true,
    "omitNoname": false,
    "watchoiShort": false,
    "iconFromWatchoi": false,
    "urlShorten": false,
    "tidyBlankLines": false,
    "showMinimap": true,
    "showLinkPreview": false,
    "listShape": "normal",
    "unreadFirst": false,
    "keywordBands": true
  },
  "android": {
    "styleOptions": { "classic": { "tree": false, "treeDepth": 3, "quote": "line", "group": true } }
  },
  "pc": {
    "styleOptions": { "classic": { "tree": false } }
  }
}
""".trimIndent()

    private val CHMATE_LIGHT = """
{
  "format": "obb-theme",
  "version": 1,
  "name": "ChMate 風(ライト)",
  "note": "ChMate のライトに寄せた見た目。薄い灰色の地、桃色の新着の札、専ブラ風のレス(番号・名前・日時・ID を 1 行に)、右にミニマップ。人気のレスは本文の色、自分のレス・自分への返信は左の帯",
  "scheme": {
    "from": "light-gray",
    "base": "#EEEEEE",
    "surface": "#EEEEEE",
    "text": "#212121",
    "accent": "#E85DA6",
    "unread": "#E85DA6",
    "own": "#D32F2F",
    "colors": {
      "bar": "#DADADA",
      "surface2": "#E4E4E4",
      "surface3": "#D9D9D9",
      "border": "#C8C8C8",
      "borderStrong": "#B0B0B0",
      "textMuted": "#757575",
      "threadReadTitle": "#3949AB",
      "posterName": "#707070",
      "link": "#1E63C9",
      "newBadge": "#E85DA6",
      "newBadgeText": "#FFFFFF",
      "heatWarm": "#5C6BC0",
      "heatHot": "#8E24AA",
      "heatVeryHot": "#D32F2F",
      "markFav": "#AC8016"
    }
  },
  "accent": "",
  "settings": {
    "followOsTheme": false,
    "postStyle": "classic",
    "dateStyle": "full",
    "idPosition": "header",
    "idStyle": "none",
    "idShort": false,
    "heatStyle": "text",
    "highlightOp": true,
    "nameSubtle": true,
    "omitNoname": false,
    "watchoiShort": false,
    "iconFromWatchoi": false,
    "urlShorten": false,
    "tidyBlankLines": false,
    "showMinimap": true,
    "showLinkPreview": false,
    "listShape": "normal",
    "unreadFirst": false,
    "keywordBands": true
  },
  "android": {
    "styleOptions": { "classic": { "tree": false, "treeDepth": 3, "quote": "line", "group": true } }
  },
  "pc": {
    "styleOptions": { "classic": { "tree": false } }
  }
}
""".trimIndent()
}
