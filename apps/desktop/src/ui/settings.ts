// アプリの設定。SQLite の settings 表に 1 項目 1 行(JSON)で保存する。
// 見た目の設定は <html> の data-scheme / data-pattern / data-density 属性と .dark クラスに反映し、
// 実際の色や余白は theme/theme.css・theme/patterns.css(web 版の複製)が CSS 変数で切り替える。

import { isMobile } from '../utils/platform'
import { useCallback, useEffect, useState } from 'react'
import type { LogStore } from '@bbs-browser/logstore'
import type { NgRule } from '../utils/ng'
import type { Keymap } from '../utils/keymap'
import { backgroundError } from '../utils/backgroundError'
import type { BarLayout } from '../utils/toolbar'

export type ColorScheme = 'indigo' | 'amber-teal' | 'light' | '2ch-classic' | 'soft-dark' | 'soft-light' | 'discord-dark' | 'line-light' | 'oled'
export type DesignPattern = 'tonal' | 'bordered'
/** レスの見た目のスタイル(PostArticle の variant)。カード / Discord 風 / 専ブラ風 */
export type PostStyle = 'card' | 'discord' | 'classic' | 'line'
export const POST_STYLES: { key: PostStyle; name: string; note: string }[] = [
  { key: 'card', name: 'カード', note: 'レスを区切り線で並べる、いままでの見た目' },
  { key: 'discord', name: 'Discord 風', note: '丸い ID のアイコンと平らな並び。同じ人の連投をまとめ、返信元を上に出す' },
  { key: 'classic', name: '専ブラ風', note: '「12 ：名前：日付 ID」を 1 行にした、昔ながらの 2ch の見た目' },
  { key: 'line', name: 'LINE 風', note: '吹き出しで会話のように並べる。自分の書き込みは右に緑の吹き出し' },
]
/**
 * スマホで選べるレスの見た目(専ブラ風は、狭い画面では読みにくいので出さない)。
 * スマホでは密度は選ばせず、見た目で決める(effectiveDensity)
 */
