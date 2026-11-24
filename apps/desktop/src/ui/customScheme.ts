// 自分の配色(設定 customScheme)。スマホのアプリ(ui/CustomScheme.kt)と同じ:
// 地・面・字・強調・未読・自分の 6 色を選び、ほかの色(帯・線・薄い字・既読の字など)は 6 色から作る。
// 人気の色・リンク・名前の色は、もとにした配色のものを使う。細かい色(colors。EXTRA_COLORS のキー)を選べば、作った値の代わりにそれ。
// 設定には JSON で入れる(アプリとも同じ形で受け渡せるように。形は docs/color-scheme.md)
// 色を混ぜるのはアプリ(Compose の lerp)と同じく Oklab で

/**
 * 細かい色。キー・並び・まとまりはアプリ(ui/CustomScheme.kt の EXTRA_COLORS)と同じ。
 * 選んでいなければ 6 色から作った値(bar・surface2 …)か、配色の決まりの色(mark*・toOwn・op …。EXTRA_DEFAULTS)
 */
export const EXTRA_COLORS = [
  { key: 'bar', label: '上下の帯', group: '面・線' },
  { key: 'surface2', label: '重ねた面(札・入力欄)', group: '面・線' },
  { key: 'surface3', label: '選んだ面', group: '面・線' },
  { key: 'border', label: '線', group: '面・線' },
  { key: 'borderStrong', label: '濃い線', group: '面・線' },
  { key: 'textBody', label: '本文', group: '字' },
  { key: 'textMuted', label: '薄い字(日付・ID・補足)', group: '字' },
  { key: 'threadReadTitle', label: '読んだスレのスレタイ', group: '字' },
  { key: 'posterName', label: '名前', group: '字' },
  { key: 'link', label: 'リンク・アンカー', group: '字' },
  { key: 'accentText', label: '強調の上の字', group: '強調・未読' },
  { key: 'unreadText', label: '未読の札の字', group: '強調・未読' },
  { key: 'newBadge', label: 'スレ一覧の「新」の札', group: '強調・未読' },
  { key: 'newBadgeText', label: '「新」の札の字', group: '強調・未読' },
  { key: 'toOwn', label: '自分へのレス', group: '自分・主' },
  { key: 'op', label: 'スレ主', group: '自分・主' },
  { key: 'heatWarm', label: '人気(少し)', group: '人気' },
  { key: 'heatHot', label: '人気(多い)', group: '人気' },
  { key: 'heatVeryHot', label: '人気(とても多い)', group: '人気' },
  { key: 'markFav', label: 'お気に入りの印', group: '印' },
  { key: 'markDanger', label: '削除・NG・動画の印', group: '印' },
  { key: 'markNew', label: '新しい・画像の印', group: '印' },
  { key: 'markHot', label: '人気の印', group: '印' },
  { key: 'markLink', label: 'リンク・ブラウザの印', group: '印' },
  { key: 'markPurple', label: '見た目・アップロードの印', group: '印' },
  { key: 'lineBg', label: 'LINE 風のスレ表示の地', group: 'LINE 風' },
  { key: 'lineOwnBg', label: 'LINE 風の自分の吹き出し', group: 'LINE 風' },
  { key: 'lineOwnText', label: '自分の吹き出しの字', group: 'LINE 風' },
  { key: 'lineOwnLink', label: '自分の吹き出しのリンク', group: 'LINE 風' },
] as const
export type ExtraKey = (typeof EXTRA_COLORS)[number]['key']
export type ExtraColors = Partial<Record<ExtraKey, string>>

/** 配色の決まりの色(配色ごとではなく、明るい・暗いで決まる色)。app.css の :root / .dark と、アプリの Palette.extraOf と同じ値 */
const EXTRA_DEFAULTS: Partial<Record<ExtraKey, { light: string; dark: string }>> = {
  markFav: { light: '#ac8016', dark: '#f2c14e' },
  markDanger: { light: '#c53631', dark: '#ef7470' },
  markNew: { light: '#24794a', dark: '#5fc28a' },
  markHot: { light: '#cc5f00', dark: '#f0954a' },
  markLink: { light: '#2969c2', dark: '#6aa9f0' },
  markPurple: { light: '#8051c7', dark: '#b48cf0' },
  toOwn: { light: '#0b7a8c', dark: '#4dd0e1' },
  op: { light: '#926019', dark: '#f0b44c' },
  lineOwnBg: { light: '#8de055', dark: '#a6db8a' },
  lineOwnText: { light: '#10200a', dark: '#10200a' },
  lineOwnLink: { light: '#0b4f9e', dark: '#0b4f9e' },
}

