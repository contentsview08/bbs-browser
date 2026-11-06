package io.github.contentsview08.obb.bbs

import io.github.contentsview08.obb.data.Http
import io.github.contentsview08.obb.data.HttpResponse

// したらば(jbbs.shitaraba.net)。専ブラの packages/connectors/src/shitaraba(connector.ts・parse.ts)を Kotlin に写したもの。
// - 板の URL は https://jbbs.shitaraba.net/カテゴリ/番号/、スレは /bbs/read.cgi/カテゴリ/番号/キー/
// - スレ一覧は 板/subject.txt(EUC-JP)。「キー.cgi,スレタイ(レス数)」、最後の行は最初の行の繰り返し
// - スレの中身は /bbs/rawmode.cgi/カテゴリ/番号/キー/(EUC-JP)。「番号<>名前<>メール<>日付<>本文<>スレタイ<>ID」。
//   差分は末尾に「何番から-」を付けて取り、新着がなければ空で返る
// - 過去ログ倉庫に入ったスレは、ヘッダー ERROR に「STORAGE IN」が付いて中身が返る。ないスレは 404 と「THREAD NOT FOUND」
// - 板の設定(板名・名無しの名前)は /bbs/api/setting.cgi/カテゴリ/番号/
// - 書き込みは /bbs/write.cgi/カテゴリ/番号/キー/(スレ立ては キー の代わりに new)へ EUC-JP のフォームで送る。
//   本番の板への試し書き込みはしないので、応答の読み方(書きこみました / ERROR)は確かめていない
// 板の一覧(bbsmenu)はないので、板は URL で足してもらう。1 つのスレは 1000 レスまで

private const val ORIGIN = "https://jbbs.shitaraba.net"
private val HOST = Regex("^https?://jbbs\\.(?:shitaraba\\.net|livedoor\\.jp)/")
private val THREAD_URL = Regex("^https?://jbbs\\.(?:shitaraba\\.net|livedoor\\.jp)/bbs/(?:read|rawmode)\\.cgi/([a-z]+)/([0-9]+)/([0-9]+)")
private val BOARD_URL = Regex("^https?://jbbs\\.(?:shitaraba\\.net|livedoor\\.jp)/([a-z]+)/([0-9]+)/?(?:subject\\.txt)?(?:[?#].*)?$")

object Shitaraba {
    fun canHandle(url: String) = HOST.containsMatchIn(url)
    fun isBoardUrl(url: String) = BOARD_URL.matches(url)

    private fun boardUrlOf(dir: String, bbs: String) = "$ORIGIN/$dir/$bbs/"

    /** 板の URL から カテゴリ と 番号 */
    private fun dirOf(boardUrl: String): Pair<String, String> {
        val m = BOARD_URL.find(boardUrl) ?: throw IllegalArgumentException("したらばの板の URL ではありません: $boardUrl")
        return m.groupValues[1] to m.groupValues[2]
    }

    /** 板の URL をそろえる(https・最後の / あり)。したらばの板でなければ null */
    fun normalizeBoardUrl(url: String): String? = BOARD_URL.find(url.trim())?.let { boardUrlOf(it.groupValues[1], it.groupValues[2]) }

    /** スレの URL → スレ(スレタイは開いてから分かる)。したらばのスレでなければ null */
    fun parseThreadUrl(url: String): ThreadSummary? {
        val m = THREAD_URL.find(url.trim()) ?: return null
        val key = m.groupValues[3]
        return ThreadSummary(boardUrlOf(m.groupValues[1], m.groupValues[2]), key, "", 0, 0, createdAtOf(key))
    }

    private fun decode(res: HttpResponse) = decodeText(res.body, res.headers["content-type"], TextEncoding.EUC)
    /** 応答のヘッダーの ERROR(過去ログ倉庫・スレなし など) */
    private fun errorOf(res: HttpResponse) = res.headers["error"] ?: ""

    // ── 板の設定 ──

