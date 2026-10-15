// アプリの設定。SQLite の settings 表に 1 項目 1 行(JSON)で保存する。
// 見た目の設定は <html> の data-scheme / data-pattern / data-density 属性と .dark クラスに反映し、
// 実際の色や余白は theme/theme.css・theme/patterns.css(web 版の複製)が CSS 変数で切り替える。

import { useCallback, useEffect, useState } from 'react'
import type { LogStore } from '@bbs-browser/logstore'
import type { NgRule } from '../utils/ng'

export type ColorScheme = 'indigo' | 'amber-teal' | 'light' | '2ch-classic'
export type DesignPattern = 'tonal' | 'bordered'
/** web 版の 'panel'(カード表示)はサムネイル前提なので、専ブラでは一覧と高密度だけにする */
export type ListDensity = 'list' | 'dense'
export type FontSize = 1 | 2 | 3 | 4 | 5
export type FontFamily = 'noto' | 'biz-ud' | 'system'
export type ThreadSort = 'subject' | 'momentum' | 'newest'
export type OpenPosition = 'unread' | 'top' | 'bottom'
export type AnchorPopup = 'hover' | 'click'
export type NgMode = 'aborn' | 'hide'

export interface AppSettings {
  // 表示
  scheme: ColorScheme
  pattern: DesignPattern
  density: ListDensity
  fontSize: FontSize
  fontFamily: FontFamily
  threadPanelWidth: number
  // 起動
  /** 起動時に開く板の URL。空なら何も開かない */
  startupBoardUrl: string
  // スレ一覧
  threadSort: ThreadSort
  // レス表示
  openPosition: OpenPosition
  anchorPopup: AnchorPopup
  showThumbnails: boolean
  aaAutoDetect: boolean
  // 自動更新
  /** 開いているスレを自動で更新する間隔(秒)。0 なら自動更新しない */
  autoRefreshSec: number
  /** いちばん下を見ているときに新着が来たら、新着まで自動でスクロールする */
  autoScrollOnNew: boolean
  // NG
  ngRules: NgRule[]
  /** aborn: 「あぼーん」と出す / hide: 何も出さない(透明あぼーん) */
  ngMode: NgMode
}

export const DEFAULT_SETTINGS: AppSettings = {
  scheme: 'indigo',
  pattern: 'tonal',
  density: 'dense',
  fontSize: 3,
  fontFamily: 'noto',
  threadPanelWidth: 420,
  startupBoardUrl: 'https://bbs.eddibb.cc/liveedge/',
  threadSort: 'subject',
  openPosition: 'unread',
  anchorPopup: 'hover',
  showThumbnails: true,
  aaAutoDetect: true,
  autoRefreshSec: 0,
  autoScrollOnNew: true,
  ngRules: [],
  ngMode: 'aborn',
}

export const COLOR_SCHEMES: { key: ColorScheme; name: string; accent: string; border: string }[] = [
  { key: 'indigo', name: 'インディゴ', accent: '#7566e6', border: '#242933' },
  { key: 'amber-teal', name: 'アンバー×ティール', accent: '#e0993f', border: '#2a3247' },
  { key: 'light', name: 'ライト', accent: '#3d6b96', border: '#e7e4df' },
  { key: '2ch-classic', name: '2chクラシック', accent: '#0000ff', border: '#545454' },
]

export const FONT_FAMILIES: { key: FontFamily; name: string; css: string }[] = [
  { key: 'noto', name: 'Noto Sans JP', css: "'Noto Sans JP Variable', 'Noto Sans JP', sans-serif" },
  { key: 'biz-ud', name: 'BIZ UDPゴシック', css: "'BIZ UDPGothic', sans-serif" },
  { key: 'system', name: 'システム標準', css: "'Yu Gothic UI', 'Meiryo UI', 'Noto Sans CJK JP', sans-serif" },
]

const DARK_SCHEMES = new Set<ColorScheme>(['indigo', 'amber-teal'])

const FONT_SIZES = [13, 14, 16, 18, 20]

function apply(s: AppSettings) {
  const root = document.documentElement
  root.setAttribute('data-scheme', s.scheme)
  root.classList.toggle('dark', DARK_SCHEMES.has(s.scheme))
  root.setAttribute('data-pattern', s.pattern)
  root.setAttribute('data-density', s.density)
  root.style.fontSize = `${FONT_SIZES[s.fontSize - 1]}px`
  const font = FONT_FAMILIES.find((f) => f.key === s.fontFamily) ?? FONT_FAMILIES[0]
  root.style.setProperty('--app-font', font.css)
}

export type UpdateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void

/** 設定を読み込み、変更を即座に画面へ反映して保存する。loaded は保存済みの値を読み終えたか */
export function useSettings(store: LogStore | undefined): [AppSettings, UpdateSetting, boolean] {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!store) return
    void store.getSettings().then((saved) => {
      setSettings((s) => ({ ...s, ...(saved as Partial<AppSettings>) }))
      setLoaded(true)
    })
  }, [store])

  useEffect(() => apply(settings), [settings])

  const update = useCallback<UpdateSetting>(
    (key, value) => {
      setSettings((s) => ({ ...s, [key]: value }))
      void store?.setSetting(key, value)
    },
    [store],
  )

  return [settings, update, loaded]
}
