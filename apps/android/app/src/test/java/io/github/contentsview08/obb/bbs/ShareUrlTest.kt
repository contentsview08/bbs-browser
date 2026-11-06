package io.github.contentsview08.obb.bbs

import org.junit.Assert.assertEquals
import org.junit.Test

class ShareUrlTest {
    @Test fun レスの番号を付ける() {
        assertEquals("https://eagle.5ch.io/test/read.cgi/livejupiter/1700000000/12", TwoCh.postWebUrl("https://eagle.5ch.io/test/read.cgi/livejupiter/1700000000/", 12))
        assertEquals(
            "https://red-edge.net/boards/livejupter/6aefe762-1722-4b73-80f5-59db564142c7/5",
            TwoCh.postWebUrl("https://red-edge.net/boards/livejupter/6aefe762-1722-4b73-80f5-59db564142c7", 5),
        )
    }

    @Test fun 番号で開けない形はそのまま() {
        assertEquals("https://may.2chan.net/b/res/123.htm", TwoCh.postWebUrl("https://may.2chan.net/b/res/123.htm", 5))
    }

    @Test fun hono_bbsの番号付きURLを読む() {
        val url = "https://red-edge.net/boards/livejupter/6aefe762-1722-4b73-80f5-59db564142c7/5"
        assertEquals(5, HonoBbs.resNoIn(url))
        assertEquals("6aefe762-1722-4b73-80f5-59db564142c7", HonoBbs.parseThreadUrl(url)?.key)
    }
}
