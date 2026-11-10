package io.github.contentsview08.obb.bbs

import io.github.contentsview08.obb.data.contentRangeTotal
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// 動画のファイルの見分け方は PC 版(apps/desktop/test/urlKinds.test.ts・postBody.test.ts)と同じ例でそろえる
class VideoUrlTest {
    @Test fun 動画のファイル() {
        for (url in listOf("https://a.test/x.mp4", "https://a.test/x.WEBM", "https://a.test/x.mov?t=1", "https://a.test/x.m4v#t=1")) {
            assertTrue(url, isVideoFileUrl(url))
        }
    }

    @Test fun 動画のファイルではない() {
        for (url in listOf("https://a.test/x.mp4/page", "https://a.test/x.mp3", "https://a.test/mp4")) {
            assertFalse(url, isVideoFileUrl(url))
        }
    }

    private fun info(body: String) = PostIndex.build(listOf(Post(1, "", "", "", null, body))).info.getValue(1)

    @Test fun 本文の動画はサムネイルに出し_リンクのカードには回さない() {
        val i = info("これ https://example.com/a.mp4 と https://example.com/b.webm?x=1 と https://example.com/page")
        assertEquals(listOf("https://example.com/a.mp4", "https://example.com/b.webm?x=1"), i.videos)
        assertEquals(listOf("https://example.com/page"), i.links)
        assertTrue(i.video)
    }

    @Test fun 同じ動画は1つにまとめ_画像とYouTubeは混ぜない() {
        val i = info("https://a.test/v.mp4\nhttps://a.test/v.mp4\nhttps://a.test/p.jpg\nhttps://youtu.be/abcDEF12345")
        assertEquals(listOf("https://a.test/v.mp4"), i.videos)
        assertEquals(listOf("https://a.test/p.jpg"), i.images)
        assertEquals(listOf("abcDEF12345"), i.youtube.map { it.first })
    }

    @Test fun 崩した書き方の動画も読み替えた形で拾う() {
        assertEquals(listOf("https://video.twimg.com/x/a.mp4?tag=12"), info("ttps://video.twimg.com/x/a.mp4?tag=12").videos)
    }

    @Test fun Range_の応答から全体の大きさを読む() {
        assertEquals(12345678L, contentRangeTotal("bytes 0-131071/12345678"))
        assertNull(contentRangeTotal("bytes 0-131071/*"))
        assertNull(contentRangeTotal(null))
    }
}
