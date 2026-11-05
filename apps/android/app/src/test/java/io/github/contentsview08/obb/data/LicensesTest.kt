package io.github.contentsview08.obb.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class LicensesTest {
    private val file = parseLicenses(File("src/main/assets/licenses.json").readText())

    @Test fun 全文の番号がすべて指せる() {
        for (p in file.packages) for ((_, i) in p.texts) assertTrue(i in file.texts.indices)
    }

    @Test fun 配布物の中心が入りテストの依存は入らない() {
        val names = file.packages.map { it.name }.toSet()
        assertTrue("com.squareup.okhttp3:okhttp" in names)
        assertTrue("aahub_light" in names)
        assertFalse("junit:junit" in names)
    }

    @Test fun 名前とライセンスで探す() {
        val p = LicensePackage("a:okhttp", "4.12.0", "Apache-2.0", "", "gradle", null, emptyList())
        val q = LicensePackage("b:onnx", "1.0", "MIT", "", "gradle", null, emptyList())
        assertEquals(listOf(p), filterLicenses(listOf(p, q), "OKHTTP\u3000apache"))
        assertEquals(listOf(q), filterLicenses(listOf(p, q), "mit"))
        assertEquals(2, filterLicenses(listOf(p, q), " ").size)
    }

    @Test fun 標準文のリンクはSPDXの表記だけ() {
        assertEquals(listOf("MIT", "Apache-2.0"), spdxLinks("(MIT OR Apache-2.0)").map { it.first })
        assertEquals(emptyList<String>(), spdxLinks("不明").map { it.first })
    }
}
