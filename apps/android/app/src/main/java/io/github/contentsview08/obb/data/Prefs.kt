package io.github.contentsview08.obb.data

import android.content.Context
import android.content.SharedPreferences
import io.github.contentsview08.obb.sync.adapters.AllowedSetting
import io.github.contentsview08.obb.sync.adapters.BOARD_META_KEY
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import kotlin.properties.ReadWriteProperty
import kotlin.reflect.KProperty

/** 画像のサムネイル: いつも読む / Wi-Fi のときだけ / 押したら読む / 出さない */
enum class ThumbMode(val label: String) {
    ALWAYS("いつも"), WIFI("Wi-Fi のときだけ"), TAP("押したら"), NEVER("出さない");

    /** 保存する値(PC の thumbLoad と同じ) */
    val key get() = name.lowercase()
}

/** 履歴の画面のタブ(キーと名前)。PC・Web の PastTab と同じ */
val PAST_TABS = listOf("unread" to "未読", "history" to "閲覧", "fav" to "お気に入り", "posts" to "書き込み", "uploads" to "画像")

/** 保存した並びのうち、いま出せるタブ。バックアップなどで 1 つも残らなければ全部を出す(履歴の画面からタブが消えないように) */
fun shownPastTabs(saved: String): List<String> {
    val known = PAST_TABS.map { it.first }
    return saved.split(',').filter { it in known }.distinct().ifEmpty { known }
}

/**
 * 見た目ごとの設定(bbs-suite の docs/style-tree.md)。既定は今までの動きと同じ。
 * tree: ツリー表示(カード・専ブラ風・まとめ風)。treeDepth: 字下げの深さの上限。
 * quote: 返信先の引用(line = 1 行 / full = 全文 / none = 出さない。Discord 風・LINE 風)。group: 続けて書いたレスをまとめる(Discord 風・LINE 風。保存の名前は PC と同じ groupRuns)
 */
data class StyleOptions(val tree: Boolean = false, val treeDepth: Int = TREE_DEPTH_DEFAULT, val quote: String = "line", val group: Boolean = true)

/** 字下げの深さの上限の既定と幅(スマホ。PC は 6) */
const val TREE_DEPTH_DEFAULT = 3
val TREE_DEPTH_RANGE = 1..10

/** 返信先の引用の出し方(キーと名前) */
val QUOTE_MODES = listOf("line" to "1 行", "full" to "全文", "none" to "出さない")

/** 覚えた JSON から、その見た目の設定。壊れた値・知らない値は既定に戻す */
fun styleOptionsOf(json: String, style: String): StyleOptions {
    val o = runCatching { JSONObject(json).optJSONObject(style) }.getOrNull() ?: return StyleOptions()
    val d = StyleOptions()
    return StyleOptions(
        tree = o.optBoolean("tree", d.tree),
        treeDepth = o.optInt("treeDepth", d.treeDepth).coerceIn(TREE_DEPTH_RANGE),
        quote = o.optString("quote", d.quote).takeIf { q -> QUOTE_MODES.any { it.first == q } } ?: d.quote,
        group = o.optBoolean("groupRuns", d.group),
    )
}

/** その見た目の設定だけを書き換えた JSON(ほかの見た目の値は残す) */
fun withStyleOptions(json: String, style: String, o: StyleOptions): String {
    val all = runCatching { JSONObject(json) }.getOrDefault(JSONObject())
    all.put(style, JSONObject().put("tree", o.tree).put("treeDepth", o.treeDepth).put("quote", o.quote).put("groupRuns", o.group))
    return all.toString()
}

/** 表示スタイルのシートのタブ。前の look(スキン)は配色に読み替え、出せないタブなら最初のタブ */
fun styleTabOf(saved: String, tabs: List<String>): String = (if (saved == "look") "color" else saved).takeIf { it in tabs } ?: tabs.first()

