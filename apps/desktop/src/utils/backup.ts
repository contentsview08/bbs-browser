// 設定と NG の書き出し・読み込み(JSON)。ファイルの読み書きは host/backup.ts、ここは中身を作る・確かめるだけ。
// - 設定には、秘密の値(catbox のアカウント・書き込みの削除キー)と、その端末だけの状態(開いていたタブ・背景画像のパスなど)を入れない
// - NG は、読み込むときに今のものへ足す(同じものは重ねない)

import type { AppSettings } from '../ui/settings'
import type { NgRule, NgTarget } from './ng'

const APP = 'bbs-browser'
const VERSION = 1

/** 書き出さない設定。秘密の値と、その端末・そのときだけの状態 */
const NOT_EXPORTED: readonly (keyof AppSettings)[] = [
  'catboxUserhash',
  'imgbbApiKey',
  'imgurClientId',
  'openTabs',
  'activeTab',
  'lastBoardUrl',
  'backgroundImage',
  'imageSaveDir',
  'customFont',
  'postDeleteKey',
  'notificationLog',
  'boardVisits',
  'keywordWatchSince',
  'lastUpdateCheckAt',
  'lastLogPruneAt',
]

export interface SettingsFile {
  app: typeof APP
  kind: 'settings'
  version: number
  exportedAt: string
  settings: Partial<AppSettings>
}

export interface NgFile {
  app: typeof APP
  kind: 'ng'
  version: number
  exportedAt: string
  rules: NgRule[]
}

export function settingsFile(settings: AppSettings, now = new Date()): SettingsFile {
  const out: Partial<AppSettings> = { ...settings }
  for (const k of NOT_EXPORTED) delete out[k]
  return { app: APP, kind: 'settings', version: VERSION, exportedAt: now.toISOString(), settings: out }
}

export function ngFile(rules: NgRule[], now = new Date()): NgFile {
  return { app: APP, kind: 'ng', version: VERSION, exportedAt: now.toISOString(), rules }
}

/** 読み込んだファイルの中身。合わなければ error に理由を入れる */
export type ParsedBackup = SettingsFile | NgFile | { kind: 'error'; error: string }

const NG_TARGET_KEYS: readonly NgTarget[] = ['content', 'posterName', 'posterId', 'threadTitle']

function isNgRule(v: unknown): v is NgRule {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.pattern === 'string' &&
    r.pattern !== '' &&
    NG_TARGET_KEYS.includes(r.target as NgTarget) &&
    typeof r.isRegex === 'boolean' &&
    (r.expiresOnDate === undefined || typeof r.expiresOnDate === 'string') &&
    (r.boardUrl === undefined || typeof r.boardUrl === 'string')
  )
}

export function parseBackup(text: string): ParsedBackup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { kind: 'error', error: 'JSON として読めません' }
  }
  if (!data || typeof data !== 'object') return { kind: 'error', error: '中身がありません' }
  const d = data as Record<string, unknown>
  if (d.app !== APP) return { kind: 'error', error: 'このアプリで書き出したファイルではありません' }
  if (typeof d.version !== 'number' || d.version > VERSION)
    return { kind: 'error', error: '新しい版のアプリで書き出したファイルです。アプリを更新してください' }
  if (d.kind === 'settings') {
    if (!d.settings || typeof d.settings !== 'object') return { kind: 'error', error: '設定が入っていません' }
    return d as unknown as SettingsFile
  }
  if (d.kind === 'ng') {
    if (!Array.isArray(d.rules)) return { kind: 'error', error: 'NG が入っていません' }
    const rules = d.rules.filter(isNgRule)
    return { ...(d as unknown as NgFile), rules }
  }
  return { kind: 'error', error: '設定でも NG でもないファイルです' }
}

/**
 * 読み込む設定のうち、いまのアプリにある項目で、型が合うものだけを返す
 * (古い版の項目や、手で書き換えて壊れた値で、アプリがおかしくならないように)
 */
export function importableSettings(file: SettingsFile, defaults: AppSettings): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  for (const [k, v] of Object.entries(file.settings) as [keyof AppSettings, unknown][]) {
    if (!(k in defaults) || NOT_EXPORTED.includes(k)) continue
    const d = defaults[k]
    const sameType = Array.isArray(d) ? Array.isArray(v) : typeof d === typeof v && (typeof d !== 'object' || (v !== null && !Array.isArray(v)))
    if (sameType) (out as Record<string, unknown>)[k] = v
  }
  return out
}

/** NG を今のものに足す。同じもの(種類・言葉・正規表現か・効く板)は重ねない。足した数も返す */
export function mergeNgRules(current: NgRule[], incoming: NgRule[], newId: () => string): { rules: NgRule[]; added: number } {
  const key = (r: NgRule) => `${r.target}\n${r.isRegex ? 1 : 0}\n${r.pattern}\n${r.boardUrl ?? ''}`
  const seen = new Set(current.map(key))
  const add: NgRule[] = []
  for (const r of incoming) {
    if (seen.has(key(r))) continue
    seen.add(key(r))
    add.push({ ...r, id: newId(), enabled: r.enabled !== false })
  }
  return { rules: [...current, ...add], added: add.length }
}

/** 書き出すファイルの名前(日付入り) */
export function backupFileName(kind: 'settings' | 'ng' | 'db', now = new Date()): string {
  const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return kind === 'db' ? `OBB-${d}.db` : `OBB-${kind}-${d}.json`
}
