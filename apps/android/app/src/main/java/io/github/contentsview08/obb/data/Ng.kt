package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.Post
import io.github.contentsview08.obb.bbs.ThreadSummary
import io.github.contentsview08.obb.bbs.legacyAuthorId
import org.json.JSONObject
import java.time.LocalDate

/**
 * NG(あぼーん)1 つ。PC 版・hono-bbs の web の utils/ng.ts の NgRule と同じ項目・同じ JSON・同じ当て方。
 * target: content(本文)/ posterName(名前)/ posterId(ID)/ threadTitle(スレタイ)。expiresOnDate は この日まで(YYYY-MM-DD)、boardUrl はこの板だけ(なければすべての板)
 */
data class NgRule(
    val target: String,
    val pattern: String,
    val isRegex: Boolean = false,
    val enabled: Boolean = true,
    val expiresOnDate: String? = null,
    val boardUrl: String? = null,
    val boardName: String? = null,
    val note: String? = null,
    val id: String = java.util.UUID.randomUUID().toString(),
    val createdAt: Long = System.currentTimeMillis(),
) {
    /** 同じ NG か(種類・文字・正規表現か・効く板が同じ)。足すときに重ねないために使う */
    fun sameAs(o: NgRule) = target == o.target && pattern == o.pattern && isRegex == o.isRegex && boardUrl == o.boardUrl

    fun toJson(): JSONObject = JSONObject().put("target", target).put("pattern", pattern).put("isRegex", isRegex).put("enabled", enabled)
        .put("expiresOnDate", expiresOnDate).put("boardUrl", boardUrl).put("boardName", boardName).put("note", note).put("id", id).put("createdAt", createdAt)

    companion object {
        /** PC の型で省ける項目は省けるものとして読む */
        fun fromJson(o: JSONObject) = NgRule(
            o.getString("target"), o.getString("pattern"), o.optBoolean("isRegex"), o.optBoolean("enabled", true),
            o.optString("expiresOnDate").ifEmpty { null }, o.optString("boardUrl").ifEmpty { null }, o.optString("boardName").ifEmpty { null },
            o.optString("note").ifEmpty { null }, o.optString("id").ifEmpty { java.util.UUID.randomUUID().toString() }, o.optLong("createdAt", 0L),
        )
    }
}

val NG_TARGETS = listOf("content" to "本文", "posterName" to "名前", "posterId" to "ID", "threadTitle" to "スレタイ")
fun ngTargetName(t: String) = NG_TARGETS.firstOrNull { it.first == t }?.second ?: "言葉"

fun today(): String = LocalDate.now().toString()
fun daysLater(days: Long): String = LocalDate.now().plusDays(days).toString()

/** いま効いているか(有効で、期限が切れていない) */
fun NgRule.active(today: String = today()) = enabled && (expiresOnDate == null || expiresOnDate >= today)

private val NG_SCRIPT = setOf("Han", "Hiragana", "Katakana", "Latin", "Hangul", "Greek", "Cyrillic")
private const val WORD = "A-Za-z0-9_"
private const val SPACE = " \\t\\n\\x0B\\f\\r\\u00A0\\uFEFF\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000"

/**
 * NG の正規表現を読む。PC 版・Web(utils/ng.ts の ngRegExp。JavaScript の正規表現)と同じ書き方が同じ意味になるようにそろえる(packages/conformance/ng.json)。
 * Android の \d \w \b は Unicode 扱いで JVM とも違うので、JavaScript の意味(\d \w は ASCII)の形に書き直して、端末によらず同じ結果にする。
 * 先頭の (?i) で大文字・小文字を区別しない。途中の (?i) は読めない。読めないときは例外
 */
internal fun ngRegex(pattern: String): Regex {
    val ignoreCase = pattern.startsWith("(?i)")
    val src = toJsMeaning(if (ignoreCase) pattern.substring(4) else pattern)
    return if (ignoreCase) Regex(src, RegexOption.IGNORE_CASE) else Regex(src)
}

private val QUANTIFIER = Regex("\\{[0-9]+(,[0-9]*)?\\}")

