// 設定画面。左に分類、右に中身。変更はその場で反映・保存する(「保存」ボタンはない)。

import { UPLOAD_HOSTS } from '../host/uploader'
import NgManager from './NgManager'
import CustomSchemeEditor from './mobile/CustomSchemeEditor'
import { isCustomDark, parseCustom } from '../ui/customScheme'
import { useRef, createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { normalizeForSearch } from '../utils/postBody'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { allConnectors, type AccountKind, type Board, type LoginResult, type SiteConfig } from '@bbs-browser/connectors'
import type { AccountRecord } from '@bbs-browser/logstore'
import { POST_STYLES,
  MOBILE_POST_STYLES,
  effectivePostStyle,
  FONT_PX_KEY,
  TAB_LABELS,
  baseFontPx,
  PICKABLE_SCHEMES,
  ACCENTS,
  effectiveScheme,
  DEFAULT_SETTINGS,
  isDarkScheme,
  pickScheme,
  FONT_FAMILIES,
  PANELS,
  LIST_TABS,
  type ListTabKey,
  type AppSettings,
  type UpdateSetting,
} from '../ui/settings'
import { loadSystemFonts, type SystemFont } from '../host/systemFonts'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isMobile } from '../utils/platform'
import { DragHandle, DragList, DragZones } from './DragSort'
import GestureRecorder, { gestureArrows } from './GestureRecorder'
import ActionSheet from './ActionSheet'
import { MOBILE_HEAD_BTN, MOBILE_HEAD_ICON } from './ActionBar'
import { ensureNotifyPermission } from '../utils/osNotify'
import FontSizeSlider from './FontSizeSlider'
import { ListEditor, SamplePosts, ThumbSample } from './SettingParts'
import { GESTURE_ACTIONS } from '../utils/gestures'
import { getVersion } from '@tauri-apps/api/app'
import type { ExternalConnectorInfo } from '../host/externalConnectors'
import { backgroundImageUrl, importBackgroundImage } from '../host/backgroundImage'
import BoardIcon from './BoardIcon'
import type { BoardMeta } from '../ui/settings'
import { importableSettings, mergeNgRules, ngFile, parseBackup, settingsFile } from '../utils/backup'
import { openJson, saveJson } from '../host/backup'
import { pickOpenPath } from '../host/dialog'
import { barActionsFor, orderBy, resolvePlacements, type BarArea, type Placement } from '../utils/toolbar'
import { DEFAULT_KEYMAP, FIXED_KEYS, KEY_ACTIONS, keyLabel, keyString, reservedKeyName, resolveKeymap, type KeyAction, type Keymap } from '../utils/keymap'

export interface SettingsProps {
  settings: AppSettings
  update: UpdateSetting
  favorites: Board[]
  sites: SiteConfig[]
  onAddFavoriteUrl: (url: string) => Promise<void>
  onRemoveFavorite: (url: string) => void
  onAddSite: (name: string, menuUrl: string) => Promise<void>
  onRemoveSite: (menuUrl: string) => void
  /** BBS メニューの板一覧。refresh なら取り直す(なければ保存してあるものを返す) */
  loadBoards: (site: SiteConfig, refresh: boolean) => Promise<Board[]>
  onToggleFavorite: (board: Board) => void
  /** 板一覧でダブルクリックした板を開く(設定は閉じる) */
  onOpenBoard: (board: Board) => void
  /** サイトのアカウント(保存してあるもの)と、ログインの状態 */
  accounts: AccountRecord[]
  loginStatus: Map<string, LoginResult>
  /** 保存してログインする */
  onLogin: (a: AccountRecord) => Promise<LoginResult>
  onDeleteAccount: (connectorId: string, accountId: string) => void
  /** DB 全体(ログ・設定・NG・履歴)を書き出す。保存先を選ばなかったら false */
  onBackupDb: () => Promise<boolean>
  /** 書き出しておいた DB に入れ替える(アプリを起動し直す) */
  onRestoreDb: () => Promise<boolean>
  /** 外付けのコネクタ(connectors/ のフォルダ)の一覧と、読み込みの結果 */
  externalConnectors: ExternalConnectorInfo[]
  /** 外付けのコネクタを読み込み直す(許可を変えたときは、変えたあとの許可を渡す) */
  onReloadConnectors: (approvals?: Record<string, { enabled: boolean; hosts: string[] }>) => Promise<void>
  /** connectors/ のフォルダをエクスプローラーで開く */
  onOpenConnectorsDir: () => void
  /** 古いログを今すぐ整理する(設定の日数で)。消したスレの数を返す */
  onPruneLogs: () => Promise<number>
  /** 最初に開く分類 */
  initialTab?: SettingsTab
  onClose: () => void
}

export type SettingsTab =
  | 'display'
  | 'threads'
  | 'posts'
  | 'write'
  | 'refresh'
  | 'keys'
  | 'toolbars'
  | 'ng'
  | 'boardlist'
  | 'boards'
  | 'connectors'
  | 'accounts'
  | 'backup'
  | 'about'
type Tab = SettingsTab

const TABS: { key: Tab; name: string; icon: string; advanced?: boolean; desktopOnly?: boolean }[] = [
  { key: 'display', name: '表示', icon: 'palette' },
  { key: 'threads', name: 'スレッド一覧', icon: 'view_list' },
  { key: 'posts', name: 'レス表示', icon: 'forum' },
  { key: 'write', name: '書き込み', icon: 'edit' },
  { key: 'refresh', name: '自動更新', icon: 'autorenew' },
  // スマホにはキーがないので、ここはジェスチャー(なぞる操作)の設定になる
  isMobile ? { key: 'keys', name: 'ジェスチャー', icon: 'swipe' } : { key: 'keys', name: 'キー操作', icon: 'keyboard', advanced: true },
  { key: 'toolbars', name: 'ボタンの配置', icon: 'toolbar', advanced: true },
  { key: 'ng', name: 'NG', icon: 'block' },
  { key: 'boardlist', name: '板一覧', icon: 'list_alt' },
  { key: 'boards', name: '板とサイト', icon: 'dns', advanced: true },
  { key: 'connectors', name: 'コネクタ', icon: 'extension', advanced: true, desktopOnly: true },
  { key: 'accounts', name: '掲示板ごとの設定', icon: 'tune' },
  { key: 'backup', name: 'バックアップ', icon: 'backup' },
  { key: 'about', name: 'このアプリについて', icon: 'info' },
]

/** スマホ: 設定の一覧のまとまり(上から)。分類の並びは TABS と別に、使う場面で分ける */
const MOBILE_GROUPS: { title: string; items: Tab[] }[] = [
  { title: '見た目', items: ['display', 'posts'] },
  { title: '読む', items: ['threads', 'refresh'] },
  { title: '書く', items: ['write', 'accounts'] },
  { title: '操作', items: ['keys', 'toolbars'] },
  { title: 'NG', items: ['ng'] },
  { title: '板とデータ', items: ['boardlist', 'boards', 'backup'] },
  { title: 'その他', items: ['about', 'connectors'] },
]
/** スマホ: 分類ごとの、何が設定できるかの一行 */
const TAB_DESC: Record<Tab, string> = {
  display: 'テーマ・文字サイズ',
  threads: '最初の並び順・タブ・ログの削除',
  posts: 'レスの見た目・本文・画像とサムネイル',
  write: '名前・続けて書き込まない間・画像のアップロード',
  refresh: '自動更新・通知・新着',
  keys: 'なぞる向きと操作・感度',
  toolbars: 'ヘッダー・フッター・︙ に置くボタン',
  ng: 'NG ワード・名前・ID・スレタイ・自動 NG',
  boardlist: 'お気に入り板・BBS メニュー',
  boards: '自分で足す掲示板とサイト',
  connectors: '外付けのコネクタ',
  accounts: '5ch のアカウント・板ごとの名前と名無しの扱い',
  backup: '設定の書き出し・まるごとバックアップ',
  about: '版',
}
/** スマホ: 分類のアイコンの色(一覧を見分けやすく) */
const TAB_COLORS: Record<Tab, string> = {
  display: '#8b5cf6',
  posts: '#6366f1',
  threads: '#0ea5e9',
  refresh: '#10b981',
  write: '#f59e0b',
  accounts: '#d97706',
  keys: '#ec4899',
  toolbars: '#f43f5e',
  ng: '#ef4444',
  boardlist: '#14b8a6',
  boards: '#0891b2',
  backup: '#64748b',
  about: '#6b7280',
  connectors: '#6b7280',
}

/** スマホ: 分類の中の項目が少なければ(3 つまで)、題の一覧を挟まず、中身をそのまま並べる(段を深くしすぎない) */
const FLAT_MAX = 3
function SectionAutoOpen(props: { seen: string[]; active: boolean; onFew: () => void }) {
  useEffect(() => {
    if (props.active && props.seen.length > 0 && props.seen.length <= FLAT_MAX) props.onFew()
  })
  return null
}

const INPUT =
  'bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted py-1.5 focus:ring-c-accent focus:border-c-accent'
const BTN =
  'px-3 py-1.5 text-sm rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover transition-colors disabled:opacity-50'
const ICON_BTN = 'p-1 text-c-text-muted hover:text-c-text-strong transition-colors rounded'

/** 高度な設定を見せるか(設定画面の左下のチェック) */
const AdvancedContext = createContext(false)

/**
 * スマホの設定(components/mobile/MobileSettings)の中に、この画面の部品(NG・板の一覧・バックアップなど)を埋め込むときの囲い。
 * 高度な設定も出し、Section はふつうに中身まで出す
 */
export function SettingsEmbed(props: { children: ReactNode }) {
  return <AdvancedContext.Provider value={true}>{props.children}</AdvancedContext.Provider>
}

/** 設定のまとまり。advanced なら、高度な設定を見せるときだけ出す */
/** 設定の検索の言葉(空なら探していない)。Section は、中の文字に言葉が入っていなければ隠れる */
const SearchContext = createContext('')

/**
 * スマホの設定の段(分類 → 項目 → 中身)。
 * index: 分類の画面。Section は題と説明だけの行になり、押すと中身の画面へ
 * detail: 項目の画面。title の Section だけが中身を出す
 * all: PC・検索の結果。Section はふつうに中身まで出す
 */
type SectionNav = { mode: 'all' } | { mode: 'index'; open: (title: string) => void; seen: string[] } | { mode: 'detail'; title: string }
const SectionNavContext = createContext<SectionNav>({ mode: 'all' })

