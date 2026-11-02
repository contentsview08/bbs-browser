// レスの頭の日時と ID の出し方(設定「日時の出し方」「ID を短く出す」)。スマホのアプリの PostRender.kt の displayDate・displayId と同じ

/** 日時の出し方: md_w_hms = 11/02(月) 19:01:15 / md_hm = 11/02 19:01 / full = 掲示板が出したまま(2026/11/02(月) 19:01:15.960) */
export type DateStyle = 'md_w_hms' | 'md_hm' | 'full'

const DATE_PARTS = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(?:\(([^)]*)\))?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/

/** レスの頭の日時。読めない形はそのまま。日時の後ろに付く印(BE の番号など)は残す */
export function displayDate(date: string, style: DateStyle): string {
  if (style === 'full') return date
  const m = DATE_PARTS.exec(date)
  if (!m) return date
  const [, , mo, d, w, h, mi, s] = m
  const md = `${mo.padStart(2, '0')}/${d.padStart(2, '0')}`
  const out = style === 'md_hm' ? `${md} ${h.padStart(2, '0')}:${mi}` : `${md}${w ? `(${w})` : ''} ${h.padStart(2, '0')}:${mi}${s ? `:${s}` : ''}`
  const rest = date
    .slice(m.index + m[0].length)
    .replace(/^[.,]\d+/, '')
    .trim()
  return rest ? `${out} ${rest}` : out
}

/** レスの頭の ID(短く出すなら先頭の 6 文字だけで「ID:」も省く。数えるのと色は ID 全体で決める) */
export function displayId(id: string, short: boolean): string {
  return short ? id.slice(0, 6) : `ID:${id}`
}
