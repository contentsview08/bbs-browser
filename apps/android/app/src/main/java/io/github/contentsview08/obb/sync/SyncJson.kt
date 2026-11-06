package io.github.contentsview08.obb.sync

// 暗号文の中の JSON。org.json は端末と単体テストで実装が違い、シングルクォートなどの崩れた JSON も通すので、PC 版の JSON.parse と同じ厳しさのものを持つ。
// 値は Map・List・String・Long・Double・Boolean・null で表す

const val MAX_JSON_DEPTH = 32
private const val MAX_SAFE = 9007199254740991L

/** 同じ値は PC とスマホで同じ文字列になるように、キーを並べて書く */
fun canonicalJson(v: Any?): String = StringBuilder().also { writeCanonical(it, v) }.toString()

private fun writeCanonical(out: StringBuilder, v: Any?) {
    when (v) {
        null -> out.append("null")
        is String -> writeString(out, v)
        is Boolean, is Long, is Int, is Double -> out.append(v.toString())
        is List<*> -> {
            out.append('[')
            v.forEachIndexed { i, x ->
                if (i > 0) out.append(',')
                writeCanonical(out, x)
            }
            out.append(']')
        }
        is Map<*, *> -> {
            out.append('{')
            v.keys.map { it as String }.sorted().forEachIndexed { i, k ->
                if (i > 0) out.append(',')
                writeString(out, k)
                out.append(':')
                writeCanonical(out, v[k])
            }
            out.append('}')
        }
        else -> throw SyncError("bad_json")
    }
}

/** JSON.stringify と同じ書き方 */
private fun writeString(out: StringBuilder, s: String) {
    out.append('"')
    var i = 0
    while (i < s.length) {
        val c = s[i]
        when {
            c == '"' -> out.append("\\\"")
            c == '\\' -> out.append("\\\\")
            c == '\b' -> out.append("\\b")
            c == '\u000c' -> out.append("\\f")
            c == '\n' -> out.append("\\n")
            c == '\r' -> out.append("\\r")
            c == '\t' -> out.append("\\t")
            c < ' ' -> out.append("\\u%04x".format(c.code))
            c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate() -> {
                out.append(c).append(s[i + 1])
                i++
            }
            c.isSurrogate() -> out.append("\\u%04x".format(c.code))
            else -> out.append(c)
        }
        i++
    }
    out.append('"')
}

fun parseStrictJson(text: String): Any? {
    val p = StrictParser(text)
    val v = p.value(0)
    p.space()
    if (!p.atEnd()) throw SyncError("bad_json")
    return v
}

private class StrictParser(private val s: String) {
    private var i = 0

    fun atEnd() = i >= s.length

    fun space() {
        while (i < s.length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++
    }

    private fun fail(): Nothing = throw SyncError("bad_json")

    fun value(depth: Int): Any? {
        space()
        if (atEnd()) fail()
        return when (s[i]) {
            '{' -> obj(depth + 1)
            '[' -> arr(depth + 1)
            '"' -> str()
            't' -> word("true", true)
            'f' -> word("false", false)
            'n' -> word("null", null)
            else -> number()
        }
    }

    private fun word(w: String, v: Any?): Any? {
        if (!s.startsWith(w, i)) fail()
        i += w.length
        return v
    }

    private fun obj(depth: Int): Map<String, Any?> {
        if (depth > MAX_JSON_DEPTH) fail()
        i++
        val out = LinkedHashMap<String, Any?>()
        space()
        if (!atEnd() && s[i] == '}') {
            i++
            return out
        }
        while (true) {
            space()
            if (atEnd() || s[i] != '"') fail()
            val k = str()
            space()
            if (atEnd() || s[i] != ':') fail()
            i++
            // 同じキーは JSON.parse と同じく後の値
            out[k] = value(depth)
            space()
            if (atEnd()) fail()
            when (s[i++]) {
                ',' -> {}
                '}' -> return out
                else -> fail()
            }
        }
    }

    private fun arr(depth: Int): List<Any?> {
        if (depth > MAX_JSON_DEPTH) fail()
        i++
        val out = ArrayList<Any?>()
        space()
        if (!atEnd() && s[i] == ']') {
            i++
            return out
        }
        while (true) {
            out += value(depth)
            space()
            if (atEnd()) fail()
            when (s[i++]) {
                ',' -> {}
                ']' -> return out
                else -> fail()
            }
        }
    }

    private fun str(): String {
        i++
        val b = StringBuilder()
        while (true) {
            if (atEnd()) fail()
            val c = s[i++]
            when {
                c == '"' -> return b.toString()
                c < ' ' -> fail()
                c == '\\' -> {
                    if (atEnd()) fail()
                    when (s[i++]) {
                        '"' -> b.append('"')
                        '\\' -> b.append('\\')
                        '/' -> b.append('/')
                        'b' -> b.append('\b')
                        'f' -> b.append('\u000c')
                        'n' -> b.append('\n')
                        'r' -> b.append('\r')
                        't' -> b.append('\t')
                        'u' -> {
                            if (i + 4 > s.length) fail()
                            val hex = s.substring(i, i + 4)
                            if (!hex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) fail()
                            b.append(hex.toInt(16).toChar())
                            i += 4
                        }
                        else -> fail()
                    }
                }
                else -> b.append(c)
            }
        }
    }

    private fun number(): Any {
        val m = NUMBER.matchAt(s, i) ?: fail()
        i += m.value.length
        val whole = m.groupValues[1].isEmpty() && m.groupValues[2].isEmpty()
        if (whole) m.value.toLongOrNull()?.let { return it }
        val d = m.value.toDouble()
        // JSON.parse と同じく、1.0 と 1 は同じ数
        return if (d == Math.rint(d) && Math.abs(d) <= MAX_SAFE) d.toLong() else d
    }

    private companion object {
        val NUMBER = Regex("-?(?:0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?")
    }
}
