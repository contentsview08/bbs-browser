// ミニマップのつまみの色。テーマの差し色を使うが、差し色が印の色と近いテーマでは落ち着いた青灰色にする。
// 近さの決め方と値は、スマホ版の ui/Minimap.kt の MinimapThumb・Web の写しと同じ(bbs-suite の docs/minimap.md・tools/colors.py で突き合わせる)

/** 色相の差(Oklch の度)がこれより小さいと、同じ系統の色に見える */
export const THUMB_NEAR_HUE = 40
/** 鮮やかさ(Oklch の C)の比(小さい方 ÷ 大きい方)がこれ以上だと、同じくらいの鮮やかさに見える */
export const THUMB_NEAR_CHROMA_RATIO = 0.5
/** 鮮やかさがこれより小さい色は灰色とみなす(色相に意味がない)。灰色どうしは近い */
export const THUMB_GRAY_CHROMA = 0.02
/** 差し色が印と近いときの、落ち着いた青灰色(明るいテーマ・暗いテーマ) */
export const THUMB_CALM = { light: '#5d6b80', dark: '#8e9aac' } as const

function lin(c: number): number {
  c /= 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** #rrggbb → Oklch の [L, C, 色相(度)] */
export function oklch(hex: string): [number, number, number] {
  const r = lin(parseInt(hex.slice(1, 3), 16))
  const g = lin(parseInt(hex.slice(3, 5), 16))
  const b = lin(parseInt(hex.slice(5, 7), 16))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360]
}

/** 2 つの色が、見分けにくいほど近いか(色相と鮮やかさで見る。明るさは見ない) */
export function nearColor(a: string, b: string): boolean {
  const [, ca, ha] = oklch(a)
  const [, cb, hb] = oklch(b)
  const grayA = ca < THUMB_GRAY_CHROMA
  const grayB = cb < THUMB_GRAY_CHROMA
  if (grayA || grayB) return grayA && grayB
  const dh = Math.abs(ha - hb) % 360
  return Math.min(dh, 360 - dh) < THUMB_NEAR_HUE && Math.min(ca, cb) / Math.max(ca, cb) >= THUMB_NEAR_CHROMA_RATIO
}

/** つまみの色。marks は印の色(人気の 3 段・画像・動画・リンク・自分・未読) */
export function minimapThumbColor(accent: string, marks: string[], dark: boolean): string {
  return marks.some((m) => nearColor(accent, m)) ? THUMB_CALM[dark ? 'dark' : 'light'] : accent
}

/** 印の色の CSS 変数(並びは minimapThumbColor の marks と同じ意味) */
export const MINIMAP_MARK_VARS = [
  '--c-heat-warm',
  '--c-heat-hot',
  '--c-heat-very-hot',
  '--c-mark-new',
  '--c-mark-danger',
  '--c-mark-link',
  '--c-own',
  '--c-unread',
]

/** CSS の色(rgb()・color(srgb …))を #rrggbb に */
function toHex(css: string): string | undefined {
  const rgb = css.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/)
  const srgb = css.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  const v = rgb ? rgb.slice(1, 4).map(Number) : srgb ? srgb.slice(1, 4).map((x) => Number(x) * 255) : undefined
  if (!v) return undefined
  return '#' + v.map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('')
}

/** いまのテーマ(<html> に付いた配色・差し色)から、つまみの色を決める */
export function currentMinimapThumbColor(): string {
  const root = document.documentElement
  // 変数は var() や color-mix() のこともあるので、字の色に入れて、ブラウザに解いてもらう
  const probe = document.createElement('span')
  probe.style.display = 'none'
  const host = document.body ?? root
  host.appendChild(probe)
  const read = (v: string) => {
    probe.style.color = `var(${v})`
    return toHex(getComputedStyle(probe).color)
  }
  const accent = read('--c-accent')
  const marks = MINIMAP_MARK_VARS.map(read).filter((c): c is string => !!c)
  probe.remove()
  const dark = root.classList.contains('dark')
  return accent ? minimapThumbColor(accent, marks, dark) : THUMB_CALM[dark ? 'dark' : 'light']
}