    /** setting.cgi は「キー=値」の行。板名は BBS_TITLE、既定の名前は BBS_NONAME_NAME(2ch の SETTING.TXT と同じ鍵なので、そのまま使える) */
    suspend fun setting(boardUrl: String): Map<String, String>? = runCatching {
        val (dir, bbs) = dirOf(boardUrl)
        val res = Http.get("$ORIGIN/bbs/api/setting.cgi/$dir/$bbs/")
        if (res.status != 200) null else parseSettingText(decode(res))
    }.getOrNull()

    /** 板の名前(URL で開いたときに使う)。板がなければ例外(404) */
    suspend fun boardName(boardUrl: String): String {
        val (dir, bbs) = dirOf(boardUrl)
        val res = Http.get("$ORIGIN/bbs/api/setting.cgi/$dir/$bbs/")
        if (res.status == 404) throw IllegalStateException("したらばの板が見つかりません(HTTP 404)")
        if (res.status != 200) throw IllegalStateException("したらばの板を開けません(HTTP ${res.status})")
        val s = parseSettingText(decode(res))
        if (s["BBS"].isNullOrEmpty() && s["TOP"].isNullOrEmpty()) throw IllegalStateException("したらばの板ではないようです(板の設定が読めません)")
        return s["BBS_TITLE"]?.ifEmpty { null } ?: "$dir/$bbs"
    }

    // ── スレ一覧 ──

    /** subject.txt の 1 行は「キー.cgi,スレタイ(レス数)」。最後の行は最初の行の繰り返しなので、同じキーは 1 つにする */
    suspend fun listThreads(board: Board): List<ThreadSummary> {
        val url = "${board.url}subject.txt"
        val res = Http.get(url)
        if (res.status == 404) throw IllegalStateException("したらばの板が見つかりません(HTTP 404)")
        if (res.status != 200) throw IllegalStateException("HTTP ${res.status}: $url")
        return parseCgiSubject(decode(res), board.url)
    }

    // ── レス ──

    /**
     * rawmode.cgi の 1 行は「番号<>名前<>メール<>日付<>本文<>スレタイ<>ID」。スレタイは 1 番目のレスにだけ。
     * cursor は 2ch 互換の DatCursor を借りる: postCount = 取り終えた最後のレス番号、kako = 過去ログ倉庫(もう変わらないので取りに行かない)
     */
    suspend fun fetchPosts(thread: ThreadSummary, cursor: DatCursor?): FetchResult {
        if (cursor?.kako == true) return FetchResult(FetchStatus.NOT_MODIFIED, emptyList(), cursor, archived = true)
        val (dir, bbs) = dirOf(thread.boardUrl)
        val from = (cursor?.postCount ?: 0) + 1
        val url = "$ORIGIN/bbs/rawmode.cgi/$dir/$bbs/${thread.key}/" + (if (from > 1) "$from-" else "")
        val res = Http.get(url)
        val error = errorOf(res)
        if (res.status == 404 || error.contains("THREAD NOT FOUND", ignoreCase = true)) return FetchResult(FetchStatus.ARCHIVED, emptyList(), cursor)
        if (res.status != 200) throw IllegalStateException("HTTP ${res.status}: $url")
        val posts = ArrayList<Post>()
        var title: String? = null
        for (line in decode(res).split('\n')) {
            if (line.isBlank()) continue
            val f = line.split("<>")
            val no = f[0].toIntOrNull()?.takeIf { it > 0 } ?: continue
            val t = f.getOrNull(5) ?: ""
            if (t.isNotEmpty() && title == null) title = htmlToText(t).trim()
            posts += Post(
                no = no,
                name = htmlToText(f.getOrNull(1) ?: "").trim(),
                mail = htmlToText(f.getOrNull(2) ?: "").trim(),
                date = htmlToText(f.getOrNull(3) ?: "").trim(),
                id = f.getOrNull(6)?.trim()?.ifEmpty { null },
                body = htmlToText((f.getOrNull(4) ?: "").removePrefix(" ").removeSuffix(" ")),
            )
        }
        // 過去ログ倉庫に入ったスレ。中身は返るので保存し、dat 落ちとして扱う
        val kako = error.contains("STORAGE IN", ignoreCase = true)
        val lastNo = posts.lastOrNull()?.no ?: cursor?.postCount ?: 0
        val next = DatCursor(0, lastNo, null, kako = kako)
        if (posts.isEmpty()) return FetchResult(FetchStatus.NOT_MODIFIED, emptyList(), next, archived = kako)
        return FetchResult(FetchStatus.UPDATED, posts, next, title, archived = kako)
    }

