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

/**
 * ツリー表示の新着の印をどこから付けるか(更新したあとの値。1 以下なら印なし)。
 * 印は「前に見たときになかったレス」に付ける: 更新で届いた分(lastBefore より後)で、まだ読んでいない(readNo より後)もの。
 * 手で更新したときは、届かなくても引き直す(読んだので消える)。自動更新で何も届かなければ、今の印を残す。
 * ツリーの既読は 1 番から途切れずに出し終えた所までしか進まないので、「既読の次から全部」にすると、開いてから見たレスまで全部に印が付いてしまう
 */
export function treeFreshFrom(o: { current: number; readNo: number; lastBefore: number; arrived: boolean; manual: boolean }): number {
  if (!o.arrived && !o.manual) return o.current
  return Math.max(o.readNo, o.lastBefore) + 1
}

/** 「未読を上に」の並び。未読のかたまりと残りの、それぞれの中の順番は変えない */
export function unreadFirstOrder<T>(list: T[], isUnread: (item: T) => boolean): T[] {
  const top = list.filter(isUnread)
  if (top.length === 0 || top.length === list.length) return list
  return [...top, ...list.filter((item) => !isUnread(item))]
}