export const MOBILE_POST_STYLES = POST_STYLES.filter((p) => p.key !== 'classic')
/** 実際に使うレスの見た目(スマホで専ブラ風が保存されていたらカード) */
export function effectivePostStyle(s: Pick<AppSettings, 'postStyle'>): PostStyle {
  return isMobile && s.postStyle === 'classic' ? 'card' : s.postStyle
}
/** 実際に使う密度。スマホは見た目で決める: Discord 風は一覧表示(高密度だとスレ一覧が詰まりすぎる)、ほかは高密度 */
export function effectiveDensity(s: Pick<AppSettings, 'postStyle' | 'density'>): ListDensity {
  if (!isMobile) return s.density
  return effectivePostStyle(s) === 'discord' ? 'list' : 'dense'
}
/** web 版の 'panel'(カード表示)はサムネイル前提なので、専ブラでは一覧と高密度だけにする */
export type ListDensity = 'list' | 'dense'
export type FontSize = 1 | 2 | 3 | 4 | 5
/** custom は OS に入っているフォントから選んだもの(customFont に名前を持つ) */
export type FontFamily = 'noto' | 'biz-ud' | 'system' | 'custom'
export type ThreadSort = 'subject' | 'momentum' | 'newest' | 'count'
/** スレ一覧の上のタブ。unread・visited は絞り込み(押すとその条件のスレだけ)、ほかは並べ替え */
export type ListTabKey = 'unread' | 'visited' | 'momentum' | 'newest' | 'count'
export const LIST_TABS: { key: ListTabKey; name: string; icon: string; note: string }[] = [
  { key: 'unread', name: '未読', icon: 'mark_email_unread', note: 'ログがあり、新着レスのあるスレだけを出す' },
  { key: 'visited', name: '閲覧済み', icon: 'history', note: '一度でも開いた(ログのある)スレだけを出す' },
  { key: 'momentum', name: '勢い順', icon: 'local_fire_department', note: '勢い(1 日あたりのレス数)の多い順に並べる' },
  { key: 'newest', name: '新しい順', icon: 'schedule', note: '立った時刻の新しい順に並べる' },
  { key: 'count', name: 'レス数順', icon: 'format_list_numbered', note: 'レス数の多い順に並べる' },
]
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
  /** OS のダーク・ライトに合わせてテーマを切り替える。そのときは scheme ではなく下の 2 つを使う */
  followOsTheme: boolean
  darkScheme: ColorScheme
  lightScheme: ColorScheme
  /** 前の「枠線スタイル」。いまは postStyle から決める(残っている保存値は使わない) */
  pattern: DesignPattern
  postStyle: PostStyle
  density: ListDensity
  fontSize: FontSize
  /** スマホの文字の大きさ(PC とは別。画面が狭いので、既定は 1 段小さい) */
  mobileFontSize: FontSize
  fontFamily: FontFamily
  customFont: string
  threadPanelWidth: number
  /** サイドバーを広げたときの幅 */
  sidebarWidth: number
  /** スレ表示のヘッダー(スレタイの行)・スレ一覧のヘッダー(板名の行)・スレ一覧のフッターの高さ(px)。0 なら既定 */
  threadHeaderHeight: number
  listHeaderHeight: number
  listFooterHeight: number
  /** Shift+Delete でログを消す前に確かめる */
  confirmDeleteLog: boolean
  /** 書き込みの削除キー(ふたば)。初めて書き込むときに作り、自分の書き込みを消すときに使う。空ならまだない */
  postDeleteKey: string
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
  /** スレ一覧の上に出すタブと、その並び(左から) */
  listTabs: ListTabKey[]
  /** 板ごとの情報(板の URL → 別名・ファビコン・名前とメールの既定値) */
  boardMeta: Record<string, BoardMeta>
  /** 興味のあるキーワード。スレ一覧で、スレタイに含むスレを帯の下にまとめて上に出す */
  keywords: string[]
  /** 板ごとの、最後にスレ一覧を取った時刻(ms)。それより後に立ったスレに「新」の印を付ける */
  boardVisits: Record<string, number>
  /**
   * 画面の分け方。split: スレ一覧とスレ表示を並べる / single: どちらか一方だけを画面いっぱいに出す /
   * auto: ウィンドウが狭い・縦長のときだけ single
   */
  paneMode: PaneMode
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
  /** スレ表示の画像のサムネイルの一辺(px) */
  postThumbSize: number
  /** スレ一覧のサムネイル(ふたばのカタログの絵など)の大きさの倍率。見た目ごとの元の大きさに掛ける */
  listThumbScale: number
  /** 「グロ」などの言葉を含む返信が付いた(または本人がそう書いた)レスの画像を、ぼかして出す */
  blurGross: boolean
  /** ぼかす目印にする言葉 */
  grossWords: string[]
  aaAutoDetect: boolean
  /** 画像でも動画でもないリンクに、埋め込みのカード(タイトル・説明・画像)を出す */
  showLinkPreview: boolean
  /** 掲示板でないリンク(ウェブページ・画像・動画)を、アプリの中で開く(リーダー表示。ReaderView)。スマホの既定 */
  openLinksInApp: boolean
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
  /** スマホ: スレ表示の右下に、丸い更新ボタンを出す */
  showRefreshFab: boolean
  /** スマホ: 下へスクロールしたらヘッダーとフッターを隠す(false なら、いつも出しておく) */
  hideBarsOnScroll: boolean
  /** 画像の保存先フォルダ。空ならダウンロードフォルダ */
  imageSaveDir: string
  // 自動更新
  /** 開いているスレを自動で更新する間隔(秒)。0 なら自動更新しない */
  autoRefreshSec: number
  /** いちばん下を見ているときに新着が来たら、新着まで自動でスクロールする */
  autoScrollOnNew: boolean
  /** 一番下を見ているときに届いた新着は、多くても一番下まで送る(オフなら新着の頭まで) */
  followToEnd: boolean
  /** お気に入りのスレの新着の数を確かめる間隔(分)。0 なら確かめない(スレ一覧だけ取るので軽い) */
  favCheckMin: number
  /** お気に入りのスレに新着があったら、右下に知らせる */
  notifyFavThreads: boolean
  /** お気に入り板のスレ一覧を見に行き、キーワードに合うスレが立ったら知らせる間隔(分)。0 なら見に行かない */
  keywordWatchMin: number
  /** 板ごとの、キーワードのスレを最後に確かめた時刻(ms)。それより後に立ったスレを知らせる */
  keywordWatchSince: Record<string, number>
  /** 自分宛てのレスが届いたら、右下に通知を出す */
  notifyReplies: boolean
  // NG
  ngRules: NgRule[]
  /** aborn: 「あぼーん」と出す / hide: 何も出さない(透明あぼーん) */
  ngMode: NgMode
  /** 自動 NG(同じ本文の連投・繰り返しばかりの文を荒らしとして畳む。utils/autoNg.ts) */
  autoNg: boolean
  /**
   * スマホ: 画面ごとの、スワイプの向きの並び(「right」「right,up」)→ 操作。
   * 操作はキー操作と同じ名前(KeyAction)か、drawer(引き出しを開く)。空なら何もしない
   */
  swipeGestures: { list: Record<string, string>; thread: Record<string, string> }
  /** スマホ: スワイプの感度(1 = 鈍い 〜 5 = 敏感) */
  gestureSensitivity: number
  /** この日数より長く開いていないスレのログを、起動したときに消す(0 なら消さない)。お気に入り・自分が書いたスレ・開いているタブは残す */
  logRetentionDays: number
  /** 最後にログを整理した時刻(1 日に 1 回だけ整理する) */
  lastLogPruneAt: number
  /** 外付けのコネクタ(connectors/ のフォルダ)ごとの許可。id → 有効か・確かめた通信の先 */
  connectors: Record<string, { enabled: boolean; hosts: string[] }>
  /** 続けて並んだあぼーん(NG・自動 NG)を 1 行にまとめる */
  groupNg: boolean
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
  /** 書き込み欄をしまっておく(スレ表示が狭いときは、これに関係なく自動でしまう) */
  replyCollapsed: boolean
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
  /** スマホのボタンの配置(PC とは別。既定も別) */
  mobileBarLayout: BarLayout
  /** 設定画面で、高度な設定も見せる(オフなら、よく使う項目だけ) */
  showAdvanced: boolean
  // 書き込み(最後に使った名前とメールを覚えておく)
  postName: string
  postMail: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  scheme: 'indigo',
  followOsTheme: false,
  darkScheme: 'soft-dark',
  lightScheme: 'soft-light',
  pattern: 'tonal',
  postStyle: 'card',
  density: 'dense',
  fontSize: 3,
  mobileFontSize: 3,
  fontFamily: 'system',
  customFont: '',
  threadPanelWidth: 420,
  sidebarWidth: 256,
  threadHeaderHeight: 0,
  listHeaderHeight: 0,
  listFooterHeight: 0,
  confirmDeleteLog: true,
  postDeleteKey: '',
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
  listTabs: ['unread', 'momentum', 'newest'],
  boardMeta: {},
  keywords: [],
  pullToRefreshList: true,
  paneMode: 'auto',
  boardVisits: {},
  tabsEnabled: true,
  openInNewTab: true,
  openTabs: [],
  activeTab: '',
  openPosition: 'unread',
  anchorPopup: 'click',
  showThumbnails: true,
  postThumbSize: 80,
  listThumbScale: 1,
  blurGross: true,
  grossWords: ['グロ'],
  aaAutoDetect: true,
  showMinimap: true,
  showRefreshFab: true,
  hideBarsOnScroll: true,
  showIdenticon: false,
  showLinkPreview: true,
  openLinksInApp: isMobile,
  omitNoname: true,
  collapseBlankLines: true,
  trimTrailingBlank: true,
  highlightOp: true,
  imageSaveDir: '',
  autoRefreshSec: 0,
  autoScrollOnNew: true,
  followToEnd: false,
  notifyReplies: true,
  favCheckMin: 5,
  notifyFavThreads: true,
  keywordWatchMin: 10,
  keywordWatchSince: {},
  ngRules: [],
  ngMode: 'aborn',
  autoNg: true,
  // 元の Web アプリ(hono-bbs)のスマホ版に合わせた割り当て
  swipeGestures: {
    // →↑ は一番下へ・→↓ は先頭へ(引っぱる向きに動く。元の Web アプリと同じ)
    list: { right: 'drawer', left: 'forward', 'right,up': 'bottom', 'right,down': 'top', 'left,down': 'refresh', 'left,up': 'reply' },
    // スマホはタブを使わない(→ の「戻る」が閉じるのと同じ)ので、←↑ はログを削除して閉じる
    thread: { right: 'back', left: 'reply', 'right,up': 'bottom', 'right,down': 'top', 'left,down': 'refresh', 'left,up': 'deleteLog' },
  },
  gestureSensitivity: 3,
  logRetentionDays: 90,
  lastLogPruneAt: 0,
  connectors: {},
  groupNg: true,
  uploaderEnabled: false,
  uploadStripMetadata: true,
  uploadMaxDimension: 2560,
  catboxUserhash: '',
  postCooldownSec: 10,
  replyCollapsed: false,
  postAccounts: {},
  quickPhrases: ['草'],
  postToolbar: ['reply', 'phrase:草', 'copy', 'ng'],
  keymap: {},
  barLayout: {},
  mobileBarLayout: {},
  showAdvanced: false,
  postName: '',
  postMail: '',
}

