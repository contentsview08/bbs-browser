// 見た目のテーマ(JSON)。配色(自分の配色)・レスの見た目・細かい表示・文字と余白をまとめて受け渡す。形は docs/look-theme.md。
// - settings: スマホのアプリと同じ名前・同じ意味の項目。pc / android: その版だけの項目(ツリー表示などの styleOptions・字)
// - 入っている項目だけを上書きする(欠けている JSON も読める。人が作ったテーマを取り込んで、気に入らない所だけ直せる)
// - scheme があれば自分の配色として入れ、配色をそれにする(settings の scheme があればそちら)
// スマホのアプリの data/LookTheme.kt と同じ決まり

import { importableSettings, type SettingsFile } from '../utils/backup'
import { customToJson, parseCustom } from './customScheme'
import { accentKeyOf, type AppSettings } from './settings'

export const LOOK_THEME_FORMAT = 'obb-theme'

/** スマホのアプリの LookTheme.COMMON_KEYS と同じ並び(名前も意味も同じ項目) */
export const COMMON_KEYS = [
  'followOsTheme', 'scheme', 'darkScheme', 'lightScheme', 'accent',
  'postStyle',
  'idStyle', 'idShort', 'idPosition', 'dateStyle', 'heatStyle', 'highlightOp', 'nameSubtle', 'omitNoname', 'watchoiShort', 'iconFromWatchoi',
  'urlShorten', 'tidyBlankLines', 'showMinimap', 'showLinkPreview', 'openLinksInApp',
  'threadSort', 'unreadFirst', 'listShape', 'keywordBands', 'openPosition', 'showNextCandidatesAtEnd', 'showNextUnreadAtEnd',
  'blurGross', 'postThumbSize', 'thumbLoad', 'reduceMotion', 'ngMode', 'groupNg', 'pastTabsPosition', 'hideBarsOnScroll',
  'mobileFontPx', 'listFontPx', 'postBodyPx', 'postHeadPx', 'listPadPx', 'postPadPx', 'postLineHeight', 'headerPx', 'footerPx',
] as const satisfies readonly (keyof AppSettings)[]
/** PC 版だけの項目(JSON の pc) */
export const PC_KEYS = ['fontFamily', 'styleOptions', 'fontPx', 'contentBasePx', 'replyFontPx', 'barFontPx', 'panelOpacity', 'backgroundOpacity', 'listThumbScale', 'anchorPopup'] as const satisfies readonly (keyof AppSettings)[]
const KEYS = new Set<string>([...COMMON_KEYS, ...PC_KEYS])

export interface LookTheme {
  format?: string
  version?: number
  name?: string
  note?: string
  scheme?: Record<string, unknown>
  accent?: string
  settings?: Record<string, unknown>
  android?: Record<string, unknown>
  pc?: Record<string, unknown>
}

/** 見た目のテーマの JSON か(自分の配色だけの JSON と見分ける) */
export const isLookTheme = (o: Record<string, unknown>) => o.format === LOOK_THEME_FORMAT || 'settings' in o || 'android' in o || 'pc' in o

/** いまの見た目をテーマに(自分の配色・差し色・見た目の項目) */
export function lookThemeOf(s: AppSettings, name = ''): LookTheme {
  const custom = parseCustom(s.customScheme)
  const common: Record<string, unknown> = {}
  const pc: Record<string, unknown> = {}
  for (const k of COMMON_KEYS) common[k] = s[k]
  for (const k of PC_KEYS) pc[k] = s[k]
  return {
    format: LOOK_THEME_FORMAT,
    version: 1,
    ...(name ? { name } : {}),
    ...(custom ? { scheme: JSON.parse(customToJson(custom)) as Record<string, unknown> } : {}),
    accent: s.accent,
    settings: common,
    pc,
  }
}

export const lookThemeJson = (s: AppSettings, name = '') => JSON.stringify(lookThemeOf(s, name), null, 2)

/**
 * テーマか自分の配色の JSON を読み、設定に当てる差分を返す(入っている項目だけ)。読めなければ理由の文。
 * 値の形の確かめ・古い形の読み替えはバックアップの読み込み(importableSettings)と同じ
 */