    // ── 書き込み ──

    suspend fun createPost(t: ThreadSummary, input: PostInput): PostResult {
        val (dir, bbs) = dirOf(t.boardUrl)
        val fields = linkedMapOf(
            "DIR" to dir, "BBS" to bbs, "KEY" to t.key, "TIME" to (System.currentTimeMillis() / 1000).toString(),
            "NAME" to input.name, "MAIL" to input.mail, "MESSAGE" to input.body, "submit" to "書き込む",
        )
        return sendWrite("$ORIGIN/bbs/write.cgi/$dir/$bbs/${t.key}/", fields, webUrl(t))
    }

    suspend fun createThread(board: Board, title: String, input: PostInput): PostResult {
        val (dir, bbs) = dirOf(board.url)
        val fields = linkedMapOf(
            "DIR" to dir, "BBS" to bbs, "TIME" to (System.currentTimeMillis() / 1000).toString(), "SUBJECT" to title,
            "NAME" to input.name, "MAIL" to input.mail, "MESSAGE" to input.body, "submit" to "新規スレッド作成",
        )
        return sendWrite("$ORIGIN/bbs/write.cgi/$dir/$bbs/new/", fields, board.url)
    }

    /** write.cgi の応答。書けたら Ok、ERROR やエラーの文言があれば Error(理由を添える) */
    private suspend fun sendWrite(url: String, fields: Map<String, String>, referer: String): PostResult {
        val res = Http.postForm(url, encodeEucJpForm(fields), mapOf("Referer" to referer))
        val html = decode(res)
        val title = Regex("<title>([^<]*)</title>", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1)?.trim() ?: ""
        val text = htmlToText(html.replace(Regex("<head>[\\s\\S]*?</head>", RegexOption.IGNORE_CASE), "")).replace(Regex("\\s+"), " ").trim()
        val written = Regex("書き?こみました")
        // ERROR の題のページは、書き込んだ文字が本文に戻ってきていることがあるので、本文の文言では成功にしない
        val errorTitle = Regex("^\\s*(?:ERROR|ＥＲＲＯＲ)(?:[\\s:：!！]|$)", RegexOption.IGNORE_CASE).containsMatchIn(title)
        if (written.containsMatchIn(title) || (!errorTitle && written.containsMatchIn(text))) return PostResult.Ok("書きこみました", null)
        val err = Regex("ERROR[:：]?\\s*([^\\n]{0,200})", RegexOption.IGNORE_CASE).find(text)
        val message = err?.value?.trim() ?: title.ifEmpty { text.take(200) }
        return PostResult.Error(message.ifEmpty { if (res.status >= 400) "HTTP ${res.status}" else POST_FAILED })
    }

    /** EUC-JP で送ったときのバイト数(書き込む前に長すぎないか確かめる目安) */
    fun byteLength(text: String): Int = encodeEucJp(text.replace("\n", "\r\n")).size

    /** ブラウザで開く URL */
    fun webUrl(t: ThreadSummary): String {
        val (dir, bbs) = dirOf(t.boardUrl)
        return "$ORIGIN/bbs/read.cgi/$dir/$bbs/${t.key}/"
    }
}

/**
 * PC 版の表(WHATWG の EUC-JP)で符号の決まっている文字のうち、Java・Android の EUC-JP では別の扱いになるもの。
 * 記号は同じ符号を別の文字に割り当てていて、13 区(丸数字など)と F9〜FC の段(IBM 拡張)は表にないか 3 バイトになる
 */
