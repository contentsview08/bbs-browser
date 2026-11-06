package io.github.contentsview08.obb.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingUnitsTest {
    @Test fun 決めていない文字は今の既定の大きさ() {
        assertEquals(1f, scaleOfPx(0, POST_BODY_BASE_PX), 0f)
        assertEquals(15f, scaleOfPx(0, POST_BODY_BASE_PX) * POST_BODY_BASE_PX, 0f)
        assertEquals(12f, scaleOfPx(0, POST_HEAD_BASE_PX) * POST_HEAD_BASE_PX, 0f)
        assertEquals(1f, baseScaleOfPx(MOBILE_FONT_PX), 0f)
        assertEquals(1f, barScaleOfPx(0f, MOBILE_FONT_PX), 0f)
    }

    @Test fun 文字はpxと倍率で行き来できる() {
        for (px in 8..32) if (px != POST_BODY_BASE_PX) {
            assertEquals(px, pxOfScale(scaleOfPx(px, POST_BODY_BASE_PX), POST_BODY_BASE_PX))
        }
        assertEquals(18, pxOfScale(1.2f, 15))
        assertEquals(1.2f, scaleOfPx(18, 15), 0.0001f)
    }

    @Test fun 既定と同じ大きさは決めていない値にする() {
        assertEquals(0, pxOfScale(1f, POST_BODY_BASE_PX))
        assertEquals(0f, barPxOfScale(1f, MOBILE_FONT_PX), 0f)
        assertEquals(-1, orUnset(POST_PAD_PX, -1, POST_PAD_PX))
        assertEquals(0, orUnset(HEADER_PX, 0, HEADER_PX))
    }

    @Test fun 基本の文字は14pxが倍率1でPCと同じく小数2桁() {
        assertEquals(9.1f, basePxOfScale(0.65f), 0.001f)
        assertEquals(14f, basePxOfScale(1f), 0f)
        assertEquals(1.05f, baseScaleOfPx(basePxOfScale(1.05f)), 0.001f)
    }

    @Test fun 帯の文字は基本の文字に対する比() {
        assertEquals(21f, barPxOfScale(1.5f, 14f), 0.001f)
        assertEquals(1.5f, barScaleOfPx(21f, 14f), 0.001f)
        assertEquals(1.25f, barScaleOfPx(21f, 16.8f), 0.001f)
    }

    @Test fun 余白と高さの0と未設定を分ける() {
        assertEquals(POST_PAD_PX, orDefault(-1, -1, POST_PAD_PX))
        assertEquals(0, orDefault(0, -1, POST_PAD_PX))
        assertEquals(20, orDefault(20, -1, POST_PAD_PX))
        assertEquals(HEADER_PX, orDefault(0, 0, HEADER_PX))
        assertEquals(60, orDefault(60, 0, HEADER_PX))
    }

    @Test fun 配列の項目はJSONで持ち画面にはつないで渡す() {
        assertEquals("""["a","b"]""", wordsJson("a\n\nb\n", "\n"))
        assertEquals("a\nb", joinedWords("""["a","b"]""", "\n", ""))
        assertEquals("unread,count", joinedWords(wordsJson("unread,count", ","), ",", ""))
        assertEquals("[]", wordsJson("", "\n"))
        assertEquals("", joinedWords("[]", "\n", "def"))
    }

    @Test fun 読めない配列は既定() {
        assertEquals("def", joinedWords("unread,count", ",", "def"))
        assertEquals("def", joinedWords("""{"a":1}""", ",", "def"))
    }

    @Test fun UAはPCと同じ形で版はビルドから() {
        val v = io.github.contentsview08.obb.BuildConfig.VERSION_NAME
        assertEquals("Monazilla/1.00 (OBB/$v)", AppUa.MONAZILLA)
        assertEquals("OBB/$v (+https://red-edge.net)", AppUa.UPLOADER)
        assertTrue(AppUa.BROWSER_LIKE.endsWith("AppleWebKit/537.36 (KHTML, like Gecko) OBB/$v"))
    }
}
