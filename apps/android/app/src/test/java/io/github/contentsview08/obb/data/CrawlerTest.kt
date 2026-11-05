package io.github.contentsview08.obb.data

import org.junit.Assert.assertEquals
import org.junit.Test

class CrawlerTest {
    @Test fun アンカーの番号を読む() {
        assertEquals(setOf(5), Crawler.anchorsOf(">>5 それな"))
        assertEquals(setOf(5), Crawler.anchorsOf("＞＞5 それな"))
        assertEquals(setOf(5), Crawler.anchorsOf(">5 それな"))
        assertEquals(setOf(1, 12), Crawler.anchorsOf(">>1,12"))
        assertEquals(emptySet<Int>(), Crawler.anchorsOf("＞＞５ それな"))
        assertEquals(emptySet<Int>(), Crawler.anchorsOf(">> 5"))
        assertEquals(setOf(3, 4, 5), Crawler.anchorsOf(">>3-5"))
        assertEquals(setOf(1, 9), Crawler.anchorsOf(">>1\n本文\n>>9"))
        assertEquals(emptySet<Int>(), Crawler.anchorsOf("アンカーなし 123"))
    }
}
