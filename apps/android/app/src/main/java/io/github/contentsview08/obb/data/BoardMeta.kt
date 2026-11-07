package io.github.contentsview08.obb.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * 板ごとの設定。全体の設定の上に、この板だけ変えたいものを重ねる(PC 版・Web の ui/settings.ts の BoardMeta と同じ項目・同じ JSON)。
 * 決めていないもの(null・空)は全体の設定のまま
 */
data class BoardMeta(
    /** 板名の代わりに出す名前 */
    val alias: String? = null,
    /** 名前欄・メール欄の既定値 */
    val defaultName: String? = null,
    val defaultMail: String? = null,
    /** 名無しの名前を省くか。null なら全体の設定(名無しの名前を省く) */
    val omitNoname: Boolean? = null,
    /** 板の既定の名前のほかに、名無しとみなす名前 */
    val nonames: List<String> = emptyList(),
    /** ファビコンの上書き(画像の URL) */
    val icon: String? = null,
) {
    val isEmpty get() = icon == null && alias == null && defaultName == null && defaultMail == null && omitNoname == null && nonames.isEmpty()

    fun toJson(): JSONObject = JSONObject().apply {
        alias?.let { put("alias", it) }
        icon?.let { put("icon", it) }
        defaultName?.let { put("defaultName", it) }
        defaultMail?.let { put("defaultMail", it) }
        omitNoname?.let { put("omitNoname", it) }
        if (nonames.isNotEmpty()) put("nonames", JSONArray(nonames))
    }

    companion object {
        fun fromJson(o: JSONObject) = BoardMeta(
            o.optString("alias").ifEmpty { null },
            o.optString("defaultName").ifEmpty { null },
            o.optString("defaultMail").ifEmpty { null },
            if (o.has("omitNoname")) o.optBoolean("omitNoname") else null,
            o.optJSONArray("nonames")?.let { a -> List(a.length()) { a.optString(it) }.filter { it.isNotEmpty() } } ?: emptyList(),
            o.optString("icon").ifEmpty { null },
        )
    }
}
