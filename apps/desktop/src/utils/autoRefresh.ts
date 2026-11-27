// 自動の取得をするかどうかの判定。タイマーや通信には触らず、答えだけを返す(呼ぶのは App)。

/** レスの数の上限まで来たか(上限のない掲示板はいつも false) */
export function reachedMaxPosts(postCount: number, maxPosts: number | undefined): boolean {
  return maxPosts !== undefined && postCount >= maxPosts
}

/** 開いているスレを自動で取りに行くか。見えていないとき・もう増えないスレ(dat 落ち・上限到達)では行かない */
export function shouldAutoRefresh(input: { visible: boolean; status: string | undefined; postCount: number; maxPosts: number | undefined }): boolean {
  return input.visible && input.status !== 'archived' && !reachedMaxPosts(input.postCount, input.maxPosts)
}

/** 失敗が続いたときの次までの待ちの上限 */
export const BACKOFF_MAX_MS = 5 * 60 * 1000

/**
 * 自動更新・実況モードの次までの待ち。失敗が続いたら倍々に延ばす(上限 5 分)。
 * 掲示板が落ちている・つながらないときに、同じ間隔で叩き続けないため。streak は続けて失敗した回数(0 なら元の間隔)
 */
export function backoffMs(baseMs: number, streak: number): number {
  if (streak <= 0) return baseMs
  return Math.min(baseMs * 2 ** Math.min(streak, 20), BACKOFF_MAX_MS)
}

/** 新しい版を確かめる間隔 */
export const UPDATE_CHECK_INTERVAL_MS = 20 * 3600 * 1000

/** 新しい版を確かめる頃か。前回が未来(時計を戻した)なら、待たずに確かめる */
export function updateCheckDue(lastCheckAt: number, now: number): boolean {
  const elapsed = now - lastCheckAt
  return elapsed < 0 || elapsed >= UPDATE_CHECK_INTERVAL_MS
}