private val EUC_FIXED: Map<Int, ByteArray> = buildMap {
    fun put2(cp: Int, code: Int) = put(cp, byteArrayOf((code shr 8).toByte(), code.toByte()))
    fun putRun(code: Int, chars: String) = chars.forEachIndexed { i, c -> put2(c.code, code + i) }
    put2(0xFF5E, 0xA1C1) // ～
    put2(0xFF0D, 0xA1DD) // －
    put2(0x2225, 0xA1C2) // ∥
    put2(0x2015, 0xA1BD) // ―
    put2(0xFFE0, 0xA1F1) // ￠
    put2(0xFFE1, 0xA1F2) // ￡
    put2(0xFFE2, 0xA2CC) // ￢
    for (i in 0 until 20) put2(0x2460 + i, 0xADA1 + i) // ①〜⑳
    for (i in 0 until 10) put2(0x2160 + i, 0xADB5 + i) // Ⅰ〜Ⅹ
    putRun(0xADC0, "㍉㌔㌢㍍㌘㌧㌃㌶㍑㍗㌍㌦㌣㌫㍊㌻㎜㎝㎞㎎㎏㏄㎡")
    putRun(0xADDF, "㍻〝〟№㏍℡㊤㊥㊦㊧㊨㈱㈲㈹㍾㍽㍼")
    putRun(0xADF3, "∮∑")
    putRun(0xADF8, "∟⊿")
    putRun(0xF9A1, "纊褜鍈銈蓜俉炻昱棈鋹曻彅丨仡仼伀伃伹佖侒侊侚侔俍偀倢俿倞偆偰偂傔僴僘兊兤冝冾凬刕劜劦勀勛匀匇匤卲厓厲叝﨎咜咊咩哿喆坙坥垬埈埇﨏塚增墲夋奓奛奝奣妤妺孖寀甯寘寬尞岦岺峵崧嵓﨑嵂嵭嶸嶹巐弡弴彧德")
    putRun(0xFAA1, "忞恝悅悊惞惕愠惲愑愷愰憘戓抦揵摠撝擎敎昀昕昻昉昮昞昤晥晗晙晴晳暙暠暲暿曺朎朗杦枻桒柀栁桄棏﨓楨﨔榘槢樰橫橆橳橾櫢櫤毖氿汜沆汯泚洄涇浯涖涬淏淸淲淼渹湜渧渼溿澈澵濵瀅瀇瀨炅炫焏焄煜煆煇凞燁燾犱")
    putRun(0xFBA1, "犾猤猪獷玽珉珖珣珒琇珵琦琪琩琮瑢璉璟甁畯皂皜皞皛皦益睆劯砡硎硤硺礰礼神祥禔福禛竑竧靖竫箞精絈絜綷綠緖繒罇羡羽茁荢荿菇菶葈蒴蕓蕙蕫﨟薰蘒﨡蠇裵訒訷詹誧誾諟諸諶譓譿賰賴贒赶﨣軏﨤逸遧郞都鄕鄧釚")
    putRun(0xFCA1, "釗釞釭釮釤釥鈆鈐鈊鈺鉀鈼鉎鉙鉑鈹鉧銧鉷鉸鋧鋗鋙鋐﨧鋕鋠鋓錥錡鋻﨨錞鋿錝錂鍰鍗鎤鏆鏞鏸鐱鑅鑈閒隆﨩隝隯霳霻靃靍靏靑靕顗顥飯飼餧館馞驎髙髜魵魲鮏鮱鮻鰀鵰鵫鶴鸙黑")
    putRun(0xFCF1, "ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ")
    putRun(0xFCFC, "￤＇＂")
}

/** EUC-JP にない字は「&#番号;」にして送る(PC 版の eucjp.ts と同じ)。3 バイトは補助漢字(PC 版は使わない) */
private fun encodeEucJp(text: String): ByteArray = encodeWithEntities(text, TextEncoding.EUC.charset(), EUC_FIXED, maxBytes = 2)

/** application/x-www-form-urlencoded(EUC-JP)。改行は CRLF に */
internal fun encodeEucJpForm(fields: Map<String, String>): ByteArray = encodeForm(fields, ::encodeEucJp)
