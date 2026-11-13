package io.github.contentsview08.obb.bbs

import io.github.contentsview08.obb.data.sortByOrder
import org.junit.Assert.assertEquals
import org.junit.Test

// スレ順(掲示板が返した順 = order)。コネクタは届いた順をそのまま order に入れる
class ThreadOrderTest {
    @Test fun 二ch互換はsubjectの書かれた順をorderにする() {
        // dat 番号の順ではなく、書かれた順(フロート型の最近動いた順)
        val list = parseSubjectTxt("1792487946.dat<>あ (3)\n1792483602.dat<>い (5)\n1792489148.dat<>う (7)\n", "https://example.net/b/")
        assertEquals(listOf("1792487946" to 0, "1792483602" to 1, "1792489148" to 2), list.map { it.key to it.order })
    }

    @Test fun したらばとまちBBSも書かれた順をorderにする() {
        val list = parseCgiSubject("1500000000.cgi,ふたつめ(9)\n1600000000.cgi,ひとつめ(3)\n1500000000.cgi,ふたつめ(9)\n", "https://example.net/b/")
        assertEquals(listOf("1500000000" to 0, "1600000000" to 1), list.map { it.key to it.order })
    }

    private data class T(val key: String, val order: Int?)
    private val list = listOf(T("c", 2), T("a", 0), T("b", 1))

    @Test fun いつもの並びはorderの小さい順で逆順は大きい順() {
        assertEquals(listOf("a", "b", "c"), sortByOrder(list, false) { it.order }.map { it.key })
        assertEquals(listOf("c", "b", "a"), sortByOrder(list, true) { it.order }.map { it.key })
    }

    @Test fun orderのないものはどちらの向きでも後ろに来た順のまま() {
        val mixed = listOf(T("x", null), T("b", 1), T("y", null), T("a", 0))
        assertEquals(listOf("a", "b", "x", "y"), sortByOrder(mixed, false) { it.order }.map { it.key })
        assertEquals(listOf("b", "a", "x", "y"), sortByOrder(mixed, true) { it.order }.map { it.key })
    }
}