export interface CustomDef {
  /** もとにした配色のキー */
  from: string
  base: string
  surface: string
  text: string
  accent: string
  unread: string
  own: string
  /** 一緒に選んでいた差し色(設定 accent のキー)。書き出し・取り込みのときだけ添える。設定の customScheme には入れない */
  accentPick?: string
  /** 細かい色(選んだものだけ) */
  colors?: ExtraColors
}

/** 細かい色の数 */
export const extraCount = (d: CustomDef) => Object.keys(d.colors ?? {}).length

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
    const d = { from: typeof o.from === 'string' ? o.from : 'light-gray' } as CustomDef
    if (typeof o.accentPick === 'string' && o.accentPick) d.accentPick = o.accentPick
    for (const k of CUSTOM_KEYS) {
      const v = o[k]
      if (typeof v !== 'string' || !HEX.test(v.trim())) return null
      d[k] = v.trim().toLowerCase()
    }
    // 細かい色は知っているキーの #RRGGBB だけ(知らないキー・読めない値は飛ばす。新しい版で足したキーが古い版に来ても落ちない)
    if (o.colors && typeof o.colors === 'object') {
      const co = o.colors as Record<string, unknown>
      const c: ExtraColors = {}
      for (const e of EXTRA_COLORS) {
        const v = co[e.key]
        if (typeof v === 'string' && HEX.test(v.trim())) c[e.key] = v.trim().toLowerCase()
      }
      if (Object.keys(c).length) d.colors = c
    }
    return d
  } catch {
    return null
  }
}

