package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.sync.adapters.NgHost
import java.time.Instant
import java.time.ZoneId

// NG の差分と、同期の本文との行き来。PC の packages/logstore/src/ngRules.ts と同じ決まり

class NgDiff(val upsert: List<NgRule> = emptyList(), val remove: List<String> = emptyList(), val drop: List<String> = emptyList()) {
    val isEmpty get() = upsert.isEmpty() && remove.isEmpty() && drop.isEmpty()
}

/** before は after を作るもとになった配列。keepRemoved は消えた要素を送らない(読み込みなど、消す操作でないもの) */
fun ngDiff(before: List<NgRule>, after: List<NgRule>, today: String, keepRemoved: Boolean = false): NgDiff {
    val old = before.associateBy { it.id }
    val now = after.map { it.id }.toSet()
    val (expiredOrKept, removed) = before.filter { it.id !in now }.partition { keepRemoved || !it.expiresOnDate.isNullOrEmpty() && it.expiresOnDate < today }
    return NgDiff(after.filter { old[it.id] != it }, removed.map { it.id }, expiredOrKept.map { it.id })
}

fun applyNgDiff(base: List<NgRule>, d: NgDiff): List<NgRule> {
    val gone = (d.remove + d.drop).toSet()
    val next = d.upsert.associateBy { it.id }
    val kept = base.filter { it.id !in gone }.map { next[it.id] ?: it }
    val have = kept.map { it.id }.toSet()
    return kept + d.upsert.filter { it.id !in have }
}

fun ngRuleToBody(r: NgRule): Map<String, Any?> = buildMap {
    put("id", r.id)
    put("type", r.target)
    put("value", r.pattern)
    put("is_regex", r.isRegex)
    put("enabled", r.enabled)
    if (!r.expiresOnDate.isNullOrEmpty()) put("expires_on", r.expiresOnDate)
    if (!r.boardUrl.isNullOrEmpty()) put("board_url", r.boardUrl)
    if (!r.boardName.isNullOrEmpty()) put("board_name", r.boardName.take(256))
    if (!r.note.isNullOrEmpty()) put("note", r.note.take(1024))
    if (r.createdAt > 0) put("created_at", r.createdAt)
}

fun ngRuleFromBody(b: Map<String, Any?>): NgRule = NgRule(
    target = b["type"] as String,
    pattern = b["value"] as String,
    isRegex = b["is_regex"] == true,
    enabled = b["enabled"] != false,
    expiresOnDate = (b["expires_on"] as? String)?.ifEmpty { null },
    boardUrl = (b["board_url"] as? String)?.ifEmpty { null },
    boardName = (b["board_name"] as? String)?.ifEmpty { null },
    note = (b["note"] as? String)?.ifEmpty { null },
    id = b["id"] as String,
    createdAt = b["created_at"] as? Long ?: 0L,
)

/** 同期の適用の口。read と write は置き場の読み書き(スマホは Prefs) */
class SyncNgHost(private val read: () -> List<NgRule>, private val write: (NgDiff) -> Unit, private val date: (Long) -> String = ::localDate) : NgHost {
    override fun read() = read.invoke().map(::ngRuleToBody)

    override fun apply(changes: Map<String, Map<String, Any?>?>) {
        write(NgDiff(changes.values.filterNotNull().map(::ngRuleFromBody), changes.filterValues { it == null }.keys.toList()))
    }

    override fun patternOk(pattern: String, isRegex: Boolean) = ngPatternError(pattern, isRegex) == null && (!isRegex || !ngRiskyPattern(pattern))

    override fun today(nowMs: Long) = date(nowMs)
}

private fun localDate(nowMs: Long) = Instant.ofEpochMilli(nowMs).atZone(ZoneId.systemDefault()).toLocalDate().toString()

private const val WIDE_MAX = 3
private const val REPEAT_MAX = 1000L
private const val NESTED_REPEAT_MAX = 8L
/** 選択肢の先頭が何にでも当たる印 */
private const val ANY_HEAD = "*"
private val GROUP_MARK = Regex("\\?(?::|=|!|<=|<!|<[^>]*>)")
private val QUANTIFIER_AT = Regex("(?:[*+?]|\\{([0-9]+)(,([0-9]*))?\\})\\??")

