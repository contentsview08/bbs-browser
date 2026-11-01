// 自分の配色(設定 customScheme)。スマホのアプリ(ui/CustomScheme.kt)と同じ:
// 地・面・字・強調・未読・自分の 6 色だけを選び、ほかの色(帯・線・薄い字・既読の字など)は 6 色から作る。
// 人気の色・リンク・名前の色は、もとにした配色のものを使う。設定には JSON で入れる(アプリとも同じ形で受け渡せるように)
// 色を混ぜるのはアプリ(Compose の lerp)と同じく Oklab で

export interface CustomDef {
  /** もとにした配色のキー */
  from: string
  base: string
  surface: string
  text: string
  accent: string
  unread: string
  own: string
}

export const CUSTOM_KEYS = ['base', 'surface', 'text', 'accent', 'unread', 'own'] as const
export type CustomKey = (typeof CUSTOM_KEYS)[number]
export const CUSTOM_LABELS: Record<CustomKey, string> = {
  base: '地',
  surface: '面(レス・帯)',
  text: '字',
  accent: '強調(ボタン・選んだ印)',
  unread: '未読',
  own: '自分の書き込み',
}

const HEX = /^#[0-9a-f]{6}$/i

export function parseCustom(json: string): CustomDef | null {
  if (!json) return null
  try {
    const o = JSON.parse(json) as Record<string, unknown>
    const d = { from: typeof o.from === 'string' ? o.from : 'soft-light' } as CustomDef
    for (const k of CUSTOM_KEYS) {
      const v = o[k]
      if (typeof v !== 'string' || !HEX.test(v.trim())) return null
      d[k] = v.trim().toLowerCase()
    }
    return d
  } catch {
    return null
  }
}

/** アプリと同じ形(キーの並びと #RRGGBB の大文字) */
export function customToJson(d: CustomDef): string {
  return JSON.stringify({ from: d.from, ...Object.fromEntries(CUSTOM_KEYS.map((k) => [k, d[k].toUpperCase()])) })
}

// ---- 色の計算 ----
type Rgb = [number, number, number]
const toRgb = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb
const toHex = (c: Rgb) => '#' + c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('')
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function toOklab(h: string): Rgb {
  const [r, g, b] = toRgb(h).map(lin)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

function fromOklab([L, a, b]: Rgb): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return toHex([
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ])
}

/** x から y へ t だけ寄せた色(Compose の lerp と同じ Oklab) */
export function lerp(x: string, y: string, t: number): string {
  const X = toOklab(x)
  const Y = toOklab(y)
  return fromOklab([0, 1, 2].map((i) => X[i] + (Y[i] - X[i]) * t) as Rgb)
}

