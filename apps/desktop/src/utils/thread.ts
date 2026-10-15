// スレ一覧の表示に使う計算。勢いの考え方は web 版(utils/momentum.ts)と同じ

import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'
import type { ThreadSummary } from '@bbs-browser/connectors'

/** 勢い = レス数 / スレが立ってからの経過時間(時間) */
export function momentum(t: ThreadSummary, now = Date.now()): number {
  if (!t.createdAt) return 0
  const hours = (now - t.createdAt.getTime()) / 3_600_000
  return t.postCount / Math.max(0.01, hours)
}

/**
 * 板の中での勢いの相対順位(0=最下位〜1=最上位)。過疎板でも一番勢いのあるスレが赤くなるよう、
 * 絶対値ではなく順位で色を付ける
 */
export function rankMomentum(threads: ThreadSummary[], key: (t: ThreadSummary) => string): Map<string, number> {
  const sorted = [...threads].sort((a, b) => momentum(a) - momentum(b))
  const n = sorted.length
  return new Map(sorted.map((t, i) => [key(t), n <= 1 ? 1 : i / (n - 1)]))
}

export function formatMomentum(value: number): string {
  return value.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function relativeTime(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true, locale: ja })
}
