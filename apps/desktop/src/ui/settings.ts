// アプリの設定。SQLite の settings 表に 1 項目 1 行(JSON)で保存する。
// 見た目の設定は <html> の data-scheme / data-pattern / data-density 属性と .dark クラスに反映し、
// 実際の色や余白は theme/theme.css・theme/patterns.css(web 版の複製)が CSS 変数で切り替える。

import { useCallback, useEffect, useState } from 'react'
import type { LogStore } from '@bbs-browser/logstore'
import type { NgRule } from '../utils/ng'
import type { Keymap } from '../utils/keymap'
import type { BarLayout } from '../utils/toolbar'

export type ColorScheme = 'indigo' | 'amber-teal' | 'light' | '2ch-classic' | 'soft-dark' | 'soft-light'
export type DesignPattern = 'tonal' | 'bordered'
/** web 版の 'panel'(カード表示)はサムネイル前提なので、専ブラでは一覧と高密度だけにする */
export type ListDensity = 'list' | 'dense'
export type FontSize = 1 | 2 | 3 | 4 | 5
/** custom は OS に入っているフォントから選んだもの(customFont に名前を持つ) */
export type FontFamily = 'noto' | 'biz-ud' | 'system' | 'custom'
export type ThreadSort = 'subject' | 'momentum' | 'newest'
export type OpenPosition = 'unread' | 'top' | 'bottom'
export type AnchorPopup = 'hover' | 'click'
export type NgMode = 'aborn' | 'hide'
/** 書き込み欄の置き場所: bottom はレスの下、right はレスの右 */
export type ReplyLayout = 'bottom' | 'right'

/** 次の起動で開き直すためのタブの控え(ThreadSummary の日付は数値にする) */
export interface SavedTab {
  connectorId: string
  boardUrl: string
  key: string
  title: string
  postCount: number
  createdAt?: number
}

/** 板ごとの情報(お気に入り板の編集画面で設定する)。どれも空なら既定のまま */
export interface BoardMeta {
  /** 板名の代わりに出す名前 */
  alias?: string
  /** ファビコンの上書き(画像の URL) */
  icon?: string
  /** その板での名前欄・メール欄の既定値 */
  defaultName?: string
  defaultMail?: string
}

/** 不透明度を変えられるパネル */
export type PanelKey = 'addressBar' | 'sidebar' | 'tabs' | 'threadList' | 'threadHeader' | 'threadView' | 'replyForm'

export const PANELS: { key: PanelKey; name: string; cssVar: string }[] = [
  { key: 'addressBar', name: '一番上の帯(URL バー)', cssVar: '--alpha-address-bar' },
  { key: 'sidebar', name: 'サイドバー', cssVar: '--alpha-sidebar' },
  { key: 'tabs', name: 'タブ', cssVar: '--alpha-tabs' },
  { key: 'threadList', name: 'スレ一覧', cssVar: '--alpha-thread-list' },
  { key: 'threadHeader', name: 'スレのヘッダー(開いているタブも)', cssVar: '--alpha-thread-header' },
  { key: 'threadView', name: 'スレ表示', cssVar: '--alpha-thread-view' },
  { key: 'replyForm', name: '書き込み欄', cssVar: '--alpha-reply-form' },
]