/**
 * 同期で来た式を手元に入れる前の検査。正規表現は途中で止められないので、固まる形を文字の上で見分ける。
 * 繰り返しの中の繰り返し、重なる選択肢の繰り返し、幅の広い繰り返しの連続と多用、巨大な回数を落とす(utils/ng.ts と同じ。packages/conformance/ng-risky.json)
 */
fun ngRiskyPattern(pattern: String): Boolean {
    val p = if (pattern.startsWith("(?i)")) pattern.substring(4) else pattern
    class Frame(var variable: Boolean = false, val alts: ArrayList<String?> = ArrayList(), var head: String? = null, var lastWide: Boolean = false)
    val stack = arrayListOf(Frame())
    fun top() = stack.last()
    fun setHead(h: String) {
        if (top().head == null) top().head = h
    }
    var wide = 0
    var i = 0
    while (i < p.length) {
        val c = p[i]
        var isWide = false
        var groupVariable = false
        var groupOverlap = false
        var isGroup = false
        when (c) {
            '(' -> {
                setHead(ANY_HEAD)
                i++
                GROUP_MARK.matchAt(p, i)?.let { i += it.value.length }
                stack += Frame()
                continue
            }
            '|' -> {
                top().alts += top().head
                top().head = null
                top().lastWide = false
                i++
                continue
            }
            '^', '$' -> {
                i++
                continue
            }
            ')' -> {
                if (stack.size == 1) return false
                val f = stack.removeAt(stack.lastIndex)
                val alts = f.alts + f.head
                isGroup = true
                groupVariable = f.variable
                groupOverlap = alts.size > 1 && (null in alts || ANY_HEAD in alts || alts.toSet().size < alts.size)
                top().variable = top().variable || f.variable
                i++
            }
            '\\' -> {
                val e = p.getOrElse(i + 1) { ' ' }
                isWide = i + 1 < p.length && e in "dDwWsSpP"
                i += 2
                if ((e == 'p' || e == 'P') && p.getOrNull(i) == '{') {
                    val end = p.indexOf('}', i)
                    i = if (end < 0) p.length else end + 1
                }
                setHead(if (isWide) ANY_HEAD else "\\$e")
            }
            '[' -> {
                i++
                if (p.getOrNull(i) == '^') i++
                while (i < p.length && p[i] != ']') i += if (p[i] == '\\') 2 else 1
                i++
                isWide = true
                setHead(ANY_HEAD)
            }
            else -> {
                isWide = c == '.'
                i++
                setHead(if (isWide) ANY_HEAD else c.toString())
            }
        }
        val q = if (i < p.length) QUANTIFIER_AT.matchAt(p, i) else null
        if (q == null) {
            top().lastWide = false
            continue
        }
        i += q.value.length
        val first = q.value[0]
        val minText = q.groups[1]?.value
        val min = minText?.let { it.toLongOrNull() ?: Long.MAX_VALUE } ?: if (first == '+') 1L else 0L
        val hasComma = q.groups[2] != null
        val maxText = q.groups[3]?.value.orEmpty()
        val open = first == '*' || first == '+' || (hasComma && maxText.isEmpty())
        val max = when {
            first == '?' -> 1L
            open -> Long.MAX_VALUE
            !hasComma -> min
            else -> maxText.toLongOrNull() ?: Long.MAX_VALUE
        }
        if (min > REPEAT_MAX || (!open && max > REPEAT_MAX)) return true
        if (isGroup && ((groupVariable && max > NESTED_REPEAT_MAX) || (groupOverlap && max > 1))) return true
        if (max != min) top().variable = true
        if (open && (isWide || isGroup)) {
            if (top().lastWide || ++wide > WIDE_MAX) return true
            top().lastWide = true
        } else top().lastWide = false
    }
    return false
}
