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

    private val min = 60_000L

    @Test fun 既定の間隔で確かめる() {
        val c = CrawlClock()
        // 最初は間隔が過ぎているものとして全部(閲覧履歴は既定で 0 なので見ない)
        assertEquals(CrawlScope(history = false, fav = true, keyword = true), c.due(100 * min, 0, 5, 10))
        assertEquals(null, c.due(101 * min, 0, 5, 10))
        assertEquals(CrawlScope(history = false, fav = true, keyword = false), c.due(105 * min, 0, 5, 10))
        assertEquals(CrawlScope(history = false, fav = true, keyword = true), c.due(110 * min, 0, 5, 10))
    }

    @Test fun 五分より短くしない() {
        val c = CrawlClock()
        c.due(100 * min, 1, 1, 1)
        assertEquals(null, c.due(104 * min, 1, 1, 1))
        assertEquals(CrawlScope(), c.due(105 * min, 1, 1, 1))
    }

    @Test fun 分が0なら見ない() {
        assertEquals(null, CrawlClock().due(100 * min, 0, 0, 0))
    }
}
