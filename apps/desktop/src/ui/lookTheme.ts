// スキン(見た目をまとめた JSON)。配色(自分の配色)・レスの見た目・細かい表示・文字と余白をまとめて受け渡す。形は docs/skin.md。
// 同梱のスキンはない(ChMate 風などは docs/skins の JSON を貼り付けて入れる)
// - settings: スマホのアプリと同じ名前・同じ意味の項目。pc / android: その版だけの項目(ツリー表示などの styleOptions・字)
// - 入っている項目だけを上書きする(欠けている JSON も読める。人が作ったテーマを取り込んで、気に入らない所だけ直せる)
// - scheme があれば自分の配色として入れ、配色をそれにする(settings の scheme があればそちら)
// スマホのアプリの data/LookTheme.kt と同じ決まり

import { importableSettings, type SettingsFile } from '../utils/backup'
import { customToJson, customVars, parseCustom, readSchemeVars } from './customScheme'
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
  /** 一覧(カタログ)から入れたスキンの出どころ。あれば、一覧が新しくなったときに自動で入れ替える(ui/skinCatalog.ts) */
  source?: { id: string; url: string; revision: number }
}

/** スキンの JSON か(自分の配色だけの JSON と見分ける) */
export const isLookTheme = (o: Record<string, unknown>) => o.format === LOOK_THEME_FORMAT || 'settings' in o || 'android' in o || 'pc' in o

/** いまの見た目をスキンに(自分の配色・差し色・見た目の項目) */
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

/** 配る形の JSON(出どころの source は外す) */
export const lookThemeShareJson = (t: LookTheme) => {
  const { source: _s, ...rest } = t
  return JSON.stringify(rest, null, 2)
}

/**
 * スキンか自分の配色の JSON を読み、設定に当てる差分を返す(入っている項目だけ)。読めなければ理由の文。
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

/**
 * スキンの代表の色(地・面・強調・未読・字)。設定の一覧の札に出す。
 * 自分の配色が入っていればそれから、なければ settings の配色のキーの CSS から。どちらもなければ undefined(今の配色で描く)
 */
export function lookThemeSwatch(t: LookTheme): string[] | undefined {
  if (t.scheme && typeof t.scheme === 'object') {
    const d = parseCustom(JSON.stringify(t.scheme))
    if (d) {
      const v = customVars(d)
      return [d.base, d.surface, d.accent, d.unread, v['--c-text-strong']]
    }
  }
  const key = t.settings?.scheme
  if (typeof key !== 'string' || !key || key === 'custom') return undefined
  const v = readSchemeVars(key, ['--c-base', '--c-surface', '--c-accent', '--c-accent-self', '--c-text-strong'])
  return [v['--c-base'], v['--c-surface'], v['--c-accent'], v['--c-accent-self'], v['--c-text-strong']]
}

// ── 保存したスキン(設定 lookThemes。名前で見分ける) ──

export const lookThemeName = (t: LookTheme) => (typeof t.name === 'string' && t.name ? t.name : '名前なし')

/** 保存する(同じ名前があれば入れ替える) */
export const withSavedTheme = (list: LookTheme[], t: LookTheme): LookTheme[] => [...list.filter((x) => lookThemeName(x) !== lookThemeName(t)), t]

export const withoutSavedTheme = (list: LookTheme[], name: string): LookTheme[] => list.filter((x) => lookThemeName(x) !== name)

/** ドロップダウンのキー("saved:名前")からスキンの JSON を。なければ undefined */
export function lookThemeByKey(s: AppSettings, key: string): string | undefined {
  if (key.startsWith('saved:')) {
    const t = s.lookThemes.find((x) => lookThemeName(x) === key.slice(6))
    return t ? JSON.stringify(t) : undefined
  }
  return undefined
}

/** 選んでいるスキンのキーから名前(保存するとき・JSON をコピーするときの既定の名前) */
export const lookThemeKeyName = (key: string): string => (key.startsWith('saved:') ? key.slice(6) : '')

