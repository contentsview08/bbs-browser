// 実況モードの、追いつくまでの段の流す速さと、その設定の決まり(bbs-suite の docs/autoscroll.md)。
// 測るのと動かすのは hooks/useAutoScroll.ts、ここは答えだけを返す。スマホ版も同じ値と式を使う。

/** 流す速さ(1 秒に何行)の幅と既定 */
export const LIVE_SPEED_MIN = 0.5
export const LIVE_SPEED_MAX = 40
export const LIVE_SPEED_DEFAULT = 2
/** 実況モードの更新の間隔(秒)の選択肢と既定 */
export const LIVE_REFRESH_CHOICES = [3, 5, 10, 20, 30]
export const LIVE_REFRESH_DEFAULT = 5
/** スライダーの目盛りの数(0〜この値。対数の目盛りなので、遅い側を細かく選べる) */
export const LIVE_SPEED_STEPS = 100

/** 速さを、見せやすい細かさに丸める(10 行より遅いときは 0.1 行、速いときは 1 行。スマホ版と同じ) */
function roundSpeed(v: number): number {
  return v < 10 ? Math.round(v * 10) / 10 : Math.round(v)
}

/** 保存してある速さを、幅の中に入れる。数でなければ既定 */
export function clampLiveSpeed(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return LIVE_SPEED_DEFAULT
  return Math.min(LIVE_SPEED_MAX, Math.max(LIVE_SPEED_MIN, v))
}

/** 保存してある更新の間隔を、選択肢のどれかにする。選択肢になければ既定 */
export function clampLiveRefresh(v: unknown): number {
  return typeof v === 'number' && LIVE_REFRESH_CHOICES.includes(v) ? v : LIVE_REFRESH_DEFAULT
}

/** スライダーの目盛り(0〜LIVE_SPEED_STEPS)→ 速さ(1 秒に何行) */
export function liveSpeedOfStep(step: number): number {
  const r = Math.min(1, Math.max(0, step / LIVE_SPEED_STEPS))
  return roundSpeed(LIVE_SPEED_MIN * (LIVE_SPEED_MAX / LIVE_SPEED_MIN) ** r)
}

/** 速さ → スライダーの目盛り。丸めでずれるので、隣の目盛りがちょうどその速さならそちらにする(戻したときに値が変わらないように) */
export function liveStepOfSpeed(speed: number): number {
  const v = clampLiveSpeed(speed)
  const s = Math.round((Math.log(v / LIVE_SPEED_MIN) / Math.log(LIVE_SPEED_MAX / LIVE_SPEED_MIN)) * LIVE_SPEED_STEPS)
  return [s, s - 1, s + 1].find((c) => c >= 0 && c <= LIVE_SPEED_STEPS && liveSpeedOfStep(c) === v) ?? s
}

/** 速さの見せ方(設定の画面) */
export function formatLiveSpeed(speed: number): string {
  return `1 秒に ${roundSpeed(speed)} 行`
}

/** 速さ(px/秒)。行は本文の 1 行の高さなので、字を大きくしても体感の速さは変わらない */
export function liveScrollPxPerSec(linesPerSec: number, lineHeightPx: number): number {
  if (!(lineHeightPx > 0)) return 0
  return clampLiveSpeed(linesPerSec) * lineHeightPx
}
