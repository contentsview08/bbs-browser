package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.bbs.legacyAuthorId
import org.json.JSONArray
import org.json.JSONObject

/** 立てた人のキーワードの帯・通知に出す名前(PC の utils/keywords.ts の authorKeywordLabel と同じ) */
fun authorKeywordLabel(authorId: String) = "立てた人 $authorId"

/**
 * キーワード 1 つ(PC・Web の utils/keywords.ts の KeywordRule と同じ項目・同じ JSON。設定 keywordRules に配列で持ち、同期する)。
 * kind: title はスレタイの言葉(pattern を含めば当たる。isRegex なら正規表現)、author は立てた人の ID(pattern と同じなら当たる)。
 * label は帯に出す別名(空なら言葉そのもの。正規表現が長くて読めないときに付ける。立てた人は「立てた人 ID」)。boardUrl があればその板だけで効く
 */
data class KeywordRule(
    val id: String = java.util.UUID.randomUUID().toString(),
    val kind: String = "title",
    val pattern: String = "",
    val isRegex: Boolean = false,
    val label: String = "",
    val boardUrl: String? = null,
    val boardName: String? = null,
    val enabled: Boolean = true,
    val createdAt: Long = System.currentTimeMillis(),
) {
    val isAuthor get() = kind == "author"

    /** 帯・通知に出す名前(別名があればそれ) */
    fun displayLabel(): String {
        val l = label.trim()
        if (l.isNotEmpty()) return l
        return if (isAuthor) authorKeywordLabel(pattern.trim()) else pattern.trim()
    }

    /** この板で効くか(有効で、板の限定がないかこの板) */
    fun appliesTo(board: String?) = enabled && (boardUrl == null || boardUrl == board)

    /** 同じ中身か(種類・言葉・正規表現か・板が同じ。足すときに重ねないために使う。別名は見ない) */
    fun sameAs(o: KeywordRule) = kind == o.kind && pattern.trim() == o.pattern.trim() && isRegex == o.isRegex && boardUrl == o.boardUrl

    fun toJson(): JSONObject = JSONObject().put("id", id).put("kind", kind).put("pattern", pattern).put("isRegex", isRegex).put("label", label)
        .put("boardUrl", boardUrl).put("boardName", boardName).put("enabled", enabled).put("createdAt", createdAt)

    companion object {
        fun fromJson(o: JSONObject): KeywordRule? {
            val pattern = o.optString("pattern").takeIf { it.isNotBlank() } ?: return null
            val kind = o.optString("kind", "title").takeIf { it == "title" || it == "author" } ?: "title"
            return KeywordRule(
                o.optString("id").ifEmpty { java.util.UUID.randomUUID().toString() }, kind, pattern, o.optBoolean("isRegex", false), o.optString("label"),
                o.optString("boardUrl").ifEmpty { null }, o.optString("boardName").ifEmpty { null }, o.optBoolean("enabled", true), o.optLong("createdAt", 0L),
            )
        }

        fun listFromJson(json: String): List<KeywordRule> = runCatching {
            val a = JSONArray(json)
            (0 until a.length()).mapNotNull { i -> a.optJSONObject(i)?.let(::fromJson) }
        }.getOrDefault(emptyList())

        fun listToJson(list: List<KeywordRule>): String = JSONArray().apply { for (r in list) put(r.toJson()) }.toString()

        /** 前の形(スレタイの言葉の並び keywords・立てた人の並び keywordAuthors)から作る。1 つの言葉が 1 つの規則 */
        fun fromLegacy(keywords: List<String>, authors: List<String>, now: Long = System.currentTimeMillis()): List<KeywordRule> {
            val out = ArrayList<KeywordRule>()
            for ((i, k) in keywords.map { it.trim() }.filter { it.isNotEmpty() }.distinct().withIndex()) out += KeywordRule(kind = "title", pattern = k, createdAt = now + i)
            for ((i, a) in authors.map { it.trim() }.filter { it.isNotEmpty() }.distinct().withIndex()) out += KeywordRule(kind = "author", pattern = a, createdAt = now + 100_000 + i)
            return out
        }
    }
}

/**
 * キーワードの当て方(スレ一覧・通知で同じ)。board はその一覧の板(板限定の規則をここで絞る)。
 * スレタイの言葉は検索と同じく全角半角・大文字小文字・カナとかなを同じに扱う(normalizeForSearch。PC と同じ)。
 * 正規表現は NG と同じ読み方(ngRegex。PC・Web と同じ意味になる)で、スレタイそのものに当てる。読めない正規表現は当たらない。
 * 立てた人は legacyAuthorId でそろえて比べる
 */
class KeywordMatcher(rules: List<KeywordRule>, board: String?) {
    val active: List<KeywordRule> = rules.filter { it.appliesTo(board) && it.pattern.isNotBlank() }
    private class TitleRule(val rule: KeywordRule, val word: String?, val re: Regex?)
    private val titles = active.filter { !it.isAuthor }.mapNotNull { r ->
        if (r.isRegex) runCatching { ngRegex(r.pattern.trim()) }.getOrNull()?.let { TitleRule(r, null, it) }
        else normalizeForSearch(r.pattern.trim()).takeIf { it.isNotEmpty() }?.let { TitleRule(r, it, null) }
    }
    private val authors = active.filter { it.isAuthor }.map { r -> r to legacyAuthorId(r.pattern.trim()) }.filter { it.second.isNotEmpty() }
    val isEmpty get() = titles.isEmpty() && authors.isEmpty()

    /** 当たった規則(スレタイの言葉が先、立てた人が後。どれにも当たらなければ null) */
    fun hit(t: ThreadSummary): KeywordRule? {
        val title = normalizeForSearch(t.title)
        titles.firstOrNull { x -> if (x.re != null) x.re.containsMatchIn(t.title) else title.contains(x.word!!) }?.let { return it.rule }
        val a = t.authorId ?: return null
        return authors.firstOrNull { (_, id) -> a == id }?.first
    }

    /**
     * 規則ごとにスレをまとめる。先の規則に当たったスレは後の規則に数えない。
     * 戻りは (規則, スレ) の並びで、最後に (null, 残り)。並びは元の一覧の順。
     * 運営のお知らせはどのまとまりにも入れず、残りの最後に置く(一番下に回すので、帯の下に並ばない)
     */
    fun groups(list: List<ThreadSummary>): List<Pair<KeywordRule?, List<ThreadSummary>>> {
        val (normal, notices) = list.partition { !it.announcement }
        val byRule = LinkedHashMap<String, ArrayList<ThreadSummary>>()
        val rest = ArrayList<ThreadSummary>()
        for (t in normal) {
            val r = hit(t)
            if (r == null) rest += t else byRule.getOrPut(r.id) { ArrayList() } += t
        }
        val out = ArrayList<Pair<KeywordRule?, List<ThreadSummary>>>()
        for (r in active) byRule[r.id]?.let { out += r to it }
        out += null to rest + notices
        return out
    }
}