export function lookThemePatch(text: string, defaults: AppSettings): { patch: Partial<AppSettings>; name: string; theme?: LookTheme } | string {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(text.trim()) as Record<string, unknown>
  } catch {
    return 'JSON ではありません'
  }
  if (!o || typeof o !== 'object') return 'JSON ではありません'
  if (!isLookTheme(o)) {
    // 自分の配色だけの JSON
    const d = parseCustom(JSON.stringify(o))
    if (!d) return '配色・テーマの JSON ではありません'
    return { patch: { customScheme: customToJson(d), followOsTheme: false, scheme: 'custom', accent: accentKeyOf(d.accentPick) }, name: '自分の配色' }
  }
  const merged: Record<string, unknown> = {}
  for (const section of ['settings', 'pc'] as const) {
    const sec = o[section]
    if (sec && typeof sec === 'object') for (const [k, v] of Object.entries(sec as Record<string, unknown>)) if (KEYS.has(k)) merged[k] = v
  }
  const file = { app: 'bbs-browser', kind: 'settings', version: 1, settings: merged } as unknown as SettingsFile
  const patch: Partial<AppSettings> = {}
  for (const [k, v] of Object.entries(importableSettings(file, defaults))) if (KEYS.has(k)) (patch as Record<string, unknown>)[k] = v
  // 自分の配色: 入っていればそれにして、配色を「自分の配色」に(settings で配色を指していればそちら)
  if (o.scheme && typeof o.scheme === 'object') {
    const d = parseCustom(JSON.stringify(o.scheme))
    if (d) {
      patch.customScheme = customToJson(d)
      if (!('scheme' in patch)) patch.scheme = 'custom'
      if (!('followOsTheme' in patch)) patch.followOsTheme = false
      if (d.accentPick && !('accent' in o)) patch.accent = accentKeyOf(d.accentPick)
    }
  }
  if (typeof o.accent === 'string') patch.accent = accentKeyOf(o.accent)
  const theme = o as LookTheme
  return { patch, name: lookThemeName(theme), theme }
}

// ── 保存したテーマ(設定 lookThemes。名前で見分ける) ──

export const lookThemeName = (t: LookTheme) => (typeof t.name === 'string' && t.name ? t.name : '名前なし')

/** 保存する(同じ名前があれば入れ替える) */
export const withSavedTheme = (list: LookTheme[], t: LookTheme): LookTheme[] => [...list.filter((x) => lookThemeName(x) !== lookThemeName(t)), t]

export const withoutSavedTheme = (list: LookTheme[], name: string): LookTheme[] => list.filter((x) => lookThemeName(x) !== name)

/** ドロップダウンのキー("preset:…" か "saved:名前")からテーマの JSON を。なければ undefined */
export function lookThemeByKey(s: AppSettings, key: string): string | undefined {
  if (key.startsWith('preset:')) return LOOK_PRESETS.some((p) => p.key === key.slice(7)) ? lookPreset(key.slice(7)) : undefined
  if (key.startsWith('saved:')) {
    const t = s.lookThemes.find((x) => lookThemeName(x) === key.slice(6))
    return t ? JSON.stringify(t) : undefined
  }
  return undefined
}

/** 選んでいるテーマのキーから名前(保存するとき・JSON をコピーするときの既定の名前) */
export function lookThemeKeyName(key: string): string {
  if (key.startsWith('saved:')) return key.slice(6)
  if (key.startsWith('preset:')) return LOOK_PRESETS.find((p) => p.key === key.slice(7))?.name ?? ''
  return ''
}

/** 同梱のテーマ(キーと名前)。中身は docs/themes にある JSON と同じ */
export const LOOK_PRESETS = [
  { key: 'chmate-dark', name: 'ChMate 風(ダーク)' },
  { key: 'chmate-light', name: 'ChMate 風(ライト)' },
] as const

export function lookPreset(key: string): string {
  return key === 'chmate-light' ? CHMATE_LIGHT : CHMATE_DARK
}

