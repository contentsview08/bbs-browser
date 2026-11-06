package io.github.contentsview08.obb.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WebUploadScriptsTest {
    private val site = WebUploadSite("imgur", "imgur", "https://imgur.com/upload", """https://i\.imgur\.com/[A-Za-z0-9]{5,}\.(?:jpe?g|png)""")
    private fun file(hash: String = "h1") = WebUploadFile("image.png", "image/png", byteArrayOf(1, 2, 3), hash)

    @Test fun `上限ちょうどまでは渡せて超えると理由が出る`() {
        assertNull(webPassProblem(WEB_PASS_MAX_BYTES))
        val msg = webPassProblem(WEB_PASS_MAX_BYTES + 1)
        assertNotNull(msg)
        assertTrue(msg!!.contains("20MB"))
    }

    @Test fun `区切った base64 はつなぐと元に戻り切れ目ごとに解ける`() {
        val bytes = ByteArray(1000) { it.toByte() }
        val parts = webPassParts(bytes, 300).toList()
        assertEquals(webPassPartCount(bytes.size, 300), parts.size)
        val back = parts.map { java.util.Base64.getDecoder().decode(it) }.reduce { a, b -> a + b }
        assertTrue(bytes.contentEquals(back))
    }

    @Test fun `空の中身は区切りがなく数も 0`() {
        assertEquals(0, webPassParts(ByteArray(0)).count())
        assertEquals(0, webPassPartCount(0, 300))
    }

    @Test fun `置き場のサイトと下の階層だけに渡す`() {
        assertTrue(isWebUploadPage("https://imgur.com/upload", site.url))
        assertTrue(isWebUploadPage("https://www.imgur.com/a", site.url))
        assertFalse(isWebUploadPage("https://notimgur.com/", site.url))
        assertFalse(isWebUploadPage("https://imgur.com.example.net/", site.url))
        assertFalse(isWebUploadPage(null, site.url))
        assertFalse(isWebUploadPage("not a url", site.url))
    }

    @Test fun `見張りの結果は形の合うリンクだけを 1 度ずつ受け取る`() {
        val raw = "\"[\\\"https://i.imgur.com/abcde.png\\\",\\\"https://evil.example/x.png\\\",\\\"https://i.imgur.com/abcde.png\\\"]\""
        assertEquals(listOf("https://i.imgur.com/abcde.png"), parseWebUploadLinks(raw, site.pattern))
    }

    @Test fun `見張りの結果が読めなければ空`() {
        assertEquals(emptyList<String>(), parseWebUploadLinks(null, site.pattern))
        assertEquals(emptyList<String>(), parseWebUploadLinks("null", site.pattern))
        assertEquals(emptyList<String>(), parseWebUploadLinks("\"oops\"", site.pattern))
    }

    @Test fun `渡した結果を読む`() {
        assertEquals("paste", webPassResult("\"paste\""))
        assertEquals("drop", webPassResult("\"drop\""))
        assertEquals("none", webPassResult("\"none\""))
        assertEquals("lost", webPassResult("\"lost\""))
        assertEquals("lost", webPassResult("null"))
        assertEquals("lost", webPassResult(null))
    }

    @Test fun `受け付けた 1 枚の最初のリンクだけにハッシュを付ける`() {
        val job = WebUploadJob(site, listOf(file())).apply { accepted = true }
        assertEquals("h1", job.hashForLink())
        assertNull(job.hashForLink())
    }

    @Test fun `受け付けていないと手で選ぶと複数ではハッシュを付けない`() {
        assertNull(WebUploadJob(site, listOf(file())).hashForLink())
        assertNull(WebUploadJob(site, listOf(file())).apply { accepted = true; manualPick = true }.hashForLink())
        assertNull(WebUploadJob(site, listOf(file("a"), file("b"))).apply { accepted = true }.hashForLink())
        assertNull(WebUploadJob(site).apply { accepted = true }.hashForLink())
    }

    @Test fun `渡した数だけ来たらすぐ閉じ足りなければ待つ`() {
        assertEquals(4000L, webUploadCloseDelayMs(0, 1))
        assertEquals(1200L, webUploadCloseDelayMs(2, 2))
        assertEquals(30000L, webUploadCloseDelayMs(2, 1))
    }

    @Test fun `スクリプトに値が入る`() {
        val watch = webUploadWatchScript(site.pattern)
        assertFalse(watch.contains("__PATTERN__"))
        assertTrue(watch.contains("""https://i\\.imgur\\.com"""))
        val part = webPassPartScript(1, "QUJD")
        assertFalse(part.contains("__INDEX__"))
        assertFalse(part.contains("__DATA__"))
        val fire = webPassFireScript(listOf(file()))
        assertFalse(fire.contains("__FILES__"))
        assertTrue(fire.contains("image.png"))
    }
}
