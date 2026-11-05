package io.github.contentsview08.obb.bbs

import org.junit.Assert.assertEquals
import org.junit.Test

class EncodingTest {
    @Test fun 一般のページは日本語以外の宣言に従う() {
        val bytes = "café".toByteArray(Charsets.ISO_8859_1)
        assertEquals("café", decodeHtml(bytes, "text/html; charset=iso-8859-1"))
    }

    @Test fun BOMは文字に残さない() {
        val bytes = byteArrayOf(0xef.toByte(), 0xbb.toByte(), 0xbf.toByte()) + "板".toByteArray()
        assertEquals("板", decodeText(bytes, null))
    }

    @Test fun 板一覧だけUTF8のサイトの板の名前を読める() {
        val html = "<html><head><meta charset=\"UTF-8\"></head><body><b>庭園板一覧</b><br><a href=\"https://example.net/garden/\">チューリップ庭園</a><br></body></html>"
        val boards = parseBbsMenuHtml(decodeText(html.toByteArray(), "text/html"))
        assertEquals(listOf("チューリップ庭園"), boards.map { it.name })
    }
}
