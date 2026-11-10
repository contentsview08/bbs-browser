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

/** 立てた人のキーワードの帯・通知に出す名前(スマホ版の authorKeywordLabel と同じ) */
export const authorKeywordLabel = (authorId: string) => `立てた人 ${authorId}`

/**
 * since より後に立ったスレのうち、スレタイにキーワードを含むもの・立てた人(authorId)が登録した人と同じもの。
 * 当たった名前を添える(スレタイのキーワードが先、立てた人は authorKeywordLabel の形)
 */
export function keywordHits(
  threads: ThreadSummary[],
  keywords: string[],
  since: number,
  authors: string[] = [],
): { thread: ThreadSummary; keyword: string }[] {
  const ks = keywords.map((k) => ({ raw: k.trim(), n: normalizeForSearch(k.trim()) })).filter((k) => k.n !== '')
  const as = authors.map((a) => a.trim()).filter(Boolean)
  if (ks.length === 0 && as.length === 0) return []
  const out: { thread: ThreadSummary; keyword: string }[] = []
  for (const t of threads) {
    if ((t.createdAt?.getTime() ?? 0) <= since) continue
    const title = normalizeForSearch(t.title)
    const hit = ks.find((k) => title.includes(k.n))
    if (hit) out.push({ thread: t, keyword: hit.raw })
    else if (t.authorId && as.includes(t.authorId)) out.push({ thread: t, keyword: authorKeywordLabel(t.authorId) })
  }
  return out
}