private fun toJsMeaning(p: String): String {
    val out = StringBuilder()
    var inClass = false
    var i = 0
    while (i < p.length) {
        val c = p[i]
        if (c == '\\' && i + 1 < p.length) {
            val e = p[i + 1]
            i += 2
            fun set(body: String, negate: Boolean) { out.append(if (negate) "[^$body]" else if (inClass) body else "[$body]") }
            when (e) {
                'd', 'D' -> set("0-9", e == 'D')
                'w', 'W' -> set(WORD, e == 'W')
                's', 'S' -> set(SPACE, e == 'S')
                'b', 'B' -> when {
                    inClass -> out.append("\\x08")
                    e == 'b' -> out.append("(?:(?<=[$WORD])(?![$WORD])|(?<![$WORD])(?=[$WORD]))")
                    else -> out.append("(?:(?<=[$WORD])(?=[$WORD])|(?<![$WORD])(?![$WORD]))")
                }
                'p', 'P' -> {
                    val end = if (i < p.length && p[i] == '{') p.indexOf('}', i) else -1
                    if (end < 0) throw IllegalArgumentException("\\$e の書き方が違います")
                    val name = p.substring(i + 1, end)
                    out.append('\\').append(e).append('{').append(if (name in NG_SCRIPT) "script=$name" else name).append('}')
                    i = end + 1
                }
                else -> out.append('\\').append(e)
            }
            continue
        }
        if (inClass) {
            when {
                c == ']' -> { inClass = false; out.append(c) }
                // Java の [ ] の中の [ と && は特別な意味になる。JavaScript ではただの文字
                c == '[' -> out.append("\\[")
                c == '&' -> out.append("\\&")
                else -> out.append(c)
            }
            i++
            continue
        }
        when {
            c == '[' -> {
                inClass = true
                out.append(c)
                // 先頭の ^ を一緒に写す(上の分岐で文字として扱わないように)
                if (i + 1 < p.length && p[i + 1] == '^') { out.append('^'); i++ }
            }
            // Java の $ は最後の改行の前にも当たる
            c == '$' -> out.append("\\z")
            c == '{' -> {
                val q = QUANTIFIER.matchAt(p, i)
                if (q != null) { out.append(q.value); i += q.value.length - 1 } else out.append("\\{")
            }
            // Android の正規表現は、対のない } ] を文字として読まないことがある
            c == '}' || c == ']' -> out.append('\\').append(c)
            c == '(' && i + 2 < p.length && p[i + 1] == '?' && (p[i + 2].isLetter() || p[i + 2] == '-') -> throw IllegalArgumentException("(?i) は先頭にだけ書けます")
            else -> out.append(c)
        }
        i++
    }
    return out.toString()
}

/** 正規表現として読めないときの理由。読めれば null */
fun ngPatternError(pattern: String, isRegex: Boolean): String? {
    if (pattern.isEmpty()) return "文字を入れてください"
    if (!isRegex) return null
    return runCatching { ngRegex(pattern); null }.getOrElse { "正規表現として読めません(${it.message?.lineSequence()?.firstOrNull() ?: it})" }
}

/** text のうち、ルールに当たる所(始まり・終わり)。試し欄で色を付ける */
fun ngMatchRanges(r: NgRule, text: String): List<IntRange> {
    if (r.pattern.isEmpty()) return emptyList()
    if (r.target == "posterId" && !r.isRegex) return if (text == r.pattern) listOf(text.indices) else emptyList()
    if (!r.isRegex) {
        val out = ArrayList<IntRange>()
        var i = text.indexOf(r.pattern, ignoreCase = true)
        while (i >= 0 && out.size < 200) { out += i until i + r.pattern.length; i = text.indexOf(r.pattern, i + maxOf(1, r.pattern.length), ignoreCase = true) }
        return out
    }
    val re = runCatching { ngRegex(r.pattern) }.getOrNull() ?: return emptyList()
    return re.findAll(text).take(200).map { it.range }.filter { !it.isEmpty() }.toList()
}

/** レスに当たっている NG(種類ごと) */
data class NgHits(val id: List<NgRule>, val name: List<NgRule>, val body: List<NgRule>)

/**
 * 当たっている NG を外す項目の分け方。その文字ちょうどの NG(exact)は押すだけで外せる。
 * 正規表現・部分一致は別のレスにも効いているので(others)、直すか消すかを NG の編集で選ぶ。value が null なら全部 others(本文の NG)
 */
