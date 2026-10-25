package io.github.yumekui8.bbsnative.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject

/** NG のルール。target: id / name / body(本文の言葉) */
data class NgRule(val target: String, val pattern: String)

/** 画像のサムネイルを自動で読むか */
enum class ThumbMode(val label: String) { ALWAYS("いつも"), WIFI("Wi-Fi のときだけ"), NEVER("押したら") }

/**
 * 設定(端末の SharedPreferences)。画面から見る値は Compose の状態にして、変えたらすぐ画面に出る。
 * 前回開いていた板・文字の大きさ・画像の自動読み込み・NG
 */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    var lastBoardUrl: String?
        get() = sp.getString("lastBoardUrl", null)
        set(v) = sp.edit().putString("lastBoardUrl", v).apply()
    var lastBoardName: String?
        get() = sp.getString("lastBoardName", null)
        set(v) = sp.edit().putString("lastBoardName", v).apply()

    /** 文字の大きさの倍率(0.85〜1.3) */
    var fontScale by mutableStateOf(sp.getFloat("fontScale", 1f))
        private set
    fun changeFontScale(v: Float) { fontScale = v; sp.edit().putFloat("fontScale", v).apply() }

    var thumbMode by mutableStateOf(runCatching { ThumbMode.valueOf(sp.getString("thumbMode", "WIFI")!!) }.getOrDefault(ThumbMode.WIFI))
        private set
    fun changeThumbMode(v: ThumbMode) { thumbMode = v; sp.edit().putString("thumbMode", v.name).apply() }

    /** 書き込みの名前(前回のもの) */
    var postName: String
        get() = sp.getString("postName", "") ?: ""
        set(v) = sp.edit().putString("postName", v).apply()

    var ngRules by mutableStateOf(loadNg())
        private set
    fun addNg(rule: NgRule) { if (rule.pattern.isNotBlank() && rule !in ngRules) saveNg(ngRules + rule) }
    fun removeNg(rule: NgRule) = saveNg(ngRules - rule)

    private fun loadNg(): List<NgRule> = runCatching {
        val arr = JSONArray(sp.getString("ngRules", "[]"))
        List(arr.length()) { arr.getJSONObject(it).let { o -> NgRule(o.getString("target"), o.getString("pattern")) } }
    }.getOrDefault(emptyList())

    private fun saveNg(list: List<NgRule>) {
        ngRules = list
        val arr = JSONArray()
        for (r in list) arr.put(JSONObject().put("target", r.target).put("pattern", r.pattern))
        sp.edit().putString("ngRules", arr.toString()).apply()
    }
}