/** アプリと同じ形(キーの並びと #RRGGBB の大文字)。accentPick を渡したときだけ差し色を添える(書き出し用) */
export function customToJson(d: CustomDef, accentPick?: string): string {
  const colors = EXTRA_COLORS.filter((e) => d.colors?.[e.key]).map((e) => [e.key, d.colors![e.key]!.toUpperCase()])
  return JSON.stringify({
    from: d.from,
    ...Object.fromEntries(CUSTOM_KEYS.map((k) => [k, d[k].toUpperCase()])),
    ...(colors.length ? { colors: Object.fromEntries(colors) } : {}),
    ...(accentPick ? { accentPick } : {}),
  })
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
function lerp(x: string, y: string, t: number): string {
  const X = toOklab(x)
  const Y = toOklab(y)
  return fromOklab([0, 1, 2].map((i) => X[i] + (Y[i] - X[i]) * t) as Rgb)
}

function luminance(h: string): number {
  const [r, g, b] = toRgb(h).map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** 塗った面の上の字: 白と黒のうち、差の大きいほう */
export const onColor = (c: string) => (contrast('#111111', c) >= contrast('#ffffff', c) ? '#111111' : '#ffffff')

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

/** 6 色(と選んだ細かい色)から作る CSS 変数(アプリの buildScheme と同じ。帯 = 面) */
export function customVars(d: CustomDef): Record<string, string> {
  const from = readSchemeVars(d.from, ['--c-link', '--c-poster-name', '--c-heat-warm', '--c-heat-hot', '--c-heat-very-hot', '--c-link-youtube'])
  const dark = isCustomDark(d)
  const v: Record<string, string> = {
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
  // 細かい色: 選んだものだけ、作った値の代わりに入れる(薄い敷きは選んだ色から作る)
  const o = d.colors ?? {}
  const put = (k: ExtraKey, ...names: string[]) => {
    const c = o[k]
    if (c) for (const n of names) v[n] = c
  }
  put('bar', '--c-header-footer')
  put('surface2', '--c-surface2')
  put('surface3', '--c-surface3')
  put('border', '--c-border')
  put('borderStrong', '--c-border-strong')
  put('textBody', '--c-text-body')
  put('textMuted', '--c-text-muted')
  put('threadReadTitle', '--c-thread-read-title')
  put('posterName', '--c-poster-name')
  put('link', '--c-link', '--c-link-twitter')
  put('accentText', '--c-accent-text')
  put('unreadText', '--c-accent-self-text')
  put('heatWarm', '--c-heat-warm')
  put('heatHot', '--c-heat-hot')
  put('heatVeryHot', '--c-heat-very-hot')
  put('markFav', '--c-mark-fav')
  put('markDanger', '--c-mark-danger', '--c-mark-video')
  put('markNew', '--c-mark-new', '--c-mark-image')
  put('markHot', '--c-mark-hot')
  put('markLink', '--c-mark-link')
  put('markPurple', '--c-mark-purple')
  if (o.toOwn) {
    v['--c-to-own'] = o.toOwn
    v['--c-to-own-wash'] = wash(o.toOwn, 0.16)
  }
  if (o.op) {
    v['--c-op'] = o.op
    v['--c-op-wash'] = wash(o.op, 0.16)
  }
  // 「新」の札: 地を選んだら字は選んだ字か、地の上で読めるほう
  if (o.newBadge) {
    v['--c-new-badge-bg'] = o.newBadge
    v['--c-new-badge-text'] = o.newBadgeText ?? onColor(o.newBadge)
  } else if (o.newBadgeText) v['--c-new-badge-text'] = o.newBadgeText
  put('lineOwnBg', '--line-own-bg')
  put('lineOwnText', '--line-own-text')
  put('lineOwnLink', '--line-own-link')
  return v
}

/** LINE 風の地(アプリの Palette.lineBg と同じ計算。細かい色で選んでいればそれ) */
export function customLineBg(d: CustomDef): string {
  if (d.colors?.lineBg) return d.colors.lineBg
  return isCustomDark(d) ? lerp(lerp(d.base, '#6f8fb8', 0.06), '#000000', 0.35) : lerp(d.base, '#7f9cc0', 0.22)
}

/** CSS 変数から値を取る細かい色 */
const EXTRA_VAR: Partial<Record<ExtraKey, string>> = {
  bar: '--c-header-footer',
  surface2: '--c-surface2',
  surface3: '--c-surface3',
  border: '--c-border',
  borderStrong: '--c-border-strong',
  textBody: '--c-text-body',
  textMuted: '--c-text-muted',
  threadReadTitle: '--c-thread-read-title',
  posterName: '--c-poster-name',
  link: '--c-link',
  accentText: '--c-accent-text',
  unreadText: '--c-accent-self-text',
  heatWarm: '--c-heat-warm',
  heatHot: '--c-heat-hot',
  heatVeryHot: '--c-heat-very-hot',
}

/**
 * 細かい色のいまの値(全部)。選んでいればそれ、選んでいなければ 6 色から作った値か配色の決まりの色(画面に見せる・色選びの始まりの色)。
 * アプリの extraValue と同じ
 */
export function extraValues(d: CustomDef): Record<ExtraKey, string> {
  const base: CustomDef = { ...d, colors: undefined }
  const v = customVars(base)
  const dark = isCustomDark(d)
  const out = {} as Record<ExtraKey, string>
  for (const e of EXTRA_COLORS) {
    const k = e.key
    const picked = d.colors?.[k]
    if (picked) out[k] = picked
    else if (EXTRA_VAR[k]) out[k] = v[EXTRA_VAR[k]!]
    else if (k === 'lineBg') out[k] = customLineBg(base)
    // 「新」の札(app.css): 暗い配色はお気に入りの金に暗い字、明るい配色は未読の色にその上の字
    else if (k === 'newBadge') out[k] = dark ? EXTRA_DEFAULTS.markFav!.dark : d.unread
    else if (k === 'newBadgeText') out[k] = dark ? '#1f1a0a' : v['--c-accent-self-text']
    else out[k] = dark ? EXTRA_DEFAULTS[k]!.dark : EXTRA_DEFAULTS[k]!.light
  }
  return out
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
