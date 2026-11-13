package io.github.contentsview08.obb.data

/** スレの未読。読んだことのないスレ(手元の記録がない)は数えない */
fun threadUnread(readNo: Int?, postCount: Int): Int = if (readNo == null) 0 else maxOf(0, postCount - readNo)

/** 「未読を上に」の並び。未読のかたまりと残りの、それぞれの中の順番は変えない */
fun <T> unreadFirstOrder(list: List<T>, isUnread: (T) -> Boolean): List<T> {
    val (top, rest) = list.partition(isUnread)
    return if (top.isEmpty() || rest.isEmpty()) list else top + rest
}

/**
 * スレ順(掲示板が返した順 = order)で並べる。reversed なら逆順。
 * order の分からないもの(null)は、どちらの向きでも後ろに来た順のまま置く(PC 版の sortByOrder と同じ)
 */
fun <T> sortByOrder(list: List<T>, reversed: Boolean, orderOf: (T) -> Int?): List<T> {
    val (has, none) = list.partition { orderOf(it) != null }
    // sortedBy は安定なので、同じ order のものも来た順のまま
    val sorted = if (reversed) has.sortedByDescending { orderOf(it)!! } else has.sortedBy { orderOf(it)!! }
    return sorted + none
}