export interface AppSettings {
  // 表示
  scheme: ColorScheme
  pattern: DesignPattern
  density: ListDensity
  fontSize: FontSize
  fontFamily: FontFamily
  customFont: string
  threadPanelWidth: number
  /** 背景画像(アプリのデータフォルダにコピーしたもののパス)。空なら出さない */
  backgroundImage: string
  /** 背景画像の濃さ(0〜1)。画像はパネルの後ろに置くので、パネルを透かしたところに見える */
  backgroundOpacity: number
  /** パネルごとの不透明度(0〜1)。背景色だけを透かす */
  panelAlpha: Record<PanelKey, number>
  /** サイドバーをしまって、アイコンだけの細い帯にする */
  sidebarCollapsed: boolean
  /** しまった帯で、板のアイコンの下に板名(別名があれば別名)を小さく出す */
  showStripNames: boolean
  replyLayout: ReplyLayout
  /** 書き込み欄の高さ(下に置くとき)と幅(右に置くとき) */
  replyHeight: number
  replyWidth: number
  // 起動
  /** 起動時に開く板の URL。'@last' なら前回開いていた板、空なら何も開かない */
  startupBoardUrl: string
  /** 前回開いていた板(startupBoardUrl が '@last' のときに使う) */
  lastBoardUrl: string
  // スレ一覧
  threadSort: ThreadSort
  /** 板ごとの情報(板の URL → 別名・ファビコン・名前とメールの既定値) */
  boardMeta: Record<string, BoardMeta>
  /** 興味のあるキーワード。スレ一覧で、スレタイに含むスレを帯の下にまとめて上に出す */
  keywords: string[]
  /** 板ごとの、最後にスレ一覧を取った時刻(ms)。それより後に立ったスレに「新」の印を付ける */
  boardVisits: Record<string, number>
  /** スレ一覧の一番上で、さらにホイールを上に回したら更新する */
  pullToRefreshList: boolean
  // タブ
  /** タブを使う。false ならタブ列を出さず、スレを開くたびに置き換える */
  tabsEnabled: boolean
  /** スレ一覧から開くとき、新しいタブで開く(false なら今のタブを置き換える) */
  openInNewTab: boolean
  openTabs: SavedTab[]
  /** 開いていたタブ(threadId) */
  activeTab: string
  // レス表示
  openPosition: OpenPosition
  anchorPopup: AnchorPopup
  showThumbnails: boolean
  aaAutoDetect: boolean
  /** 画像でも動画でもないリンクに、埋め込みのカード(タイトル・説明・画像)を出す */
  showLinkPreview: boolean
  /** 名前が板の既定の名前(名無し)なら省く */
  omitNoname: boolean
  /** 3 行以上続く空行を 1 行にまとめる */
  collapseBlankLines: boolean
  /** 本文の最後の空行を消す */
  trimTrailingBlank: boolean
  /** >>1 と同じ ID のレスに「主」の印を付ける */
  highlightOp: boolean
  /** レスの番号の左に、ID から作るアイコン(GitHub 風の Identicon)を出す */
  showIdenticon: boolean
  /** スレ表示の右端に、人気レス・自分のレス・画像の位置を示す縮図を出す */
  showMinimap: boolean
  /** 画像の保存先フォルダ。空ならダウンロードフォルダ */
  imageSaveDir: string
  // 自動更新
  /** 開いているスレを自動で更新する間隔(秒)。0 なら自動更新しない */
  autoRefreshSec: number
  /** いちばん下を見ているときに新着が来たら、新着まで自動でスクロールする */
  autoScrollOnNew: boolean
  /** お気に入りのスレの新着の数を確かめる間隔(分)。0 なら確かめない(スレ一覧だけ取るので軽い) */
  favCheckMin: number
  /** 自分宛てのレスが届いたら、右下に通知を出す */
  notifyReplies: boolean
  // NG
  ngRules: NgRule[]
  /** aborn: 「あぼーん」と出す / hide: 何も出さない(透明あぼーん) */
  ngMode: NgMode
  // 画像のアップロード(catbox.moe)
  /** 書き込み欄から画像をアップロードできるようにする(上げた画像は公開され、匿名なら消せない) */
  uploaderEnabled: boolean
  /** 上げる前に、画像を描き直して EXIF(撮影場所など)を取り除く */
  uploadStripMetadata: boolean
  /** 上げる前に、長い辺がこれを超える画像を縮小する(px)。0 なら縮小しない */
  uploadMaxDimension: number
  /** catbox のアカウント(userhash)。あればアカウントで上げ、アップロード履歴からサーバー上のファイルも消せる */
  catboxUserhash: string
  /** 書き込むときにアカウント(BE など)を使うか。アカウントの id → 使うか。書いていなければ使う(登録してあれば) */
  postAccounts: Record<string, boolean>
  /** 書き込んだあと、続けて書き込めないようにあける秒数。0 ならあけない */
  postCooldownSec: number
  /** 定型文。操作バーや ⋯ から、そのレスへのアンカーを付けてすぐ書き込む */
  quickPhrases: string[]
  /**
   * レスの操作バーに並べるもの(左から順)。'reply' | 'copy' | 'ng' | 'tree' | 'phrase:定型文'。
   * ⋯ はいつも一番右に出す
   */
  postToolbar: string[]
  /** キー操作の割り当て(変えたものだけ。足りない操作は既定の割り当てを使う) */
  keymap: Partial<Keymap>
  /** スレ表示・スレ一覧の操作ボタンの置き場所(変えたものだけ) */
  barLayout: BarLayout
  /** 設定画面で、高度な設定も見せる(オフなら、よく使う項目だけ) */
  showAdvanced: boolean
  // 書き込み(最後に使った名前とメールを覚えておく)
  postName: string
  postMail: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  scheme: 'indigo',
  pattern: 'tonal',
  density: 'dense',
  fontSize: 3,
  fontFamily: 'system',
  customFont: '',
  threadPanelWidth: 420,
  backgroundImage: '',
  backgroundOpacity: 1,
  panelAlpha: { addressBar: 1, sidebar: 1, tabs: 1, threadList: 1, threadHeader: 1, threadView: 1, replyForm: 1 },
  sidebarCollapsed: false,
  showStripNames: false,
  replyLayout: 'bottom',
  replyHeight: 170,
  replyWidth: 380,
  startupBoardUrl: '@last',
  lastBoardUrl: 'https://bbs.eddibb.cc/liveedge/',
  threadSort: 'subject',
  boardMeta: {},
  keywords: [],
  pullToRefreshList: true,
  boardVisits: {},
  tabsEnabled: true,
  openInNewTab: true,
  openTabs: [],
  activeTab: '',
  openPosition: 'unread',
  anchorPopup: 'click',
  showThumbnails: true,
  aaAutoDetect: true,
  showMinimap: true,
  showIdenticon: false,
  showLinkPreview: true,
  omitNoname: true,
  collapseBlankLines: true,
  trimTrailingBlank: true,
  highlightOp: true,
  imageSaveDir: '',
  autoRefreshSec: 0,
  autoScrollOnNew: true,
  notifyReplies: true,
  favCheckMin: 5,
  ngRules: [],
  ngMode: 'aborn',
  uploaderEnabled: false,
  uploadStripMetadata: true,
  uploadMaxDimension: 2560,
  catboxUserhash: '',
  postCooldownSec: 10,
  postAccounts: {},
  quickPhrases: ['草'],
  postToolbar: ['reply', 'phrase:草', 'copy', 'ng'],
  keymap: {},
  barLayout: {},
  showAdvanced: false,
  postName: '',
  postMail: '',
}