export const COLOR_SCHEMES: { key: ColorScheme; name: string; accent: string; border: string }[] = [
  { key: 'indigo', name: 'インディゴ', accent: '#7566e6', border: '#242933' },
  { key: 'amber-teal', name: 'アンバー×ティール', accent: '#e0993f', border: '#2a3247' },
  { key: '2ch-classic', name: '2chクラシック', accent: '#0000ff', border: '#545454' },
  // 専ブラで足した、コントラストを抑えた配色(app.css)。web 版のライト('light')は見にくいので外し、これをライトとする
  { key: 'soft-dark', name: 'ダーク', accent: '#8b93d9', border: '#343a44' },
  { key: 'soft-light', name: 'ライト', accent: '#4f6f8f', border: '#d2cdc5' },
  // レスの見た目のスタイル(Discord 風・LINE 風)と組み合わせる配色と、夜用の真っ黒
  { key: 'discord-dark', name: 'Discord ダーク', accent: '#5865f2', border: '#29292d' },
  { key: 'line-light', name: 'LINE ライト', accent: '#06c755', border: '#dfe2e7' },
  { key: 'oled', name: '真っ黒', accent: '#7aa2ff', border: '#222222' },
]

/** 選べる配色(スマホでは 2ch クラシックを除く) */
export const PICKABLE_SCHEMES = isMobile ? COLOR_SCHEMES.filter((c) => c.key !== '2ch-classic') : COLOR_SCHEMES

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

