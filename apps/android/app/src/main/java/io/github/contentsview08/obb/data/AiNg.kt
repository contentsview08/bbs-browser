package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.Post
import org.json.JSONArray
import org.json.JSONObject

// AI NG: 利用者が文で書いた条件に、レスが当たるかを端末の中の判定モデル(data/AiModel.kt)で調べる。
// PC 版・Web の utils/aiNg.ts と同じ項目・同じ JSON・同じ決め方(判定と見せ方を分ける・手の印が先・印が 3 件ずつそろうと学んだ判定を半々に混ぜる)

/** 見せ方: hide は出さない、fold は畳む(押せば見られる)、mark は印だけ */
val AI_NG_SHOWS = listOf("fold" to "畳む", "mark" to "印だけ", "hide" to "隠す")
const val AI_DEFAULT_THRESHOLD = 0.8f
const val AI_MIN_EXAMPLES = 3
private const val OVERRIDE_MAX = 2000
private const val EXAMPLE_MAX = 300

data class AiNgRule(
    val id: String,
    val name: String,
    val prompt: String,
    val threshold: Float = AI_DEFAULT_THRESHOLD,
    val show: String = "fold",
    val enabled: Boolean = true,
    val boardUrl: String? = null,
    val boardName: String? = null,
    /** スレの話題(スレタイと 1 レス目の頭)を添えて判定する(文脈で決まる条件に) */
    val withContext: Boolean = false,
    /** 同じ ID がこのスレで 2 回以上当たったら、その ID の書き込みをすべて当てる */
    val sameId: Boolean = false,
) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("name", name).put("prompt", prompt).put("threshold", threshold.toDouble())
        .put("show", show).put("enabled", enabled).put("boardUrl", boardUrl).put("boardName", boardName).put("withContext", withContext).put("sameId", sameId)

    companion object {
        fun fromJson(o: JSONObject) = AiNgRule(
            o.getString("id"), o.optString("name"), o.optString("prompt"), o.optDouble("threshold", AI_DEFAULT_THRESHOLD.toDouble()).toFloat(),
            o.optString("show", "fold"), o.optBoolean("enabled", true), o.optString("boardUrl").ifEmpty { null }, o.optString("boardName").ifEmpty { null },
            o.optBoolean("withContext", false), o.optBoolean("sameId", false),
        )

        /** はじめに入れておく条件の見本(どれも切ってある。PC 版の AI_NG_SAMPLES と同じ)。話題そのものは当てず、話題から外れたものだけ */
        val SAMPLES = listOf(
            AiNgRule("sample-0", "スレ違い", "スレの話題と関係のない話をしている", show = "mark", enabled = false, withContext = true),
            AiNgRule("sample-1", "煽り", "特定の相手を繰り返し煽ったり、見下したりしている", show = "mark", enabled = false, withContext = true, sameId = true),
            AiNgRule("sample-2", "宣伝", "商品やサイトの宣伝・勧誘をしている", show = "mark", enabled = false),
        )
    }
}

/** スレの話題として判定に添える文(スレタイと 1 レス目の頭)。PC 版の threadContextOf と同じ */
fun threadContextOf(title: String, firstBody: String?): String {
    val head = firstBody?.let { aiTextOf(it).take(120) }.orEmpty()
    return "スレ「${title.take(60)}」" + if (head.isNotEmpty()) "($head)" else ""
}

/** モデルに渡す文: 文脈つきの条件なら、スレの話題を頭に添える */
fun aiInputOf(body: String, context: String?): String {
    val text = aiTextOf(body)
    return if (context.isNullOrEmpty()) text else "${context}への書き込み: $text"
}

/** 手で付けた「当たる(hit)・当たらない(miss)」(本文の鍵)と、学ぶための本文 */
data class AiNgOverride(val hit: List<String> = emptyList(), val miss: List<String> = emptyList(), val examples: List<Pair<String, Boolean>> = emptyList()) {
    fun toJson(): JSONObject = JSONObject().put("hit", JSONArray(hit)).put("miss", JSONArray(miss))
        .put("examples", JSONArray().apply { for ((t, h) in examples) put(JSONObject().put("text", t).put("hit", h)) })

    companion object {
        fun fromJson(o: JSONObject): AiNgOverride {
            fun strs(k: String) = o.optJSONArray(k)?.let { a -> List(a.length()) { a.getString(it) } } ?: emptyList()
            val ex = o.optJSONArray("examples")?.let { a -> List(a.length()) { a.getJSONObject(it).let { e -> e.getString("text") to e.getBoolean("hit") } } } ?: emptyList()
            return AiNgOverride(strs("hit"), strs("miss"), ex)
        }
    }
}

