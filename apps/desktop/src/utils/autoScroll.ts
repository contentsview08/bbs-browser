// 自動で流す(オートスクロール)の速さの決まり。測るのと動かすのは hooks/useAutoScroll.ts、ここは答えだけを返す。
// スマホ版も同じ式で流す(bbs-suite の docs/autoscroll.md)。

/** 自動で流す速さの選択肢 */
export type AutoScrollSpeed = 'slow' | 'normal' | 'fast'

/** 既定の速さ(1 秒に何行)。追いつくまでの一定の速さと、追いついた後の最低の速さを兼ねる */
export const AUTO_SCROLL_SPEEDS: { key: AutoScrollSpeed; name: string; linesPerSec: number }[] = [
  { key: 'slow', name: 'ゆっくり', linesPerSec: 1 },
  { key: 'normal', name: 'ふつう', linesPerSec: 2 },
  { key: 'fast', name: '速い', linesPerSec: 4 },
]

/** 最大の速さは既定の速さの何倍か(別の設定にしない) */
export const AUTO_SCROLL_MAX_RATIO = 6
/** 次の更新の時刻を過ぎたとき、残りの距離のこの割合を 1 秒で寄せる(下に近づくほどゆっくりになる) */
export const AUTO_SCROLL_LATE_RATIO = 0.5
/** 溜まった分がこの画面の枚数を超えたら、「新着 N 件」の札を出す */
export const AUTO_SCROLL_BACKLOG_SCREENS = 10

/** 既定の速さ(px/秒)。行は本文の 1 行の高さなので、字を大きくしても体感の速さは変わらない。知らない値は「ふつう」 */
export function autoScrollBaseSpeed(lineHeightPx: number, speedKey: AutoScrollSpeed): number {
  const lines = (AUTO_SCROLL_SPEEDS.find((s) => s.key === speedKey) ?? AUTO_SCROLL_SPEEDS[1]).linesPerSec
  return lines * lineHeightPx
}

/**
 * 流す速さ(px/秒)。
 * - 追いつくまで(caughtUp が false): 既定の速さで一定に流す
 * - 追いついた後: 残りの距離 ÷ 次の更新までの時間(次の更新の時刻にちょうど下に着く)。既定の速さより遅くせず、最大の速さを超えない
 * - 次の更新の時刻を過ぎた(msToNext が 0 以下): 残りの距離に比べた速さで寄せる(最大の速さは超えない)
 * - 自動更新がオフ(msToNext が Infinity): 新着が来たら既定の速さで流し、下に着いたら止まる
 * 下に着いていれば(残りが 0 以下)0
 */
export function autoScrollSpeed(remainingPx: number, msToNext: number, lineHeightPx: number, speedKey: AutoScrollSpeed, caughtUp: boolean): number {
  if (!(remainingPx > 0) || !(lineHeightPx > 0)) return 0
  const base = autoScrollBaseSpeed(lineHeightPx, speedKey)
  const max = base * AUTO_SCROLL_MAX_RATIO
  if (!caughtUp) return base
  if (Number.isNaN(msToNext)) return base
  if (msToNext <= 0) return Math.min(max, remainingPx * AUTO_SCROLL_LATE_RATIO)
  const fit = remainingPx / (msToNext / 1000)
  return Math.min(max, Math.max(base, fit))
}

/** 溜まった分が多すぎて、札を出すほどか(残りの距離が画面 AUTO_SCROLL_BACKLOG_SCREENS 枚を超えた) */
export function autoScrollBacklogged(remainingPx: number, viewHeightPx: number): boolean {
  return viewHeightPx > 0 && remainingPx > viewHeightPx * AUTO_SCROLL_BACKLOG_SCREENS
}

/** 次の自動更新までの時間(ms)。自動更新がオフ・まだ回っていなければ Infinity */
export function msToNextRefresh(autoRefreshSec: number, lastRefreshAt: number | undefined, now: number): number {
  if (!(autoRefreshSec > 0) || lastRefreshAt === undefined) return Infinity
  return lastRefreshAt + autoRefreshSec * 1000 - now
}
