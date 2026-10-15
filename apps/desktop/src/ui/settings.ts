// 表示設定(配色・枠線スタイル・密度・文字サイズ)。値は web 版(hono-bbs)の settingsStore と同じ。
// <html> の data-scheme / data-pattern / data-density 属性と .dark クラスに反映し、
// 実際の見た目は theme/theme.css・theme/patterns.css が CSS 変数で切り替える。

import { useCallback, useEffect, useState } from 'react'
import type { LogStore } from '@bbs-browser/logstore'

export type ColorScheme = 'indigo' | 'amber-teal' | 'light' | '2ch-classic'
export type DesignPattern = 'tonal' | 'bordered'
/** web 版の 'panel'(カード表示)はサムネイル前提なので、専ブラでは一覧と高密度だけにする */
export type ListDensity = 'list' | 'dense'
export type FontSize = 1 | 2 | 3 | 4 | 5

export interface DisplaySettings {
  scheme: ColorScheme
  pattern: DesignPattern
  density: ListDensity
  fontSize: FontSize
  threadPanelWidth: number
}

/** 専ブラなので既定は高密度 */
export const DEFAULT_SETTINGS: DisplaySettings = {
  scheme: 'indigo',
  pattern: 'tonal',
  density: 'dense',
  fontSize: 3,
  threadPanelWidth: 420,
}

export const COLOR_SCHEMES: { key: ColorScheme; name: string; accent: string; border: string }[] = [
  { key: 'indigo', name: 'インディゴ', accent: '#7566e6', border: '#242933' },
  { key: 'amber-teal', name: 'アンバー×ティール', accent: '#e0993f', border: '#2a3247' },
  { key: 'light', name: 'ライト', accent: '#3d6b96', border: '#e7e4df' },
  { key: '2ch-classic', name: '2chクラシック', accent: '#0000ff', border: '#545454' },
]

const DARK_SCHEMES = new Set<ColorScheme>(['indigo', 'amber-teal'])

const FONT_SIZES = [13, 14, 16, 18, 20]

function apply(s: DisplaySettings) {
  const root = document.documentElement
  root.setAttribute('data-scheme', s.scheme)
  root.classList.toggle('dark', DARK_SCHEMES.has(s.scheme))
  root.setAttribute('data-pattern', s.pattern)
  root.setAttribute('data-density', s.density)
  root.style.fontSize = `${FONT_SIZES[s.fontSize - 1]}px`
}

export type UpdateSetting = <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) => void

export function useDisplaySettings(store: LogStore | undefined): [DisplaySettings, UpdateSetting] {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)

  useEffect(() => {
    if (!store) return
    void store.getSettings().then((saved) => setSettings((s) => ({ ...s, ...(saved as Partial<DisplaySettings>) })))
  }, [store])

  useEffect(() => apply(settings), [settings])

  const update = useCallback<UpdateSetting>(
    (key, value) => {
      setSettings((s) => ({ ...s, [key]: value }))
      void store?.setSetting(key, value)
    },
    [store],
  )

  return [settings, update]
}
