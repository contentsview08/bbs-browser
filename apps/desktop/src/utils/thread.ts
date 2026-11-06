// スレ一覧の表示に使う計算。勢いの考え方は web 版(utils/momentum.ts)と同じ

import type { ThreadSummary } from '@bbs-browser/connectors'

/** 勢い = レス数 / スレが立ってからの経過日数(1 日あたりのレス数。2ch の専ブラと、スマホのアプリ スマホ版 と同じ) */
export function momentum(t: ThreadSummary, now = Date.now()): number {
  if (!t.createdAt) return 0
  // 立って 1 分までは 1 分とみなす(立った直後に大きくなりすぎないように)
  const days = Math.max(now - t.createdAt.getTime(), 60_000) / 86_400_000
  return t.postCount / days
}

/**
 * 板の中での勢いの相対順位(0=最下位〜1=最上位)。過疎板でも一番勢いのあるスレが赤くなるよう、
 * 絶対値ではなく順位で色を付ける。values は momentum の結果(キーごと)
 */
export function rankMomentum(values: Map<string, number>): Map<string, number> {
  const sorted = [...values].sort((a, b) => a[1] - b[1])
  const n = sorted.length
  return new Map(sorted.map(([key], i) => [key, n <= 1 ? 1 : i / (n - 1)]))
}

/** 100 からは整数、それより小さければ小数 1 桁(アプリと同じ) */
export function formatMomentum(value: number): string {
  const d = value >= 100 ? 0 : 1
  return value.toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d })
}

/** スマホ版の relativeTime(ui/Chrome.kt)と同じ言葉・同じ区切り */
export function relativeTime(date: Date, now = Date.now()): string {
  const s = Math.floor((now - date.getTime()) / 1000)
  if (s < 60) return 'たった今'
  if (s < 3600) return `${Math.floor(s / 60)}分前`
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}日前`
  if (s < 86400 * 365) return `約${Math.floor(s / (86400 * 30))}か月前`
  return `約${Math.floor(s / (86400 * 365))}年前`
}

/** 日ごとの見出し(今日・昨日・10/18(土))。同じ日のものをまとめて区切る */
export function dayLabel(time: number, now = Date.now()): string {
  const d = new Date(time)
  const start = (t: number) => new Date(new Date(t).toDateString()).getTime()
  const days = Math.round((start(now) - start(time)) / 86_400_000)
  if (days === 0) return '今日'
  if (days === 1) return '昨日'
  const wd = '日月火水木金土'[d.getDay()]
  return d.getFullYear() === new Date(now).getFullYear() ? `${d.getMonth() + 1}/${d.getDate()}(${wd})` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${wd})`
}
