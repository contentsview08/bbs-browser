package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.DatCursor
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

// ログの DB のうち JVM で確かめられるところ(差分の位置の保存形式・テーブルを作る SQL の分け方)
class LogFormatTest {
    @Test fun 続きの位置は保存して読み戻せる() {
        for (c in listOf(DatCursor(123, 4, "Mon, 01 Jan 2026 00:00:00 GMT"), DatCursor(123, 4, null), DatCursor(9_000_000_000L, 1000, null, kako = true))) {
            assertEquals(c, cursorFromJson(cursorToJson(c)))
        }
    }

    @Test fun 保存形式はPC版と同じ名前() {
        val o = JSONObject(cursorToJson(DatCursor(1, 2, "M", kako = true)))
        assertEquals(setOf("bytes", "postCount", "lastModified", "kako"), o.keys().asSequence().toSet())
        assertEquals(setOf("bytes", "postCount"), JSONObject(cursorToJson(DatCursor(1, 2, null))).keys().asSequence().toSet())
    }

    @Test fun 壊れた位置は位置なしに読む() {
        assertNull(cursorFromJson("not json"))
        assertNull(cursorFromJson("""{"postCount":2}"""))
        assertNull(cursorFromJson("""{"bytes":"x","postCount":2}"""))
    }

    @Test fun SQLはコメントを外して文ごとに分ける() {
        val sql = "-- 説明;\nCREATE TABLE a (\n  x TEXT\n);\n\n  -- 字下げの説明\nINSERT INTO a VALUES ('1');\nDROP TABLE b"
        assertEquals(listOf("CREATE TABLE a (\n  x TEXT\n)", "INSERT INTO a VALUES ('1')", "DROP TABLE b"), splitSql(sql))
    }

    private val migrations = File("../../../packages/logstore/migrations").listFiles()!!.filter { it.name.endsWith(".sql") }.sortedBy { it.name }

    // execSQL は最初の 1 文しか流さないので、文がつながると後ろのテーブルが黙って作られない
    @Test fun 本物のマイグレーションが1文ずつに分かれる() {
        assertTrue(migrations.isNotEmpty())
        val start = Regex("^(CREATE|INSERT|ALTER|DROP|UPDATE|DELETE)\\b", RegexOption.IGNORE_CASE)
        for (f in migrations) {
            val list = splitSql(f.readText())
            assertTrue(f.name, list.isNotEmpty())
            for (s in list) {
                assertTrue("${f.name}: $s", start.containsMatchIn(s))
                assertFalse("${f.name}: $s", s.contains(';'))
            }
        }
    }

    @Test fun マイグレーションはPC版のファイルをそのまま使い欠けがない() {
        assertEquals(migrations.indices.map { it + 1 }, migrations.map { it.name.take(3).toInt() })
        assertTrue(migrations.any { it.name == "017_upload_delete_url.sql" })
        // 写しを置くと、ビルドで入るものと二重になる
        assertFalse(File("src/main/assets/migrations").exists())
        assertTrue(File("build.gradle.kts").readText().contains("packages/logstore/migrations"))
    }
}
