package io.github.contentsview08.obb.data

import org.json.JSONObject

/**
 * スキンの一覧(カタログ)。GitHub Pages の obb-skins(index.json)から取って、設定 → スキン の「もっと探す」に札で並べる。
 * 入れたスキンには source(id・url・revision)を付けて覚え、一覧の revision が上がっていたら自動で入れ替える
 * (配る側を直せば、入れている人のアプリも新しくなる)。PC 版の ui/skinCatalog.ts・host/skinCatalog.ts と同じ決まり
 */
object SkinCatalog {
    /** 一覧の置き場(obb-skins の GitHub Pages)。中身は tools/build_index.py が作る */
    const val URL = "https://contentsview08.github.io/obb-skins/index.json"
    /** 一覧(もっと探す)を出すか。配り場(obb-skins の Pages)がまだないので、整うまで UI から外しておく(2026-11-26)。取りにも行かない */
    const val ENABLED = false

    /** 一覧の 1 つ(スキン 1 つ分の案内。scheme・settings は札を描くための写し) */
    class Entry(val id: String, val name: String, val note: String, val revision: Int, val url: String, val scheme: JSONObject?, val settings: JSONObject?)

    /** index.json を読む(読めなければ投げる) */
    fun parse(text: String, indexUrl: String): List<Entry> {
        val o = runCatching { JSONObject(text) }.getOrNull() ?: throw IllegalArgumentException("スキンの一覧が読めませんでした")
        if (o.optString("format") != "obb-skins") throw IllegalArgumentException("スキンの一覧ではありません")
        val a = o.optJSONArray("skins") ?: throw IllegalArgumentException("スキンの一覧ではありません")
        val base = java.net.URI(indexUrl)
        val out = ArrayList<Entry>()
        for (i in 0 until a.length()) {
            val e = a.optJSONObject(i) ?: continue
            val id = e.optString("id"); val rel = e.optString("url")
            if (id.isEmpty() || rel.isEmpty()) continue
            val url = runCatching { base.resolve(rel).toString() }.getOrNull() ?: continue
            out += Entry(id, e.optString("name").ifEmpty { id }, e.optString("note"), e.optInt("revision", 1), url, e.optJSONObject("scheme"), e.optJSONObject("settings"))
        }
        return out
    }

    suspend fun fetch(url: String = URL): List<Entry> {
        val res = Http.get(url, mapOf("Accept" to "application/json", "Cache-Control" to "no-cache"))
        if (res.status !in 200..299) throw IllegalStateException("スキンの一覧を取れませんでした(${res.status})")
        return parse(String(res.body), url)
    }

    /** 一覧のスキンの JSON を取り、名前と出どころを付けて返す(保存する形) */
    suspend fun fetchSkin(e: Entry): JSONObject {
        val res = Http.get(e.url, mapOf("Accept" to "application/json", "Cache-Control" to "no-cache"))
        if (res.status !in 200..299) throw IllegalStateException("取れませんでした(${res.status})")
        val o = runCatching { JSONObject(String(res.body)) }.getOrNull() ?: throw IllegalArgumentException("スキンが読めませんでした")
        if (!LookTheme.isTheme(o)) throw IllegalArgumentException("スキンではありません")
        o.put("name", e.name)
        o.put("source", JSONObject().put("id", e.id).put("url", e.url).put("revision", e.revision))
        return o
    }

    /** 一覧の id で、入れているスキンを探す */
    fun installedOf(saved: List<JSONObject>, id: String): JSONObject? = saved.firstOrNull { it.optJSONObject("source")?.optString("id") == id }

    /** 入れたスキンを保存する(同じ id の古いものは、名前が変わっていても消す) */
    fun save(prefs: Prefs, theme: JSONObject) {
        val id = theme.optJSONObject("source")?.optString("id").orEmpty()
        val list = LookTheme.saved(prefs).filter { it.optJSONObject("source")?.optString("id") != id && LookTheme.nameOf(it) != LookTheme.nameOf(theme) } + theme
        prefs.lookThemes = org.json.JSONArray(list).toString()
    }

    /** 入れているスキンのうち、一覧の方が新しいもの(入れ替えるべきもの) */
    fun updates(saved: List<JSONObject>, catalog: List<Entry>): List<Pair<JSONObject, Entry>> = saved.mapNotNull { t ->
        val src = t.optJSONObject("source") ?: return@mapNotNull null
        val e = catalog.firstOrNull { it.id == src.optString("id") } ?: return@mapNotNull null
        if (e.revision > src.optInt("revision", 1)) t to e else null
    }
}
