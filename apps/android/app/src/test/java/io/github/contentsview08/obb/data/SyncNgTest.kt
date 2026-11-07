package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.sync.parseStrictJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

// NG の差分と、同期で来た式の検査。PC と同じ表を読む
class SyncNgTest {
    private val a = NgRule("content", "a", id = "a", createdAt = 1)
    private val b = NgRule("content", "b", id = "b", createdAt = 1)
    private val old = NgRule("content", "o", id = "old", expiresOnDate = "2020-01-01", createdAt = 1)

    @Suppress("UNCHECKED_CAST")
    @Test fun 固まる式の表がPCと同じ() {
        val cases = parseStrictJson(File("../../../packages/conformance/ng-risky.json").readText()) as List<Map<String, Any?>>
        assertTrue(cases.size > 20)
        for (c in cases) assertEquals("${c["name"]}: ${c["pattern"]}", c["risky"], ngRiskyPattern(c["pattern"] as String))
    }

    @Test fun 差分は窓が見ていた配列と比べる() {
        val d = ngDiff(listOf(a), listOf(a, b), "2027-01-01")
        assertEquals(listOf(b), d.upsert)
        assertEquals(emptyList<String>(), d.remove)
        // 窓の知らない要素は今の値に残る
        val other = NgRule("content", "x", id = "x", createdAt = 1)
        assertEquals(listOf(a, other, b), applyNgDiff(listOf(a, other), d))
    }

    @Test fun 期限切れと読み込みでは消えた要素を送らない() {
        val expired = ngDiff(listOf(a, old), listOf(a), "2027-01-01")
        assertEquals(emptyList<String>(), expired.remove)
        assertEquals(listOf("old"), expired.drop)
        val imported = ngDiff(listOf(a, b), listOf(b), "2027-01-01", keepRemoved = true)
        assertEquals(emptyList<String>(), imported.remove)
        assertEquals(listOf("a"), imported.drop)
    }

    @Test fun 本文と行き来しても同じ() {
        val full = NgRule("posterId", "ID", true, false, "2030-01-01", "https://a.5ch.io/x/", "板", "メモ", "n1", 5)
        assertEquals(full, ngRuleFromBody(ngRuleToBody(full)))
    }

    @Test fun 画面が同期の対象の関数を直接呼ばない() {
        // 種類の入口の取りこぼしは静かにずれるので、呼び出しの一覧を固定する。applyPresets だけ例外
        val source = File("src/main/java/io/github/contentsview08/obb/AppViewModel.kt").readText()
        val direct = Regex("\\bdb\\.(setFavorite|reorderFavorites|addSite|removeSite|addUpload|importUploads|removeUpload)\\(").findAll(source).map { it.groupValues[1] }.toList()
        assertEquals(listOf("addSite", "setFavorite"), direct)
        assertTrue(!Regex("\\bprefs\\.setNg\\(").containsMatchIn(source))
    }

    @Test fun 同期のSQLに古いSQLiteで通らない文がない() {
        val root = File("src/main/java/io/github/contentsview08/obb")
        val files = File(root, "sync").walkTopDown().filter { it.extension == "kt" } + sequenceOf(File(root, "data/UserOps.kt"), File(root, "data/LogDb.kt"))
        for (f in files) assertTrue(f.name, !Regex("ON CONFLICT|RETURNING\\b|OVER\\s*\\(").containsMatchIn(f.readText()))
    }
}
