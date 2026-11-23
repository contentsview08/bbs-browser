// 設定と NG の書き出し・読み込み(JSON)。ファイルの読み書きは host/backup.ts、ここは中身を作る・確かめるだけ。
// - 設定には、秘密の値(catbox のアカウント・書き込みの削除キー)と、その端末だけの状態(開いていたタブ・背景画像のパスなど)を入れない
// - NG は、読み込むときに今のものへ足す(同じものは重ねない)
// - 設定のファイルには、お気に入り板・お気に入りのスレ・サイト・上げた画像の履歴も入れる(Android 版のバックアップと同じ形。互いに読める)

import { migrateOld, migrateValues, type AppSettings } from '../ui/settings'
import type { NgRule, NgTarget } from './ng'
import { isKeywordRule, migrateLegacyKeywords } from './keywords'

const APP = 'bbs-browser'
/** Android 版のバックアップの名乗り。設定の名前と形は同じなので、そのまま読む */
const APP_ANDROID = 'OBB'
const VERSION = 1

/** 設定と一緒に書き出すもの(Android 版の favoriteBoards・favoriteThreads・sites・uploads と同じ形) */
export interface BackupExtras {
  favoriteBoards?: { url: string; name: string }[]
  favoriteThreads?: { boardUrl: string; key: string; title: string }[]
  sites?: { url: string; name: string }[]
  /** 削除ページの URL(deleteUrl)は、知った人が画像を消せる秘密なので書き出さない(読み込みは受ける) */
  uploads?: { url: string; name: string; size: number; uploadedAt: number; withAccount: boolean; hash?: string; deleteUrl?: string }[]
}

/** 書き出さない設定。秘密の値と、その端末・そのときだけの状態 */
const NOT_EXPORTED: readonly (keyof AppSettings)[] = [
  'catboxUserhash',
  'imgbbApiKey',
  'imgurClientId',
  'openTabs',
  'activeTab',
  'tabGroups',
  'keywordBandsCollapsed',
  'keywordRulesMigrated',
  'lastBoardUrl',
  'backgroundImage',
  'notifySoundPath',
  'imageSaveDir',
  'imageSaveName',
  'customFont',
  'postDeleteKey',
  'notificationLog',
  'boardVisits',
  'keywordWatchSince',
  'lastUpdateCheckAt',
  'lastLogPruneAt',
]

export interface SettingsFile extends BackupExtras {
  app: typeof APP | typeof APP_ANDROID
  kind: 'settings'
  version: number
  exportedAt?: string
  settings: Partial<AppSettings>
}

export interface NgFile {
  app: typeof APP
  kind: 'ng'
  version: number
  exportedAt: string
  rules: NgRule[]
}

