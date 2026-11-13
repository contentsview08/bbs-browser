package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.Board
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FavoriteBoardsTest {
    private val vipIo = Board("https://hayabusa9.5ch.io/news4vip/", "ニュー速VIP", "雑談系2")
    private val vipNet = Board("https://hayabusa9.5ch.net/news4vip", "ニュー速VIP")

    /** DB の代わり: 変え方をそのまま当てる */
    private fun applyTo(favs: List<Board>, c: FavoriteChange) = favs.filter { it.url !in c.remove } + listOfNotNull(c.add)

    @Test fun 書き方が違っても同じ板ならお気に入りにある() {
        assertTrue(isFavoriteIn(listOf(vipNet), vipIo.url))
        assertTrue(isFavoriteIn(listOf(vipIo), "http://HAYABUSA9.5ch.net/news4vip/"))
        assertTrue(vipIo.url.let { favoriteKey(it) } in favoriteKeys(listOf(vipNet)))
    }

    @Test fun 板の名前の大文字小文字は別の板() = assertFalse(isFavoriteIn(listOf(vipIo), "https://hayabusa9.5ch.io/NEWS4VIP/"))

    @Test fun 板のURLでないものは文字のまま比べる() {
        assertTrue(isFavoriteIn(listOf(Board("x", "x")), "x"))
        assertFalse(isFavoriteIn(listOf(Board("x", "x")), "y"))
    }

    @Test fun 押すと入って二度目で外れる() {
        var favs = emptyList<Board>()
        favs = applyTo(favs, favoriteChange(favs, vipIo, !isFavoriteIn(favs, vipIo.url)))
        assertTrue(isFavoriteIn(favs, vipIo.url))
        assertEquals(listOf(Board(vipIo.url, vipIo.name)), favs)
        favs = applyTo(favs, favoriteChange(favs, vipIo, !isFavoriteIn(favs, vipIo.url)))
        assertFalse(isFavoriteIn(favs, vipIo.url))
        assertTrue(favs.isEmpty())
    }

    // 同期で来た 5ch.net の行がある板は ★ で出し、外すと書き方の違う行も残さない
    @Test fun 書き方の違う行も外す() {
        val favs = listOf(vipNet, Board("https://greta.5ch.io/poverty/", "嫌儲"))
        val c = favoriteChange(favs, vipIo, on = false)
        assertEquals(listOf(vipNet.url), c.remove)
        assertFalse(isFavoriteIn(applyTo(favs, c), vipIo.url))
        assertEquals(1, applyTo(favs, c).size)
    }

    @Test fun 入っている板に入れても二重にしない() = assertNull(favoriteChange(listOf(vipNet), vipIo, on = true).add)

    // 二度押しで同じ値を 2 回送っても、結果は押した後の状態のまま
    @Test fun 同じ状態へは何度送っても同じ() {
        var favs = emptyList<Board>()
        repeat(2) { favs = applyTo(favs, favoriteChange(favs, vipIo, on = true)) }
        assertEquals(1, favs.size)
        repeat(2) { favs = applyTo(favs, favoriteChange(favs, vipIo, on = false)) }
        assertTrue(favs.isEmpty())
    }
}
