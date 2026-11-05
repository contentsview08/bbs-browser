package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.Post
import io.github.contentsview08.obb.bbs.ThreadSummary
import org.json.JSONObject
import java.time.LocalDate

/**
 * NG(あぼーん)1 つ。PC 版・hono-bbs の web の utils/ng.ts の NgRule と同じ項目・同じ当て方(2026-11 にそろえた)。
 * target: body(本文)/ name(名前)/ id(ID)/ title(スレタイ)。expiresOn は この日まで(YYYY-MM-DD)、boardUrl はこの板だけ(なければすべての板)
 */
data class NgRule(
    val target: String,
    val pattern: String,
    val isRegex: Boolean = false,
    val enabled: Boolean = true,
    val expiresOn: String? = null,
    val boardUrl: String? = null,
    val boardName: String? = null,
    val note: String? = null,
    val id: String = java.util.UUID.randomUUID().toString(),
    val createdAt: Long = System.currentTimeMillis(),
) {
    /** 同じ NG か(種類・文字・正規表現か・効く板が同じ)。足すときに重ねないために使う */
    fun sameAs(o: NgRule) = target == o.target && pattern == o.pattern && isRegex == o.isRegex && boardUrl == o.boardUrl

    fun toJson(): JSONObject = JSONObject().put("target", target).put("pattern", pattern).put("isRegex", isRegex).put("enabled", enabled)
        .put("expiresOn", expiresOn).put("boardUrl", boardUrl).put("boardName", boardName).put("note", note).put("id", id).put("createdAt", createdAt)

    companion object {
        /** 前の形(種類と文字だけ)も読む */
        fun fromJson(o: JSONObject) = NgRule(
            o.getString("target"), o.getString("pattern"), o.optBoolean("isRegex"), o.optBoolean("enabled", true),
            o.optString("expiresOn").ifEmpty { null }, o.optString("boardUrl").ifEmpty { null }, o.optString("boardName").ifEmpty { null },
            o.optString("note").ifEmpty { null }, o.optString("id").ifEmpty { java.util.UUID.randomUUID().toString() }, o.optLong("createdAt", 0L),
        )
    }
}

val NG_TARGETS = listOf("body" to "本文", "name" to "名前", "id" to "ID", "title" to "スレタイ")
fun ngTargetName(t: String) = NG_TARGETS.firstOrNull { it.first == t }?.second ?: "言葉"

fun today(): String = LocalDate.now().toString()
fun daysLater(days: Long): String = LocalDate.now().plusDays(days).toString()

/** いま効いているか(有効で、期限が切れていない) */
fun NgRule.active(today: String = today()) = enabled && (expiresOn == null || expiresOn >= today)

/** 正規表現として読めないときの理由。読めれば null */
fun ngPatternError(pattern: String, isRegex: Boolean): String? {
    if (pattern.isEmpty()) return "文字を入れてください"
    if (!isRegex) return null
    return runCatching { Regex(pattern); null }.getOrElse { "正規表現として読めません(${it.message?.lineSequence()?.firstOrNull() ?: it})" }
}

/** text のうち、ルールに当たる所(始まり・終わり)。試し欄で色を付ける */
fun ngMatchRanges(r: NgRule, text: String): List<IntRange> {
    if (r.pattern.isEmpty()) return emptyList()
    if (r.target == "id" && !r.isRegex) return if (text == r.pattern) listOf(text.indices) else emptyList()
    if (!r.isRegex) {
        val out = ArrayList<IntRange>()
        var i = text.indexOf(r.pattern, ignoreCase = true)
        while (i >= 0 && out.size < 200) { out += i until i + r.pattern.length; i = text.indexOf(r.pattern, i + maxOf(1, r.pattern.length), ignoreCase = true) }
        return out
    }
    val re = runCatching { Regex(r.pattern) }.getOrNull() ?: return emptyList()
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

/** ルールを判定関数にしておく(レスの数だけ正規表現を作り直さないため) */
class NgMatcher(rules: List<NgRule>) {
    private class M(val r: NgRule, val re: Regex?)
    private val byTarget: Map<String, List<M>>

    init {
        val t = today()
        byTarget = rules.filter { it.active(t) }.mapNotNull { r ->
            if (r.isRegex) runCatching { M(r, Regex(r.pattern)) }.getOrNull() else M(r, null)
        }.groupBy { it.r.target }
    }

    private fun matches(m: M, target: String, text: String, boardUrl: String?) =
        (m.r.boardUrl == null || m.r.boardUrl == boardUrl) && when {
            m.re != null -> m.re.containsMatchIn(text)
            // ID は部分一致だと別の ID まで巻き込むので、完全一致
            target == "id" -> text == m.r.pattern
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

    fun post(p: Post, boardUrl: String?) = hit("body", p.body, boardUrl) || hit("name", p.name, boardUrl) || hit("id", p.id, boardUrl)

    /** このレスに当たっている NG(種類ごと)。レスのメニューから外すために使う */
    fun postHits(p: Post, boardUrl: String?) = NgHits(hits("id", p.id, boardUrl), hits("name", p.name, boardUrl), hits("body", p.body, boardUrl))

    /** スレ一覧: スレタイの NG と、立てた人の ID の NG */
    fun thread(t: ThreadSummary) = hit("title", t.title, t.boardUrl) || hit("id", t.authorId, t.boardUrl)

    val isEmpty get() = byTarget.isEmpty()
}
