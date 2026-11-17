// 通知の判定。お気に入りのスレの新着と、キーワードに合う新しいスレ。
// 通信や画面には触らず、取ってきた値を比べるだけ(App が数分おきに呼ぶ)

import type { ThreadSummary } from '@bbs-browser/connectors'
import { keywordLabel, keywordMatcher, type KeywordRule } from './keywords'

export interface FavIncrease {
  id: string
  title: string
  /** 増えたレス数 */
  added: number
}

/**
 * 知らせる新着の数(前回の確認からの増え)。知らせないなら 0。スマホ版の Crawler.kt の favIncrease と同じ(packages/conformance/fav-new.json)。
 * 前に知っていた数は、前回スレ一覧で見た数(なければ手元のレス数)。一度も取っていないスレ(手元のレス数が 0)は知らせない
 */
export function favIncrease(now: number, before: number | undefined, localCount: number, readNo: number): number {
  if (now <= 0 || localCount <= 0) return 0
  const known = Math.max(before ?? localCount, localCount)
  return now > known && now > readNo ? now - known : 0
}

/** お気に入りのスレで、前に知っていた数より増えて、まだ読んでいないレスがあるもの */
export function favIncreases(
  entries: { id: string; title: string; readNo: number; localCount: number }[],
  before: Map<string, number>,
  after: Map<string, number>,
): FavIncrease[] {
  const out: FavIncrease[] = []
  for (const e of entries) {
    const now = after.get(e.id)
    if (now === undefined) continue
    const added = favIncrease(now, before.get(e.id), e.localCount, e.readNo)
    if (added > 0) out.push({ id: e.id, title: e.title, added })
  }
  return out
}

export { authorKeywordLabel } from './keywords'

/**
 * since より後に立ったスレのうち、キーワード(スレタイの言葉・正規表現・立てた人)に当たるもの。
 * 当たったキーワードの名前(別名があればそれ)を添える。boardUrl はその板(板限定のキーワードを絞る)
 */
export function keywordHits(threads: ThreadSummary[], rules: KeywordRule[], since: number, boardUrl?: string): { thread: ThreadSummary; keyword: string }[] {
  const m = keywordMatcher(rules, boardUrl)
  if (m.isEmpty) return []
  const out: { thread: ThreadSummary; keyword: string }[] = []
  for (const t of threads) {
    if ((t.createdAt?.getTime() ?? 0) <= since) continue
    const r = m.hit(t)
    if (r) out.push({ thread: t, keyword: keywordLabel(r) })
  }
  return out
}