fun splitNgHits(rules: List<NgRule>, value: String?): Pair<List<NgRule>, List<NgRule>> =
    rules.partition { !it.isRegex && it.pattern == value }

/** あぼーんをまとめるときの扱い。RULE・AI は数えるもの、SKIP は何も描かないので数えずに飛ばす(間に挟まってもまとまりは切れない) */
enum class NgRunKind { RULE, AI, SKIP }

/** 続けて並んだあぼーんのまとまり。nos は飛ばしたレスも含む */
data class NgRun(val nos: List<Int>, val ai: Int, val rule: Int)

/** runs: 先頭の番号 → まとまり。firstOf: レス番号 → 入っているまとまりの先頭の番号 */
data class NgRuns(val runs: Map<Int, NgRun>, val firstOf: Map<Int, Int>) {
    companion object { val NONE = NgRuns(emptyMap(), emptyMap()) }
}

/**
 * 続けて並んだあぼーんをまとめる(PC 版の ThreadView の ngRuns と同じ)。数えるものが 2 つ以上続いたときだけ。
 * 「ここから未読」の所では切る(区切りの線が隠れないように)。kindOf が null のレスで切れる
 */
fun ngRuns(nos: List<Int>, unreadFrom: Int, kindOf: (Int) -> NgRunKind?): NgRuns {
    val runs = LinkedHashMap<Int, NgRun>()
    val firstOf = HashMap<Int, Int>()
    var cur = ArrayList<Int>()
    fun close() {
        val kinds = cur.map(kindOf)
        val ai = kinds.count { it == NgRunKind.AI }
        val rule = kinds.count { it == NgRunKind.RULE }
        if (ai + rule >= 2) {
            runs[cur[0]] = NgRun(cur, ai, rule)
            for (no in cur) firstOf[no] = cur[0]
        }
        cur = ArrayList()
    }
    for (no in nos) {
        if (no == unreadFrom) close()
        if (kindOf(no) != null) cur.add(no) else close()
    }
    close()
    return NgRuns(runs, firstOf)
}

/** ルールを判定関数にしておく(レスの数だけ正規表現を作り直さないため) */
class NgMatcher(rules: List<NgRule>) {
    private class M(val r: NgRule, val re: Regex?)
    private val byTarget: Map<String, List<M>>

    init {
        val t = today()
        // 空の文字はどの文字列にも当たる。すべてのレスを消さないように外す
        byTarget = rules.filter { it.active(t) && it.pattern.isNotEmpty() }.mapNotNull { r ->
            if (r.isRegex) runCatching { M(r, ngRegex(r.pattern)) }.getOrNull() else M(r, null)
        }.groupBy { it.r.target }
    }

    private fun matches(m: M, target: String, text: String, boardUrl: String?) =
        (m.r.boardUrl == null || m.r.boardUrl == boardUrl) && when {
            m.re != null -> m.re.containsMatchIn(text)
            // ID は部分一致だと別の ID まで巻き込むので、完全一致
            target == "posterId" -> text == legacyAuthorId(m.r.pattern)
            else -> text.contains(m.r.pattern, ignoreCase = true)
        }

    private fun hit(target: String, text: String?, boardUrl: String?): Boolean {
        if (text == null) return false
        return byTarget[target]?.any { matches(it, target, text, boardUrl) } == true
    }

    private fun hits(target: String, text: String?, boardUrl: String?): List<NgRule> {
        if (text == null) return emptyList()
        return byTarget[target].orEmpty().filter { matches(it, target, text, boardUrl) }.map { it.r }
    }

    fun post(p: Post, boardUrl: String?) = hit("content", p.body, boardUrl) || hit("posterName", p.name, boardUrl) || hit("posterId", p.id, boardUrl)

    /** このレスに当たっている NG(種類ごと)。レスのメニューから外すために使う */
    fun postHits(p: Post, boardUrl: String?) = NgHits(hits("posterId", p.id, boardUrl), hits("posterName", p.name, boardUrl), hits("content", p.body, boardUrl))

    /** スレ一覧: スレタイの NG と、立てた人の ID の NG */
    fun thread(t: ThreadSummary) = hit("threadTitle", t.title, t.boardUrl) || hit("posterId", t.authorId, t.boardUrl)

    val isEmpty get() = byTarget.isEmpty()
}
