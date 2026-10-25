// 次スレ探し。同じ板のスレ一覧から、スレタイが似ていて、いまのスレより後に立ったスレを候補として並べる。
// 似ているかは、番号や記号を除いたスレタイの「2 文字ずつのまとまり」がどれだけ重なるかで測り、
// スレタイの番号(Part12・その12・★12 など)がちょうど次の番号なら上に出す。

import type { ThreadSummary } from '@bbs-browser/connectors'

/** 番号・記号・空白を除き、全角英数を半角に、英字を小文字にそろえる */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(part|ｐａｒｔ|その|第|vol\.?|no\.?)\s*\d+\s*(弾|章|話|回|スレ|目)?/g, '')
    .replace(/[★☆◆◇■□●○#＃]+\s*\d+/g, '')
    .replace(/\d+/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/**
 * スレタイの通し番号。Part12・その12・第12・★12・「スレタイ12」のような末尾の数字の順に探す。
 * 見つからなければ undefined
 */
export function titleNumber(title: string): number | undefined {
  const t = title.normalize('NFKC')
  const m =
    /(?:part|その|第|vol\.?|no\.?)\s*(\d+)/i.exec(t) ??
    /[★☆◆◇■□●○#]\s*(\d+)/.exec(t) ??
    /(\d+)\s*(?:スレ|章|弾|話|回|目)?\s*(?:【[^】]*】|\[[^\]]*\]|\([^)]*\))?\s*$/.exec(t)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) ? n : undefined
}

function bigrams(s: string): Set<string> {
  const chars = [...s]
  if (chars.length < 2) return new Set(chars)
  const out = new Set<string>()
  for (let i = 0; i < chars.length - 1; i++) out.add(chars[i] + chars[i + 1])
  return out
}

/** 2 つのスレタイの似ている度合い(0〜1) */
export function titleSimilarity(a: string, b: string): number {
  const x = bigrams(normalizeTitle(a))
  const y = bigrams(normalizeTitle(b))
  if (x.size === 0 || y.size === 0) return 0
  let both = 0
  for (const g of x) if (y.has(g)) both++
  return (2 * both) / (x.size + y.size)
}

export interface NextThreadCandidate {
  thread: ThreadSummary
  score: number
  /** スレタイの番号がちょうど次 */
  isNextNumber: boolean
}

/** これより似ていないスレは候補にしない */
const MIN_SIMILARITY = 0.45

/**
 * 次スレの候補を、それらしい順に返す。
 * - いまのスレ自身と、いまのスレより前に立ったスレは除く(立った時刻が分かるときだけ)
 * - 番号がちょうど次なら一番上、次に似ている順、同じくらいなら新しい順
 */
export function findNextThreads(
  current: { key: string; title: string; createdAt?: Date },
  list: ThreadSummary[],
  limit = 5,
): NextThreadCandidate[] {
  const num = titleNumber(current.title)
  const since = current.createdAt?.getTime()
  const out: NextThreadCandidate[] = []
  for (const t of list) {
    if (t.key === current.key) continue
    if (since !== undefined && t.createdAt && t.createdAt.getTime() < since) continue
    const score = titleSimilarity(current.title, t.title)
    if (score < MIN_SIMILARITY) continue
    const n = titleNumber(t.title)
    out.push({ thread: t, score, isNextNumber: num !== undefined && n === num + 1 })
  }
  out.sort(
    (a, b) =>
      Number(b.isNextNumber) - Number(a.isNextNumber) ||
      b.score - a.score ||
      (b.thread.createdAt?.getTime() ?? 0) - (a.thread.createdAt?.getTime() ?? 0),
  )
  return out.slice(0, limit)
}

/**
 * スレの最後の「次の未読スレへ」で開くスレ。いまのスレ一覧(板・閲覧履歴・お気に入り)に見えている並びのまま、
 * いまのスレより下から探し、なければ上へ戻って探す(いまのスレは除く)。
 * 未読の数は呼ぶ側が決める(読んだことのないスレは 0 にする。一覧の「+n」と同じ見方)
 */
export function nextUnreadThread(
  list: readonly ThreadSummary[],
  currentId: string | undefined,
  idOf: (t: ThreadSummary) => string,
  unreadOf: (t: ThreadSummary) => number,
): { thread: ThreadSummary; unread: number } | undefined {
  const at = currentId === undefined ? -1 : list.findIndex((t) => idOf(t) === currentId)
  for (let i = 1; i <= list.length; i++) {
    const t = list[(at + i) % list.length]
    if (idOf(t) === currentId) continue
    const unread = unreadOf(t)
    if (unread > 0) return { thread: t, unread }
  }
  return undefined
}