const DARK_SCHEMES = new Set<ColorScheme>(['indigo', 'amber-teal', 'soft-dark', 'discord-dark', 'oled'])

/** 文字の大きさ(px)。極小・小・標準・大・特大。スマホは画面が小さいので 1 段ずつ小さくし、PC の「小」をスマホの「標準」にする */
const FONT_SIZES = isMobile ? [12, 13, 14, 16, 18] : [13, 14, 16, 18, 20]
/** 文字の大きさの設定の名前(スマホは PC と別に持つ)。文字の大きさを変える所は、どこもこれを使う */
export const FONT_SIZE_KEY = isMobile ? 'mobileFontSize' : 'fontSize'

/** 暗い配色か(OS のダーク・ライトに合わせるとき、どちら用かを見分ける) */
export function isDarkScheme(scheme: ColorScheme): boolean {
  return DARK_SCHEMES.has(scheme)
}

/** OS がダークモードか */
const osDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

/** いま使うテーマ。OS に合わせるなら、OS のダーク・ライトで選んでおいた方 */
export function effectiveScheme(s: AppSettings): ColorScheme {
  if (!s.followOsTheme) return withoutOldLight(s.scheme)
  return osDark() ? withoutOldLight(s.darkScheme) : withoutOldLight(s.lightScheme)
}

