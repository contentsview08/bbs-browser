package io.github.contentsview08.obb.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

// 決まりは packages/conformance/save-name.json(PC 版の save_name.rs の試験も同じファイルを読む)
class SaveNameTest {
    @Test fun conformance() {
        val text = javaClass.classLoader!!.getResourceAsStream("save-name.json")!!.readBytes().toString(Charsets.UTF_8)
        val a = JSONArray(text)
        for (k in 0 until a.length()) {
            val c = a.getJSONObject(k)
            val i = c.getJSONObject("input")
            val got = i.optJSONObject("numbered")?.let { numberedName(it.getString("name"), it.getInt("n")) } ?: run {
                val v = i.optJSONObject("vars") ?: JSONObject()
                fun str(name: String) = if (v.has(name)) v.getString(name) else null
                val time = i.optString("time", "2026-11-11 09:05:03").split('-', ' ', ':').map { it.toInt() }
                val vars = SaveVars(str("boardUrl"), str("site"), str("board"), str("thread"), str("threadKey"), if (v.has("no")) v.getInt("no") else null, time, i.optLong("unix", 1_794_355_503))
                savePath(i.getString("pattern"), i.getString("url"), i.getString("ext"), vars).joinToString("/")
            }
            assertEquals(c.getString("name"), c.getString("expected"), got)
        }
    }
}