const CHMATE_DARK = String.raw`
{
  "format": "obb-theme",
  "version": 1,
  "name": "ChMate 風(ダーク)",
  "note": "ChMate のダークに寄せた見た目。濃い灰色の地、紫の新着の札、専ブラ風のレス(番号・名前・日時・ID を 1 行に)、右にミニマップ。人気のレスは本文の色、自分のレス・自分への返信は左の帯",
  "scheme": {
    "from": "gray",
    "base": "#313131",
    "surface": "#313131",
    "text": "#F4F4F4",
    "accent": "#8E6BC8",
    "unread": "#8E6BC8",
    "own": "#FF8FA3",
    "colors": {
      "bar": "#575757",
      "surface2": "#3A3A3A",
      "surface3": "#434343",
      "border": "#262626",
      "borderStrong": "#1A1A1A",
      "textMuted": "#A8A8A8",
      "threadReadTitle": "#64B5F6",
      "posterName": "#B0B0B0",
      "link": "#6AA6E8",
      "newBadge": "#8E6BC8",
      "newBadgeText": "#FFFFFF",
      "heatWarm": "#7986CB",
      "heatHot": "#AB47BC",
      "heatVeryHot": "#EF5350",
      "markFav": "#F2C14E"
    }
  },
  "accent": "",
  "settings": {
    "followOsTheme": false,
    "postStyle": "classic",
    "dateStyle": "full",
    "idPosition": "header",
    "idStyle": "none",
    "idShort": false,
    "heatStyle": "text",
    "highlightOp": true,
    "nameSubtle": true,
    "omitNoname": false,
    "watchoiShort": false,
    "iconFromWatchoi": false,
    "urlShorten": false,
    "tidyBlankLines": false,
    "showMinimap": true,
    "showLinkPreview": false,
    "listShape": "normal",
    "unreadFirst": false,
    "keywordBands": true
  },
  "android": {
    "styleOptions": { "classic": { "tree": false, "treeDepth": 3, "quote": "line", "group": true } }
  },
  "pc": {
    "styleOptions": { "classic": { "tree": false } }
  }
}
`

const CHMATE_LIGHT = String.raw`
{
  "format": "obb-theme",
  "version": 1,
  "name": "ChMate 風(ライト)",
  "note": "ChMate のライトに寄せた見た目。薄い灰色の地、桃色の新着の札、専ブラ風のレス(番号・名前・日時・ID を 1 行に)、右にミニマップ。人気のレスは本文の色、自分のレス・自分への返信は左の帯",
  "scheme": {
    "from": "light-gray",
    "base": "#EEEEEE",
    "surface": "#EEEEEE",
    "text": "#212121",
    "accent": "#E85DA6",
    "unread": "#E85DA6",
    "own": "#D32F2F",
    "colors": {
      "bar": "#DADADA",
      "surface2": "#E4E4E4",
      "surface3": "#D9D9D9",
      "border": "#C8C8C8",
      "borderStrong": "#B0B0B0",
      "textMuted": "#757575",
      "threadReadTitle": "#3949AB",
      "posterName": "#707070",
      "link": "#1E63C9",
      "newBadge": "#E85DA6",
      "newBadgeText": "#FFFFFF",
      "heatWarm": "#5C6BC0",
      "heatHot": "#8E24AA",
      "heatVeryHot": "#D32F2F",
      "markFav": "#AC8016"
    }
  },
  "accent": "",
  "settings": {
    "followOsTheme": false,
    "postStyle": "classic",
    "dateStyle": "full",
    "idPosition": "header",
    "idStyle": "none",
    "idShort": false,
    "heatStyle": "text",
    "highlightOp": true,
    "nameSubtle": true,
    "omitNoname": false,
    "watchoiShort": false,
    "iconFromWatchoi": false,
    "urlShorten": false,
    "tidyBlankLines": false,
    "showMinimap": true,
    "showLinkPreview": false,
    "listShape": "normal",
    "unreadFirst": false,
    "keywordBands": true
  },
  "android": {
    "styleOptions": { "classic": { "tree": false, "treeDepth": 3, "quote": "line", "group": true } }
  },
  "pc": {
    "styleOptions": { "classic": { "tree": false } }
  }
}
`