function Section({
  title,
  children,
  note,
  advanced,
  desktopOnly,
}: {
  title: string
  children: ReactNode
  note?: string
  advanced?: boolean
  /** PC だけの設定(キー操作・サイドバー・マウスの操作・フォルダなど)。スマホでは出さない */
  desktopOnly?: boolean
}) {
  const showAdvanced = useContext(AdvancedContext)
  const query = useContext(SearchContext)
  const nav = useContext(SectionNavContext)
  const ref = useRef<HTMLElement>(null)
  // 検索中は、題・説明・中の文字(選べる項目の名前など)に言葉が入っている Section だけを出す
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const q = normalizeForSearch(query.trim())
    el.hidden = q !== '' && !normalizeForSearch(el.textContent ?? '').includes(q)
  })
  if (advanced && !showAdvanced) return null
  if (desktopOnly && isMobile) return null
  if (nav.mode === 'index') {
    // 分類の画面: 題と説明だけの行。押すと、この項目だけの画面へ
    nav.seen.push(title)
    return (
      <button type="button" onClick={() => nav.open(title)} className="settings-row w-full flex items-center gap-3 py-4 text-left active:bg-c-surface2">
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-bold text-c-text-strong">{title}</span>
          {note && <span className="block mt-1 text-[13px] leading-relaxed text-c-text-muted line-clamp-2">{note}</span>}
        </span>
        <span className="material-symbols-outlined text-xl text-c-text-muted">chevron_right</span>
      </button>
    )
  }
  if (nav.mode === 'detail') {
    if (nav.title !== title) return null
    // 項目の画面: 題は上の帯に出ているので、説明と中身だけを、ゆったり出す
    return (
      <section ref={ref}>
        {note && <p className="mb-4 text-[13px] leading-relaxed text-c-text-muted">{note}</p>}
        <div>{children}</div>
      </section>
    )
  }
  return (
    // スマホは、まとまりの間・題と中身の間をゆったり取る
    <section ref={ref} className={isMobile ? 'mb-10' : 'mb-8'}>
      <h3 className={`${isMobile ? 'text-base mb-1.5' : 'text-sm mb-1'} font-bold text-c-text-strong flex items-center gap-2`}>
        {title}
        {advanced && <span className="text-[10px] font-normal px-1.5 rounded border border-c-border text-c-text-muted">高度</span>}
      </h3>
      {note && <p className={`${isMobile ? 'text-[13px] leading-relaxed mb-3' : 'text-xs mb-2'} text-c-text-muted`}>{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

/** 見本のレス(表示・レス表示の分類の上)。検索の結果と、スマホの分類の画面(題の一覧)では出さない */
function StickySample({ settings }: { settings: AppSettings }) {
  const query = useContext(SearchContext)
  const nav = useContext(SectionNavContext)
  const [hidden, setHidden] = useState(sampleHidden)
  if (query.trim() !== '' || nav.mode === 'index') return null
  if (hidden)
    return (
      <button
        type="button"
        onClick={() => setHidden((sampleHidden = false))}
        className="mb-4 text-xs text-c-text-muted hover:text-c-accent underline"
      >
        見本のレスを出す
      </button>
    )
  return (
    // 入れ物の上の余白(PC は 20px・スマホは 24px)まで地で覆い、スクロールした設定が見本の上に透けないようにする
    <div className={`sticky z-10 -mx-1 px-1 pb-1 bg-c-surface ${isMobile ? '-top-6 -mt-6 pt-6' : '-top-5 -mt-5 pt-5'}`}>
      <SamplePosts settings={settings} compact title="見本(変えるとすぐ映ります)" onHide={() => setHidden((sampleHidden = true))} />
    </div>
  )
}
/** 見本を隠したか(設定画面を開き直しても覚えておく。アプリを起動し直したら出す) */
let sampleHidden = false

/** 横に並べる択一ボタン */
function Choice<T extends string | number>(props: {
  value: T
  options: { key: T; name: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {props.options.map((o) => {
        const active = o.key === props.value
        return (
          <button
            key={String(o.key)}
            type="button"
            onClick={() => props.onChange(o.key)}
            className={`px-3 py-1.5 text-sm border transition-colors rounded-[var(--chip-radius)] ${
              active
                ? 'border-c-accent text-c-accent bg-[var(--c-accent-wash)]'
                : 'border-c-border text-c-text-body hover:border-c-border-strong'
            }`}
          >
            {o.name}
          </button>
        )
      })}
    </div>
  )
}

/** スレ一覧のタブを選んで並べる。出すものを上に、出さないものを下に並べる */
export function ListTabsEditor(props: { value: ListTabKey[]; onChange: (v: ListTabKey[]) => void }) {
  const shown = props.value.filter((k) => LIST_TABS.some((t) => t.key === k))
  const rest = LIST_TABS.map((t) => t.key).filter((k) => !shown.includes(k))
  // スマホ: 出すタブは、右のつまみをつかんで上下に動かして並べる(上が左)。− で外し、下の + で足す
  if (isMobile) {
    const def = (k: ListTabKey) => LIST_TABS.find((t) => t.key === k)!
    return (
      <div className="flex flex-col gap-4">
        <DragList
          items={shown}
          onChange={props.onChange}
          render={(k, handle, dragging) => (
            <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border border-c-border ${dragging ? 'bg-c-surface2' : 'bg-c-surface'}`}>
              <button type="button" onClick={() => props.onChange(shown.filter((x) => x !== k))} className="text-c-heat-very-hot" title="外す">
                <span className="material-symbols-outlined fill text-xl">do_not_disturb_on</span>
              </button>
              <span className="material-symbols-outlined text-xl text-c-text-muted">{def(k).icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] text-c-text-strong">{def(k).name}</span>
                <span className="block text-xs text-c-text-muted">{def(k).note}</span>
              </span>
              <DragHandle handle={handle} />
            </div>
          )}
        />
        {rest.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-bold text-c-text-muted">出していないタブ</p>
            {rest.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => props.onChange([...shown, k])}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-dashed border-c-border text-left active:bg-c-surface2"
              >
                <span className="material-symbols-outlined fill text-xl text-c-accent">add_circle</span>
                <span className="material-symbols-outlined text-xl text-c-text-muted">{def(k).icon}</span>
                <span className="text-[15px] text-c-text-body">{def(k).name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }
  const move = (i: number, d: -1 | 1) => {
    const next = [...shown]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    props.onChange(next)
  }
  const row = (key: ListTabKey, on: boolean, i: number) => {
    const def = LIST_TABS.find((t) => t.key === key)!
    return (
      <div key={key} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-c-border ${on ? '' : 'opacity-60'}`}>
        <input
          type="checkbox"
          checked={on}
          className="accent-[var(--c-accent)]"
          onChange={() => props.onChange(on ? shown.filter((k) => k !== key) : [...shown, key])}
          aria-label={`${def.name}を出す`}
        />
        <span className="material-symbols-outlined text-base text-c-text-muted">{def.icon}</span>
        <span className="text-sm text-c-text-strong w-20">{def.name}</span>
        <span className="flex-1 min-w-0 text-xs text-c-text-muted truncate">{def.note}</span>
        {on && (
          <>
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="左へ" className="p-0.5 rounded hover:bg-c-surface2 disabled:opacity-30">
              <span className="material-symbols-outlined text-base leading-none">arrow_upward</span>
            </button>
            <button type="button" disabled={i === shown.length - 1} onClick={() => move(i, 1)} title="右へ" className="p-0.5 rounded hover:bg-c-surface2 disabled:opacity-30">
              <span className="material-symbols-outlined text-base leading-none">arrow_downward</span>
            </button>
          </>
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((k, i) => row(k, true, i))}
      {rest.map((k) => row(k, false, -1))}
    </div>
  )
}

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; note?: string }) {
  // スマホ: 説明を左、スイッチを右に。行の上下を広く取り、指で押しやすくする(行のどこを押しても切り替わる)
  if (isMobile)
    return (
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        onClick={() => props.onChange(!props.checked)}
        className="settings-row w-full flex items-center gap-4 py-3.5 text-left"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] leading-snug text-c-text-strong">{props.label}</span>
          {props.note && <span className="block mt-1 text-[13px] leading-relaxed text-c-text-muted">{props.note}</span>}
        </span>
        <span className={`relative w-12 h-7 rounded-full flex-shrink-0 transition-colors ${props.checked ? 'bg-c-accent' : 'bg-c-border-strong'}`}>
          <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${props.checked ? 'left-6' : 'left-1'}`} />
        </span>
      </button>
    )
  return (
    <label className="flex items-start gap-3 py-1.5 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        onClick={() => props.onChange(!props.checked)}
        className={`relative mt-0.5 w-11 h-6 rounded-full flex-shrink-0 transition-all shadow-inner ${props.checked ? 'bg-c-accent' : 'bg-c-border-strong'}`}
      >
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm ${props.checked ? 'right-1' : 'left-1'}`} />
      </button>
      <span>
        <span className="text-sm text-c-text-body">{props.label}</span>
        {props.note && <span className="block text-xs text-c-text-muted">{props.note}</span>}
      </span>
    </label>
  )
}

/** OS に入っているフォントから選ぶ。各行をそのフォント自体で描くので、見た目を比べられる */
function SystemFontPicker({ value, onPick }: { value: string; onPick: (family: string) => void }) {
  const [fonts, setFonts] = useState<SystemFont[]>()
  const [query, setQuery] = useState('')
  const [japaneseOnly, setJapaneseOnly] = useState(true)
  const [message, setMessage] = useState<string>()

  useEffect(() => {
    loadSystemFonts().then(setFonts, (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)))
  }, [])

  const q = query.trim().toLowerCase()
  const shown = (fonts ?? []).filter(
    (f) =>
      (!japaneseOnly || f.localName) &&
      (!q || f.family.toLowerCase().includes(q) || (f.localName ?? '').toLowerCase().includes(q)),
  )

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3 mb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="フォント名で絞り込む"
          className={`${INPUT} flex-1`}
        />
        <label className="flex items-center gap-1.5 text-sm text-c-text-body select-none whitespace-nowrap">
          <input type="checkbox" checked={japaneseOnly} onChange={(e) => setJapaneseOnly(e.target.checked)} className="rounded" />
          日本語フォントだけ
        </label>
      </div>
      {message && <p className="text-sm text-c-heat-very-hot mb-2">{message}</p>}
      <div className="max-h-64 overflow-y-auto custom-scrollbar border border-c-border rounded-[var(--card-radius)] divide-y divide-c-border">
        {!fonts && !message && <p className="px-3 py-2 text-sm text-c-text-muted">フォントを探しています...</p>}
        {shown.map((f) => {
          const active = f.family === value
          return (
            <button
              key={f.family}
              type="button"
              onClick={() => onPick(f.family)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-c-surface2 ${active ? 'bg-[var(--c-accent-wash)]' : ''}`}
            >
              <span className="flex-1 min-w-0 truncate text-base text-c-text-body" style={{ fontFamily: `'${f.family}'` }}>
                {f.localName ?? f.family} あア亜 Aa1
              </span>
              <span className="text-xs text-c-text-muted truncate max-w-[40%]">{f.family}</span>
              {active && <span className="material-symbols-outlined text-base text-c-accent">check</span>}
            </button>
          )
        })}
        {fonts && shown.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">見つかりません</p>}
      </div>
    </div>
  )
}

function DisplayTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  return (
    <>
      <StickySample settings={s} />
      <Section title="テーマ">
        <Toggle
          checked={s.followOsTheme}
          onChange={(v) => update('followOsTheme', v)}
          label="OS のダーク・ライトに合わせる"
          note="オンのときは、暗い配色と明るい配色を 1 つずつ選びます。Windows の設定を切り替えると、その場で切り替わります"
        />
        <Toggle
          checked={s.reduceMotion}
          onChange={(v) => update('reduceMotion', v)}
          label="動きを減らす"
          note="画面の移り方・新着の光り方・数字の繰り上がりを省きます。OS の「アニメーションを表示しない」がオンでも同じになります"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[...PICKABLE_SCHEMES, ...(parseCustom(s.customScheme) ? [{ key: 'custom' as const, name: '自分の配色', accent: parseCustom(s.customScheme)!.accent, border: 'var(--c-border)' }] : [])].map((c) => {
            const chosen = s.followOsTheme ? c.key === s.darkScheme || c.key === s.lightScheme : s.scheme === c.key
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => {
                  for (const [k, v] of Object.entries(pickScheme(s, c.key))) update(k as keyof AppSettings, v as never)
                }}
                className={`flex items-center gap-2.5 px-3 py-2 text-sm border rounded-[var(--card-radius)] transition-colors ${
                  chosen ? 'border-c-accent text-c-text-strong' : 'border-c-border text-c-text-body hover:border-c-border-strong'
                }`}
              >
                <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: c.accent, boxShadow: `inset 0 0 0 1px ${c.border}` }} />
                <span className="flex-1 text-left">{c.name}</span>
                {s.followOsTheme && (
                  <span className="text-[10px] text-c-text-muted">
                    {(c.key === 'custom' ? isCustomDark(parseCustom(s.customScheme)!) : isDarkScheme(c.key)) ? 'ダーク' : 'ライト'}
                    {chosen && 'で使う'}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </Section>
      <Section title="差し色">
        <p className="text-xs text-c-text-muted mb-2">ボタン・選んだ印・タブの下線などの色。どのテーマの上でも読める濃さにしてあります(スマホのアプリ・web と同じ 8 色)</p>
        <div className="flex flex-wrap gap-3">
          {[{ key: '', name: 'テーマの色', color: '' }, ...ACCENTS.map((a) => ({ key: a.key, name: a.name, color: isDarkScheme(effectiveScheme(s)) ? a.dark : a.light }))].map((a) => {
            const on = s.accent === a.key
            return (
              <button key={a.key || 'theme'} type="button" onClick={() => update('accent', a.key)} className="flex flex-col items-center gap-1 min-w-[3rem]">
                <span
                  data-scheme={a.key ? undefined : effectiveScheme(s)}
                  className="w-7 h-7 rounded-full"
                  style={{ background: a.color || 'var(--c-accent)', border: on ? '3px solid var(--c-text-strong)' : '1px solid var(--c-border)' }}
                />
                <span className={`text-xs ${on ? 'text-c-text-strong font-bold' : 'text-c-text-muted'}`}>{a.name}</span>
              </button>
            )
          })}
        </div>
      </Section>
      <Section advanced title="自分の配色" note="地・面・字・強調・未読・自分の 6 色を選んで、配色を作れます。見本とコントラストの判定を見ながら決められます(スマホのアプリと同じ JSON)">
        <CustomSchemeEditor settings={s} update={update} />
      </Section>
      <Section advanced desktopOnly title="フォント">
        <Choice
          value={s.fontFamily}
          options={[...FONT_FAMILIES, { key: 'custom' as const, name: s.customFont ? `OS のフォント(${s.customFont})` : 'OS のフォント' }]}
          onChange={(v) => update('fontFamily', v)}
        />
        {s.fontFamily === 'custom' && (
          <SystemFontPicker
            value={s.customFont}
            onPick={(family) => {
              update('customFont', family)
              update('fontFamily', 'custom')
            }}
          />
        )}
        <p className="mt-3 p-3 text-base text-c-text-body bg-c-surface2 rounded-[var(--card-radius)]">
          あのイーハトーヴォのすきとおった風、0123456789 ABCabc
        </p>
      </Section>
      <Section advanced desktopOnly title="背景画像" note="パネルの後ろに置きます。下の「パネルの不透明度」でパネルを透かすと見えます。選んだ画像はアプリのフォルダにコピーして使います">
        <div className="flex items-center gap-3">
          <div
            className="w-24 h-16 flex-shrink-0 rounded-[var(--card-radius)] border border-c-border bg-c-surface2 bg-cover bg-center"
            style={s.backgroundImage ? { backgroundImage: `url("${backgroundImageUrl(s.backgroundImage)}")` } : undefined}
          />
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <button
                type="button"
                className={BTN}
                onClick={async () => {
                  const file = await pickOpenPath('画像', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])
                  if (file) update('backgroundImage', await importBackgroundImage(file))
                }}
              >
                画像を選ぶ
              </button>
              {s.backgroundImage && (
                <button type="button" className="px-3 py-1.5 text-sm text-c-text-muted hover:text-c-text-strong" onClick={() => update('backgroundImage', '')}>
                  外す
                </button>
              )}
            </div>
            <label className="flex items-center gap-3 text-sm text-c-text-body">
              <span className="w-12 flex-shrink-0">濃さ</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(s.backgroundOpacity * 100)}
                onChange={(e) => update('backgroundOpacity', Number(e.target.value) / 100)}
                className="flex-1"
                disabled={!s.backgroundImage}
              />
              <span className="w-10 text-right tabular-nums text-c-text-muted">{Math.round(s.backgroundOpacity * 100)}%</span>
            </label>
          </div>
        </div>
      </Section>
      <Section
        desktopOnly
        title="画面の分け方"
        note="1 画面にすると、スレ一覧とスレ表示のどちらか一方を画面いっぱいに出します。スレを押すとスレ表示に、上の帯の左のボタンで一覧に戻ります"
      >
        <Choice
          value={s.paneMode}
          options={[
            { key: 'auto' as const, name: '自動(狭いときだけ 1 画面)' },
            { key: 'split' as const, name: '2 画面' },
            { key: 'single' as const, name: '1 画面' },
          ]}
          onChange={(v) => update('paneMode', v)}
        />
      </Section>
      <Section advanced desktopOnly title="サイドバー">
        <Toggle
          checked={s.showStripNames}
          onChange={(v) => update('showStripNames', v)}
          label="しまったサイドバーに板名を出す"
          note="お気に入り板のアイコンの下に、板名を小さく出します(別名があれば別名)"
        />
      </Section>
      <Section advanced desktopOnly title="パネルの不透明度" note="パネルの背景色だけを透かします(文字は透けません)。背景画像と組み合わせて使います">
        <div className="space-y-1.5">
          {PANELS.map((p) => {
            const v = s.panelAlpha[p.key] ?? 1
            return (
              <label key={p.key} className="flex items-center gap-3 text-sm text-c-text-body">
                <span className="w-56 flex-shrink-0 truncate">{p.name}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(v * 100)}
                  onChange={(e) => update('panelAlpha', { ...s.panelAlpha, [p.key]: Number(e.target.value) / 100 })}
                  className="flex-1"
                />
                <span className="w-10 text-right tabular-nums text-c-text-muted">{Math.round(v * 100)}%</span>
              </label>
            )
          })}
        </div>
        <button
          type="button"
          className="mt-2 text-xs text-c-text-muted hover:text-c-accent"
          onClick={() =>
            update('panelAlpha', { addressBar: 1, sidebar: 1, tabs: 1, threadList: 1, threadHeader: 1, threadView: 1, replyForm: 1 })
          }
        >
          すべて 100% に戻す
        </button>
      </Section>
      <Section title="文字サイズ">
        {/* 1px ずつ。スレ一覧・レスの本文・頭は、それぞれの ︙ の「文字の大きさ」でさらに変えられる */}
        <FontSizeSlider
          label="画面全体"
          value={baseFontPx(s)}
          base={baseFontPx(s)}
          preview={(px) => (document.documentElement.style.fontSize = `${px}px`)}
          onCommit={(px) => update(FONT_PX_KEY, px)}
        />
      </Section>
      {!isMobile && (
      <Section title="密度" note="高密度は余白を詰めた専ブラ風の表示です">
        <Choice
          value={s.density}
          options={[
            { key: 'list', name: '一覧表示' },
            { key: 'dense', name: '高密度' },
          ]}
          onChange={(v) => update('density', v)}
        />
      </Section>
      )}
      <Section title="スレ一覧の行の形">
        <Choice
          value={s.listShape}
          options={[
            { key: 'normal' as const, name: 'ふつう' },
            { key: 'compact' as const, name: 'コンパクト(スレタイ 1 行と数だけ)' },
          ]}
          onChange={(v) => update('listShape', v)}
        />
      </Section>
      <Section
        title="レスの見た目"
        note={`${POST_STYLES.find((p) => p.key === effectivePostStyle(s))?.note ?? ''}${isMobile ? '(スマホでは、Discord 風は一覧表示、ほかは高密度で出します)' : ''}`}
      >
        <Choice value={effectivePostStyle(s)} options={isMobile ? MOBILE_POST_STYLES : POST_STYLES} onChange={(v) => update('postStyle', v)} />
      </Section>
    </>
  )
}

function ThreadsTab({ settings: s, update, favorites }: Pick<SettingsProps, 'settings' | 'update' | 'favorites'>) {
  return (
    <>
      <Section advanced desktopOnly title="更新">
        <Toggle
          checked={s.pullToRefreshList}
          onChange={(v) => update('pullToRefreshList', v)}
          label="一番上でさらにホイールを上に回したら、スレ一覧を更新する"
          note="一番上に着いてから少し待って、さらに大きく回したときだけ更新します。一度更新したら 5 秒はしません。切っても、更新ボタンでは更新できます"
        />
      </Section>
      <Section
        title="キーワード"
        note="スレタイに含むスレを、スレ一覧の上にキーワードの帯をつけてまとめます。上に並んでいるキーワードほど先に出ます"
      >
        <ListEditor noun="キーワード" sortable items={s.keywords} onChange={(v) => update('keywords', v)} placeholder="例: 実況" />
      </Section>
      <Section title="スレ一覧の見せ方">
        <Toggle
          checked={s.threadAuthorIcon}
          onChange={(v) => update('threadAuthorIcon', v)}
          label="スレ一覧で、立てた人の ID を模様で出す"
          note="スレ一覧に立てた人の ID が付いてくる掲示板(エッジ)だけです。切っているときは、スレの右下に ID を小さく出します"
        />
      </Section>
      <Section title="最初の並び順" note="板を開いたときの並び順です。スレ一覧のタブでその場で変えられます">
        <Choice
          value={s.threadSort}
          options={[
            { key: 'subject', name: 'サーバーの順(更新順)' },
            { key: 'momentum', name: '勢い順' },
            { key: 'newest', name: '新しい順' },
            { key: 'count', name: 'レス数順' },
          ]}
          onChange={(v) => update('threadSort', v)}
        />
      </Section>
      <Section title="スレ一覧のタブ" note="スレ一覧の上に出すタブと、その並び(上が左)です。数字キーの 1・2・3… は左から順に当たります">
        <ListTabsEditor value={s.listTabs} onChange={(v) => update('listTabs', v)} />
        <p className="text-xs text-c-text-muted mt-3 mb-1.5">タブの見せ方</p>
        <Choice value={s.listTabLabel} options={TAB_LABELS} onChange={(v) => update('listTabLabel', v)} />
      </Section>
      <Section title="ログの削除">
        <Toggle
          checked={s.confirmDeleteLog}
          onChange={(v) => update('confirmDeleteLog', v)}
          label="Shift+Delete でログを消す前に確かめる"
          note="確かめる画面で「次回から表示しない」を選ぶとオフになります。ここで戻せます"
        />
      </Section>
      <Section advanced desktopOnly title="タブ" note="Ctrl+W で閉じる、Ctrl+Tab で切り替え。開いていたタブは次の起動で戻ります">
        <Toggle
          checked={s.tabsEnabled}
          onChange={(v) => update('tabsEnabled', v)}
          label="タブを使う"
          note="オフにすると、タブ列を出さず、スレを開くたびに今のスレを置き換えます(開いているスレ以外のタブは閉じます)"
        />
        <Toggle
          checked={s.openInNewTab}
          onChange={(v) => update('openInNewTab', v)}
          label="スレ一覧から開くときは新しいタブで開く"
          note="オフにすると、いま見ているタブを置き換えます"
        />
      </Section>
      <Section advanced title="起動時に開く板" note="前回開いていた板か、お気に入りの板から選べます">
        <select
          value={s.startupBoardUrl}
          onChange={(e) => update('startupBoardUrl', e.target.value)}
          className={`${INPUT} w-72`}
        >
          <option value="@last">前回開いていた板</option>
          <option value="">開かない</option>
          {favorites.map((b) => (
            <option key={b.url} value={b.url}>
              {b.name}
            </option>
          ))}
        </select>
      </Section>
    </>
  )
}

function PostsTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  return (
    <>
      <StickySample settings={s} />
      <Section title="スレを開いたときの位置">
        <Choice
          value={s.openPosition}
          options={[
            { key: 'unread', name: '最初の未読' },
            { key: 'top', name: '先頭' },
            { key: 'bottom', name: '末尾' },
          ]}
          onChange={(v) => update('openPosition', v)}
        />
      </Section>
      <Section desktopOnly title="アンカー(>>1)のポップアップ" note="レス番号と ID は押すと一覧が出ます">
        <Choice
          value={s.anchorPopup}
          options={[
            { key: 'click', name: '押したら出す' },
            { key: 'hover', name: 'マウスを乗せたら出す' },
          ]}
          onChange={(v) => update('anchorPopup', v)}
        />
      </Section>
      <Section title="名前と ID" note="名前の省き方は、板ごとにも変えられます(設定 → 掲示板ごとの設定)">
        <Toggle
          checked={s.omitNoname}
          onChange={(v) => update('omitNoname', v)}
          label="名無しの名前を省く"
          note="名前が板の既定の名前(「名無しさん」など)なら省きます。後ろのトリップなどは残します"
        />
        <Toggle
          checked={s.highlightOp}
          onChange={(v) => update('highlightOp', v)}
          label="スレ主を強調する"
          note=">>1 と同じ ID の書き込みに「主」の印を付けます(ID のない板では付きません)"
        />
        <Toggle
          checked={s.idShort}
          onChange={(v) => update('idShort', v)}
          label="ID を短く出す"
          note="先頭の 6 文字だけにして「ID:」も省きます(数えるのと色は ID 全体で)"
        />
        <Toggle
          checked={s.idColor}
          onChange={(v) => update('idColor', v)}
          label="ID ごとに色を付ける"
          note="2 回以上書いた ID を、ID ごとの色で。同じ人の書き込みを目で追えます"
        />
        <Toggle
          checked={s.idHeat}
          onChange={(v) => update('idHeat', v)}
          label="書き込みの多い ID を赤くする"
          note="同じ ID の書き込みが 3 つ以上で色を付け、多いほど赤くします"
        />
        <Toggle
          checked={s.showIdenticon}
          onChange={(v) => update('showIdenticon', v)}
          label="ID のアイコンを出す"
          note="ID から作る GitHub 風の模様を、レス番号の左に出します(同じ ID はいつも同じ模様)。右下の数字はその ID の書き込み数です"
        />
      </Section>
      <Section title="本文">
        <FontSizeSlider
          label="本文の行間"
          value={s.postLineHeight}
          base={1.625}
          min={1}
          max={2.4}
          step={0.05}
          format={(v) => `${v.toFixed(2)} 倍`}
          icons={['format_line_spacing', 'format_line_spacing']}
          preview={(v) => document.documentElement.style.setProperty('--post-line-height', String(v))}
          onCommit={(v) => update('postLineHeight', v)}
          resettable
        />
        <Toggle
          checked={s.collapseBlankLines}
          onChange={(v) => update('collapseBlankLines', v)}
          label="3 行以上続く空行を 1 行にまとめる"
        />
        <Toggle checked={s.trimTrailingBlank} onChange={(v) => update('trimTrailingBlank', v)} label="本文の最後の空行を消す" />
        <Toggle
          checked={s.aaAutoDetect}
          onChange={(v) => update('aaAutoDetect', v)}
          label="AA を自動で見分ける"
          note="空白が続く本文を AA 用のフォントで表示します。レスの ⋯ から個別に切り替えられます"
        />
        <Toggle
          checked={s.urlShorten}
          onChange={(v) => update('urlShorten', v)}
          label="URL を短く見せる"
          note="https:// を外し、長い URL は後ろを「…」で省きます。押すと元の URL を開きます"
        />
        <Toggle
          checked={s.imageUrlOmit}
          onChange={(v) => update('imageUrlOmit', v)}
          label="画像の URL を「画像」の札にする"
          note="画像はサムネイルで見えるので、長い URL を出しません。押すと画像を開きます"
        />
        <Toggle
          checked={s.imageUrlCollapse}
          onChange={(v) => update('imageUrlCollapse', v)}
          label="続いて並んだ画像の URL をまとめる"
          note="改行や空白だけをはさんで並んだ画像の URL を、「画像 ×3」のように 1 つにまとめます"
        />
        <Toggle
          checked={s.showLinkPreview}
          onChange={(v) => update('showLinkPreview', v)}
          label="リンクの埋め込みを出す"
          note="画像でも動画でもないリンクに、ページのタイトル・説明・画像のカードを出します(画面に見えたときにページを取りに行きます)"
        />
        <Toggle
          checked={s.openLinksInApp}
          onChange={(v) => update('openLinksInApp', v)}
          label="リンクをアプリの中で開く"
          note="掲示板でないリンクを、外のブラウザではなくアプリの中で開きます。ウェブページは題・本文・画像だけを抜き出して出し(読めないページは右上からブラウザで開けます)、画像・動画・YouTube はそのまま見られます"
        />
      </Section>
      <Section title="日時の出し方" note="レスの頭の日時です。元の形は、日時にマウスを乗せると出ます">
        <Choice
          value={s.dateStyle}
          options={[
            { key: 'md_w_hms' as const, name: '月日・曜日・時刻(11/02(月) 19:01:15)' },
            { key: 'md_hm' as const, name: '月日と時分(11/02 19:01)' },
            { key: 'full' as const, name: 'すべて(年・秒の下の桁まで)' },
          ]}
          onChange={(v) => update('dateStyle', v)}
        />
      </Section>
      <Section title="人気のレスの示し方" note="返信が 3 件からのレス。多いほど赤くします">
        <Choice
          value={s.heatStyle}
          options={[
            { key: 'left' as const, name: '左の帯' },
            { key: 'right' as const, name: '右の帯' },
            { key: 'text' as const, name: '本文の色' },
            { key: 'none' as const, name: '示さない' },
          ]}
          onChange={(v) => update('heatStyle', v)}
        />
      </Section>
      <Section title="画像とサムネイル">
        <Toggle
          checked={s.showThumbnails}
          onChange={(v) => update('showThumbnails', v)}
          label="画像のサムネイルを出す"
          note="本文中の画像 URL(jpg・png・gif・webp)を小さく表示します"
        />
        <p className="text-xs text-c-text-muted mt-3 mb-1.5">サムネイルを読みに行く</p>
        <Choice
          value={s.thumbLoad}
          options={[
            { key: 'always' as const, name: 'いつも' },
            { key: 'wifi' as const, name: 'Wi-Fi のときだけ' },
            { key: 'tap' as const, name: '押したら' },
          ]}
          onChange={(v) => update('thumbLoad', v)}
        />
        <p className="text-xs text-c-text-muted mt-1">
          読みに行かないときは、サムネイルの枠だけを出します。押すとそのサムネイルを読み、もう一度押すと大きく見られます
        </p>
        <div className="mt-4">
        <ThumbSample kind="post" />
        <FontSizeSlider
          label="スレ表示(本文の画像・動画・YouTube)"
          value={s.postThumbSize}
          base={80}
          unset={-1}
          min={48}
          max={240}
          step={4}
          icons={['photo_size_select_small', 'photo_size_select_large']}
          preview={(px) => document.documentElement.style.setProperty('--post-thumb-size', `${px}px`)}
          onCommit={(px) => update('postThumbSize', px)}
        />
        <div className="mt-3">
          <ThumbSample kind="list" />
        </div>
        <FontSizeSlider
          label="スレ一覧(ふたばのカタログの絵など)"
          value={s.listThumbScale}
          base={1}
          unset={-1}
          min={0.5}
          max={3}
          step={0.25}
          format={(v) => `${v.toFixed(2)} 倍`}
          icons={['photo_size_select_small', 'photo_size_select_large']}
          preview={(v) => document.documentElement.style.setProperty('--list-thumb-scale', String(v))}
          onCommit={(v) => update('listThumbScale', v)}
        />
        </div>
        <Toggle
          checked={s.blurGross}
          onChange={(v) => update('blurGross', v)}
          label="グロ注意の画像をぼかす"
          note="下の言葉を含む返信が付いたレス(画像を貼った本人がそう書いたレスも)の、サムネイルと画像一覧をぼかします。押せばいつもどおり開けます"
        />
        {s.blurGross && (
          <div className="pl-1 mt-1 mb-3">
            <p className="text-xs text-c-text-muted mb-1.5">目印の言葉</p>
            <ListEditor noun="目印の言葉" items={s.grossWords} onChange={(v) => update('grossWords', v)} placeholder="例: 閲覧注意" />
          </div>
        )}
      </Section>
      <Section title="スレ表示の画面">
        <Toggle
          checked={s.showMinimap}
          onChange={(v) => update('showMinimap', v)}
          label="ミニマップを出す"
          note="スレ表示の右端に、人気レス・自分のレス・画像の位置と、未読の始まりを示します"
        />
        {isMobile && (
          <Toggle
            checked={s.showRefreshFab}
            onChange={(v) => update('showRefreshFab', v)}
            label="書き込み欄の右に更新ボタンを出す"
            note="スレ表示のフッターの右端(送るボタンの右)に、更新ボタンを出します"
          />
        )}
        {isMobile && (
          <Toggle
            checked={s.hideBarsOnScroll}
            onChange={(v) => update('hideBarsOnScroll', v)}
            label="下へスクロールしたら、ヘッダーとフッターを隠す"
            note="切ると、スレ一覧・スレ表示のヘッダーとフッターをいつも出しておきます"
          />
        )}
      </Section>
      <Section title="絞り込みのタブの見せ方" note="スレ表示の上の、人気・画像・動画・リンク・すべて のタブです">
        <Choice value={s.filterTabLabel} options={TAB_LABELS} onChange={(v) => update('filterTabLabel', v)} />
      </Section>
      <Section advanced desktopOnly title="画像の保存先" note="画像ビューワーの保存ボタンで、ここへ保存します。空のときはダウンロードフォルダです">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={s.imageSaveDir}
            onChange={(e) => update('imageSaveDir', e.target.value)}
            placeholder="ダウンロードフォルダ"
            className={`${INPUT} flex-1`}
          />
          <button
            type="button"
            className={BTN}
            onClick={async () => {
              const dir = await openDialog({ directory: true, title: '画像の保存先を選ぶ' })
              if (typeof dir === 'string') update('imageSaveDir', dir)
            }}
          >
            フォルダを選ぶ
          </button>
          {s.imageSaveDir && (
            <button type="button" className={ICON_BTN} title="ダウンロードフォルダに戻す" onClick={() => update('imageSaveDir', '')}>
              <span className="material-symbols-outlined text-base">restart_alt</span>
            </button>
          )}
        </div>
      </Section>
    </>
  )
}

/** 操作バーに並べられるもの(定型文はこのほかに 1 つずつ) */
const TOOLBAR_ITEMS: { key: string; name: string; icon: string }[] = [
  { key: 'reply', name: '返信', icon: 'reply' },
  { key: 'copy', name: 'コピー', icon: 'content_copy' },
  { key: 'ng', name: 'NG に追加', icon: 'block' },
  { key: 'tree', name: 'アンカーツリー', icon: 'account_tree' },
]

/** userhash の入力欄。ふだんは伏せて、目のボタンで見られるようにする */
export function UserhashInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <input
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="登録しない(匿名で上げる)"
        autoComplete="off"
        spellCheck={false}
        className={`${INPUT} flex-1 font-mono`}
      />
      <button type="button" className={ICON_BTN} title={shown ? '伏せる' : '見る'} onClick={() => setShown((v) => !v)}>
        <span className="material-symbols-outlined text-base">{shown ? 'visibility_off' : 'visibility'}</span>
      </button>
    </div>
  )
}

function WriteTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  // 並べられるもの全部(いま並べているものを先に、並びのとおりに)
  const all = [
    ...TOOLBAR_ITEMS,
    ...s.quickPhrases.map((p) => ({ key: `phrase:${p}`, name: `定型文「${p}」`, icon: 'bolt' })),
  ]
  const shown = s.postToolbar.filter((k) => all.some((a) => a.key === k))
  const ordered = [...shown.map((k) => all.find((a) => a.key === k)!), ...all.filter((a) => !shown.includes(a.key))]
  const move = (key: string, d: number) => {
    const i = shown.indexOf(key)
    const j = i + d
    if (i < 0 || j < 0 || j >= shown.length) return
    const next = [...shown]
    ;[next[i], next[j]] = [next[j], next[i]]
    update('postToolbar', next)
  }
  return (
    <>
      <Section
        advanced title="続けて書き込まない"
        note="書き込んだあと、この秒数は書き込むボタンを押せなくし、残りを出します(連投で規制されないように)。どのスレでも同じです"
      >
        <Choice
          value={s.postCooldownSec}
          options={[0, 5, 10, 20, 30, 60].map((n) => ({ key: n, name: n === 0 ? 'あけない' : `${n} 秒` }))}
          onChange={(v) => update('postCooldownSec', v)}
        />
      </Section>
      <Section title="定型文" note="レスの操作バーや ⋯ から、そのレスへのアンカーを付けて、押すとすぐ書き込みます">
        <ListEditor
          noun="定型文"
          sortable
          items={s.quickPhrases}
          onChange={(v) => {
            update('quickPhrases', v)
            // 消した定型文は、操作バーからも外す
            update('postToolbar', s.postToolbar.filter((x) => !x.startsWith('phrase:') || v.includes(x.slice('phrase:'.length))))
          }}
          onRename={(from, to) => update('postToolbar', s.postToolbar.map((x) => (x === `phrase:${from}` ? `phrase:${to}` : x)))}
          placeholder="例: ワロタ"
        />
        <Toggle checked={s.phraseBar} onChange={(v) => update('phraseBar', v)} label="書いている間、定型文のバーを出す" note="本文の欄の上に並べ、押すとカーソルの所に入ります" />
      </Section>
      <Section advanced title="送るとき">
        <Toggle checked={s.sendDelay} onChange={(v) => update('sendDelay', v)} label="送る前に 3 秒待つ" note="その間は「取り消す」で止められます(誤爆を防ぐ)" />
      </Section>

      <Section advanced desktopOnly title="レスの操作バー" note="レスにマウスを乗せたとき右上に出すボタンです。チェックしたものを、上から順に左から並べます(⋯ はいつも一番右)">
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)]">
          {ordered.map((item) => {
            const on = shown.includes(item.key)
            return (
              <div key={item.key} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => update('postToolbar', e.target.checked ? [...shown, item.key] : shown.filter((k) => k !== item.key))}
                />
                <span className="material-symbols-outlined text-base text-c-text-muted">{item.icon}</span>
                <span className={`flex-1 ${on ? 'text-c-text-body' : 'text-c-text-muted'}`}>{item.name}</span>
                {on && (
                  <>
                    <button type="button" className={ICON_BTN} title="左へ" onClick={() => move(item.key, -1)}>
                      <span className="material-symbols-outlined text-base">arrow_upward</span>
                    </button>
                    <button type="button" className={ICON_BTN} title="右へ" onClick={() => move(item.key, 1)}>
                      <span className="material-symbols-outlined text-base">arrow_downward</span>
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </Section>
      <Section
        advanced title="画像のアップロード"
        note="書き込み欄のボタン・貼り付け・ドラッグで画像や動画を置き場に上げ、本文に URL を入れます。上げた画像は誰でも見られます"
      >
        <Toggle checked={s.uploaderEnabled} onChange={(v) => update('uploaderEnabled', v)} label="画像のアップロードを使う" />
        <div className="mt-3">
          <p className="text-sm text-c-text-body mb-1.5">上げ先</p>
          <Choice value={s.uploadHost} options={UPLOAD_HOSTS} onChange={(v) => update('uploadHost', v)} />
          <p className="text-[10px] text-c-text-muted mt-1">
            自動では、受け付けていない置き場を飛ばして次の置き場に上げます(どこに上げたかは書き込み欄に出ます)。uguu.se は 3 時間で消えるので、最後に使います
          </p>
        </div>
        {(s.uploadHost === 'auto' || s.uploadHost === 'imgur') && (
          <div className="mt-3">
            <p className="text-sm text-c-text-body mb-1.5">imgur の Client-ID</p>
            <input
              type="text"
              value={s.imgurClientId}
              onChange={(e) => update('imgurClientId', e.target.value.trim())}
              placeholder="api.imgur.com で登録した Client-ID"
              spellCheck={false}
              className={`${INPUT} w-full font-mono`}
            />
            <p className="text-[10px] text-c-text-muted mt-1 leading-relaxed">
              <button type="button" className="text-c-link hover:underline" onClick={() => void openUrl('https://api.imgur.com/oauth2/addclient')}>
                imgur でアプリを登録し
              </button>
              (Authorization type は「Anonymous usage without user authorization」)、表示された Client-ID を入れます。空なら imgur は使いません
            </p>
          </div>
        )}
        <Toggle
          checked={s.uploadStripMetadata}
          onChange={(v) => update('uploadStripMetadata', v)}
          label="上げる前に、画像の位置情報など(EXIF)を消す"
          note="JPEG・PNG・WebP は描き直して取り除きます。GIF と動画は描き直すとアニメが崩れるので、そのまま上げます"
        />
        <div className="mt-3">
          <p className="text-sm text-c-text-body mb-1.5">大きい画像を縮小してから上げる(長い辺)</p>
          <Choice
            value={s.uploadMaxDimension}
            options={[0, 1280, 1920, 2560, 4096].map((n) => ({ key: n, name: n === 0 ? '縮小しない' : `${n}px まで` }))}
            onChange={(v) => update('uploadMaxDimension', v)}
          />
          <p className="text-[10px] text-c-text-muted mt-1">
            アップローダーの負担を減らすため、ほどほどの大きさにしてから上げます(JPEG・PNG・WebP)。まとめて貼られても 1 枚ずつ、一度に 10 枚まで上げます
          </p>
        </div>
        <div className="mt-3">
          <p className="text-sm text-c-text-body mb-1.5">catbox のアカウント(userhash)</p>
          <UserhashInput value={s.catboxUserhash} onChange={(v) => update('catboxUserhash', v)} />
          <p className="text-[10px] text-c-text-muted mt-1 leading-relaxed">
            <button type="button" className="text-c-link hover:underline" onClick={() => void openUrl('https://catbox.moe/user/register.php')}>
              catbox.moe でアカウントを作り
            </button>
            、
            <button type="button" className="text-c-link hover:underline" onClick={() => void openUrl('https://catbox.moe/user/login.php')}>
              ログイン
            </button>
            したあとのアカウントの画面にある userhash を貼ってください。登録すると、そのアカウントで上げ、アップロード履歴から catbox
            上のファイルも消せるようになります(消せるのは登録してから上げたものだけ)。userhash はこのパソコンの中に保存し、catbox に送るときだけ使います
          </p>
        </div>
        <div className="mt-3 p-3 text-xs leading-relaxed text-c-text-body bg-c-surface2 rounded-[var(--card-radius)]">
          <p className="font-bold text-c-text-strong mb-1">使う前に</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>上げたファイルは誰でも見られます。匿名で上げたものはあとから消せません(2 年間アクセスがなければ消えます)</li>
            <li>catbox は EXIF を残したまま公開します。スマホの写真は撮った場所が分かることがあります(上の設定で消せます)</li>
            <li>児童ポルノ・マルウェア・アニメやドラマの丸ごとの配信・ひどいグロなどは禁止です。責任は上げた人にあります</li>
            <li>このアプリから上げられるのは 50MB まで(GIF は 20MB)。利用規約: catbox.moe/legal.php</li>
          </ul>
        </div>
      </Section>
    </>
  )
}

function RefreshTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  return (
    <>
      <Section title="開いているスレの自動更新" note="実況板など、流れの速いスレ向けです。差分だけを取りに行きます">
        <Choice
          value={s.autoRefreshSec}
          options={[0, 5, 10, 20, 30, 60].map((n) => ({ key: n, name: n === 0 ? 'しない' : `${n} 秒` }))}
          onChange={(v) => update('autoRefreshSec', v)}
        />
      </Section>
      <Section
        advanced title="お気に入りのスレの新着"
        note="お気に入りのスレがある板のスレ一覧だけを取りに行き、新着の数を確かめます(本文は取りません)。本文はお気に入りのスレの一覧で更新したときに取ります"
      >
        <Choice
          value={s.favCheckMin}
          options={[0, 3, 5, 10, 30].map((n) => ({ key: n, name: n === 0 ? 'しない' : `${n} 分ごと` }))}
          onChange={(v) => update('favCheckMin', v)}
        />
      </Section>
      <Section title="通知">
        {isMobile && (
          <Toggle
            checked={s.osNotify}
            onChange={(v) => {
              update('osNotify', v)
              // オンにしたら、Android に通知の許可を求める(断られたら、Android の設定から許可してもらう)
              if (v) void ensureNotifyPermission().then((ok) => !ok && alert('通知が許可されていません。Android の設定 → アプリ → bbs-browser → 通知 から許可してください'))
            }}
            label="スマホの通知の欄にも出す"
            note="アプリを裏に回しているときは、下の知らせを Android の通知でも出します。アプリを完全に閉じている間は、新着を確かめられないので知らせません"
          />
        )}
        <Toggle
          checked={s.notifyFavThreads}
          onChange={(v) => update('notifyFavThreads', v)}
          label="お気に入りのスレに新着があったら知らせる"
          note="上の間隔で新着の数を確かめたときに、増えていたら右下に出します"
        />
        <div className="mt-3">
          <p className="text-sm text-c-text-body mb-1.5">キーワードに合うスレが立ったら知らせる</p>
          <p className="text-xs text-c-text-muted mb-2">
            お気に入り板のスレ一覧をこの間隔で見に行き、スレッド一覧のキーワード(設定 → スレッド一覧)を含むスレが新しく立っていたら知らせます
          </p>
          <Choice
            value={s.keywordWatchMin}
            options={[0, 5, 10, 30, 60].map((n) => ({ key: n, name: n === 0 ? '知らせない' : `${n} 分ごと` }))}
            onChange={(v) => update('keywordWatchMin', v)}
          />
        </div>
      </Section>
      <Section title="新着">
        <Toggle
          checked={s.autoScrollOnNew}
          onChange={(v) => update('autoScrollOnNew', v)}
          label="いちばん下を見ているときは、新着まで自動でスクロールする"
        />
        {s.autoScrollOnNew && <Toggle
          checked={s.followToEnd}
          onChange={(v) => update('followToEnd', v)}
          label="新着が多くても、いちばん下まで送る"
          note="オフなら新着の頭(最初の新しいレス)まで、オンなら一番下まで送ります。実況のように速いスレで、いつも最新を見ていたいとき向け"
        />}
        <Toggle
          checked={s.notifyReplies}
          onChange={(v) => update('notifyReplies', v)}
          label="自分宛てのレスが届いたら通知する"
          note="画面の右下に出します。押すとそのレスへ飛びます。自動更新は開いているタブだけなので、裏のタブは更新したときに知らせます"
        />
      </Section>
    </>
  )
}

/**
 * キー操作の割り当て。操作ごとにキーを並べ、× で外し、「+」を押してから押したキーを足す。
 * 同じキーをほかの操作に使っていたら、そちらから外して付け替える
 */
/** スワイプの向き(スマホ)。左の端から右へなぞると、いつもサイドバーの引き出しが開く */
const GESTURES: { seq: string; name: string }[] = [
  { seq: 'right', name: '→' },
  { seq: 'left', name: '←' },
  { seq: 'right,up', name: '→ ↑' },
  { seq: 'right,down', name: '→ ↓' },
  { seq: 'left,up', name: '← ↑' },
  { seq: 'left,down', name: '← ↓' },
]

/** スマホ: 画面ごとに、スワイプに割り当てる操作と、感度 */
export function GestureSettings({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  /** なぞり方を覚えさせている操作(と画面) */
  const [recording, setRecording] = useState<{ screen: 'list' | 'thread'; action: string }>()
  /** 足す操作を選んでいる画面 */
  const [picking, setPicking] = useState<'list' | 'thread'>()
  const nameOf = (action: string) => GESTURE_ACTIONS.find((a) => a.key === action)?.name.replace(/\(.*\)$/, '') ?? action
  const setMap = (key: 'list' | 'thread', map: Record<string, string>) => update('swipeGestures', { ...s.swipeGestures, [key]: map })
  // スマホ: 操作ごとに、割り当てたなぞり方を並べる。＋ を押して、枠の中で実際になぞって覚えさせる
  const screenMobile = (key: 'list' | 'thread', title: string) => {
    const map = s.swipeGestures[key]
    const assigned = [...new Set(Object.values(map).filter(Boolean))]
    return (
      <Section title={title} note="操作の行の ＋ を押して、実際になぞった形を割り当てます。左の端から右へなぞると、いつもメニュー(引き出し)が開きます">
        <div className="flex flex-col">
          {assigned.map((action) => (
            <div key={action} className="settings-row flex items-center gap-3 py-3">
              <span className="flex-1 min-w-0 text-[15px] text-c-text-strong">{nameOf(action)}</span>
              {Object.entries(map)
                .filter(([, a]) => a === action)
                .map(([seq]) => (
                  <button
                    key={seq}
                    type="button"
                    onClick={() => setMap(key, Object.fromEntries(Object.entries(map).filter(([k]) => k !== seq)))}
                    className="flex items-center gap-0.5 pl-2 pr-1 py-1 rounded-lg bg-c-surface2 border border-c-border text-base text-c-text-strong"
                    title="このなぞり方を外す"
                  >
                    {gestureArrows(seq)}
                    <span className="material-symbols-outlined text-base text-c-text-muted">close</span>
                  </button>
                ))}
              <button type="button" onClick={() => setRecording({ screen: key, action })} className="p-1.5 text-c-accent" title="なぞり方を足す">
                <span className="material-symbols-outlined text-2xl">add_circle</span>
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setPicking(key)} className="mt-3 flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-c-border text-[15px] text-c-accent">
            <span className="material-symbols-outlined text-xl">add</span>
            操作を足す
          </button>
        </div>
      </Section>
    )
  }
  if (isMobile)
    return (
      <>
        {screenMobile('list', 'スレ一覧のジェスチャー')}
        {screenMobile('thread', 'スレ表示のジェスチャー')}
        <Section title="ジェスチャーの感度">
          <Choice
            value={s.gestureSensitivity}
            options={[
              { key: 1, name: '鈍い' },
              { key: 2, name: 'やや鈍い' },
              { key: 3, name: '標準' },
              { key: 4, name: 'やや敏感' },
              { key: 5, name: '敏感' },
            ]}
            onChange={(v) => update('gestureSensitivity', v)}
          />
        </Section>
        {picking && (
          <ActionSheet
            title="どの操作に割り当てますか"
            onClose={() => setPicking(undefined)}
            items={GESTURE_ACTIONS.filter((a) => !Object.values(s.swipeGestures[picking]).includes(a.key)).map((a) => ({
              label: nameOf(a.key),
              icon: 'swipe',
              onClick: () => setRecording({ screen: picking, action: a.key }),
            }))}
          />
        )}
        {recording && (
          <GestureRecorder
            action={nameOf(recording.action)}
            usedBy={(seq) => {
              const a = s.swipeGestures[recording.screen][seq]
              return a && a !== recording.action ? nameOf(a) : undefined
            }}
            onClose={() => setRecording(undefined)}
            onDone={(seq) => {
              setMap(recording.screen, { ...s.swipeGestures[recording.screen], [seq]: recording.action })
              setRecording(undefined)
            }}
          />
        )}
      </>
    )
  const screen = (key: 'list' | 'thread', title: string) => (
    <Section title={title} note="画面をなぞる向きに、操作を割り当てます。左の端から右へなぞると、いつもメニュー(引き出し)が開きます">
      <div className="flex flex-col gap-2">
        {GESTURES.map((g) => (
          <label key={g.seq} className="flex items-center gap-3 text-sm">
            <span className="w-16 font-mono text-c-text-strong">{g.name}</span>
            <select
              value={s.swipeGestures[key][g.seq] ?? ''}
              onChange={(e) => update('swipeGestures', { ...s.swipeGestures, [key]: { ...s.swipeGestures[key], [g.seq]: e.target.value } })}
              className={`${INPUT} flex-1 min-w-0`}
            >
              <option value="">なし</option>
              {GESTURE_ACTIONS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </Section>
  )
  return (
    <>
      {screen('list', 'スワイプ:スレ一覧(スマホ)')}
      {screen('thread', 'スワイプ:スレ表示(スマホ)')}
      <Section title="スワイプの感度">
        <Choice
          value={s.gestureSensitivity}
          options={[
            { key: 1, name: '鈍い' },
            { key: 2, name: 'やや鈍い' },
            { key: 3, name: '標準' },
            { key: 4, name: 'やや敏感' },
            { key: 5, name: '敏感' },
          ]}
          onChange={(v) => update('gestureSensitivity', v)}
        />
      </Section>
    </>
  )
}

/**
 * キー操作の割り当て(管理画面)。操作の名前・キーで探す、変えたもの・キーのないものだけを出す、押したキーから操作を探す。
 * 同じキーをほかの操作に使っていたら、そちらから外して付け替える(すぐ「元に戻す」で戻せる)。
 * 決め打ちのキー(Esc・Ctrl+W など)には割り当てない
 */
function KeysTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  const keymap = resolveKeymap(s.keymap)
  /** キーを待っている操作('find' は押したキーから操作を探す) */
  const [waiting, setWaiting] = useState<KeyAction | 'find'>()
  /** 直前の変更の知らせと、その前の割り当て(元に戻す用) */
  const [notice, setNotice] = useState<{ text: string; before?: Partial<Keymap> }>()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'changed' | 'empty'>('all')
  const [found, setFound] = useState<string>()

  const save = (next: Keymap) => {
    // 既定と同じものは保存しない(あとで既定が変わったときに追いつけるように)
    const changed: Partial<Keymap> = {}
    for (const { key } of KEY_ACTIONS) if (next[key].join('\n') !== DEFAULT_KEYMAP[key].join('\n')) changed[key] = next[key]
    update('keymap', changed)
  }
  const isChanged = (a: KeyAction) => keymap[a].join('\n') !== DEFAULT_KEYMAP[a].join('\n')

  useEffect(() => {
    if (!waiting) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setWaiting(undefined)
      const k = keyString(e)
      if (!k) return
      if (waiting === 'find') {
        setFound(k)
        setQuery('')
        setFilter('all')
        setWaiting(undefined)
        return
      }
      const reserved = reservedKeyName(k)
      if (reserved) {
        setNotice({ text: `${keyLabel(k)} は「${reserved}」に決まっているので、割り当てられません` })
        setWaiting(undefined)
        return
      }
      const next = { ...keymap }
      const from = KEY_ACTIONS.filter(({ key }) => key !== waiting && next[key].includes(k))
      for (const { key } of KEY_ACTIONS) next[key] = next[key].filter((x) => x !== k)
      next[waiting] = [...next[waiting].filter((x) => x !== k), k]
      setNotice({
        text:
          from.length > 0
            ? `${keyLabel(k)} は「${from.map((a) => a.name).join('」「')}」から外して、「${KEY_ACTIONS.find((a) => a.key === waiting)!.name}」に付け替えました`
            : `${keyLabel(k)} を「${KEY_ACTIONS.find((a) => a.key === waiting)!.name}」に割り当てました`,
        before: s.keymap,
      })
      save(next)
      setWaiting(undefined)
    }
    // 開いているスレのキー操作より先に受け取る
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [waiting, keymap])

  const q = normalizeForSearch(query.trim())
  const rows = KEY_ACTIONS.filter(
    (a) =>
      (filter === 'all' || (filter === 'changed' ? isChanged(a.key) : keymap[a.key].length === 0)) &&
      (!found || keymap[a.key].includes(found)) &&
      (!q || normalizeForSearch(a.name).includes(q) || keymap[a.key].some((k) => normalizeForSearch(keyLabel(k)).includes(q))),
  )
  const changedCount = KEY_ACTIONS.filter((a) => isChanged(a.key)).length

  if (isMobile) return <GestureSettings settings={s} update={update} />
  return (
    <>
      <Section
        title="キーの割り当て"
        note="キーを受け取っている方(2 画面なら上に線が出ている方。既定では Ctrl+E で入れ替え)で効きます。入力欄の中では Ctrl 付きのキーだけ効きます。「+」を押してから、割り当てたいキーを押してください(Esc でやめる)"
      >
        {notice && (
          <p className="mb-3 px-3 py-2 text-xs rounded-lg border border-c-border bg-c-surface2 text-c-text-body flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-c-accent">swap_horiz</span>
            <span className="flex-1">{notice.text}</span>
            {notice.before !== undefined && (
              <button
                type="button"
                className="px-2 py-0.5 rounded border border-c-border hover:border-c-accent hover:text-c-accent"
                onClick={() => {
                  update('keymap', notice.before!)
                  setNotice(undefined)
                }}
              >
                元に戻す
              </button>
            )}
            <button type="button" onClick={() => setNotice(undefined)} className="p-0.5 rounded-full hover:bg-c-surface3" title="閉じる">
              <span className="material-symbols-outlined text-sm leading-none">close</span>
            </button>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setFound(undefined)
            }}
            placeholder="操作の名前・キーで探す"
            className={`${INPUT} flex-1 min-w-48`}
          />
          <button
            type="button"
            onClick={() => setWaiting(waiting === 'find' ? undefined : 'find')}
            className={`px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border ${waiting === 'find' ? 'border-c-accent text-c-accent animate-pulse' : 'border-c-border text-c-text-body hover:border-c-border-strong'}`}
          >
            {waiting === 'find' ? 'キーを押してください' : '押したキーで探す'}
          </button>
          <Choice
            value={filter}
            options={[
              { key: 'all' as const, name: `すべて(${KEY_ACTIONS.length})` },
              { key: 'changed' as const, name: `変えたもの(${changedCount})` },
              { key: 'empty' as const, name: 'キーのないもの' },
            ]}
            onChange={(v) => setFilter(v)}
          />
        </div>
        {found && (
          <p className="mb-2 text-xs text-c-text-body flex items-center gap-2">
            {keyLabel(found)} の割り当て: {rows.length > 0 ? rows.map((a) => `「${a.name}」`).join('') : reservedKeyName(found) ? `決まっているキー(${reservedKeyName(found)})` : 'なし'}
            <button type="button" className="text-c-text-muted hover:text-c-accent underline" onClick={() => setFound(undefined)}>
              解除
            </button>
          </p>
        )}
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)]">
          {(['view', 'app'] as const).map((where) => {
            const list = rows.filter((a) => a.where === where)
            if (list.length === 0) return null
            return (
              <div key={where}>
                <p className="px-3 py-1.5 text-[11px] font-bold text-c-text-muted bg-c-surface2">
                  {where === 'view' ? 'スレ表示・スレ一覧(キーを受け取っている方)' : 'アプリ全体(どちらを触っていても)'}
                </p>
                {list.map(({ key, name }) => (
                  <div key={key} className="flex items-center gap-3 px-3 py-2 border-t border-c-border">
                    <span className="w-64 flex-shrink-0 text-sm text-c-text-body">
                      {name}
                      {isChanged(key) && <span className="ml-1.5 text-[10px] px-1 rounded border border-c-accent text-c-accent">変更</span>}
                    </span>
                    <div className="flex-1 flex flex-wrap items-center gap-1.5">
                      {keymap[key].map((k) => (
                        <span key={k} className="inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 text-xs font-mono rounded border border-c-border bg-c-surface2 text-c-text-strong">
                          {keyLabel(k)}
                          <button
                            type="button"
                            className={ICON_BTN}
                            title="外す"
                            onClick={() => {
                              setNotice({ text: `${keyLabel(k)} を「${name}」から外しました`, before: s.keymap })
                              save({ ...keymap, [key]: keymap[key].filter((x) => x !== k) })
                            }}
                          >
                            <span className="material-symbols-outlined text-sm leading-none">close</span>
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() => setWaiting(waiting === key ? undefined : key)}
                        className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                          waiting === key ? 'border-c-accent text-c-accent animate-pulse' : 'border-dashed border-c-border text-c-text-muted hover:text-c-text-strong'
                        }`}
                      >
                        {waiting === key ? 'キーを押してください' : '+'}
                      </button>
                    </div>
                    {isChanged(key) && (
                      <button
                        type="button"
                        className={ICON_BTN}
                        title={`既定(${DEFAULT_KEYMAP[key].map(keyLabel).join('・') || 'なし'})に戻す`}
                        onClick={() => {
                          setNotice({ text: `「${name}」を既定に戻しました`, before: s.keymap })
                          save({ ...keymap, [key]: DEFAULT_KEYMAP[key] })
                        }}
                      >
                        <span className="material-symbols-outlined text-base">restart_alt</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
          {rows.length === 0 && <p className="px-3 py-3 text-sm text-c-text-muted">見つかりません</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            setNotice({ text: 'すべて既定に戻しました', before: s.keymap })
            update('keymap', {})
          }}
          className="mt-3 text-xs text-c-text-muted hover:text-c-accent underline"
        >
          すべて既定に戻す
        </button>
      </Section>
      <Section title="決まっているキー" note="ここは変えられません(? キーの一覧にも出ます)">
        <ul className="text-sm text-c-text-body space-y-1">
          {FIXED_KEYS.map((f) => (
            <li key={f.keys}>
              <span className="font-mono text-xs">{f.keys}</span> … {f.name}
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}

/** アカウント 1 つぶんの欄(メールアドレス・パスワード・自動ログイン・ログイン) */
function AccountForm(props: {
  connectorId: string
  kind: AccountKind
  saved?: AccountRecord
  status?: LoginResult
  onLogin: (a: AccountRecord) => Promise<LoginResult>
  onDelete: () => void
}) {
  const [user, setUser] = useState(props.saved?.user ?? '')
  const [password, setPassword] = useState(props.saved?.password ?? '')
  const [autoLogin, setAutoLogin] = useState(props.saved?.autoLogin ?? true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LoginResult | undefined>(props.status)
  const ready = user.trim() !== '' && password !== '' && !busy

  return (
    <div className="p-4 border border-c-border rounded-[var(--card-radius)] space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-c-text-strong">{props.kind.name}</span>
        <span className="text-xs text-c-text-muted">{props.kind.site}</span>
        {result && (
          <span className={`ml-auto text-xs ${result.ok ? 'text-c-accent' : 'text-c-heat-very-hot'}`}>
            <span className="material-symbols-outlined text-sm align-[-3px] mr-0.5">{result.ok ? 'check_circle' : 'error'}</span>
            {result.message}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          type="email"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="メールアドレス"
          autoComplete="off"
          className={`${INPUT} flex-1 min-w-[200px]`}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード"
          autoComplete="off"
          className={`${INPUT} flex-1 min-w-[160px]`}
        />
      </div>
      <Toggle checked={autoLogin} onChange={setAutoLogin} label="起動したときに自動でログインする" />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={BTN}
          disabled={!ready}
          onClick={async () => {
            setBusy(true)
            try {
              setResult(await props.onLogin({ connectorId: props.connectorId, accountId: props.kind.id, user: user.trim(), password, autoLogin }))
            } catch (e) {
              setResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'ログイン中…' : '保存してログイン'}
        </button>
        {props.saved && (
          <button
            type="button"
            onClick={() => {
              props.onDelete()
              setUser('')
              setPassword('')
              setResult(undefined)
            }}
            className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border border-c-border text-c-text-body hover:border-c-border-strong"
          >
            保存したものを消す
          </button>
        )}
        {props.kind.registerUrl && (
          <button type="button" onClick={() => void openUrl(props.kind.registerUrl!)} className="ml-auto text-xs text-c-text-muted hover:text-c-accent underline">
            登録・確認のページを開く
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * 掲示板ごとの設定。全体の設定(ほかの分類)の上に、掲示板(サービス)ごと・板ごとに上書きするもの。
 * - 掲示板ごと: アカウント(5ch の BE など。コネクタが申告したものだけ)
 * - 板ごと: 別名・名前欄とメール欄の既定値・名無しの扱い
 */
export function AccountsTab(
  props: Pick<SettingsProps, 'accounts' | 'loginStatus' | 'onLogin' | 'onDeleteAccount' | 'favorites' | 'settings' | 'update'>,
) {
  const key = (connectorId: string, accountId: string) => `${connectorId}:${accountId}`
  const services = allConnectors().filter((c) => (c.accounts ?? []).length > 0)
  const [editing, setEditing] = useState<string>()
  const [query, setQuery] = useState('')
  const [addUrl, setAddUrl] = useState('')
  /** URL で足した板(設定を入れるまでは保存しないので、ここで覚えておく) */
  const [added, setAdded] = useState<string[]>([])
  const meta = props.settings.boardMeta
  const setMeta = (url: string, m: BoardMeta) => {
    const next = { ...meta }
    // 全部空になったら消す
    if (Object.values(m).some((v) => v !== undefined)) next[url] = m
    else delete next[url]
    props.update('boardMeta', next)
  }
  // 板の一覧: お気に入りの板と、設定のある板(お気に入りでない板は名前が分からないので URL で出す)
  const boards: Board[] = [
    ...props.favorites,
    ...[...new Set([...Object.keys(meta), ...added])]
      .filter((u) => !props.favorites.some((b) => b.url === u))
      .map((u): Board => ({ connectorId: '', url: u, name: u.replace(/^https?:\/\//, '').replace(/\/$/, '') })),
  ]
  const q = normalizeForSearch(query.trim())
  const shown = q ? boards.filter((b) => normalizeForSearch(`${meta[b.url]?.alias ?? ''} ${b.name} ${b.url}`).includes(q)) : boards
  const summary = (m: BoardMeta | undefined) =>
    [
      m?.alias && `別名「${m.alias}」`,
      m?.defaultName && `名前「${m.defaultName}」`,
      m?.defaultMail && `メール「${m.defaultMail}」`,
      m?.omitNoname !== undefined && (m.omitNoname ? '名無しを省く' : '名無しを省かない'),
      m?.nonames?.length && `名無し扱い ${m.nonames.length} 件`,
    ]
      .filter(Boolean)
      .join('・')
  return (
    <>
      <p className="mb-5 text-xs text-c-text-muted leading-relaxed">
        ほかの分類の設定はすべての掲示板に効きます。ここでは、掲示板(サービス)ごと・板ごとに変えたいものだけを決めます。決めていないものは全体の設定のままです。
      </p>
      {services.map((c) => (
        <Section
          key={c.id}
          title={`${c.name}のアカウント`}
          note="ログインすると、この掲示板に書き込むときに自動で使われます(5ch の BE なら、BE に対応した板でアイコンやポイントが付きます)。パスワードはこのアプリの DB にそのまま保存します。設定の書き出し(JSON)には入りませんが、まるごとバックアップのファイルには入ります"
        >
          <div className="space-y-3">
            {(c.accounts ?? []).map((kind) => (
              <AccountForm
                key={key(c.id, kind.id)}
                connectorId={c.id}
                kind={kind}
                saved={props.accounts.find((a) => a.connectorId === c.id && a.accountId === kind.id)}
                status={props.loginStatus.get(key(c.id, kind.id))}
                onLogin={props.onLogin}
                onDelete={() => props.onDeleteAccount(c.id, kind.id)}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-c-text-muted">
            ログインで受け取った Cookie は、ふだんの通信の Cookie と一緒に保存されます。保存したものを消しても、受け取った Cookie はその期限まで残ります。
          </p>
        </Section>
      ))}
      <Section title="板ごとの設定" note="別名・名前欄とメール欄の既定値・名無しの扱いを、板ごとに決めます。お気に入りの板と、設定のある板が並びます">
        {boards.length > 8 && (
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`${boards.length} 板から絞り込む`} className={`${INPUT} w-full mb-2`} />
        )}
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)] mb-3">
          {shown.map((b) => {
            const m = meta[b.url]
            return (
              <div key={b.url}>
                <button
                  type="button"
                  onClick={() => setEditing((e) => (e === b.url ? undefined : b.url))}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-c-surface2"
                >
                  <BoardIcon boardUrl={b.url} override={m?.icon} />
                  <span className="text-c-text-strong">{m?.alias || b.name}</span>
                  <span className="flex-1 min-w-0 truncate text-xs text-c-text-muted">{summary(m) || '全体の設定のまま'}</span>
                  <span className="material-symbols-outlined text-lg text-c-text-muted">{editing === b.url ? 'expand_less' : 'expand_more'}</span>
                </button>
                {editing === b.url && <BoardMetaEditor board={b} meta={m ?? {}} onChange={(next) => setMeta(b.url, next)} />}
              </div>
            )
          })}
          {shown.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">{boards.length === 0 ? 'お気に入りの板がまだありません' : '見つかりません'}</p>}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const u = addUrl.trim().replace(/\/?$/, '/')
            if (!/^https?:\/\//.test(u)) return
            setAdded((a) => (a.includes(u) ? a : [...a, u]))
            setEditing(u)
            setAddUrl('')
          }}
        >
          <input type="text" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} placeholder="お気に入りでない板の URL(例: https://eagle.5ch.net/livejupiter/)" className={`${INPUT} flex-1`} />
          <button type="submit" className={BTN} disabled={!/^https?:\/\//.test(addUrl.trim())}>
            設定する
          </button>
        </form>
      </Section>
    </>
  )
}

/** 設定・NG の書き出しと読み込み、DB 全体のバックアップと復元 */
export function BackupTab({
  settings: s,
  update,
  onBackupDb,
  onRestoreDb,
  onPruneLogs,
}: Pick<SettingsProps, 'settings' | 'update' | 'onBackupDb' | 'onRestoreDb' | 'onPruneLogs'>) {
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()
  const [busy, setBusy] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)

  const act = async (fn: () => Promise<string | undefined>) => {
    setBusy(true)
    setMessage(undefined)
    try {
      const text = await fn()
      if (text) setMessage({ ok: true, text })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  /** 選んだファイルを、設定か NG かを見分けて読み込む */
  const importFile = (expect: 'settings' | 'ng') =>
    act(async () => {
      const text = await openJson()
      if (text === undefined) return undefined
      const parsed = parseBackup(text)
      if (parsed.kind === 'error') throw new Error(parsed.error)
      if (parsed.kind !== expect) throw new Error(expect === 'settings' ? '設定のファイルではありません(NG のファイルです)' : 'NG のファイルではありません(設定のファイルです)')
      if (parsed.kind === 'settings') {
        const values = importableSettings(parsed, DEFAULT_SETTINGS)
        for (const [k, v] of Object.entries(values)) update(k as keyof AppSettings, v as never)
        return `設定を読み込みました(${Object.keys(values).length} 項目)`
      }
      const { rules, added } = mergeNgRules(s.ngRules, parsed.rules, () => crypto.randomUUID())
      update('ngRules', rules)
      return `NG を ${added} 件足しました(同じものは足していません)`
    })

  return (
    <>
      {message && (
        <p className={`mb-4 text-sm ${message.ok ? 'text-c-accent' : 'text-c-heat-very-hot'}`}>
          <span className="material-symbols-outlined text-base align-[-3px] mr-1">{message.ok ? 'check_circle' : 'error'}</span>
          {message.text}
        </p>
      )}
      <Section
        title="古いログの整理"
        note="この日数より長く開いていないスレのログ(レス)を、起動したときに消します(1 日に 1 回)。お気に入りのスレ・自分が書き込んだスレ・開いているタブは残します。消したスレは、もう一度開けば取り直します(dat 落ちしていれば読めません)"
      >
        <Choice
          value={s.logRetentionDays}
          options={[
            { key: 30, name: '30 日' },
            { key: 90, name: '90 日' },
            { key: 180, name: '180 日' },
            { key: 365, name: '1 年' },
            { key: 0, name: '消さない' },
          ]}
          onChange={(v) => update('logRetentionDays', v)}
        />
        {s.logRetentionDays > 0 && (
          <button
            type="button"
            className={`${BTN} mt-3`}
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const n = await onPruneLogs()
                return n > 0 ? `${n} スレのログを消しました` : '消すログはありませんでした'
              })
            }
          >
            今すぐ整理する
          </button>
        )}
      </Section>
      <Section
        title="設定"
        note="表示・スレ一覧・キー操作などの設定を JSON に書き出します。catbox のアカウント、開いていたタブ、背景画像、画像の保存先は入れません"
      >
        <div className="flex gap-2">
          <button type="button" className={BTN} disabled={busy} onClick={() => act(async () => ((await saveJson('settings', settingsFile(s))) ? '書き出しました' : undefined))}>
            書き出す
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => importFile('settings')}>
            読み込む
          </button>
        </div>
      </Section>
      <Section title="NG" note={`NG(いま ${s.ngRules.length} 件)を JSON に書き出します。読み込むと、いまの NG に足します(同じものは重ねません)`}>
        <div className="flex gap-2">
          <button type="button" className={BTN} disabled={busy} onClick={() => act(async () => ((await saveJson('ng', ngFile(s.ngRules))) ? '書き出しました' : undefined))}>
            書き出す
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => importFile('ng')}>
            読み込む
          </button>
        </div>
      </Section>
      <Section
        title="まるごとバックアップ"
        note="ログ・既読・お気に入り・書き込み履歴・設定・NG を含む DB 全体を 1 つのファイルに書き出します。使っている最中でもそのまま書き出せます。アカウントのパスワードも入るので、ファイルの置き場所に気をつけてください"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} disabled={busy} onClick={() => act(async () => ((await onBackupDb()) ? 'バックアップを書き出しました' : undefined))}>
            バックアップを書き出す
          </button>
          {!confirmRestore ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmRestore(true)}
              className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border border-c-border text-c-text-body hover:border-c-border-strong"
            >
              バックアップから戻す…
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-sm text-c-text-body">
              いまの状態をバックアップの時点に戻し、アプリを起動し直します。いまの DB は消さずに別の名前で残します。
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const chosen = await onRestoreDb()
                    if (!chosen) setConfirmRestore(false)
                    return undefined
                  })
                }
                className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] bg-c-heat-very-hot text-white hover:opacity-90"
              >
                ファイルを選んで戻す
              </button>
              <button type="button" onClick={() => setConfirmRestore(false)} className="text-xs text-c-text-muted hover:text-c-text-strong underline">
                やめる
              </button>
            </span>
          )}
        </div>
      </Section>
    </>
  )
}

/** スレ表示とスレ一覧の操作ボタンを、ヘッダー・フッター・︙ の中だけ、のどこに置くか */
export function ToolbarsTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  // スマホでは、スマホの配置(PC とは別に持つ)を変える
  const key = isMobile ? 'mobileBarLayout' : 'barLayout'
  const layout = s[key]
  const orderKey = isMobile ? 'mobileBarOrder' : 'barOrder'
  const order = s[orderKey]
  const set = (area: BarArea, id: string, placement: Placement) => {
    const cur = layout[area] ?? {}
    update(key, { ...layout, [area]: { ...cur, [id]: placement } })
  }
  const PLACES: { key: Placement; name: string }[] = [
    { key: 'header', name: 'ヘッダー' },
    { key: 'footer', name: 'フッター' },
    { key: 'menu', name: '︙ の中だけ' },
  ]
  const area = (areaKey: BarArea, title: string) => {
    const placements = resolvePlacements(areaKey, layout, isMobile)
    // スマホ: ボタンをつまんで、ヘッダー・フッター・︙ の箱のあいだで動かす
    if (isMobile) {
      const actions = orderBy(barActionsFor(areaKey, isMobile), order[areaKey])
      const nameOf = (id: string) => actions.find((a) => a.id === id)!
      return (
        <Section title={title} note="ボタンの右のつまみをつかんで、置きたい箱の、置きたい位置へ動かします(同じ箱の中で動かすと並び順が変わります)">
          <DragZones
            zones={PLACES.map((p) => ({ key: p.key, title: p.name, items: actions.filter((a) => placements[a.id] === p.key).map((a) => a.id) }))}
            onMove={(id, zone, index) => {
              // 置き場所と、並び(ヘッダー → フッター → ︙ の順に、箱ごとの並びをつなげたもの)を一緒に変える
              const zones = PLACES.map((p) => ({ key: p.key, ids: actions.filter((a) => placements[a.id] === p.key && a.id !== id).map((a) => a.id) }))
              zones.find((z) => z.key === zone)!.ids.splice(index, 0, id)
              update(orderKey, { ...order, [areaKey]: zones.flatMap((z) => z.ids) })
              if (placements[id] !== zone) set(areaKey, id, zone)
            }}
            render={(id, handle, dragging) => (
              <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border border-c-border ${dragging ? 'bg-c-surface2' : 'bg-c-surface'}`}>
                <span className="material-symbols-outlined text-xl text-c-text-muted">{nameOf(id).icon}</span>
                <span className="flex-1 text-[15px] text-c-text-body">{nameOf(id).name}</span>
                <DragHandle handle={handle} />
              </div>
            )}
          />
        </Section>
      )
    }
    return (
      <Section title={title} note="どのボタンも、ヘッダーの右端の ︙ を押すと出てきます。よく使うものだけヘッダーかフッターに並べてください">
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)]">
          {barActionsFor(areaKey, isMobile).map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-3 py-2">
              <span className="material-symbols-outlined text-lg text-c-text-muted">{a.icon}</span>
              <span className="w-36 flex-shrink-0 text-sm text-c-text-body">{a.name}</span>
              <Choice value={placements[a.id]} options={PLACES} onChange={(v) => set(areaKey, a.id, v)} />
            </div>
          ))}
        </div>
      </Section>
    )
  }
  return (
    <>
      {area('thread', 'スレ表示')}
      {area('list', 'スレッド一覧')}
      <button
        type="button"
        onClick={() => {
          update(key, {})
          update(orderKey, {})
        }}
        className="text-xs text-c-text-muted hover:text-c-accent underline"
      >
        すべて既定に戻す
      </button>
    </>
  )
}

/** NG の管理。種類(本文・名前・ID・スレタイ)ごとのタブに分け、それぞれに追加欄と一覧を置く */
export function NgTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  const rules = s.ngRules

  return (
    <>
      <Section title="NG に当たったレスの扱い">
        <Choice
          value={s.ngMode}
          options={[
            { key: 'aborn', name: '「あぼーん」と出す' },
            { key: 'hide', name: '何も出さない(透明あぼーん)' },
          ]}
          onChange={(v) => update('ngMode', v)}
        />
        <Toggle
          checked={s.groupNg}
          onChange={(v) => update('groupNg', v)}
          label="2 つ以上続いたあぼーんを 1 行にまとめる"
          note="「あぼーん × 12(自動 NG 10・NG 2)」のように出します。押すと 1 つずつのあぼーんに広がり、そこから中身を見たり「荒らしじゃない」を付けたりできます"
        />
      </Section>
      <Section title="自動 NG(荒らし)">
        <Toggle
          checked={s.autoNg}
          onChange={(v) => update('autoNg', v)}
          label="荒らしらしいレスを自動で畳む"
          note="同じスレで同じ長い本文が 3 回以上あるレスと、同じ文字の繰り返しばかりのレスを畳みます(理由を出します)。レスの NG メニューの「荒らしとして NG」で同じ本文をスレをまたいで畳み、「荒らし判定を外す」で誤判定を直せます。荒らしの印が 3 件以上になると、印から判定を学び(でたらめな文字の並び・ほかのスレにも同じ長文・繰り返しなどの判断軸と、文字の並びの癖)、印のない似た荒らしも畳むようになります"
        />
      </Section>

      <Section title="NG の一覧" note="レスの ⋯・スレの NG ボタンからも足せます。正規表現・効く板(すべて / この板だけ)・期限・メモを決められます">
        <NgManager rules={rules} onChange={(v) => update('ngRules', v)} />
      </Section>
    </>
  )
}

export function BoardListTab(props: {
  sites: SiteConfig[]
  initialSite?: string
  favorites: Board[]
  loadBoards: SettingsProps['loadBoards']
  onToggleFavorite: SettingsProps['onToggleFavorite']
  onOpenBoard: SettingsProps['onOpenBoard']
}) {
  const [siteUrl, setSiteUrl] = useState(props.initialSite ?? props.sites[0]?.menuUrl)
  const site = props.sites.find((s) => s.menuUrl === siteUrl)
  const [boards, setBoards] = useState<Board[]>()
  const [query, setQuery] = useState('')
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const favoriteUrls = useMemo(() => new Set(props.favorites.map((b) => b.url)), [props.favorites])

  const load = async (refresh: boolean) => {
    if (!site) return
    setBusy(true)
    setMessage(undefined)
    try {
      setBoards(await props.loadBoards(site, refresh))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  // BBS メニューを切り替えたら、保存してある板一覧を出す(なければ取りに行く)
  useEffect(() => {
    setBoards(undefined)
    void load(false)
  }, [siteUrl])

  const grouped = useMemo(() => {
    const q = query.trim()
    const map = new Map<string, Board[]>()
    for (const b of boards ?? []) {
      if (q && !b.name.includes(q) && !(b.category ?? '').includes(q)) continue
      const cat = b.category ?? '(未分類)'
      map.set(cat, [...(map.get(cat) ?? []), b])
    }
    return [...map]
  }, [boards, query])

  const toggleCat = (cat: string) =>
    setOpenCats((s) => {
      const next = new Set(s)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })

  if (props.sites.length === 0) {
    return <p className="text-sm text-c-text-muted">BBS メニューが登録されていません。「板とサイト」から追加してください</p>
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Choice
          value={siteUrl ?? ''}
          options={props.sites.map((s) => ({ key: s.menuUrl, name: s.name }))}
          onChange={setSiteUrl}
        />
        <button type="button" className={`${ICON_BTN} ml-auto`} title="板一覧を取り直す" onClick={() => void load(true)}>
          <span className={`material-symbols-outlined text-lg ${busy ? 'animate-spin' : ''}`}>refresh</span>
        </button>
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="板の名前やカテゴリで絞り込む"
        className={`${INPUT} w-full mb-1`}
      />
      <p className="text-xs text-c-text-muted mb-2">☆ でお気に入りに登録・解除、ダブルクリックでその板を開きます</p>
      {message && <p className="text-sm text-c-heat-very-hot mb-2">{message}</p>}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar border border-c-border rounded-[var(--card-radius)]">
        {!boards && busy && <p className="px-3 py-2 text-sm text-c-text-muted">読み込み中...</p>}
        {grouped.map(([cat, list]) => {
          const open = query.trim() !== '' || openCats.has(cat)
          return (
            <div key={cat} className="border-b border-c-border last:border-b-0">
              <button
                type="button"
                onClick={() => toggleCat(cat)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-bold text-c-text-strong hover:bg-c-surface2"
              >
                <span
                  className="material-symbols-outlined text-base transition-transform"
                  style={{ transform: open ? 'rotate(90deg)' : undefined }}
                >
                  chevron_right
                </span>
                <span className="flex-1 text-left">{cat}</span>
                <span className="text-xs font-normal text-c-text-muted">{list.length}</span>
              </button>
              {open &&
                list.map((b) => {
                  const fav = favoriteUrls.has(b.url)
                  return (
                    <div
                      key={b.url}
                      onDoubleClick={() => props.onOpenBoard(b)}
                      className="flex items-center gap-2 pl-8 pr-3 py-1 text-sm cursor-default select-none hover:bg-c-surface2"
                      title="ダブルクリックで開く"
                    >
                      <button
                        type="button"
                        onClick={() => props.onToggleFavorite(b)}
                        className={fav ? 'text-mark-fav' : 'text-c-text-muted hover:text-mark-fav'}
                        title={fav ? 'お気に入りから外す' : 'お気に入りに追加'}
                      >
                        <span className={`material-symbols-outlined text-lg leading-none ${fav ? 'fill' : ''}`}>star</span>
                      </button>
                      <span className="text-c-text-body">{b.name}</span>
                    </div>
                  )
                })}
            </div>
          )
        })}
        {boards && grouped.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">見つかりません</p>}
      </div>
    </div>
  )
}

/** 板 1 つぶんの設定の欄(見せ方・書き込みの既定・名無しの扱い)。入力はすぐに反映・保存し、空にすれば全体の設定に戻る */
function BoardMetaEditor({ board, meta, onChange }: { board: Board; meta: BoardMeta; onChange: (m: BoardMeta) => void }) {
  const field = (key: 'alias' | 'icon' | 'defaultName' | 'defaultMail', label: string, placeholder: string, note?: string) => (
    <label className="block">
      <span className="block text-xs text-c-text-muted mb-1">{label}</span>
      <input
        type="text"
        value={meta[key] ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange({ ...meta, [key]: e.target.value || undefined })}
        className={`${INPUT} w-full`}
      />
      {note && <span className="block text-[10px] text-c-text-muted mt-0.5">{note}</span>}
    </label>
  )
  return (
    <div className="px-3 pb-3 pt-2 bg-c-surface2 space-y-3">
      <p className="text-[11px] font-bold text-c-text-muted">見せ方</p>
      <div className="grid grid-cols-2 gap-3">
        {field('alias', '別名(板名の代わりに出す名前)', board.name)}
        {field('icon', 'ファビコン(画像の URL)', '自動(板のページから探す)')}
      </div>
      <p className="text-[11px] font-bold text-c-text-muted">書き込み</p>
      <div className="grid grid-cols-2 gap-3">
        {field('defaultName', '名前欄の既定値', 'ふだんの名前のまま')}
        {field('defaultMail', 'メール欄の既定値', 'ふだんのメールのまま', 'sage にしておきたい板など')}
      </div>
      <p className="text-[11px] font-bold text-c-text-muted">名無しの扱い</p>
      <Choice
        value={meta.omitNoname === undefined ? 'global' : meta.omitNoname ? 'omit' : 'keep'}
        options={[
          { key: 'global' as const, name: '全体の設定に合わせる' },
          { key: 'omit' as const, name: '名無しの名前を省く' },
          { key: 'keep' as const, name: '省かない' },
        ]}
        onChange={(v) => onChange({ ...meta, omitNoname: v === 'global' ? undefined : v === 'omit' })}
      />
      <div>
        <span className="block text-xs text-c-text-muted mb-1">板の既定の名前のほかに、名無しとみなす名前(名前を変えた名無し・ワッチョイの頭など)</span>
        <ListEditor noun="名無しとみなす名前" items={meta.nonames ?? []} onChange={(v) => onChange({ ...meta, nonames: v.length ? v : undefined })} placeholder="例: 風吹けば名無し" />
      </div>
    </div>
  )
}

export function BoardsTab(
  props: Pick<
    SettingsProps,
    'favorites' | 'sites' | 'onAddFavoriteUrl' | 'onRemoveFavorite' | 'onAddSite' | 'onRemoveSite' | 'settings' | 'update'
  > & { onShowBoardList: (menuUrl: string) => void },
) {
  const [editing, setEditing] = useState<string>()
  const metaOf = (url: string) => props.settings.boardMeta[url] ?? {}
  const setMeta = (url: string, m: BoardMeta) => {
    const next = { ...props.settings.boardMeta }
    // 全部空になったら消す
    if (Object.values(m).some((v) => v !== undefined)) next[url] = m
    else delete next[url]
    props.update('boardMeta', next)
  }
  const [favUrl, setFavUrl] = useState('')
  const [siteName, setSiteName] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMessage(undefined)
    try {
      await fn()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Section title="お気に入り板" note="サイドバーの「お気に入り」に並ぶ板です。「板一覧」で ☆ を押すか、板の URL を貼って登録します">
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)] mb-3">
          {props.favorites.map((b) => (
            <div key={b.url}>
              <div className="flex items-center gap-3 px-3 py-2 text-sm">
                <BoardIcon boardUrl={b.url} override={metaOf(b.url).icon} />
                <span className="text-c-text-strong">{metaOf(b.url).alias || b.name}</span>
                {metaOf(b.url).alias && <span className="text-xs text-c-text-muted">({b.name})</span>}
                <span className="flex-1 min-w-0 truncate text-xs text-c-text-muted">{b.url}</span>
                <button
                  type="button"
                  onClick={() => setEditing((e) => (e === b.url ? undefined : b.url))}
                  className={`px-2 py-0.5 text-xs border rounded-[var(--btn-radius)] transition-colors ${
                    editing === b.url ? 'border-c-accent text-c-accent' : 'border-c-border text-c-text-body hover:border-c-accent hover:text-c-accent'
                  }`}
                >
                  編集
                </button>
                <button type="button" className={ICON_BTN} title="外す" onClick={() => props.onRemoveFavorite(b.url)}>
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
              {editing === b.url && <BoardMetaEditor board={b} meta={metaOf(b.url)} onChange={(m) => setMeta(b.url, m)} />}
            </div>
          ))}
          {props.favorites.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">まだありません</p>}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!favUrl.trim()) return
            void act(async () => {
              await props.onAddFavoriteUrl(favUrl.trim())
              setFavUrl('')
            })
          }}
        >
          <input
            type="text"
            value={favUrl}
            onChange={(e) => setFavUrl(e.target.value)}
            placeholder="板の URL(例: https://bbs.eddibb.cc/liveedge)"
            className={`${INPUT} flex-1`}
          />
          <button type="submit" className={BTN} disabled={busy || !favUrl.trim()}>
            追加
          </button>
        </form>
      </Section>

      <Section title="BBS メニュー" note="掲示板の板一覧(bbsmenu.html か bbsmenu.json)です。hono-bbs は web の板の一覧の URL(https://〜/boards)を入れます。「板一覧を見る」から、お気に入りに登録する板を探せます">
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)] mb-3">
          {props.sites.map((s) => (
            <div key={s.menuUrl}>
              <div className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="text-c-text-strong">{s.name}</span>
                <span className="flex-1 min-w-0 truncate text-xs text-c-text-muted">{s.menuUrl}</span>
                <button
                  type="button"
                  onClick={() => props.onShowBoardList(s.menuUrl)}
                  className="px-2 py-0.5 text-xs border border-c-border rounded-[var(--btn-radius)] text-c-text-body hover:border-c-accent hover:text-c-accent transition-colors"
                >
                  板一覧を見る
                </button>
                <button type="button" className={ICON_BTN} title="削除" onClick={() => props.onRemoveSite(s.menuUrl)}>
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            </div>
          ))}
          {props.sites.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">まだありません</p>}
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!siteUrl.trim()) return
            void act(async () => {
              await props.onAddSite(siteName.trim(), siteUrl.trim())
              setSiteName('')
              setSiteUrl('')
            })
          }}
        >
          <input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="名前(省略可)" className={`${INPUT} w-36`} />
          <input type="text" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="bbsmenu の URL" className={`${INPUT} flex-1 min-w-48`} />
          <button type="submit" className={BTN} disabled={busy || !siteUrl.trim()}>
            追加
          </button>
        </form>
      </Section>
      {message && <p className="text-sm text-c-heat-very-hot">{message}</p>}
    </>
  )
}

/** 外付けのコネクタ(MOD のように、フォルダに置いて有効にする) */
function ConnectorsTab({
  settings: s,
  update,
  externalConnectors,
  onReloadConnectors,
  onOpenConnectorsDir,
}: Pick<SettingsProps, 'settings' | 'update' | 'externalConnectors' | 'onReloadConnectors' | 'onOpenConnectorsDir'>) {
  /** 通信の先を確かめてもらっているコネクタ */
  const [asking, setAsking] = useState<string>()
  const [busy, setBusy] = useState(false)
  const reload = async (approvals?: Record<string, { enabled: boolean; hosts: string[] }>) => {
    setBusy(true)
    await onReloadConnectors(approvals)
    setBusy(false)
  }
  const setApproval = (id: string, approval: { enabled: boolean; hosts: string[] } | undefined) => {
    const next = { ...s.connectors }
    if (approval) next[id] = approval
    else delete next[id]
    update('connectors', next)
    setAsking(undefined)
    void reload(next)
  }
  const STATUS: Record<ExternalConnectorInfo['status'], { label: string; color: string }> = {
    loaded: { label: '使えます', color: 'var(--c-mark-new)' },
    disabled: { label: '無効', color: 'var(--c-text-muted)' },
    needsApproval: { label: '通信の先が変わりました', color: 'var(--c-mark-fav)' },
    error: { label: '読み込めません', color: 'var(--c-error)' },
  }
  return (
    <>
      <Section
        title="外付けのコネクタ"
        note="アプリのデータフォルダの connectors に、コネクタを 1 つずつフォルダで置きます(manifest.json と connector.js)。置いたら「読み込み直す」を押し、ここで有効にします。コネクタは外と切り離した囲いの中で動き、manifest.json に書いた先とだけ通信できます"
      >
        <div className="flex gap-2 mb-3">
          <button type="button" className={BTN} onClick={onOpenConnectorsDir}>
            フォルダを開く
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => void reload()}>
            {busy ? '読み込み中…' : '読み込み直す'}
          </button>
        </div>
        {externalConnectors.length === 0 && <p className="text-sm text-c-text-muted">まだありません</p>}
        <div className="flex flex-col gap-2">
          {externalConnectors.map((c) => {
            const m = c.manifest
            const st = STATUS[c.status]
            const approval = m ? s.connectors[m.id] : undefined
            return (
              <div key={c.dir} className="rounded-lg border border-c-border px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg text-c-text-muted">extension</span>
                  <span className="text-sm font-bold text-c-text-strong">{m?.name ?? c.dir}</span>
                  {m && <span className="text-xs text-c-text-muted">v{m.version}</span>}
                  {m?.author && <span className="text-xs text-c-text-muted">{m.author}</span>}
                  <span className="text-[11px] font-bold ml-auto" style={{ color: st.color }}>
                    {st.label}
                  </span>
                  {m && (c.status === 'disabled' || c.status === 'needsApproval') && (
                    <button type="button" className={BTN} onClick={() => setAsking(m.id)}>
                      {c.status === 'disabled' ? '有効にする' : '確かめ直す'}
                    </button>
                  )}
                  {m && approval?.enabled && c.status !== 'needsApproval' && (
                    <button
                      type="button"
                      className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border border-c-border hover:bg-c-surface2"
                      onClick={() => setApproval(m.id, undefined)}
                    >
                      無効にする
                    </button>
                  )}
                </div>
                {m?.description && <p className="mt-1 text-xs text-c-text-body">{m.description}</p>}
                <p className="mt-1 text-[11px] text-c-text-muted break-all">
                  フォルダ: {c.dir}
                  {m && ` ・ 通信する先: ${m.hosts.join('、')}`}
                </p>
                {c.error && (
                  <p className="mt-1 text-xs break-all" style={{ color: 'var(--c-error)' }}>
                    {c.error}
                  </p>
                )}
                {m && asking === m.id && (
                  <div className="mt-2 p-3 rounded-lg bg-c-surface2 text-sm text-c-text-body">
                    <p className="font-bold">このコネクタは、次の先と通信します</p>
                    <ul className="my-1.5 list-disc pl-5 font-mono text-xs">
                      {m.hosts.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-c-text-muted">
                      コネクタは、あなたがフォルダに置いたファイルのコードです。囲いの中で動くので、アプリのログ・設定・パスワードには触れませんが、
                      上の先へは、読んでいるスレの情報や書き込みを送れます。作った人を信頼できるものだけを有効にしてください。
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" className={BTN} onClick={() => setApproval(m.id, { enabled: true, hosts: m.hosts })}>
                        許可して有効にする
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border border-c-border hover:bg-c-surface"
                        onClick={() => setAsking(undefined)}
                      >
                        やめる
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Section>
      <Section title="コネクタの書き方" note="connector.js の中で defineConnector({ ... }) を 1 回呼びます。中身は組み込みのコネクタと同じ形です(リポジトリの docs/connectors.md に、見本と決まりの説明があります)">
        <pre className="text-[11px] leading-relaxed bg-c-surface2 rounded-lg p-3 overflow-x-auto custom-scrollbar">{`// manifest.json
{ "id": "my-bbs", "name": "自作の掲示板", "version": "1.0.0", "api": 1, "hosts": ["bbs.example.com"] }

// connector.js
defineConnector({
  canHandle: (url) => url.startsWith('https://bbs.example.com/'),
  threadWebUrl: (t) => 'https://bbs.example.com/t/' + t.key,
  async resolveUrl(url, ctx) { ... },
  async listBoards(site, ctx) { return [] },
  async listThreads(board, ctx) { ... },
  async fetchPosts(thread, cursor, ctx) { ... },
})`}</pre>
      </Section>
    </>
  )
}

export function AboutTab() {
  // 版はインストーラーの版(apps/desktop/package.json。tauri.conf.json がそこを読む)
  const [version, setVersion] = useState<string>()
  useEffect(() => {
    void getVersion().then(setVersion, () => setVersion(undefined))
  }, [])
  return (
    <>
      <Section title={`bbs-browser ${version ?? ''}`}>
        <p className="text-sm text-c-text-body leading-relaxed">
          コネクタで掲示板を読む専用ブラウザです。組み込みのコネクタで 2ch 互換(5ch・eddibb・bbspink など)・したらば・ふたばを読めます。
          ほかの掲示板は、外付けのコネクタ(設定 → コネクタ)で足せます。
        </p>
      </Section>
      <Section desktopOnly title="データの保存場所">
        <p className="text-sm font-mono text-c-text-body break-all">%APPDATA%\io.github.yumekui8.bbs-browser\bbs-browser.db</p>
        <p className="text-xs text-c-text-muted mt-1">ログ・既読位置・設定はすべてこのファイルに入っています</p>
        <p className="text-sm font-mono text-c-text-body break-all mt-3">%APPDATA%\io.github.yumekui8.bbs-browser\backups\</p>
        <p className="text-xs text-c-text-muted mt-1">
          DB の形が変わる版に上げたとき、上げる前の DB の写しを自動で置きます(新しいものから 3 つ)。困ったときは、設定 → バックアップ の「バックアップから戻す」で、ここのファイルを選んで戻せます
        </p>
      </Section>
    </>
  )
}

export default function SettingsDialog(props: SettingsProps) {
  // スマホは、はじめに分類の一覧(tab が undefined)を出し、押すとその分類の画面に入る
  const [tab, setTab] = useState<Tab | undefined>(props.initialTab ?? (isMobile ? undefined : 'display'))
  /** スマホ: 分類の中で開いている項目(Section の題) */
  const [section, setSection] = useState<string>()
  /** スマホ: 項目が少ない分類なので、題の一覧を挟まずに中身をそのまま並べている */
  const [flat, setFlat] = useState(false)
  const openSection = (title: string) => setSection(title)
  const enterTab = (key: Tab | undefined) => {
    setTab(key)
    setSection(undefined)
    setFlat(false)
  }
  /** 「板とサイト」から板一覧へ移るときに、どの BBS メニューを出すか */
  const [listSite, setListSite] = useState<string>()
  /** 設定の検索。言葉があるときは、すべての分類から当てはまる設定だけを並べる */
  const [query, setQuery] = useState('')
  const searching = query.trim() !== ''
  // スマホは、はじめから高度な設定も全部出す(分類を開いてから探すので、多くても困らない)
  const showAdvanced = isMobile || props.settings.showAdvanced

  // Tab・矢印はダイアログの中だけで回し、Esc で閉じる。開いている間は後ろの画面のキー操作を止める
  const boxRef = useRef<HTMLDivElement>(null)
  // スマホ: Esc(戻るボタン)は、検索 → 分類の画面 → 一覧 の順に 1 つずつ戻り、一覧で閉じる
  /** スマホ: 1 段戻る(検索 → 項目 → 分類 → 一覧 → 閉じる) */
  const goBack = () => {
    if (searching) return setQuery('')
    if (section) return setSection(undefined)
    if (tab) return enterTab(undefined)
    props.onClose()
  }
  useFocusTrap(boxRef, () => (isMobile ? goBack() : props.onClose()))

  // スマホは、PC だけの設定のまとまり(コネクタなど)を出さない
  const tabs = TABS.filter((t) => (showAdvanced || !t.advanced) && !(isMobile && t.desktopOnly))
  const renderTab = (key: Tab) => {
    switch (key) {
      case 'display':
        return <DisplayTab {...props} />
      case 'threads':
        return <ThreadsTab {...props} />
      case 'posts':
        return <PostsTab {...props} />
      case 'write':
        return <WriteTab {...props} />
      case 'refresh':
        return <RefreshTab {...props} />
      case 'keys':
        return <KeysTab {...props} />
      case 'toolbars':
        return <ToolbarsTab {...props} />
      case 'ng':
        return <NgTab {...props} />
      case 'boardlist':
        return (
          <BoardListTab
            key={listSite}
            sites={props.sites}
            initialSite={listSite}
            favorites={props.favorites}
            loadBoards={props.loadBoards}
            onToggleFavorite={props.onToggleFavorite}
            onOpenBoard={props.onOpenBoard}
          />
        )
      case 'boards':
        return (
          <BoardsTab
            {...props}
            onShowBoardList={(menuUrl) => {
              setListSite(menuUrl)
              enterTab('boardlist')
            }}
          />
        )
      case 'connectors':
        return <ConnectorsTab {...props} />
      case 'accounts':
        return <AccountsTab {...props} />
      case 'backup':
        return <BackupTab {...props} />
      case 'about':
        return <AboutTab />
    }
  }
  /** 検索の結果: すべての分類を並べ、当てはまる Section だけを出す(板一覧は大きいので入れない) */
  const searchResults = (
    <SearchContext.Provider value={query}>
      {tabs
        .filter((t) => t.key !== 'boardlist')
        .map((t) => (
          <div key={t.key} className="settings-group">
            <p className="flex items-center gap-2 mb-3 text-xs font-bold text-c-accent">
              <span className="material-symbols-outlined text-base">{t.icon}</span>
              {t.name}
            </p>
            {renderTab(t.key)}
          </div>
        ))}
      <p className="settings-empty text-sm text-c-text-muted">見つかりませんでした</p>
    </SearchContext.Provider>
  )
  const searchBox = (
    <div className="flex items-center gap-2 px-3 h-10 bg-c-surface2 border border-c-border rounded-full focus-within:border-c-accent">
      <span className="material-symbols-outlined text-lg text-c-text-muted">search</span>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="設定を探す(例: 文字の大きさ・NG・スワイプ)"
        className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm text-c-text-body placeholder-c-text-muted focus:ring-0"
      />
      {searching && (
        <button type="button" onClick={() => setQuery('')} className="p-0.5 text-c-text-muted" title="検索をやめる">
          <span className="material-symbols-outlined text-base">close</span>
        </button>
      )}
    </div>
  )

  if (isMobile) {
    // スマホ: 画面いっぱいの 3 段。分類の一覧(まとまりごと)→ 分類の画面(項目の題と説明)→ 項目の画面(中身)。
    // ← と戻るで 1 段ずつ戻る。一覧の上に検索
    const current = tab && TABS.find((t) => t.key === tab)
    const title = searching ? '設定の検索' : (section ?? current?.name ?? '設定')
    // 分類の画面で、項目(Section)の題を集める(1 つしかなければ、その中身をすぐ出す)
    const seen: string[] = []
    const nav: SectionNav = flat ? { mode: 'all' } : section ? { mode: 'detail', title: section } : { mode: 'index', open: openSection, seen }
    return createPortal(
      <div
        ref={boxRef}
        className="fixed inset-0 z-[9500] flex flex-col bg-c-surface"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex-shrink-0 flex items-center gap-1 px-1 border-b border-c-border bg-panel-thread-header" style={{ height: 'var(--header-height, 72px)' }}>
          <button type="button" onClick={goBack} className={MOBILE_HEAD_BTN} title={current || searching ? '戻る' : '閉じる'}>
            <span className={`material-symbols-outlined ${MOBILE_HEAD_ICON}`}>{current || searching ? 'arrow_back' : 'close'}</span>
          </button>
          <h2 className="flex-1 min-w-0 truncate text-[17px] font-bold text-c-text-strong">{title}</h2>
        </div>
        <AdvancedContext.Provider value={showAdvanced}>
          {!current && <div className="flex-shrink-0 px-4 pt-4 pb-2">{searchBox}</div>}
          {searching ? (
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">{searchResults}</div>
          ) : current ? (
            <div key={`${tab}:${section ?? ''}`} className={`flex-1 min-h-0 px-6 py-6 reply-slide ${tab === 'boardlist' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}>
              <SectionNavContext.Provider value={tab === 'boardlist' ? { mode: 'all' } : nav}>
                <SectionAutoOpen seen={seen} active={!flat && !section && tab !== 'boardlist'} onFew={() => setFlat(true)} />
                {renderTab(current.key)}
              </SectionNavContext.Provider>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6">
              {MOBILE_GROUPS.map((g) => {
                const items = g.items.filter((k) => tabs.some((t) => t.key === k))
                if (items.length === 0) return null
                return (
                  <div key={g.title} className="mt-5">
                    <p className="px-1 mb-2 text-xs font-bold text-c-text-muted">{g.title}</p>
                    <div className="rounded-2xl bg-c-surface2 overflow-hidden divide-y divide-c-border">
                      {items.map((k) => {
                        const t = TABS.find((x) => x.key === k)!
                        return (
                          <button key={k} type="button" onClick={() => enterTab(k)} className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left active:bg-c-surface3">
                            <span className="w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center text-white" style={{ background: TAB_COLORS[k] }}>
                              <span className="material-symbols-outlined text-[22px]">{t.icon}</span>
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-[15px] font-bold text-c-text-strong">{t.name}</span>
                              <span className="block mt-0.5 text-xs text-c-text-muted truncate">{TAB_DESC[k]}</span>
                            </span>
                            <span className="material-symbols-outlined text-xl text-c-text-muted">chevron_right</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </AdvancedContext.Provider>
      </div>,
      document.body,
    )
  }

  return (
    <div className="fixed inset-0 z-[9500] bg-black/50 flex items-center justify-center p-6" onClick={props.onClose}>
      <div
        ref={boxRef}
        className="w-full max-w-4xl h-full max-h-[720px] flex bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-2xl overflow-hidden rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="w-52 flex-shrink-0 flex flex-col bg-c-surface2 border-r border-c-border py-3">
          <h2 className="px-5 pb-3 text-lg font-bold text-c-text-strong">設定</h2>
          <div className="px-3 pb-2">{searchBox}</div>
          {/* 分類が多くて入りきらないときは、この並びだけスクロールする(下の「高度な設定」は動かさない) */}
          <div className="flex-1 min-h-0 overflow-y-auto hover-scrollbar">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setQuery('')
                setTab(t.key)
              }}
              className={`w-full flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                tab === t.key && !searching ? 'active-board text-c-text-strong' : 'text-c-text-body hover:bg-c-surface3'
              }`}
            >
              <span className={`material-symbols-outlined text-lg ${tab === t.key && !searching ? 'fill' : ''}`}>{t.icon}</span>
              {t.name}
            </button>
          ))}
          </div>
          {/* 高度な設定。オフ(はじめ)のときは、よく使う設定だけを見せる */}
          <label className="flex-shrink-0 mt-2 mx-3 px-2 py-2 flex items-start gap-2 rounded-lg cursor-pointer hover:bg-c-surface3 select-none">
            <input
              type="checkbox"
              checked={props.settings.showAdvanced}
              onChange={(e) => {
                props.update('showAdvanced', e.target.checked)
                if (!e.target.checked && TABS.find((t) => t.key === tab)?.advanced) setTab('display')
              }}
              className="mt-0.5 rounded"
            />
            <span className="text-xs text-c-text-body">
              高度な設定を表示
              <span className="block text-[10px] text-c-text-muted">細かい見た目・キー操作・ボタンの配置など</span>
            </span>
          </label>
        </nav>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center justify-between px-6 py-3 border-b border-c-border">
            <h3 className="text-base font-bold text-c-text-strong">{searching ? '設定の検索' : TABS.find((t) => t.key === tab)?.name}</h3>
            <button type="button" onClick={props.onClose} className={ICON_BTN} title="閉じる">
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
          <AdvancedContext.Provider value={showAdvanced}>
          <div
            className={`flex-1 min-h-0 px-6 py-5 ${tab === 'boardlist' && !searching ? 'flex flex-col overflow-hidden' : 'overflow-y-auto custom-scrollbar'}`}
          >
            {searching ? searchResults : tab && renderTab(tab)}
          </div>
          </AdvancedContext.Provider>
        </div>
      </div>
    </div>
  )
}