data class AiHit(val rule: AiNgRule, val p: Float?, val manual: Boolean, val sameId: Boolean = false) {
    /** 画面に出す理由(「AI NG・煽り 87%」) */
    val label get() = "AI NG・${rule.name.ifEmpty { rule.prompt }}${if (manual) "(手で)" else if (sameId) "(同じ ID の続き)" else p?.let { " ${(it * 100).toInt()}%" } ?: ""}"
}

/** 仮説の形: 条件の文をそのまま */
fun hypothesisOf(prompt: String) = prompt.trim().trimEnd('。', '.') + "。"

/** 判定に渡す本文: アンカーだけの行・URL を除き、長すぎるものは頭だけ */
fun aiTextOf(body: String): String = body.lines().filter { !Regex("""^\s*>>[0-9]""").containsMatchIn(it) }.joinToString("\n")
    .replace(Regex("""https?://\S+"""), "").replace(Regex("""\s+"""), " ").trim().take(300)

/** 本文の鍵(PC 版の autoNg.ts の bodyKey と同じ: アンカーの行と空白を除いた本文の cyrb53 を 16 進で) */
fun bodyKey(body: String): String {
    val s = body.lines().filter { !Regex("""^\s*>>""").containsMatchIn(it) }.joinToString("").replace(Regex("""\s+"""), "")
    var h1 = 0xdeadbeef.toInt()
    var h2 = 0x41c6ce57
    for (ch in s) {
        h1 = (h1 xor ch.code) * 2654435761L.toInt()
        h2 = (h2 xor ch.code) * 1597334677
    }
    h1 = ((h1 xor (h1 ushr 16)) * 2246822507L.toInt()) xor ((h2 xor (h2 ushr 13)) * 3266489909L.toInt())
    h2 = ((h2 xor (h2 ushr 16)) * 2246822507L.toInt()) xor ((h1 xor (h1 ushr 13)) * 3266489909L.toInt())
    return (4294967296L * (2097151L and h2.toLong()) + (h1.toLong() and 0xFFFFFFFFL)).toString(16)
}

fun activeRules(rules: List<AiNgRule>, boardUrl: String?) = rules.filter { it.enabled && it.prompt.isNotBlank() && (it.boardUrl == null || it.boardUrl == boardUrl) }

private val STRENGTH = mapOf("hide" to 3, "fold" to 2, "mark" to 1)

/** スレのレスを判定する(手の印が先。scoreOf はモデルの当たり具合で、まだなら null) */
fun judgeAiNg(
    posts: List<Post>, rules: List<AiNgRule>, scoreOf: (String, String, String?) -> Float?, overrides: Map<String, AiNgOverride>, learned: Map<String, RuleModel>,
    /** スレの話題(withContext の条件に添える) */
    context: String = "",
): Map<Int, AiHit> {
    if (rules.isEmpty()) return emptyMap()
    val sets = rules.associate { r -> r.id to (overrides[r.id]?.hit.orEmpty().toHashSet() to overrides[r.id]?.miss.orEmpty().toHashSet()) }
    val hitOf = HashMap<Int, MutableList<AiHit>>()
    /** 条件ごとに、当たった ID の数(sameId のため) */
    val idHits = HashMap<String, HashMap<String, Int>>()
    for (p in posts) {
        if (aiTextOf(p.body).isEmpty()) continue
        val key = bodyKey(p.body)
        for (r in rules) {
            val (hit, miss) = sets.getValue(r.id)
            if (key in miss) continue
            val h = if (key in hit) AiHit(r, null, true) else {
                val m = scoreOf(p.body, r.prompt, if (r.withContext) context else null)
                val s = if (m == null) null else learned[r.id]?.let { (m + it.predict(p.body)) / 2 } ?: m
                if (s != null && s >= r.threshold) AiHit(r, s, false) else null
            } ?: continue
            hitOf.getOrPut(p.no) { ArrayList() }.add(h)
            p.id?.let { id -> idHits.getOrPut(r.id) { HashMap() }.merge(id, 1, Int::plus) }
        }
    }
    // 同じ ID が 2 回以上当たった条件は、その ID の書き込みをすべて当てる(手で「当たらない」を付けたものは除く)
    for (r in rules) {
        if (!r.sameId) continue
        val counts = idHits[r.id] ?: continue
        for (p in posts) {
            val id = p.id ?: continue
            if ((counts[id] ?: 0) < 2 || hitOf[p.no]?.any { it.rule.id == r.id } == true) continue
            if (bodyKey(p.body) in sets.getValue(r.id).second) continue
            hitOf.getOrPut(p.no) { ArrayList() }.add(AiHit(r, null, false, sameId = true))
        }
    }
    return hitOf.mapValues { (_, hs) -> hs.maxBy { STRENGTH.getValue(it.rule.show) } }
}

