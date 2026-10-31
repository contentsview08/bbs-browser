package io.github.yumekui8.bbsnative.data

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import kotlin.properties.ReadWriteProperty
import kotlin.reflect.KProperty

/** NG のルール。target: id / name / body(本文の言葉) / title(スレタイ) */
data class NgRule(val target: String, val pattern: String)

/** 画像のサムネイルを自動で読むか */
enum class ThumbMode(val label: String) { ALWAYS("いつも"), WIFI("Wi-Fi のときだけ"), NEVER("押したら") }

/** 設定を Compose の状態にしつつ SharedPreferences に書く(変えたらすぐ画面に出て、閉じても残る) */
private class Pref<T>(private val sp: SharedPreferences, private val key: String, def: T) : ReadWriteProperty<Any?, T> {
    @Suppress("UNCHECKED_CAST")
    private var state = mutableStateOf(
        runCatching {
            when (def) {
                is Boolean -> sp.getBoolean(key, def)
                is Int -> sp.getInt(key, def)
                is Float -> sp.getFloat(key, def)
                is String -> sp.getString(key, def) ?: def
                else -> def
            } as T
        }.getOrDefault(def),
    )

    override fun getValue(thisRef: Any?, property: KProperty<*>): T = state.value
    override fun setValue(thisRef: Any?, property: KProperty<*>, value: T) {
        state.value = value
        sp.edit().apply {
            when (value) {
                is Boolean -> putBoolean(key, value)
                is Int -> putInt(key, value)
                is Float -> putFloat(key, value)
                is String -> putString(key, value)
            }
        }.apply()
    }
}