export function settingsFile(settings: AppSettings, extras: BackupExtras = {}, now = new Date()): SettingsFile {
  const out: Partial<AppSettings> = { ...settings }
  for (const k of NOT_EXPORTED) delete out[k]
  const uploads = extras.uploads?.map(({ deleteUrl: _secret, ...u }) => u)
  return { app: APP, kind: 'settings', version: VERSION, exportedAt: now.toISOString(), settings: out, ...extras, ...(uploads ? { uploads } : {}) }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const strs = (o: Record<string, unknown>, keys: string[]) => keys.every((k) => typeof o[k] === 'string' && o[k] !== '')

/** ファイルの中の、お気に入り板・スレ・サイト・画像の履歴のうち、形の合う行だけ(ファイルは人の手で書き換えられる) */
export function backupExtras(d: Record<string, unknown>): BackupExtras {
  const rows = (name: string) => (Array.isArray(d[name]) ? (d[name] as unknown[]).filter(isObj) : [])
  const out: BackupExtras = {}
  const boards = rows('favoriteBoards').filter((r) => strs(r, ['url'])).map((r) => ({ url: r.url as string, name: typeof r.name === 'string' ? r.name : '' }))
  const threads = rows('favoriteThreads').filter((r) => strs(r, ['boardUrl', 'key'])).map((r) => ({ boardUrl: r.boardUrl as string, key: r.key as string, title: typeof r.title === 'string' ? r.title : '' }))
  const sites = rows('sites').filter((r) => strs(r, ['url'])).map((r) => ({ url: r.url as string, name: typeof r.name === 'string' ? r.name : '' }))
  const uploads = rows('uploads')
    .filter((r) => strs(r, ['url']) && typeof r.uploadedAt === 'number' && Number.isFinite(r.uploadedAt))
    .map((r) => ({
      url: r.url as string,
      name: typeof r.name === 'string' ? r.name : '',
      size: typeof r.size === 'number' && Number.isFinite(r.size) ? r.size : 0,
      uploadedAt: r.uploadedAt as number,
      withAccount: r.withAccount === true,
      ...(typeof r.hash === 'string' && r.hash ? { hash: r.hash } : {}),
      ...(typeof r.deleteUrl === 'string' && r.deleteUrl ? { deleteUrl: r.deleteUrl } : {}),
    }))
  if (boards.length) out.favoriteBoards = boards
  if (threads.length) out.favoriteThreads = threads
  if (sites.length) out.sites = sites
  if (uploads.length) out.uploads = uploads
  return out
}

/** 読み込んだお気に入りなどの数の言い方(「お気に入り板 3・サイト 1」。何もなければ空) */
export function describeExtras(e: BackupExtras): string {
  return [
    e.favoriteBoards?.length && `お気に入り板 ${e.favoriteBoards.length}`,
    e.favoriteThreads?.length && `お気に入りのスレ ${e.favoriteThreads.length}`,
    e.sites?.length && `サイト ${e.sites.length}`,
    e.uploads?.length && `上げた画像 ${e.uploads.length}`,
  ]
    .filter(Boolean)
    .join('・')
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

const isString = (v: unknown) => typeof v === 'string'

/** 配列の設定の、要素の確かめ方。合わない要素は読み込まない(手で書き換えた値で描画が落ちないように) */
const ARRAY_ITEM_CHECKS: Partial<Record<keyof AppSettings, (v: unknown) => boolean>> = {
  ngRules: isNgRule,
  aiNgRules: (v) => !!v && typeof v === 'object' && ['id', 'name', 'prompt'].every((k) => typeof (v as Record<string, unknown>)[k] === 'string'),
  listTabs: isString,
  pastTabs: isString,
  keywords: isString,
  keywordAuthors: isString,
  keywordRules: isKeywordRule,
  grossWords: isString,
  quickPhrases: isString,
  postToolbar: isString,
}

/** 確かめる間隔の範囲(設定の画面と同じ)。外れた値だと、タイマーがすぐ回り続けて通信を送り続ける */
const INTERVAL_LIMITS: Partial<Record<keyof AppSettings, number>> = {
  autoRefreshSec: 3600,
  favCheckMin: 1440,
  historyCheckMin: 1440,
  keywordWatchMin: 1440,
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
  if (d.app !== APP && d.app !== APP_ANDROID) return { kind: 'error', error: 'OBB(PC 版・Android 版)で書き出したファイルではありません' }
  if (typeof d.version !== 'number' || d.version > VERSION)
    return { kind: 'error', error: '新しい版のアプリで書き出したファイルです。アプリを更新してください' }
  // Android 版のバックアップは kind がなく、設定とお気に入りなどが 1 つに入っている
  if (d.kind === 'settings' || (d.kind === undefined && d.app === APP_ANDROID)) {
    if (!isObj(d.settings)) return { kind: 'error', error: '設定が入っていません' }
    return { app: d.app as SettingsFile['app'], kind: 'settings', version: d.version, exportedAt: typeof d.exportedAt === 'string' ? d.exportedAt : undefined, settings: d.settings as Partial<AppSettings>, ...backupExtras(d) }
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
    // __proto__ などの受け継いだ名前も in には当たるので、自分の項目だけを見る
    if (!Object.hasOwn(defaults, k) || NOT_EXPORTED.includes(k)) continue
    const d = defaults[k]
    const sameType = Array.isArray(d) ? Array.isArray(v) : typeof d === typeof v && (typeof d !== 'object' || (v !== null && !Array.isArray(v)))
    if (!sameType || (typeof v === 'number' && !Number.isFinite(v))) continue
    const check = ARRAY_ITEM_CHECKS[k]
    const limit = INTERVAL_LIMITS[k]
    ;(out as Record<string, unknown>)[k] = check && Array.isArray(v) ? v.filter(check) : limit !== undefined ? Math.min(limit, Math.max(0, Math.round(v as number))) : v
  }
  // id がないと消すときに見分けられず、enabled がないと黙って切れてしまう
  if (out.ngRules) out.ngRules = out.ngRules.map((r) => ({ ...r, id: r.id || crypto.randomUUID(), enabled: r.enabled !== false }))
  // 古い版のファイルも、保存してある設定を読むときと同じく今の形に読み替える
  const merged = { ...out, ...migrateOld(file.settings) }
  // 前の形のキーワード(言葉の並び)しかないファイルは、今の形(keywordRules)に写して戻す(写し終えた端末では、戻すときにしか写らないため)
  if (!merged.keywordRules && (merged.keywords?.length || merged.keywordAuthors?.length)) merged.keywordRules = migrateLegacyKeywords(merged.keywords ?? [], merged.keywordAuthors ?? [])
  return { ...merged, ...migrateValues(merged) }
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
export function backupFileName(kind: 'settings' | 'ng' | 'scheme' | 'db' | 'full', now = new Date()): string {
  const d = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return kind === 'db' ? `OBB-${d}.db` : kind === 'full' ? `OBB-full-${d}.zip` : `OBB-${kind}-${d}.json`
}
