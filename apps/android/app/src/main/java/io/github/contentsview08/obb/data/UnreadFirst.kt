package io.github.contentsview08.obb.data

/** スレの未読。読んだことのないスレ(手元の記録がない)は数えない */
fun threadUnread(readNo: Int?, postCount: Int): Int = if (readNo == null) 0 else maxOf(0, postCount - readNo)

/** 「未読を上に」の並び。未読のかたまりと残りの、それぞれの中の順番は変えない */
fun <T> unreadFirstOrder(list: List<T>, isUnread: (T) -> Boolean): List<T> {
    val (top, rest) = list.partition(isUnread)
    return if (top.isEmpty() || rest.isEmpty()) list else top + rest
}
