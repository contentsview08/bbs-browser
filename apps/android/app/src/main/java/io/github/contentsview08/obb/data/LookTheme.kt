package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.ui.CustomDef
import org.json.JSONObject

/**
 * スキン(見た目をまとめた JSON)。配色(自分の配色)・レスの見た目・細かい表示・文字と余白をまとめて受け渡す。形は docs/skin.md。
 * 同梱のスキンはない(ChMate 風などは docs/skins の JSON を貼り付けて入れる)。
 * - settings: PC 版と同じ名前・同じ意味の項目。android / pc: その版だけの項目(ツリー表示などの styleOptions・字)
 * - 入っている項目だけを上書きする(欠けている JSON も読める。人が作ったテーマを取り込んで、気に入らない所だけ直せる)
 * - scheme があれば自分の配色として入れ、配色をそれにする(settings の scheme があればそちら)
 */
object LookTheme {
    const val FORMAT = "obb-theme"

    /**
     * 同梱のスキン: レスの見た目と組になっている配色(Discord 風・LINE 風の色)。配色の一覧からは外し、スキンとして並べる(2026-11-25)。
     * キーは "builtin:<配色のキー>"。PC 版の ui/lookTheme.ts の BUILTIN_SKINS と同じ
     */
    val BUILTIN_SKINS = listOf("discord-dark" to "discord", "line-light" to "line", "line-dark" to "line", "x-dim" to "discord")
    val BUILTIN_SCHEME_KEYS = BUILTIN_SKINS.map { it.first }.toSet()
    fun builtinStyle(schemeKey: String): String? = BUILTIN_SKINS.firstOrNull { it.first == schemeKey }?.second

    /** PC 版の ui/lookTheme.ts の COMMON_KEYS と同じ並び(名前も意味も同じ項目) */
    val COMMON_KEYS = setOf(
        "followOsTheme", "scheme", "darkScheme", "lightScheme", "accent",
        "postStyle",
        "idStyle", "idShort", "idPosition", "dateStyle", "heatStyle", "highlightOp", "nameSubtle", "omitNoname", "watchoiShort", "iconFromWatchoi",
        "urlShorten", "tidyBlankLines", "showMinimap", "showLinkPreview", "openLinksInApp",
        "threadSort", "unreadFirst", "listShape", "keywordBands", "listTabs", "openPosition", "showNextCandidatesAtEnd", "showNextUnreadAtEnd",
        "blurGross", "postThumbSize", "thumbLoad", "reduceMotion", "ngMode", "groupNg", "pastTabsPosition", "hideBarsOnScroll",
        "mobileFontPx", "listFontPx", "postBodyPx", "postHeadPx", "listPadPx", "postPadPx", "postLineHeight", "headerPx", "footerPx",
    )
    /** スマホだけの項目(JSON の android) */
    val ANDROID_KEYS = setOf("fontFamily", "styleOptions", "barLayout", "toolbarIconSize", "toolbarLabel", "pastTabs")
    val KEYS = COMMON_KEYS + ANDROID_KEYS

    /** スキンの JSON か(自分の配色だけの JSON と見分ける) */
    fun isTheme(o: JSONObject) = o.optString("format") == FORMAT || o.has("settings") || o.has("android") || o.has("pc")

    /** いまの見た目をスキンに(自分の配色・差し色・見た目の項目) */
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

    /** スキンを当てる(入っている項目だけ)。当てた項目の数を返す */
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

    /** スキンの配色(見本を描くため)。自分の配色が入っていればそれ、なければ settings の配色のキーから。どちらもなければ null */
    fun schemeOf(o: JSONObject): io.github.contentsview08.obb.ui.Scheme? {
        o.optJSONObject("scheme")?.let { sc -> CustomDef.parse(sc.toString()) }?.let { return io.github.contentsview08.obb.ui.buildScheme(it) }
        val key = o.optJSONObject("settings")?.optString("scheme").orEmpty()
        return io.github.contentsview08.obb.ui.SCHEMES.firstOrNull { it.key == key }
    }

    /** スキンの「自分の書き込み」の色(見本の帯) */
    fun ownOf(o: JSONObject, s: io.github.contentsview08.obb.ui.Scheme): androidx.compose.ui.graphics.Color =
        o.optJSONObject("scheme")?.let { sc -> CustomDef.parse(sc.toString()) }?.own ?: io.github.contentsview08.obb.ui.Palette.extraOf(s, "own")

    /** スキンの一言(JSON の note)。なければ、レスの見た目などから作る */
    fun captionOf(o: JSONObject): String {
        o.optString("note").takeIf { it.isNotEmpty() }?.let { return it }
        val st = o.optJSONObject("settings")
        val parts = ArrayList<String>()
        st?.optString("postStyle")?.takeIf { it.isNotEmpty() }?.let { parts += "レスの見た目: " + io.github.contentsview08.obb.ui.postStyleName(it) }
        val n = (st?.length() ?: 0) + (o.optJSONObject("android")?.length() ?: 0)
        if (o.has("scheme")) parts += if (n == 0) "色だけのスキン" else "色と見た目($n 項目)"
        else if (n > 0) parts += "見た目($n 項目)"
        return parts.joinToString("・")
    }

    /**
     * スキンの代表の色(地・面・強調・未読・字)。設定の一覧の札に出す。
     * 自分の配色が入っていればそれから、なければ settings の配色のキーから。どちらもなければ null(今の配色で描く)
     */
    fun swatch(o: JSONObject): List<androidx.compose.ui.graphics.Color>? {
        o.optJSONObject("scheme")?.let { sc -> CustomDef.parse(sc.toString()) }?.let { d ->
            val s = io.github.contentsview08.obb.ui.buildScheme(d)
            return listOf(s.base, s.surface, s.accent, s.unread, s.textStrong)
        }
        val key = o.optJSONObject("settings")?.optString("scheme").orEmpty()
        val s = io.github.contentsview08.obb.ui.SCHEMES.firstOrNull { it.key == key } ?: return null
        return listOf(s.base, s.surface, s.accent, s.unread, s.textStrong)
    }

    // ── 保存したスキン(設定 lookThemes。JSON の配列。名前で見分ける) ──

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

    /** ドロップダウンのキー("saved:名前")からスキンの JSON を。なければ null */
    fun byKey(prefs: Prefs, key: String): String? =
        if (key.startsWith("saved:")) saved(prefs).firstOrNull { nameOf(it) == key.removePrefix("saved:") }?.toString() else null

}
