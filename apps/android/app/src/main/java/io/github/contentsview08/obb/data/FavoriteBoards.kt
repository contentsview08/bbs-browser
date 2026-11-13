package io.github.contentsview08.obb.data

import io.github.contentsview08.obb.bbs.Board
import io.github.contentsview08.obb.sync.normalizeBoardUrl

// お気に入り板に入っているかの判定と、☆ を押したときの DB の変え方。
// 行は書いた端末・板一覧の URL のまま残る(同期で来た 5ch.net と、板一覧の 5ch.io など)ので、URL の文字のままでは比べない

/** 同じ板かを決める鍵。同期の決まり(normalizeBoardUrl)と同じにし、5ch.net と 5ch.io・http と https・末尾の / の違いで別の板にしない */
fun favoriteKey(url: String): String = normalizeBoardUrl(url) ?: url

fun favoriteKeys(favorites: List<Board>): Set<String> = favorites.mapTo(HashSet()) { favoriteKey(it.url) }

fun isFavoriteIn(favorites: List<Board>, url: String): Boolean = favoriteKey(url).let { k -> favorites.any { favoriteKey(it.url) == k } }

/** 印を on / off にするために、足す板(すでにあれば null)と消す行の URL */
data class FavoriteChange(val add: Board?, val remove: List<String>)

/**
 * 押した後の状態(on)から変え方を決める。反転する元を画面の外で読み直さないので、二度押しや古い一覧でも結果は on のとおりになる。
 * 外すときは書き方の違う行もまとめて消す(1 つ残ると、☆ なのにお気に入りに残る)
 */
fun favoriteChange(favorites: List<Board>, board: Board, on: Boolean): FavoriteChange {
    val key = favoriteKey(board.url)
    val rows = favorites.filter { favoriteKey(it.url) == key }
    return if (on) FavoriteChange(if (rows.isEmpty()) Board(board.url, board.name) else null, emptyList())
    else FavoriteChange(null, rows.map { it.url })
}
