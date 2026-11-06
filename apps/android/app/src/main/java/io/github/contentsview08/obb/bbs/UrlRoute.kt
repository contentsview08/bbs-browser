package io.github.contentsview08.obb.bbs

// URL の解釈(通信なしで分かるところ)。PC 版の twoch/connector.ts の routeTwoChUrl と同じ決まりで、正は packages/conformance/url.json

sealed class UrlRoute {
    enum class Site { TWOCH, HONO, SHITARABA, MACHI }

    /** no: URL の後ろのレス番号(開いたらそこへ飛ぶ) */
    class Thread(val site: Site, val thread: ThreadSummary, val no: Int? = null) : UrlRoute()
    class BoardPage(val site: Site, val boardUrl: String) : UrlRoute()

    /** itest でサーバー名が URL にないもの。板のページから探す(TwoCh.itestServer) */
    class Itest(val domain: String, val board: String, val key: String?, val no: Int? = null) : UrlRoute() {
        fun realUrl(host: String) = if (key != null) "https://$host/test/read.cgi/$board/$key/${no ?: ""}" else "https://$host/$board/"
    }

    companion object {
        private val NET = Regex("^https?://((?:[a-z0-9]+\\.)?)5ch\\.net(?=[/?#]|$)")
        private val PLAIN_5CH = Regex("^http://((?:[a-z0-9]+\\.)?(?:5ch\\.io|bbspink\\.com))(?=[/?#]|$)")
        private val ITEST_THREAD = Regex("^https?://itest\\.(5ch\\.net|5ch\\.io|bbspink\\.com)/(?:([a-z0-9]+)/)?test/read\\.cgi/([^/?#]+)/([0-9]+)")
        private val ITEST_BOARD = Regex("^https?://itest\\.(5ch\\.net|5ch\\.io|bbspink\\.com)/subback/([^/?#]+)")
        // /test/read.cgi/ の前に道(ディレクトリ)があってもよい(https://host/bbs/test/read.cgi/板/キー なら、板は https://host/bbs/板/)
        private val THREAD_URL = Regex("^https?://([^/?#]+(?:/[^?#]*?)?)/test/read\\.cgi/([^/?#]+)/([0-9]+)")
        private val BOARD_URL = Regex("^https?://([^/]+)/([^/?#]+)/?(?:subject\\.txt)?(?:[?#].*)?$")
        // 「123」「123-456」「123,456」「123n」。l50・-100 は先頭のレス番号がないので読まない
        private val RES_NO = Regex("^([0-9]+)(?:[-,][0-9,-]*)?n?$")

        /** read.cgi/ の後ろの keyAt 番目がキーの URL から、その次の段のレス番号を読む */
        private fun resNoOf(url: String, keyAt: Int = 1): Int? {
            val parts = url.substringAfter(".cgi/", "").substringBefore('?').substringBefore('#').split('/')
            val m = RES_NO.matchEntire(parts.getOrNull(keyAt + 1) ?: return null) ?: return null
            return m.groupValues[1].toIntOrNull()?.takeIf { it > 0 }
        }

        /**
         * 5ch は 5ch.net から 5ch.io へ移った。5ch.net への POST はリダイレクトをたどれないので、初めから 5ch.io で開く。
         * 5ch・bbspink は https に揃える
         */
        fun to5chIo(url: String): String =
            PLAIN_5CH.replace(NET.replace(url) { "https://${it.groupValues[1]}5ch.io" }) { "https://${it.groupValues[1]}" }

        /** 板・スレの URL の形を読む。2ch 互換の板が本当にあるかは、このあとスレ一覧を取って確かめる。形が合わなければ null */
        fun parse(raw: String, now: Long = System.currentTimeMillis()): UrlRoute? {
            val u = to5chIo(raw.trim())
            HonoBbs.parseThreadUrl(u)?.let { return Thread(Site.HONO, it, HonoBbs.resNoIn(u)) }
            HonoBbs.normalizeBoardUrl(u)?.let { return BoardPage(Site.HONO, it) }
            Shitaraba.parseThreadUrl(u)?.let { return Thread(Site.SHITARABA, it, resNoOf(u, keyAt = 2)) }
            Shitaraba.normalizeBoardUrl(u)?.let { return BoardPage(Site.SHITARABA, it) }
            if (Shitaraba.canHandle(u)) return null
            Machi.parseThreadUrl(u)?.let { return Thread(Site.MACHI, it, resNoOf(u)) }
            Machi.normalizeBoardUrl(u)?.let { return BoardPage(Site.MACHI, it) }
            if (Machi.canHandle(u)) return null
            ITEST_THREAD.find(u)?.let { m ->
                val (domain, server, board, key) = m.destructured
                return if (server.isEmpty()) Itest(domain, board, key, resNoOf(u)) else thread("$server.$domain/$board/", key, now, resNoOf(u))
            }
            ITEST_BOARD.find(u)?.let { return Itest(it.groupValues[1], it.groupValues[2], null) }
            THREAD_URL.find(u)?.let { m ->
                val (origin, dir, key) = m.destructured
                return if (dir == "test") null else thread("$origin/$dir/", key, now, resNoOf(u))
            }
            val b = BOARD_URL.find(u) ?: return null
            val dir = b.groupValues[2]
            // 最後に . のあるものはファイルで、板ではない(a.html など)
            if (dir == "test" || dir.contains('.')) return null
            return BoardPage(Site.TWOCH, "https://${b.groupValues[1]}/$dir/")
        }

        // 2ch 互換の板は https で開く(取れないときの扱いは HttpsFirst)
        private fun thread(hostAndPath: String, key: String, now: Long, no: Int?) =
            Thread(Site.TWOCH, ThreadSummary("https://$hostAndPath", key, "", 0, 0, createdAtOf(key, now)), no)

        /** アプリの中で開くスレの URL か(リンクのカードにしない) */
        fun isThreadUrl(url: String): Boolean = when (val r = parse(url)) {
            is Thread -> true
            is Itest -> r.key != null
            else -> false
        }
    }
}
