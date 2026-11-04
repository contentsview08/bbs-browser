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

/** 画像のサムネイルを自動で読むか */
/** 画像のサムネイル: いつも読む / Wi-Fi のときだけ / 押したら読む / 出さない(前の「サムネイルで出す」のオフ) */
enum class ThumbMode(val label: String) { ALWAYS("いつも"), WIFI("Wi-Fi のときだけ"), TAP("押したら"), NEVER("出さない") }

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

    init {
        // レスの見た目「タイムライン(X 風)」はやめた(2026-11)。選んでいた人は、いちばん近い Discord 風に
        if (sp.getString("postStyle", null) == "timeline") sp.edit().putString("postStyle", "discord").apply()
        // やめた配色(2026-11)を選んでいたら、いちばん近い配色に書き換える(ui/Theme.kt の retiredScheme)
        for (k in listOf("scheme", "darkScheme", "lightScheme")) {
            val v = sp.getString(k, null) ?: continue
            val to = io.github.yumekui8.bbsnative.ui.retiredScheme(v)
            if (to != v) sp.edit().putString(k, to).apply()
        }
        // 上げ先の 自動・0x0.st・uguu.se はやめた(2026-11)。imgur のサイトの画面に読み替える
        sp.getString("uploadHost", null)?.let { v -> val to = Uploader.migrateHost(v); if (to != v) sp.edit().putString("uploadHost", to).apply() }
        // 設定の棚卸し(2026-11-04。PC・Web と同じ)。消した・まとめた設定の古い値を、いまの設定に 1 回だけ写して消す
        // サムネイル: 「出す・出さない」+「読み込む」→ 読み込む 1 つ(出さない = NEVER。前の NEVER(押したら)は TAP)
        if (sp.contains("showThumbnails")) {
            val mode = if (!sp.getBoolean("showThumbnails", true)) "NEVER" else if (sp.getString("thumbMode", null) == "NEVER") "TAP" else null
            sp.edit().apply { if (mode != null) putString("thumbMode", mode); remove("showThumbnails") }.apply()
        }
        // ID の見せ方: 「赤く」+「ID ごとの色」→ idStyle(none / color)
        if (sp.contains("idHeat") || sp.contains("idColor")) {
            val color = sp.getBoolean("idColor", false) || sp.getBoolean("idHeat", true)
            sp.edit().putString("idStyle", if (color) "color" else "none").remove("idHeat").remove("idColor").apply()
        }
        // 人気のレス「示さない」はやめた
        if (sp.getString("heatStyle", null) == "none") sp.edit().putString("heatStyle", "left").apply()
        // いつもオンにした(消した)もの
        for (k in listOf("pullToRefreshList", "aaAutoDetect", "sendDelay", "phraseBar", "uploadEnabled", "imageUrlOmit", "imageUrlCollapse")) if (sp.contains(k)) sp.edit().remove(k).apply()
    }

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
    var followSystem by pref("followSystem", true)
    var darkScheme by pref("darkScheme", "soft-dark")
    /** 差し色(ACCENTS のキー)。空ならテーマの色 */
    var accent by pref("accent", "")
    var lightScheme by pref("lightScheme", "light-gray")
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
    /** 板ごとに、前回スレ一覧を取った時刻(「新」の印の境目)。JSON */
    /** 最近開いた板(新しい順、30 まで)。クイックアクセスで使う */
    private var recentBoardsJson by pref("recentBoards", "[]")
    fun recentBoards(): List<Triple<String, String, Long>> = runCatching {
        val a = org.json.JSONArray(recentBoardsJson)
        (0 until a.length()).map { a.getJSONObject(it).let { o -> Triple(o.getString("url"), o.getString("name"), o.getLong("t")) } }
    }.getOrDefault(emptyList())
    fun addRecentBoard(url: String, name: String) {
        val list = listOf(Triple(url, name, System.currentTimeMillis())) + recentBoards().filter { it.first != url }
        recentBoardsJson = org.json.JSONArray(list.take(30).map { org.json.JSONObject().put("url", it.first).put("name", it.second).put("t", it.third) }).toString()
    }

    /** 上げた画像(新しい順、100 まで)。クイックアクセスから URL をもう一度使えるように */
    private var uploadsJson by pref("uploads", "[]")
    /** 上げた画像 1 件(url・時刻・中身のハッシュ・置き場から消すページ。ハッシュと消すページは昔の履歴にはない) */
    data class Upload(val url: String, val t: Long, val hash: String?, val deleteUrl: String? = null)
    private fun readUploads(): List<Upload> = runCatching {
        val a = org.json.JSONArray(uploadsJson)
        (0 until a.length()).map { a.getJSONObject(it).let { o -> Upload(o.getString("url"), o.getLong("t"), o.optString("h").ifEmpty { null }, o.optString("d").ifEmpty { null }) } }
    }.getOrDefault(emptyList())
    private fun writeUploads(list: List<Upload>) {
        uploadsJson = org.json.JSONArray(list.take(100).map { org.json.JSONObject().put("url", it.url).put("t", it.t).put("h", it.hash ?: "").put("d", it.deleteUrl ?: "") }).toString()
    }
    fun uploads(): List<Pair<String, Long>> = readUploads().map { it.url to it.t }
    /** 置き場から消すためのページ(imgbb の delete_url)。なければ null(置き場では消せない) */
    fun uploadDeleteUrl(url: String): String? = readUploads().firstOrNull { it.url == url }?.deleteUrl
    /** 履歴に残す。hash は中身の SHA-256(同じ画像をもう一度選んだら、上げずにこの URL を使う)。deleteUrl は置き場から消すページ(imgbb) */
    fun addUpload(url: String, hash: String? = null, deleteUrl: String? = null) {
        writeUploads(listOf(Upload(url, System.currentTimeMillis(), hash, deleteUrl)) + readUploads().filter { it.url != url })
    }
    /** 同じ中身(hash)の画像を前に上げていれば、その URL */
    fun findUploadByHash(hash: String): String? = readUploads().firstOrNull { it.hash == hash }?.url
    /** 履歴からだけ外す(置き場のファイルは残る) */
    fun removeUpload(url: String) {
        writeUploads(readUploads().filter { it.url != url })
    }
    /** 上げる前の確かめの「画像にスレタイと URL を入れる」(left / right。入れないなら空。最後に選んだものを覚える) */
    var uploadStamp by pref("uploadStamp", "")

    // スレ立ての書きかけ(板ごと)。閉じても・板を開き直しても・認証の間にアプリが閉じられても消えないように
    private var newThreadDraftsJson by pref("newThreadDrafts", "{}")

    /** 板の書きかけ(スレタイ・名前・メール・本文)。なければ null */
    fun newThreadDraft(boardUrl: String): List<String>? = runCatching {
        val o = org.json.JSONObject(newThreadDraftsJson).optJSONObject(boardUrl) ?: return null
        listOf(o.optString("title"), o.optString("name"), o.optString("mail"), o.optString("body"))
    }.getOrNull()

    /** 書きかけを覚える(スレタイも本文も空なら消す) */
    fun setNewThreadDraft(boardUrl: String, title: String, name: String, mail: String, body: String) {
        val all = runCatching { org.json.JSONObject(newThreadDraftsJson) }.getOrDefault(org.json.JSONObject())
        if (title.isEmpty() && body.isEmpty()) all.remove(boardUrl)
        else all.put(boardUrl, org.json.JSONObject().put("title", title).put("name", name).put("mail", mail).put("body", body))
        newThreadDraftsJson = all.toString()
    }

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
    /** 空行を整える(3 行以上続く空行を 1 行に)。保存の鍵は前の名前のまま */
    var tidyBlankLines by pref("collapseBlankLines", true)
    var highlightOp by pref("highlightOp", true)
    /** ID の見せ方: none(文字だけ) / color(2 回以上書いた ID を ID ごとの色に)。PC・Web の idStyle と同じ(模様はスマホにない) */
    var idStyle by pref("idStyle", "none")
    /** レスの頭の日時の出し方: md_w_hms(11/02(月) 19:01:15。既定)/ md_hm(11/02 19:01)/ full(掲示板が出したまま) */
    var dateStyle by pref("dateStyle", "md_w_hms")
    /** レスの頭の ID を短く出す(先頭の 6 文字。「ID:」も省く) */
    var idShort by pref("idShort", true)
    /** ID の位置: header(日時の後ろ)/ topRight(レスの右上)/ bottomRight(レスの右下)。PC 版の idPosition と同じ */
    var idPosition by pref("idPosition", "topRight")
    /** OS の通知に出す */
    var osNotify by pref("osNotify", false)
    /** 知らせる種類 */
    var notifyReply by pref("notifyReply", true)
    var notifyFav by pref("notifyFav", true)
    var notifyKeyword by pref("notifyKeyword", true)
    /** 閲覧履歴(既読のスレ)の新着を、この分ごとに確かめる(0 ならしない。5 分より短くはしない) */
    var historyCheckMin by pref("historyCheckMin", 0)
    /** ワッチョイを短く出す(「(ワッチョイ 1a2b-3c4d)」→「(1a2b-3c4d)」) */
    var watchoiShort by pref("watchoiShort", true)
    /** アイコン(Discord 風・LINE 風)の種を、ワッチョイがあればワッチョイから(ID は日ごと、ワッチョイは週ごとに変わる) */
    var iconFromWatchoi by pref("iconFromWatchoi", true)
    /** 動きを減らす(画面の移り方・新着の光り方・数字の繰り上がりを省く)。端末の「アニメーションを削除」でも同じになる */
    var reduceMotion by pref("reduceMotion", false)
    /** 字(Fonts.CHOICES のキー)。空なら端末の標準 */
    var font by pref("font", "")
    /** 自分で作った配色(CustomDef の JSON)。空なら作っていない */
    var customScheme by pref("customScheme", "")
    /** 設定で、詳しい項目も出す */
    var showAdvanced by pref("showAdvanced", false)
    /** 本文のアンカーを押したら、ポップアップではなくその下に差し込む */
    var anchorInline by pref("anchorInline", false)
    /** 画面の下に「履歴・未読・スレ・板」のタブ(2ch Mate 風) */
    var bottomTabs by pref("bottomTabs", false)
    /** 過去のスレの画面で最後に見たタブ(unread / history / fav / posts) */
    var pastTab by pref("pastTab", "history")
    /** 返信の連なりの起点のレスの下に「この会話 (N)」を出す */
    var showConversations by pref("showConversations", false)
    /** NG のレスの見せ方: fold(あぼーん 1 行)/ hide(透明あぼーん)/ dim(薄く表示) */
    var ngStyle by pref("ngStyle", "fold")
    /** レスをダブルタップで返信(>>番号 を入れて書き込み欄を開く) */
    var doubleTapReply by pref("doubleTapReply", false)
    var showMinimap by pref("showMinimap", true)
    /** 人気のレスの示し方: left(左の帯)/ right(右の帯)/ text(本文の色)/ none */
    var heatStyle by pref("heatStyle", "left")
    /** URL を短く見せる(https:// を外し、長いものは省く。画像の URL は「画像」の札にし、続いたものはまとめる) */
    var urlShorten by pref("urlShorten", true)
    var showLinkPreview by pref("showLinkPreview", true)
    var openLinksInApp by pref("openLinksInApp", true)

    // ── 画像と動画 ──
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
    var quickPhrases by pref("quickPhrases", "")
    /** hono-bbs のアカウント(ユーザー ID とパスワード。設定 → サイトごとの設定)。空なら使わない。パスワードはそのまま保存する(PC 版と同じ) */
    var honoUser by pref("honoUser", "")
    var honoPassword by pref("honoPassword", "")
    // 画像のアップロード(上げ先が選んであれば使える。EXIF はいつも取り除く)
    /** 上げる前に縮める、長い辺の大きさ(px。0 なら縮めない) */
    var uploadMaxDimension by pref("uploadMaxDimension", 4096)
    /** 画像の上げ先(data/Uploader.kt の HOSTS): imgur-web(既定)/ imgur / catbox / imgbb / imgbox-web / imgbb-web。hono-bbs の板は、いつもその掲示板の置き場 */
    var uploadHost by pref("uploadHost", Uploader.DEFAULT_HOST)
    /** imgbb の API キー(https://api.imgbb.com/)。空なら imgbb は使わない */
    var imgbbApiKey by pref("imgbbApiKey", "")
    /** 最初から入れておく掲示板・板(assets の sites.json)のうち、もう足したものの id(カンマ区切り)。本人が消したものを戻さないために覚える */
    var presetsApplied by pref("presetsApplied", "")
    /** imgur の Client-ID(https://api.imgur.com/oauth2/addclient で登録したもの)。空なら imgur は使わない */
    var imgurClientId by pref("imgurClientId", "")

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
        val defaults = DEFAULT_GESTURES.getValue(screen)
        if (json.isEmpty()) return defaults
        // 保存した割り当てを既定に重ねる(あとから足した向きの並びも、既定の操作で使えるように)
        return defaults + runCatching { JSONObject(json).let { o -> o.keys().asSequence().associateWith { o.getString(it) } } }.getOrDefault(emptyMap())
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

    var ngRules by mutableStateOf(loadNg())
        private set
    /** NG を足す(同じもの = 種類・文字・正規表現か・効く板が同じ、は重ねない)。同じ id のものがあれば差し替える(直したとき) */
    fun addNg(rule: NgRule) {
        if (rule.pattern.isBlank()) return
        if (ngRules.any { it.id == rule.id }) saveNg(ngRules.map { if (it.id == rule.id) rule else it })
        else if (ngRules.none { it.sameAs(rule) }) saveNg(ngRules + rule)
    }
    fun removeNg(rule: NgRule) = saveNg(ngRules.filter { it.id != rule.id })
    /** NG をまとめて置き換える(まとめて削除・期限切れの片づけなど) */
    fun setNg(list: List<NgRule>) = saveNg(list)

    private fun loadNg(): List<NgRule> = runCatching {
        val arr = JSONArray(sp.getString("ngRules", "[]"))
        List(arr.length()) { NgRule.fromJson(arr.getJSONObject(it)) }
    }.getOrDefault(emptyList())

    private fun saveNg(list: List<NgRule>) {
        ngRules = list
        val arr = JSONArray()
        for (r in list) arr.put(r.toJson())
        sp.edit().putString("ngRules", arr.toString()).apply()
    }

    /** AI NG(data/AiNg.kt)。オンのときだけモデルを取って動かす */
    var aiNgEnabled by pref("aiNgEnabled", false)
    var aiNgRules by mutableStateOf(loadAiRules())
        private set
    var aiNgOverrides by mutableStateOf(loadAiOverrides())
        private set

    fun setAiRules(list: List<AiNgRule>) {
        aiNgRules = list
        sp.edit().putString("aiNgRules", JSONArray().apply { for (r in list) put(r.toJson()) }.toString()).apply()
    }

    fun setAiOverrides(map: Map<String, AiNgOverride>) {
        aiNgOverrides = map
        sp.edit().putString("aiNgOverrides", JSONObject().apply { for ((k, v) in map) put(k, v.toJson()) }.toString()).apply()
    }

    private fun loadAiRules(): List<AiNgRule> = sp.getString("aiNgRules", null)?.let { s ->
        runCatching { JSONArray(s).let { a -> List(a.length()) { AiNgRule.fromJson(a.getJSONObject(it)) } } }.getOrNull()
    } ?: AiNgRule.SAMPLES

    private fun loadAiOverrides(): Map<String, AiNgOverride> = runCatching {
        val o = JSONObject(sp.getString("aiNgOverrides", "{}") ?: "{}")
        o.keys().asSequence().associateWith { AiNgOverride.fromJson(o.getJSONObject(it)) }
    }.getOrDefault(emptyMap())

    /** 板ごとの設定(板の URL → 設定)。PC 版・Web の settings.boardMeta と同じ項目 */
    var boardMeta by mutableStateOf(loadBoardMeta())
        private set

    /** 板の設定を入れる。全部空なら消す */
    fun setBoardMeta(url: String, m: BoardMeta) {
        val next = if (m.isEmpty) boardMeta - url else boardMeta + (url to m)
        boardMeta = next
        val o = JSONObject()
        for ((u, v) in next) o.put(u, v.toJson())
        sp.edit().putString("boardMeta", o.toString()).apply()
    }

    private fun loadBoardMeta(): Map<String, BoardMeta> = runCatching {
        val o = JSONObject(sp.getString("boardMeta", "{}") ?: "{}")
        o.keys().asSequence().associateWith { BoardMeta.fromJson(o.getJSONObject(it)) }
    }.getOrDefault(emptyMap())

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
            "list" to mapOf("right" to "drawer", "left" to "forward", "right,up" to "bottom", "right,down" to "top", "left,down" to "refresh", "left,up" to "newThread", "left,right" to "quick", "right,left" to "quick"),
            "thread" to mapOf("right" to "back", "left" to "reply", "right,up" to "bottom", "right,down" to "top", "left,down" to "refresh", "left,up" to "deleteLog", "left,right" to "quick", "right,left" to "quick"),
        )
    }
}