/** 手の印を付ける・外す(mark が null なら外す) */
fun setOverride(overrides: Map<String, AiNgOverride>, ruleId: String, body: String, mark: Boolean?): Map<String, AiNgOverride> {
    val key = bodyKey(body)
    val cur = overrides[ruleId] ?: AiNgOverride()
    val text = aiTextOf(body)
    val hit = cur.hit.filter { it != key }.toMutableList()
    val miss = cur.miss.filter { it != key }.toMutableList()
    val ex = cur.examples.filter { it.first != text }.toMutableList()
    if (mark == true) hit += key
    if (mark == false) miss += key
    if (mark != null && text.isNotEmpty()) ex += text to mark
    return overrides + (ruleId to AiNgOverride(hit.takeLast(OVERRIDE_MAX), miss.takeLast(OVERRIDE_MAX), ex.takeLast(EXAMPLE_MAX)))
}

// ── 印から学ぶ判定(条件ごと)。PC 版の trainRule・predictRule と同じ(文字の 1〜3 文字の並び → ロジスティック回帰) ──

private const val DIM = 1 shl 14

private fun hash(s: String): Int {
    var h = 0x811c9dc5.toInt()
    for (c in s) h = (h xor c.code) * 16777619
    return h and (DIM - 1)
}

private fun featuresOf(text: String): Map<Int, Float> {
    val f = HashMap<Int, Float>()
    val cps = text.replace(Regex("""\s+"""), "").codePoints().toArray().take(300)
    for (n in 1..3) for (i in 0..cps.size - n) {
        val sb = StringBuilder()
        for (j in i until i + n) sb.appendCodePoint(cps[j])
        val k = hash(sb.toString())
        f[k] = (f[k] ?: 0f) + 1f
    }
    val norm = kotlin.math.sqrt(f.values.sumOf { (it * it).toDouble() }).toFloat().takeIf { it > 0f } ?: 1f
    for (k in f.keys.toList()) f[k] = f.getValue(k) / norm
    return f
}

class RuleModel(private val w: FloatArray, private val b: Float) {
    fun predict(body: String): Float {
        var z = b
        for ((k, v) in featuresOf(aiTextOf(body))) z += w[k] * v
        return (1.0 / (1.0 + kotlin.math.exp(-z.toDouble()))).toFloat()
    }

    companion object {
        /** 手の印から学ぶ。当たる・当たらないが AI_MIN_EXAMPLES 件ずつなければ null */
        fun train(examples: List<Pair<String, Boolean>>): RuleModel? {
            val pos = examples.count { it.second }
            val neg = examples.size - pos
            if (pos < AI_MIN_EXAMPLES || neg < AI_MIN_EXAMPLES) return null
            val data = examples.map { featuresOf(it.first) to if (it.second) 1f else 0f }
            val w = FloatArray(DIM)
            var b = 0f
            val wPos = examples.size / (2f * pos)
            val wNeg = examples.size / (2f * neg)
            for (epoch in 0 until 60) for (i in data.indices) {
                val (f, y) = data[((i.toLong() * 7919 + epoch) % data.size).toInt()]
                var z = b
                for ((k, v) in f) z += w[k] * v
                val g = ((1.0 / (1.0 + kotlin.math.exp(-z.toDouble()))).toFloat() - y) * (if (y > 0f) wPos else wNeg)
                for ((k, v) in f) w[k] -= 0.3f * (g * v + 1e-4f * w[k])
                b -= 0.3f * g
            }
            return RuleModel(w, b)
        }
    }
}

fun trainRules(rules: List<AiNgRule>, overrides: Map<String, AiNgOverride>): Map<String, RuleModel> =
    rules.mapNotNull { r -> RuleModel.train(overrides[r.id]?.examples.orEmpty())?.let { r.id to it } }.toMap()
