// 通知の判定。お気に入りのスレの新着と、キーワードに合う新しいスレ。
// 通信や画面には触らず、取ってきた値を比べるだけ(App が数分おきに呼ぶ)

import type { ThreadSummary } from '@bbs-browser/connectors'
import { normalizeForSearch } from './postBody'

export interface FavIncrease {
  id: string
  title: string
  /** 増えたレス数 */
  added: number
}

/**
 * お気に入りのスレで、前に知っていた数より増えて、まだ読んでいないレスがあるもの。
 * 前に知っていた数は、前回スレ一覧で見た数(なければ手元のレス数)
 */
export function favIncreases(
  entries: { id: string; title: string; readNo: number; localCount: number }[],
  before: Map<string, number>,
  after: Map<string, number>,
): FavIncrease[] {
  const out: FavIncrease[] = []
  for (const e of entries) {
    const now = after.get(e.id)
    if (now === undefined) continue
    const known = Math.max(before.get(e.id) ?? e.localCount, e.localCount)
    if (now > known && now > e.readNo) out.push({ id: e.id, title: e.title, added: now - known })
  }
  return out
}

/** since より後に立ったスレのうち、スレタイにキーワードを含むもの(最初に当たったキーワードを添える) */
export function keywordHits(threads: ThreadSummary[], keywords: string[], since: number): { thread: ThreadSummary; keyword: string }[] {
  const ks = keywords.map((k) => ({ raw: k.trim(), n: normalizeForSearch(k.trim()) })).filter((k) => k.n !== '')
  if (ks.length === 0) return []
  const out: { thread: ThreadSummary; keyword: string }[] = []
  for (const t of threads) {
    if ((t.createdAt?.getTime() ?? 0) <= since) continue
    const title = normalizeForSearch(t.title)
    const hit = ks.find((k) => title.includes(k.n))
    if (hit) out.push({ thread: t, keyword: hit.raw })
  }
  return out
}