export const COLOR_SCHEMES: { key: ColorScheme; name: string; accent: string; border: string }[] = [
  { key: 'indigo', name: 'インディゴ', accent: '#7566e6', border: '#242933' },
  { key: 'amber-teal', name: 'アンバー×ティール', accent: '#e0993f', border: '#2a3247' },
  { key: 'light', name: 'ライト', accent: '#3d6b96', border: '#e7e4df' },
  { key: '2ch-classic', name: '2chクラシック', accent: '#0000ff', border: '#545454' },
  // 専ブラで足した、コントラストを抑えた配色(app.css)
  { key: 'soft-dark', name: 'やさしいダーク', accent: '#8b93d9', border: '#343a44' },
  { key: 'soft-light', name: 'やさしいライト', accent: '#4f6f8f', border: '#dcd8d1' },
]

/**
 * 顔文字用の予備フォント(app.css)。日本語フォントで描けない「文字 + 重ねる記号」の組(･᷄ など)を描く。
 * どのフォントでも、日本語フォントのすぐ後ろ(sans-serif の前)に置く
 */
const KAOMOJI_FALLBACK = "'BBS Kaomoji Fallback'"

export const FONT_FAMILIES: { key: Exclude<FontFamily, 'custom'>; name: string; css: string }[] = [
  { key: 'noto', name: 'Noto Sans JP', css: `'Noto Sans JP Variable', 'Noto Sans JP', ${KAOMOJI_FALLBACK}, sans-serif` },
  { key: 'biz-ud', name: 'BIZ UDPゴシック(同梱)', css: `'BIZ UDPGothic', ${KAOMOJI_FALLBACK}, sans-serif` },
  // Windows に入っている BIZ UDPゴシックは画面表示向けの調整(ヒンティング)が効いていて、小さい字もガタつきにくい
  {
    key: 'system',
    name: 'Windows 標準(BIZ UDPゴシック)',
    css: `'BIZ UDPGothic', 'Yu Gothic UI', 'Meiryo UI', 'Noto Sans CJK JP', ${KAOMOJI_FALLBACK}, sans-serif`,
  },
]

const DARK_SCHEMES = new Set<ColorScheme>(['indigo', 'amber-teal', 'soft-dark'])

const FONT_SIZES = [13, 14, 16, 18, 20]

function apply(s: AppSettings) {
  const root = document.documentElement
  root.setAttribute('data-scheme', s.scheme)
  root.classList.toggle('dark', DARK_SCHEMES.has(s.scheme))
  root.setAttribute('data-pattern', s.pattern)
  root.setAttribute('data-density', s.density)
  root.style.fontSize = `${FONT_SIZES[s.fontSize - 1]}px`
  const preset = FONT_FAMILIES.find((f) => f.key === s.fontFamily) ?? FONT_FAMILIES[0]
  // OS のフォントが見つからなかったときのために、同梱の Noto Sans JP を後ろに置く
  const css =
    s.fontFamily === 'custom' && s.customFont
      ? `'${s.customFont.replace(/'/g, "\\'")}', ${FONT_FAMILIES[0].css}`
      : preset.css
  root.style.setProperty('--app-font', css)
  for (const p of PANELS) root.style.setProperty(p.cssVar, String(s.panelAlpha[p.key] ?? 1))
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
