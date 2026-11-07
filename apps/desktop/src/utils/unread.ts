// 未読の数え方。スレ一覧の「+n」・タブ・お気に入り・次の未読スレで同じ数になるように、ここにまとめる。

/** 分かっているレス数のうち一番多いものから既読を引く。既読のほうが多ければ 0 */
export function unreadCount(readNo: number, ...counts: number[]): number {
  return Math.max(0, Math.max(0, ...counts) - readNo)
}

/** スレの未読。読んだことのないスレ(手元の記録がない)は数えない */
export function threadUnread(state: { readNo: number } | undefined, ...counts: number[]): number {
  return state ? unreadCount(state.readNo, ...counts) : 0
}

/** お気に入りのスレの未読。まだ一度も取っていないスレ(手元のレス数が 0)は数えない */
export function favUnread(fav: { postCount: number; readNo: number }, known: number | undefined): number {
  return fav.postCount === 0 ? 0 : unreadCount(fav.readNo, known ?? fav.postCount)
}

/** 「未読を上に」の並び。未読のかたまりと残りの、それぞれの中の順番は変えない */
export function unreadFirstOrder<T>(list: T[], isUnread: (item: T) => boolean): T[] {
  const top = list.filter(isUnread)
  if (top.length === 0 || top.length === list.length) return list
  return [...top, ...list.filter((item) => !isUnread(item))]
}