/**
 * 設定(端末の SharedPreferences)。画面から見る値は Compose の状態にして、変えたらすぐ画面に出る。
 * 項目と既定の値は、今のスマホ版(apps/desktop/src/ui/settings.ts の DEFAULT_SETTINGS)にそろえる
 */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    private fun <T> pref(key: String, def: T): ReadWriteProperty<Any?, T> = Pref(sp, key, def)

    var lastBoardUrl: String?
        get() = sp.getString("lastBoardUrl", null)
        set(v) = sp.edit().putString("lastBoardUrl", v).apply()
    var lastBoardName: String?
        get() = sp.getString("lastBoardName", null)
        set(v) = sp.edit().putString("lastBoardName", v).apply()

    // ── テーマと文字 ──
    /** 配色(Palette の SCHEMES のキー) */
    var scheme by pref("scheme", "indigo")
    /** スマホのダーク・ライトに合わせる(合わせるときは darkScheme / lightScheme を使う) */
    var followSystem by pref("followSystem", false)
    var darkScheme by pref("darkScheme", "soft-dark")
    /** 差し色(ACCENTS のキー)。空ならテーマの色 */
    var accent by pref("accent", "")
    var lightScheme by pref("lightScheme", "soft-light")
    /** レスの見た目: card(カード)/ discord(Discord 風)/ line(LINE 風) */
    var postStyle by pref("postStyle", "card")
    /** 画面全体の文字の倍率(0.85〜1.3) */
    var fontScale by pref("fontScale", 1f)
    /** レスの本文の文字の倍率(画面全体に掛ける) */
    var bodyScale by pref("bodyScale", 1f)
    /** レスの本文の行間(字の高さの倍) */
    var lineHeight by pref("lineHeight", 1.47f)
    /** レスの頭(名前・日付・ID)の文字の倍率 */
    var postHeadScale by pref("postHeadScale", 1f)
    /** レスの上下の余白(dp) */
    var postPad by pref("postPad", 8)
    /** スレ一覧の文字の倍率 */
    var listFontScale by pref("listFontScale", 1f)
    /** スレ一覧のスレの上下の余白(dp) */
    var listPad by pref("listPad", 9)
    /** ヘッダー・フッターの高さ(dp)と文字の倍率 */
    var headerHeight by pref("headerHeight", 54)
    var footerHeight by pref("footerHeight", 52)
    var barFontScale by pref("barFontScale", 1f)

    // ── スレ一覧 ──
    /** 板を開いたときの並び: subject(更新順)/ momentum / newest / count */
    var threadSort by pref("threadSort", "subject")
    /** スレタイにこの言葉が入っているスレを、一覧の上にまとめる(改行区切り) */
    var keywords by pref("keywords", "")
    /** スレ一覧の勢いの示し方: number(数字の色)/ bar(行の下のバー)/ both */
    var momentumStyle by pref("momentumStyle", "number")
    /** スレ一覧の行の形: normal / compact(スレタイ 1 行と数だけ) */
    var listDensity by pref("listDensity", "normal")
    /** スレ一覧を見出し(キーワード・新しいスレ・新着のある読んだスレ・その他)で区切る */
    var listSections by pref("listSections", false)
    /** 板を開いたとき、一覧の上に前回からの差分(新しいスレ・新着のある読んだスレの数)を出す */
    var listDiff by pref("listDiff", true)
    var pullToRefreshList by pref("pullToRefreshList", true)
    /** 板ごとに、前回スレ一覧を取った時刻(「新」の印の境目)。JSON */
    private var boardVisitsJson by pref("boardVisits", "{}")
    fun boardVisit(url: String): Long? = runCatching { JSONObject(boardVisitsJson).optLong(url, 0L).takeIf { it > 0 } }.getOrNull()
    fun setBoardVisit(url: String, t: Long) { boardVisitsJson = runCatching { JSONObject(boardVisitsJson) }.getOrDefault(JSONObject()).put(url, t).toString() }
    /** 一覧の下に出すタブと並び(カンマ区切り。unread / visited / momentum / newest / count) */
    var listTabs by pref("listTabs", "unread,momentum,newest")
    /** 開いていないスレのログを消すまでの日数(0 なら消さない) */
    var logRetentionDays by pref("logRetentionDays", 90)

    // ── スレ表示 ──
    /** 開く位置: unread(最初の未読)/ top / bottom */
    var openPosition by pref("openPosition", "unread")
    var omitNoname by pref("omitNoname", true)
    var collapseBlankLines by pref("collapseBlankLines", true)
    var aaAutoDetect by pref("aaAutoDetect", true)
    var highlightOp by pref("highlightOp", true)
    var idHeat by pref("idHeat", true)
    var idColor by pref("idColor", false)
    /** 動きを減らす(画面の移り方・新着の光り方・数字の繰り上がりを省く)。端末の「アニメーションを削除」でも同じになる */
    var reduceMotion by pref("reduceMotion", false)
    /** 字(Fonts.CHOICES のキー)。空なら端末の標準 */
    var font by pref("font", "")
    /** 自分で作った配色(CustomDef の JSON)。空なら作っていない */
    var customScheme by pref("customScheme", "")
    /** NG のレスの見せ方: fold(あぼーん 1 行)/ hide(透明あぼーん)/ dim(薄く表示) */
    var ngStyle by pref("ngStyle", "fold")
    /** レスをダブルタップで返信(>>番号 を入れて書き込み欄を開く) */
    var doubleTapReply by pref("doubleTapReply", false)
    var showMinimap by pref("showMinimap", true)
    /** 前のレスから時間が空いたところに「3 時間後」の区切りを入れる */
    var timeGap by pref("timeGap", true)
    /** 人気のレスの示し方: left(左の帯)/ right(右の帯)/ text(本文の色)/ none */
    var heatStyle by pref("heatStyle", "left")
    var urlShorten by pref("urlShorten", true)
    var imageUrlOmit by pref("imageUrlOmit", true)
    var imageUrlCollapse by pref("imageUrlCollapse", true)
    var showLinkPreview by pref("showLinkPreview", true)
    var openLinksInApp by pref("openLinksInApp", true)

    // ── 画像と動画 ──
    var showThumbnails by pref("showThumbnails", true)
    private var thumbModeName by pref("thumbMode", "WIFI")
    var thumbMode: ThumbMode
        get() = runCatching { ThumbMode.valueOf(thumbModeName) }.getOrDefault(ThumbMode.WIFI)
        set(v) { thumbModeName = v.name }
    /** サムネイルの大きさ(dp) */
    var thumbSize by pref("thumbSize", 96)
    var blurGross by pref("blurGross", true)
    /** グロ注意とみなす言葉(改行区切り) */
    var grossWords by pref("grossWords", "グロ")

    // ── 書き込み ──
    /** 書き込みの名前・メール(前回のもの) */
    var postName by pref("postName", "")
    var postMail by pref("postMail", "")
    /** 定型文(長押しの「すぐ書き込む」。改行区切り) */
    var quickPhrases by pref("quickPhrases", "草")
    /** 送るを押してから 3 秒待ち、その間は取り消せる */
    var sendDelay by pref("sendDelay", false)
    /** 書いている間、本文の欄の上に定型文のバーを出す */
    var phraseBar by pref("phraseBar", true)
    /** 書き込み欄から画像を catbox.moe に上げるか(匿名で上げた画像は公開され、消せないので既定は切る。PC 版と同じ) */
    var uploadEnabled by pref("uploadEnabled", false)
    /** 上げる前に縮める、長い辺の大きさ(px。0 なら縮めない) */
    var uploadMaxDimension by pref("uploadMaxDimension", 4096)

    // ── 操作 ──
    var gesturesEnabled by pref("gesturesEnabled", true)
    /** 操作が決まったときなどに軽く振動する */
    var haptics by pref("haptics", true)
    /** なぞる操作の感度(1 鈍い〜5 敏感) */
    var gestureSensitivity by pref("gestureSensitivity", 3)
    private var gesturesListJson by pref("gesturesList", "")
    private var gesturesThreadJson by pref("gesturesThread", "")
    var hideBarsOnScroll by pref("hideBarsOnScroll", true)
    /** ログを削除する前に確かめる(確かめる画面の「次回から表示しない」で切れる) */
    var confirmDeleteLog by pref("confirmDeleteLog", true)
    var autoScrollOnNew by pref("autoScrollOnNew", true)
    /** 開いているスレの自動更新(秒。0 ならしない) */
    var autoRefreshSec by pref("autoRefreshSec", 0)
    var showRefreshButton by pref("showRefreshButton", true)

    /** なぞる操作の割り当て(向きの並び → 操作)。screen は list / thread */
    fun gestures(screen: String): Map<String, String> {
        val json = if (screen == "list") gesturesListJson else gesturesThreadJson
        if (json.isEmpty()) return DEFAULT_GESTURES.getValue(screen)
        return runCatching { JSONObject(json).let { o -> o.keys().asSequence().associateWith { o.getString(it) } } }.getOrDefault(DEFAULT_GESTURES.getValue(screen))
    }

    fun setGesture(screen: String, seq: String, action: String) {
        val json = JSONObject(gestures(screen).toMutableMap().apply { put(seq, action) } as Map<*, *>).toString()
        if (screen == "list") gesturesListJson = json else gesturesThreadJson = json
    }

    fun resetGestures() { gesturesListJson = ""; gesturesThreadJson = "" }

    // 古い呼び方(画面の側)
    fun changeFontScale(v: Float) { fontScale = v }
    fun changeThumbMode(v: ThumbMode) { thumbMode = v }
    fun changeShowMinimap(v: Boolean) { showMinimap = v }
    fun changeUploadEnabled(v: Boolean) { uploadEnabled = v }

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

    /** バックアップ: 設定を全部 JSON に(最後に開いた板は除く) */
    fun export(): JSONObject {
        val o = JSONObject()
        for ((k, v) in sp.all) if (k != "lastBoardUrl" && k != "lastBoardName") o.put(k, v)
        return o
    }

    /** バックアップから戻す(戻したあとはアプリを開き直すと全部に効く) */
    fun import(o: JSONObject) {
        val e = sp.edit()
        for (k in o.keys()) {
            when (val v = o.get(k)) {
                is Boolean -> e.putBoolean(k, v)
                is Int -> e.putInt(k, v)
                is Double -> e.putFloat(k, v.toFloat())
                is Float -> e.putFloat(k, v)
                is String -> e.putString(k, v)
            }
        }
        e.commit()
    }

    companion object {
        /** なぞる操作の既定(今のスマホ版と同じ) */
        val DEFAULT_GESTURES = mapOf(
            "list" to mapOf("right" to "drawer", "left" to "forward", "right,up" to "bottom", "right,down" to "top", "left,down" to "refresh", "left,up" to "newThread"),
            "thread" to mapOf("right" to "back", "left" to "reply", "right,up" to "bottom", "right,down" to "top", "left,down" to "refresh", "left,up" to "deleteLog"),
        )
    }
}