/** 設定を Compose の状態にしつつ SharedPreferences に書く(変えたらすぐ画面に出て、閉じても残る) */
private class Pref<T>(private val sp: SharedPreferences, private val key: String, def: T, private val changed: (String, Any?) -> Unit) : ReadWriteProperty<Any?, T> {
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
        val before = state.value
        write(value)
        if (before != value) changed(key, before)
    }

    /** 同期の適用。利用者の操作ではないので知らせない(知らせると送り返してしまう) */
    @Suppress("UNCHECKED_CAST")
    fun setRemote(value: Any?) = write(value as T)

    private fun write(value: T) {
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

/** PC では string[] の項目。保存は同じ JSON の配列で、画面には sep でつないだ文字で渡す */
private class WordsPref(private val inner: ReadWriteProperty<Any?, String>, private val sep: String, private val def: String) : ReadWriteProperty<Any?, String> {
    override fun getValue(thisRef: Any?, property: KProperty<*>): String = joinedWords(inner.getValue(thisRef, property), sep, def)
    override fun setValue(thisRef: Any?, property: KProperty<*>, value: String) = inner.setValue(thisRef, property, wordsJson(value, sep))
}

/**
 * 設定(端末の SharedPreferences)。画面から見る値は Compose の状態にして、変えたらすぐ画面に出る。
 * 端末をまたいで意味のある項目は、保存の名前・単位・JSON を apps/desktop/src/ui/settings.ts の AppSettings と同じにする
 */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    /** 小数の設定の名前。バックアップの 1.0 は JSON で 1 になるので、戻すときの型をこれで決める */
    private val floatKeys = HashSet<String>()
    /** いまある設定の名前。バックアップにはこれだけを入れ、これだけを戻す */
    private val knownKeys = hashSetOf("ngRules", "aiNgRules", "aiNgOverrides", "boardMeta")
    private val prefByKey = HashMap<String, Pref<*>>()

    /** 利用者が設定を変えた(名前と前の値)。同期の適用とバックアップの読み込みからは呼ばない */
    var onSettingChange: ((String, Any?) -> Unit)? = null

    private fun <T> pref(key: String, def: T): ReadWriteProperty<Any?, T> {
        if (def is Float) floatKeys += key
        knownKeys += key
        return Pref(sp, key, def) { k, before -> onSettingChange?.invoke(k, before) }.also { prefByKey[key] = it }
    }
    private fun wordsPref(key: String, def: List<String>, sep: String): ReadWriteProperty<Any?, String> =
        WordsPref(pref(key, JSONArray(def).toString()), sep, def.joinToString(sep))

    var lastBoardUrl: String?
        get() = sp.getString("lastBoardUrl", null)
        set(v) = sp.edit().putString("lastBoardUrl", v).apply()
    var lastBoardName: String?
        get() = sp.getString("lastBoardName", null)
        set(v) = sp.edit().putString("lastBoardName", v).apply()

    // ── テーマと文字 ──
    /** 配色(Palette の SCHEMES のキー) */
    var scheme by pref("scheme", "indigo")
    /** 同期の間隔(SyncConfig.SYNC_INTERVALS の id)。端末ごとの設定で、同期の許可の一覧に入れない */
    var syncInterval by pref("syncInterval", io.github.contentsview08.obb.sync.SyncConfig.DEFAULT_SYNC_INTERVAL)
    /** スマホのダーク・ライトに合わせる(合わせるときは darkScheme / lightScheme を使う) */
    var followOsTheme by pref("followOsTheme", true)
    var darkScheme by pref("darkScheme", "soft-dark")
    /** 差し色(ACCENTS のキー)。空ならテーマの色 */
    var accent by pref("accent", "")
    var lightScheme by pref("lightScheme", "light-gray")
    /** レスの見た目(ui/PostRender.kt の POST_STYLES のキー) */
    var postStyle by pref("postStyle", "card")
    /** 基本の文字(px)。メニュー・ボタン・ポップアップなどの部品の字 */
    var mobileFontPx by pref("mobileFontPx", MOBILE_FONT_PX)
    var fontScale: Float
        get() = baseScaleOfPx(mobileFontPx)
        set(v) { mobileFontPx = basePxOfScale(v) }
    /** レスの本文の文字(px。0 なら既定) */
    var postBodyPx by pref("postBodyPx", 0)
    var bodyScale: Float
        get() = scaleOfPx(postBodyPx, POST_BODY_BASE_PX)
        set(v) { postBodyPx = pxOfScale(v, POST_BODY_BASE_PX) }
    /** レスの本文の行間(字の高さの倍。0 なら既定) */
    var postLineHeight by pref("postLineHeight", 0f)
    var lineHeight: Float
        get() = if (postLineHeight > 0f) postLineHeight else POST_LINE_HEIGHT
        set(v) { postLineHeight = if (v == POST_LINE_HEIGHT) 0f else v }
    /** レスの頭(名前・日付・ID)の文字(px。0 なら既定) */
    var postHeadPx by pref("postHeadPx", 0)
    var postHeadScale: Float
        get() = scaleOfPx(postHeadPx, POST_HEAD_BASE_PX)
        set(v) { postHeadPx = pxOfScale(v, POST_HEAD_BASE_PX) }
    /** レスの上下の余白(px。-1 なら既定) */
    var postPadPx by pref("postPadPx", -1)
    var postPad: Int
        get() = orDefault(postPadPx, -1, POST_PAD_PX)
        set(v) { postPadPx = orUnset(v, -1, POST_PAD_PX) }
    /** スレ一覧の文字(px。0 なら既定) */
    var listFontPx by pref("listFontPx", 0)
    var listFontScale: Float
        get() = scaleOfPx(listFontPx, LIST_FONT_BASE_PX)
        set(v) { listFontPx = pxOfScale(v, LIST_FONT_BASE_PX) }
    /** スレ一覧のスレの上下の余白(px。-1 なら既定) */
    var listPadPx by pref("listPadPx", -1)
    var listPad: Int
        get() = orDefault(listPadPx, -1, LIST_PAD_PX)
        set(v) { listPadPx = orUnset(v, -1, LIST_PAD_PX) }
    /** ヘッダー・フッターの高さ(px。0 なら既定)と文字(px。0 なら基本の文字のまま) */
    var headerPx by pref("headerPx", 0)
    var headerHeight: Int
        get() = orDefault(headerPx, 0, HEADER_PX)
        set(v) { headerPx = orUnset(v, 0, HEADER_PX) }
    var footerPx by pref("footerPx", 0)
    var footerHeight: Int
        get() = orDefault(footerPx, 0, FOOTER_PX)
        set(v) { footerPx = orUnset(v, 0, FOOTER_PX) }

    // ── スレ一覧 ──
    /** 板を開いたときの並び: subject(更新順)/ momentum / newest / count */
    var threadSort by pref("threadSort", "subject")
    /** 一度見たことがあり新着レスのあるスレを、今の並びのまま一覧の上にまとめる */
    var unreadFirst by pref("unreadFirst", false)
    /** スレタイにこの言葉が入っているスレを、一覧の上にまとめる(改行区切り) */
    var keywords by wordsPref("keywords", emptyList(), "\n")
    /** 立てた人のキーワード(ThreadSummary.authorId。改行区切り)。この人が立てたスレを、スレタイのキーワードの後の帯にまとめ、通知もする */
    var keywordAuthors by wordsPref("keywordAuthors", emptyList(), "\n")
    /** スレ一覧の行の形: normal / compact(スレタイ 1 行と数だけ) */
    var listShape by pref("listShape", "normal")
    /** 最近開いた板(新しい順、30 まで)。クイックアクセスで使う */
    private var recentBoardsJson by pref("recentBoards", "[]")
    fun recentBoards(): List<Triple<String, String, Long>> = runCatching {
        val a = JSONArray(recentBoardsJson)
        (0 until a.length()).map { a.getJSONObject(it).let { o -> Triple(o.getString("url"), o.getString("name"), o.getLong("t")) } }
    }.getOrDefault(emptyList())
    fun addRecentBoard(url: String, name: String) {
        val list = listOf(Triple(url, name, System.currentTimeMillis())) + recentBoards().filter { it.first != url }
        recentBoardsJson = JSONArray(list.take(30).map { JSONObject().put("url", it.first).put("name", it.second).put("t", it.third) }).toString()
    }

    /** 上げる前の確かめの「画像にスレタイと URL を入れる」(left / right。入れないなら空。最後に選んだものを覚える) */
    var uploadStamp by pref("uploadStamp", "")

    // スレ立ての書きかけ(板ごと)。閉じても・板を開き直しても・認証の間にアプリが閉じられても消えないように
    private var newThreadDraftsJson by pref("newThreadDrafts", "{}")

    /** 板の書きかけ(スレタイ・名前・メール・本文)。なければ null */
    fun newThreadDraft(boardUrl: String): List<String>? = runCatching {
        val o = JSONObject(newThreadDraftsJson).optJSONObject(boardUrl) ?: return null
        listOf(o.optString("title"), o.optString("name"), o.optString("mail"), o.optString("body"))
    }.getOrNull()

    /** 書きかけを覚える(スレタイも本文も空なら消す) */
    fun setNewThreadDraft(boardUrl: String, title: String, name: String, mail: String, body: String) {
        val all = runCatching { JSONObject(newThreadDraftsJson) }.getOrDefault(JSONObject())
        if (title.isEmpty() && body.isEmpty()) all.remove(boardUrl)
        else all.put(boardUrl, JSONObject().put("title", title).put("name", name).put("mail", mail).put("body", body))
        newThreadDraftsJson = all.toString()
    }

    /** 板ごとに、前回スレ一覧を取った時刻(「新」の印の境目)。JSON */
    private var boardVisitsJson by pref("boardVisits", "{}")
    fun boardVisit(url: String): Long? = runCatching { JSONObject(boardVisitsJson).optLong(url, 0L).takeIf { it > 0 } }.getOrNull()
    fun setBoardVisit(url: String, t: Long) { boardVisitsJson = runCatching { JSONObject(boardVisitsJson) }.getOrDefault(JSONObject()).put(url, t).toString() }
    /** 一覧の下に出すタブと並び(カンマ区切り。unread / visited / momentum / newest / count) */
    var listTabs by wordsPref("listTabs", listOf("unread", "momentum", "newest"), ",")
    /** 履歴の画面に出すタブと並び(カンマ区切り。PAST_TABS のキー) */
    var pastTabs by wordsPref("pastTabs", PAST_TABS.map { it.first }, ",")
    /** 履歴の画面のタブの置き場: footer / header */
    var pastTabsPosition by pref("pastTabsPosition", "footer")
    /** 開いていないスレのログを消すまでの日数(0 なら消さない) */
    var logRetentionDays by pref("logRetentionDays", 90)

    // ── スレ表示 ──
    /** 開く位置: unread(最初の未読)/ top / bottom */
    var openPosition by pref("openPosition", "unread")
    var omitNoname by pref("omitNoname", false)
    /** 空行を整える(3 行以上続く空行を 1 行に) */
    var tidyBlankLines by pref("tidyBlankLines", true)
    var highlightOp by pref("highlightOp", true)
    /** ID の見せ方: none(文字だけ) / color(2 回以上書いた ID を ID ごとの色に)。PC・Web の idStyle と同じ(模様はスマホにない) */
    var idStyle by pref("idStyle", "none")
    /** レスの頭の日時の出し方: md_w_hms(11/02(月) 19:01:15。既定)/ md_hm(11/02 19:01)/ full(掲示板が出したまま) */
    var dateStyle by pref("dateStyle", "md_hm")
    /** レスの頭の ID を短く出す(先頭の 6 文字。「ID:」も省く) */
    var idShort by pref("idShort", false)
    /** ID の位置: header(日時の後ろ)/ topRight(レスの右上)/ bottomRight(レスの右下)。PC 版の idPosition と同じ */
    var idPosition by pref("idPosition", "topRight")
    /** OS の通知に出す */
    var osNotify by pref("osNotify", false)
    /** 知らせる種類(PC の notifyKinds と同じ。ないものはオン) */
    private var notifyKindsJson by pref("notifyKinds", "{}")
    private fun notifyKind(kind: String) = runCatching { JSONObject(notifyKindsJson).optBoolean(kind, true) }.getOrDefault(true)
    private fun setNotifyKind(kind: String, on: Boolean) { notifyKindsJson = runCatching { JSONObject(notifyKindsJson) }.getOrDefault(JSONObject()).put(kind, on).toString() }
    var notifyReply: Boolean
        get() = notifyKind("reply")
        set(v) = setNotifyKind("reply", v)
    var notifyFav: Boolean
        get() = notifyKind("fav")
        set(v) = setNotifyKind("fav", v)
    var notifyKeyword: Boolean
        get() = notifyKind("keyword")
        set(v) = setNotifyKind("keyword", v)
    /** 閲覧履歴(既読のスレ)の新着を、この分ごとに確かめる(0 ならしない。5 分より短くはしない) */
    var historyCheckMin by pref("historyCheckMin", 0)
    /** お気に入りのスレの新着の数を、アプリを開いている間この分ごとに確かめる(0 ならしない)。PC 版と同じ既定 */
    var favCheckMin by pref("favCheckMin", 5)
    /** キーワードに合うスレを、アプリを開いている間この分ごとに確かめる(0 ならしない。OS の通知がオンでキーワードがあるときだけ見に行く)。PC 版と同じ既定 */
    var keywordWatchMin by pref("keywordWatchMin", 10)
    /** ワッチョイを短く出す(「(ワッチョイ 1a2b-3c4d)」→「(1a2b-3c4d)」) */
    var watchoiShort by pref("watchoiShort", true)
    /** 名前欄(ワッチョイ込み)を日付・ID と同じ薄い色・大きさにする */
    var nameSubtle by pref("nameSubtle", true)
    /** アイコン(Discord 風・LINE 風)の種を、ワッチョイがあればワッチョイから(ID は日ごと、ワッチョイは週ごとに変わる) */
    var iconFromWatchoi by pref("iconFromWatchoi", true)
    /** 動きを減らす(画面の移り方・新着の光り方・数字の繰り上がりを省く)。端末の「アニメーションを削除」でも同じになる */
    var reduceMotion by pref("reduceMotion", false)
    /** 字(Fonts.CHOICES のキー。PC の fontFamily と同じ名前)。Fonts.SYSTEM なら端末の標準 */
    var fontFamily by pref("fontFamily", Fonts.SYSTEM)
    /** 自分で作った配色(CustomDef の JSON)。空なら作っていない */
    var customScheme by pref("customScheme", "")
    /** 設定で、詳しい項目も出す */
    var showAdvanced by pref("showAdvanced", false)
    /** 過去のスレの画面で最後に見たタブ(unread / history / fav / posts) */
    var pastTab by pref("pastTab", "history")
    /** 表示スタイルのシートで最後に見たタブ(color / style / size / post)。端末ごとの状態なので同期しない。前の look(スキン)は配色に読み替える(styleTabOf) */
    var styleTab by pref("styleTab", "color")
    /** 見た目ごとの設定(見た目のキー → StyleOptions の JSON。名前と中身は PC の styleOptions と同じ)。見た目ごとに別々に覚える。表示の設定と同じく端末ごとで、同期の許可の一覧に入れない */
    private var postStyleOptionsJson by pref("styleOptions", "{}")
    fun styleOptions(style: String): StyleOptions = styleOptionsOf(postStyleOptionsJson, style)
    fun setStyleOptions(style: String, o: StyleOptions) { postStyleOptionsJson = withStyleOptions(postStyleOptionsJson, style, o) }
    /** NG のレスの見せ方: aborn(あぼーん 1 行)/ hide(透明あぼーん)/ dim(薄く表示。スマホだけ) */
    var ngMode by pref("ngMode", "aborn")
    /** 2 つ以上続いたあぼーんを 1 行にまとめる(PC 版と同じ既定) */
    var groupNg by pref("groupNg", true)
    /** レスをダブルタップで返信(>>番号 を入れて書き込み欄を開く) */
    var doubleTapReply by pref("doubleTapReply", false)
    var showMinimap by pref("showMinimap", true)
    /** 人気のレスの示し方: left(左の帯)/ right(右の帯)/ text(本文の色) */
    var heatStyle by pref("heatStyle", "left")
    /** URL を短く見せる(https:// を外し、長いものは省く。画像の URL は「画像」の札にし、続いたものはまとめる) */
    var urlShorten by pref("urlShorten", true)
    /** スレが終わったとき(dat 落ち・上限到達)、一番下に次スレの候補を出す。︙ の「次スレを探す」はオフでも使える */
    var showNextCandidatesAtEnd by pref("showNextCandidatesAtEnd", true)
    /** スレの一番下に「次の未読スレへ」を出す */
    var showNextUnreadAtEnd by pref("showNextUnreadAtEnd", true)
    var showLinkPreview by pref("showLinkPreview", true)
    var openLinksInApp by pref("openLinksInApp", true)

    // ── 画像と動画 ──
    private var thumbLoad by pref("thumbLoad", ThumbMode.WIFI.key)
    var thumbMode: ThumbMode
        get() = ThumbMode.entries.firstOrNull { it.key == thumbLoad } ?: ThumbMode.WIFI
        set(v) { thumbLoad = v.key }
    /** サムネイルの大きさ(px) */
    var postThumbSize by pref("postThumbSize", 96)
    var blurGross by pref("blurGross", true)
    /** グロ注意とみなす言葉(改行区切り) */
    var grossWords by wordsPref("grossWords", listOf("グロ"), "\n")

    // ── 書き込み ──
    /** 書き込みの名前・メール(前回のもの) */
    var postName by pref("postName", "")
    var postMail by pref("postMail", "")
    /** 定型文(長押しの「すぐ書き込む」。改行区切り) */
    var quickPhrases by wordsPref("quickPhrases", emptyList(), "\n")
    /** 定型文を 1 行ずつ(空の行は除く) */
    val quickPhraseList: List<String> get() = quickPhrases.lines().map { it.trim() }.filter { it.isNotEmpty() }
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
    /** 最初から入れておく掲示板・板(assets の sites.json)のうち、もう足したものの id(カンマ区切りで渡す)。利用者が消したものを戻さないために覚える */
    var presetsApplied by wordsPref("presetsApplied", emptyList(), ",")
    /** imgur の Client-ID(https://api.imgur.com/oauth2/addclient で登録したもの)。空なら imgur は使わない */
    var imgurClientId by pref("imgurClientId", "")

    // ── 操作 ──
    var gesturesEnabled by pref("gesturesEnabled", true)
    /** 操作が決まったときなどに軽く振動する */
    var haptics by pref("haptics", true)
    /** なぞる操作の感度(1 鈍い〜5 敏感) */
    var gestureSensitivity by pref("gestureSensitivity", 3)
    /** なぞる操作の割り当て(PC の swipeGestures と同じ形。{list: {向き: 操作}, thread: {…}}) */
    private var swipeGesturesJson by pref("swipeGestures", "")
    var hideBarsOnScroll by pref("hideBarsOnScroll", true)
    /** ログを削除する前に確かめる(確かめる画面の「次回から表示しない」で切れる) */
    var confirmDeleteLog by pref("confirmDeleteLog", true)
    var autoScrollOnNew by pref("autoScrollOnNew", true)
    /** 実況モードの更新の間隔(秒)と流す速さ(1 秒に流す本文の行。ui/LiveMode.kt)。端末ごとの操作の好みなので同期しない */
    var liveRefreshSec by pref("liveRefreshSec", 5)
    var liveSpeed by pref("liveSpeed", 2f)
    /** 開いているスレの自動更新(秒。0 ならしない) */
    var autoRefreshSec by pref("autoRefreshSec", 0)
    var showRefreshFab by pref("showRefreshFab", true)

    /** なぞる操作の割り当て(向きの並び → 操作)。screen は list / thread */
    fun gestures(screen: String): Map<String, String> {
        val defaults = DEFAULT_GESTURES.getValue(screen)
        // 保存した割り当てを既定に重ねる(あとから足した向きの並びも、既定の操作で使えるように)
        return defaults + runCatching { JSONObject(swipeGesturesJson).getJSONObject(screen).let { o -> o.keys().asSequence().associateWith { o.getString(it) } } }.getOrDefault(emptyMap())
    }

    fun setGesture(screen: String, seq: String, action: String) {
        val all = runCatching { JSONObject(swipeGesturesJson) }.getOrDefault(JSONObject())
        swipeGesturesJson = all.put(screen, JSONObject(gestures(screen).toMutableMap().apply { put(seq, action) } as Map<*, *>)).toString()
    }

    fun resetGestures() { swipeGesturesJson = "" }

    var ngRules by mutableStateOf(loadNg())
        private set
    /** NG を足す(同じもの = 種類・文字・正規表現か・効く板が同じ、は重ねない)。同じ id のものがあれば差し替える(直したとき)。変えたら true */
    @Synchronized
    fun addNg(rule: NgRule): Boolean {
        if (rule.pattern.isBlank()) return false
        if (ngRules.any { it.id == rule.id }) saveNg(ngRules.map { if (it.id == rule.id) rule else it })
        else if (ngRules.none { it.sameAs(rule) }) saveNg(ngRules + rule)
        else return false
        return true
    }
    @Synchronized
    fun removeNg(rule: NgRule) = saveNg(ngRules.filter { it.id != rule.id })
    /** 期限切れの片づけ。手元からだけ消す */
    @Synchronized
    fun dropExpiredNg(today: String) = saveNg(ngRules.filter { it.expiresOnDate == null || it.expiresOnDate >= today })

    /** 同期の適用。今の値に重ねて、操作として積まない */
    @Synchronized
    fun applyRemoteNg(diff: NgDiff) = saveNg(applyNgDiff(ngRules, diff))

    /** バックアップから戻した値を読み直す。戻す前の配列を返す */
    @Synchronized
    fun reloadNg(): List<NgRule> {
        val before = ngRules
        ngRules = loadNg()
        return before
    }

    private fun loadNg(): List<NgRule> = runCatching {
        val arr = JSONArray(sp.getString("ngRules", "[]"))
        val list = List(arr.length()) { NgRule.fromJson(arr.getJSONObject(it)) }
        // id のない古い行は読むたびに新しい id になり、同期で別のレコードに見えるので、一度決めたら残す
        if ((0 until arr.length()).any { arr.getJSONObject(it).optString("id").isEmpty() }) sp.edit().putString("ngRules", JSONArray().apply { for (r in list) put(r.toJson()) }.toString()).apply()
        list
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
    @Synchronized
    fun setBoardMeta(url: String, m: BoardMeta) {
        val before = boardMetaFields()
        saveBoardMeta(if (m.isEmpty) boardMeta - url else boardMeta + (url to m))
        onSettingChange?.invoke(BOARD_META_KEY, before)
    }

    private fun saveBoardMeta(next: Map<String, BoardMeta>) {
        boardMeta = next
        val o = JSONObject()
        for ((u, v) in next) o.put(u, v.toJson())
        sp.edit().putString("boardMeta", o.toString()).apply()
    }

    /** 板ごとの同期する項目。名前欄・メール欄の既定値は出さない */
    fun boardMetaFields(): Map<String, Map<String, Any?>> = boardMeta.mapValues { it.value.syncFields() }

    /** 同期の適用。許可された項目だけを今の値に重ね、操作として積まない。何もなくなれば消す */
    @Synchronized
    fun applyRemoteBoardMeta(changes: Map<String, Map<String, Any?>>) {
        val next = LinkedHashMap(boardMeta)
        for ((url, remote) in changes) {
            val merged = (next[url] ?: BoardMeta()).withSyncFields(remote)
            if (merged.isEmpty) next.remove(url) else next[url] = merged
        }
        saveBoardMeta(next)
    }

    /** 保存したことのない項目は null。settings 表に行がないのと同じ扱いにする */
    fun syncedValue(item: AllowedSetting): Any? {
        if (!sp.contains(item.name)) return null
        return runCatching {
            when (item.type) {
                "bool" -> sp.getBoolean(item.name, false)
                "enum" -> sp.getString(item.name, null)
                "words" -> wordsOfJson(sp.getString(item.name, null).orEmpty())
                else -> null
            }
        }.getOrNull()
    }

    /** 同期の適用。Compose の状態を変えるが、操作として積まない */
    fun applyRemote(item: AllowedSetting, value: Any?) {
        // 薄く表示はスマホだけの値で送れない。別の端末の値で上書きしない
        if (item.name == "ngMode" && ngMode == "dim") return
        @Suppress("UNCHECKED_CAST")
        val stored: Any? = if (item.type == "words") JSONArray(value as List<String>).toString() else value
        prefByKey[item.name]?.setRemote(stored)
    }

    private fun loadBoardMeta(): Map<String, BoardMeta> = runCatching {
        val o = JSONObject(sp.getString("boardMeta", "{}") ?: "{}")
        o.keys().asSequence().associateWith { BoardMeta.fromJson(o.getJSONObject(it)) }
    }.getOrDefault(emptyMap())

    /** バックアップ: 設定を JSON に(最後に開いた板と秘密の値は除く) */
    fun export(): JSONObject = exportedSettings(sp.all, knownKeys)

    /** バックアップから戻す(戻したあとはアプリを開き直すと全部に効く)。commit はディスクに書くので IO で */
    suspend fun import(o: JSONObject) = withContext(Dispatchers.IO) {
        val e = sp.edit()
        for ((k, v) in restoredSettings(o, floatKeys)) {
            if (k !in knownKeys) continue
            when (v) {
                is Boolean -> e.putBoolean(k, v)
                is Int -> e.putInt(k, v)
                is Float -> e.putFloat(k, v)
                is String -> e.putString(k, v)
            }
        }
        e.commit()
    }

    companion object {
        /**
         * バックアップに入れない項目: 最後に開いた板と、アカウント・API キー(ファイルは人に渡したりクラウドに置いたりするので)、
         * 端末だけの状態・書きかけ(板を開いた回数・最近の板・スレ立ての下書き。PC の utils/backup.ts も boardVisits を除く)
         */
        private val NOT_IN_BACKUP = setOf(
            "lastBoardUrl", "lastBoardName", "honoUser", "honoPassword", "imgbbApiKey", "imgurClientId",
            "boardVisits", "recentBoards", "newThreadDrafts",
        )

        internal fun inBackup(key: String) = key !in NOT_IN_BACKUP

        /** 文字列に JSON を入れて持つ項目。バックアップでは PC と同じく JSON のまま書く */
        internal val JSON_KEYS = setOf(
            "ngRules", "aiNgRules", "aiNgOverrides", "boardMeta", "boardVisits", "keywords", "keywordAuthors", "grossWords", "quickPhrases",
            "listTabs", "pastTabs", "presetsApplied", "notifyKinds", "swipeGestures", "recentBoards", "newThreadDrafts",
        )

        /** なぞる操作の既定 */
        val DEFAULT_GESTURES = mapOf(
            "list" to mapOf("right" to "drawer", "left" to "forward", "right,up" to "bottom", "right,down" to "top", "left,down" to "refresh", "left,up" to "newThread", "left,right" to "quick", "right,left" to "quick"),
            "thread" to mapOf("right" to "back", "left" to "reply", "right,up" to "bottom", "right,down" to "top", "left,down" to "refresh", "left,up" to "deleteLog", "left,right" to "quick", "right,left" to "quick"),
        )
    }
}
