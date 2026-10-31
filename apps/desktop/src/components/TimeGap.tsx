// 前のレスから時間が空いた所の区切り(スマホのアプリ・hono-bbs の web と同じ)。1 時間以上空いたら「3 時間後」、日付が変わったら「10/31(金)」。
// 「ここから未読」より控えめに、細い線と小さい字で
import { memo } from 'react'

const DATE_TIME = /(\d{4})\/(\d{1,2})\/(\d{1,2})[^\d]*(\d{1,2}):(\d{2})/
const DAY = /(\d{4})\/(\d{1,2})\/(\d{1,2})(\([^)]*\))?/

/** 日付の文字列を分単位の通し番号に(差を出すためだけ。時差は気にしない) */
function minutes(date: string | undefined): number | undefined {
  const m = date ? DATE_TIME.exec(date) : null
  if (!m) return undefined
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000
}

export function timeGapLabel(prev: string | undefined, cur: string | undefined): string | undefined {
  const a = minutes(prev)
  const b = minutes(cur)
  if (a === undefined || b === undefined) return undefined
  const gap = b - a
  const newDay = Math.floor(a / 1440) !== Math.floor(b / 1440)
  const span = gap < 60 ? undefined : gap < 1440 ? `${Math.floor(gap / 60)} 時間後` : gap < 43200 ? `${Math.floor(gap / 1440)} 日後` : `${Math.floor(gap / 43200)} か月後`
  const d = newDay && cur ? DAY.exec(cur) : null
  const day = d ? `${+d[2]}/${+d[3]}${d[4] ?? ''}` : undefined
  return [day, span].filter(Boolean).join('  ') || undefined
}

function TimeGap(props: { prev?: string; cur?: string }) {
  const label = timeGapLabel(props.prev, props.cur)
  if (!label) return null
  return (
    <div className="flex items-center gap-2.5 px-6 py-1 select-none text-c-text-muted">
      <span className="flex-1 h-px" style={{ background: 'currentColor', opacity: 0.35 }} />
      <span className="text-[11px] whitespace-pre">{label}</span>
      <span className="flex-1 h-px" style={{ background: 'currentColor', opacity: 0.35 }} />
    </div>
  )
}

export default memo(TimeGap)