export function luminance(h: string): number {
  const [r, g, b] = toRgb(h).map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** 塗った面の上の字: 白と黒のうち、差の大きいほう */
const onColor = (c: string) => (contrast('#111111', c) >= contrast('#ffffff', c) ? '#111111' : '#ffffff')

const wash = (h: string, a: number) => {
  const [r, g, b] = toRgb(h).map((x) => Math.round(x * 255))
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

export const isCustomDark = (d: CustomDef) => luminance(d.base) < 0.4

/**
 * 配色の CSS 変数を、その配色の印を付けた見えない要素で読む(テーマの CSS は [data-scheme] の付いた要素ならどこにでも効く)
 */
export function readSchemeVars(key: string, names: string[]): Record<string, string> {
  const el = document.createElement('div')
  el.setAttribute('data-scheme', key)
  el.style.display = 'none'
  document.body.appendChild(el)
  const cs = getComputedStyle(el)
  // #rrggbb にそろえる(1 px の canvas に塗って読む)
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const g = cv.getContext('2d', { willReadFrequently: true })!
  const out: Record<string, string> = {}
  for (const n of names) {
    g.clearRect(0, 0, 1, 1)
    g.fillStyle = '#000'
    g.fillStyle = cs.getPropertyValue(n).trim()
    g.fillRect(0, 0, 1, 1)
    const d = g.getImageData(0, 0, 1, 1).data
    out[n] = '#' + [d[0], d[1], d[2]].map((x) => x.toString(16).padStart(2, '0')).join('')
  }
  el.remove()
  return out
}

/** 今ある配色から 6 色を写して始める(自分の色はアプリと同じ、明るさで 2 つ) */
export function customOf(key: string, dark: boolean): CustomDef {
  const v = readSchemeVars(key, ['--c-base', '--c-surface', '--c-text-strong', '--c-accent', '--c-accent-self'])
  return { from: key, base: v['--c-base'], surface: v['--c-surface'], text: v['--c-text-strong'], accent: v['--c-accent'], unread: v['--c-accent-self'], own: dark ? '#3ec7a0' : '#1f9a78' }
}

/** 6 色から作る CSS 変数(アプリの buildScheme と同じ。帯 = 面) */
export function customVars(d: CustomDef): Record<string, string> {
  const from = readSchemeVars(d.from, ['--c-link', '--c-poster-name', '--c-heat-warm', '--c-heat-hot', '--c-heat-very-hot', '--c-link-youtube'])
  const dark = isCustomDark(d)
  return {
    '--c-base': d.base,
    '--c-header-footer': d.surface,
    '--c-surface': d.surface,
    '--c-surface2': lerp(d.surface, d.text, 0.06),
    '--c-surface3': lerp(d.surface, d.text, 0.12),
    '--c-border': lerp(d.base, d.text, 0.14),
    '--c-border-strong': lerp(d.base, d.text, 0.26),
    '--c-text-strong': d.text,
    '--c-text-body': lerp(d.text, d.base, 0.1),
    '--c-text-muted': lerp(d.text, d.base, 0.45),
    '--c-text-emphasis': dark ? '#ffffff' : '#000000',
    '--c-accent': d.accent,
    '--c-accent-hover': lerp(d.accent, dark ? '#ffffff' : '#000000', 0.15),
    '--c-accent-text': onColor(d.accent),
    '--c-accent-wash': wash(d.accent, 0.14),
    '--c-accent-self': d.unread,
    '--c-accent-self-wash': wash(d.unread, 0.15),
    '--c-accent-self-text': onColor(d.unread),
    '--c-own': d.own,
    '--c-own-wash': wash(d.own, 0.16),
    '--c-link': from['--c-link'],
    '--c-link-twitter': from['--c-link'],
    '--c-link-youtube': from['--c-link-youtube'],
    '--c-poster-name': from['--c-poster-name'],
    '--c-thread-read-title': lerp(d.text, d.base, 0.35),
    '--c-heat-warm': from['--c-heat-warm'],
    '--c-heat-hot': from['--c-heat-hot'],
    '--c-heat-very-hot': from['--c-heat-very-hot'],
  }
}

/** LINE 風の地(アプリの Palette.lineBg と同じ計算) */
export function customLineBg(d: CustomDef): string {
  return isCustomDark(d) ? lerp(lerp(d.base, '#6f8fb8', 0.06), '#000000', 0.35) : lerp(d.base, '#7f9cc0', 0.22)
}

/** 読みやすさの判定(本文 4.5、そのほか 3 が目安。アプリと同じ 6 つ) */
export function customChecks(d: CustomDef): { label: string; ratio: number; min: number }[] {
  const v = customVars(d)
  return [
    { label: '本文 / 地', ratio: contrast(v['--c-text-body'], d.base), min: 4.5 },
    { label: '本文 / 面', ratio: contrast(v['--c-text-body'], d.surface), min: 4.5 },
    { label: '薄い字 / 地', ratio: contrast(v['--c-text-muted'], d.base), min: 3 },
    { label: '強調の上の字', ratio: contrast(v['--c-accent-text'], d.accent), min: 3 },
    { label: '強調 / 地', ratio: contrast(d.accent, d.base), min: 3 },
    { label: '未読の札の字', ratio: contrast(v['--c-accent-self-text'], d.unread), min: 3 },
  ]
}