/**
 * 外した web 版のライトを選んでいた人(設定の読み込みや、古い設定ファイル)は、いまのライトにする。
 * スマホでは 2ch クラシックも出さない(専ブラ風の見た目と組で、スマホの画面には合わない)ので、ライトにする
 */
function withoutOldLight(scheme: ColorScheme): ColorScheme {
  return scheme === 'light' || (isMobile && scheme === '2ch-classic') ? 'soft-light' : scheme
}

/** 前の既定だったスレ表示の ←↑「タブを閉じる」(スマホにはタブがない)は、いまの既定の「ログを削除して閉じる」にする */
function withoutOldGestures(g: AppSettings['swipeGestures']): AppSettings['swipeGestures'] {
  return g.thread?.['left,up'] === 'closeTab' ? { ...g, thread: { ...g.thread, 'left,up': 'deleteLog' } } : g
}

/**
 * テーマを選んだときに変える設定。OS に合わせているときは、暗い配色ならダーク用に、明るい配色ならライト用にする
 */
export function pickScheme(s: AppSettings, key: ColorScheme): Partial<AppSettings> {
  if (!s.followOsTheme) return { scheme: key }
  return isDarkScheme(key) ? { darkScheme: key } : { lightScheme: key }
}

function apply(s: AppSettings) {
  const root = document.documentElement
  const scheme = effectiveScheme(s)
  root.setAttribute('data-scheme', scheme)
  root.classList.toggle('dark', DARK_SCHEMES.has(scheme))
  // カード・Discord 風はトーナル(面の濃淡)、専ブラ風は枠線(色の面なし)の部品の見た目にする
  root.setAttribute('data-pattern', effectivePostStyle(s) === 'classic' ? 'bordered' : 'tonal')
  root.setAttribute('data-post-style', effectivePostStyle(s))
  root.setAttribute('data-density', effectiveDensity(s))
  root.style.fontSize = `${FONT_SIZES[s[FONT_SIZE_KEY] - 1]}px`
  const preset = FONT_FAMILIES.find((f) => f.key === s.fontFamily) ?? FONT_FAMILIES[0]
  // OS のフォントが見つからなかったときのために、同梱の Noto Sans JP を後ろに置く
  const css =
    s.fontFamily === 'custom' && s.customFont
      ? `'${s.customFont.replace(/'/g, "\\'")}', ${FONT_FAMILIES[0].css}`
      : preset.css
  root.style.setProperty('--app-font', css)
  for (const p of PANELS) root.style.setProperty(p.cssVar, String(s.panelAlpha[p.key] ?? 1))
  root.style.setProperty('--post-thumb-size', `${s.postThumbSize}px`)
  root.style.setProperty('--list-thumb-scale', String(s.listThumbScale))
}

export type PaneMode = 'split' | 'single' | 'auto'

export type UpdateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void

/** 設定を読み込み、変更を即座に画面へ反映して保存する。loaded は保存済みの値を読み終えたか */
export function useSettings(store: LogStore | undefined): [AppSettings, UpdateSetting, boolean] {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!store) return
    void store.getSettings().then((saved) => {
      setSettings((s) => {
        const next = { ...s, ...(saved as Partial<AppSettings>) }
        return { ...next, scheme: withoutOldLight(next.scheme), lightScheme: withoutOldLight(next.lightScheme), swipeGestures: withoutOldGestures(next.swipeGestures) }
      })
      setLoaded(true)
    })
  }, [store])

  useEffect(() => apply(settings), [settings])
  // OS のダーク・ライトが切り替わったら、合わせて塗り直す
  useEffect(() => {
    if (!settings.followOsTheme) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply(settings)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [settings])

  const update = useCallback<UpdateSetting>(
    (key, value) => {
      setSettings((s) => ({ ...s, [key]: value }))
      void store?.setSetting(key, value).catch(backgroundError('設定の保存'))
    },
    [store],
  )

  return [settings, update, loaded]
}
