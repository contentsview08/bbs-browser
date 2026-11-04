// アプリの設定。SQLite の settings 表に 1 項目 1 行(JSON)で保存する。
import { AI_NG_SAMPLES, type AiNgOverride, type AiNgRule } from '../utils/aiNg'
import { setHaptics } from '../utils/haptics'
import { customLineBg, customVars, isCustomDark, parseCustom } from './customScheme'
import type { DateStyle } from '../utils/displayDate'
// 見た目の設定は <html> の data-scheme / data-pattern / data-density 属性と .dark クラスに反映し、
// 実際の色や余白は theme/theme.css・theme/patterns.css(web 版の複製)が CSS 変数で切り替える。

import { isMobile } from '../utils/platform'
import { ensureFont } from '../host/fonts'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogStore } from '@bbs-browser/logstore'
import type { ThreadSummary } from '@bbs-browser/connectors'
import type { NgRule } from '../utils/ng'
import type { Keymap } from '../utils/keymap'
import { backgroundError } from '../utils/backgroundError'
import type { BarLayout, BarOrder } from '../utils/toolbar'
import { DEFAULT_UPLOAD_HOST, migrateUploadHost, type UploadHost } from '../host/uploader'
import { broadcast, onBroadcast } from '../host/crossWindow'

export type ColorScheme = 'indigo' | 'amber-teal' | 'light' | '2ch-classic' | 'soft-dark' | 'soft-light' | 'discord-dark' | 'line-light' | 'oled'
  // スマホのアプリ(ネイティブ版)で足した配色。色は theme/native-schemes.css
  | 'gray' | 'light-gray' | 'sepia' | 'nord' | 'contrast' | 'night' | 'line-dark' | 'discord-light' | 'x-dim' | 'mono'
  // 自分の配色(設定 customScheme の 6 色から作る。ui/customScheme.ts)
  | 'custom'
export type DesignPattern = 'tonal' | 'bordered'
/** レスの見た目のスタイル(PostArticle の variant)。カード / Discord 風 / 専ブラ風 */
export type PostStyle = 'card' | 'discord' | 'classic' | 'line' | 'matome'
export const POST_STYLES: { key: PostStyle; name: string; note: string }[] = [
  { key: 'card', name: 'カード', note: 'レスを区切り線で並べる、いままでの見た目' },
  { key: 'discord', name: 'Discord 風', note: '丸い ID のアイコンと平らな並び。同じ人の連投をまとめ、返信元を上に出す' },
  { key: 'classic', name: '専ブラ風', note: '「12 ：名前：日付 ID」を 1 行にした、昔ながらの 2ch の見た目' },
  { key: 'line', name: 'LINE 風', note: '吹き出しで会話のように並べる。自分の書き込みは右に緑の吹き出し' },
  { key: 'matome', name: 'まとめ風', note: '返信の多いレスは字を大きく濃く、ほかは小さめに。レスの間の線はごく薄く' },
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
/** スレ一覧・アンカーツリーの見た目(レスの見た目のうち、一覧とツリーにない まとめ風は、カードにする) */
export function baseVariant(v: PostStyle): 'card' | 'discord' | 'classic' | 'line' {
  return v === 'matome' ? 'card' : v
}
/**
 * 実際に使う密度。PC もスマホも、レスの見た目で決める(2026-11 に「一覧表示・高密度」の設定はやめた)。
 * 吹き出し・アイコンで並べる Discord 風・LINE 風は一覧表示、カード・専ブラ風・まとめ風は高密度
 */
export function effectiveDensity(s: Pick<AppSettings, 'postStyle'>): ListDensity {
  const st = effectivePostStyle(s)
  return st === 'discord' || st === 'line' ? 'list' : 'dense'
}
/** web 版の 'panel'(カード表示)はサムネイル前提なので、専ブラでは一覧と高密度だけにする */
export type ListDensity = 'list' | 'dense'
/** custom は OS に入っているフォントから選んだもの(customFont に名前を持つ) */
/** フォント。同梱のもの(FONT_FAMILIES)・OS のもの(custom) */
export type FontFamily = (typeof FONT_FAMILY_KEYS)[number] | 'custom'
export const FONT_FAMILY_KEYS = [
  'noto',
  'biz-ud',
  'system',
  'm-plus-1p',
  'm-plus-2',
  'm-plus-rounded',
  'zen-kaku',
  'zen-maru',
  'ibm-plex',
  'murecho',
  'sawarabi',
  'kosugi-maru',
  'noto-serif',
  'biz-ud-mincho',
  'shippori-mincho',
  'zen-old-mincho',
] as const
export type ThreadSort = 'subject' | 'momentum' | 'newest' | 'count'
/** スレ一覧の上のタブ。unread・visited は絞り込み(押すとその条件のスレだけ)、ほかは並べ替え */
export type ListTabKey = 'unread' | 'visited' | 'momentum' | 'newest' | 'count' | 'viewed' | 'posted' | 'fav'
/** スレ一覧の絞り込み(タブのうち、並べ替えではないもの) */
export type ListFilter = 'unread' | 'visited' | 'posted' | 'fav'
export const LIST_FILTERS: ReadonlySet<ListTabKey> = new Set(['unread', 'visited', 'posted', 'fav'])
export const LIST_TABS: { key: ListTabKey; name: string; icon: string; note: string }[] = [
  { key: 'unread', name: '未読', icon: 'mark_email_unread', note: 'ログがあり、新着レスのあるスレだけを出す' },
  { key: 'visited', name: '閲覧済み', icon: 'history', note: '一度でも開いた(ログのある)スレだけを出す' },
  { key: 'momentum', name: '勢い順', icon: 'local_fire_department', note: '勢い(1 日あたりのレス数)の多い順に並べる' },
  { key: 'newest', name: '新しい順', icon: 'schedule', note: '立った時刻の新しい順に並べる' },
  { key: 'count', name: 'レス数順', icon: 'format_list_numbered', note: 'レス数の多い順に並べる' },
]
/** 「履歴」だけのタブ(設定のタブの並びには出さない): 見た順(最近見たものが上。押すたびに上下を入れ替える)・書き込んだ・お気に入り */
export const HISTORY_TABS: { key: ListTabKey; name: string; icon: string; note: string }[] = [
  { key: 'viewed', name: '見た順', icon: 'history', note: '最近見た順に並べる。もう一度押すと並べ直す(裏で新着を確かめている間は、並びを変えない)' },
  { key: 'posted', name: '書き込んだ', icon: 'edit_note', note: '自分の書き込み(本文と、どのスレに書いたか)を新しい順に出す' },
  { key: 'fav', name: 'お気に入り', icon: 'star', note: 'お気に入りのスレ(☆ を付けたスレ)だけを出す' },
]
/** 「履歴」の一覧のタブ(PC)。見た順・未読・書き込んだ・お気に入り(レス数順・新しい順は履歴には要らない) */
export const HISTORY_LIST_TABS: ListTabKey[] = ['viewed', 'unread', 'posted', 'fav']
/** タブの定義(板のタブと履歴のタブのどちらからも引ける) */
export const tabDefOf = (key: ListTabKey) => LIST_TABS.find((t) => t.key === key) ?? HISTORY_TABS.find((t) => t.key === key)!
export type OpenPosition = 'unread' | 'top' | 'bottom'
/** 人気のレス(返信 3 件から)の示し方: 左の帯・右の帯・本文の色(スマホのアプリの heatStyle と同じ。「示さない」は 2026-11 にやめた) */
export type HeatStyle = 'left' | 'right' | 'text'
/** ID の見せ方: なし / 色(2 回以上書いた ID を ID ごとの色に) / 模様(ID から作るアイコンを番号の左と、スレ一覧の立てた人に) */
export type IdStyle = 'none' | 'color' | 'icon'
export const ID_STYLES: { key: IdStyle; name: string; note: string }[] = [
  { key: 'none', name: 'なし', note: 'ID は文字だけ' },
  { key: 'color', name: '色', note: '2 回以上書いた ID を ID ごとの色で。同じ人の書き込みを目で追えます' },
  { key: 'icon', name: '模様', note: 'ID から作る GitHub 風の模様を、レス番号の左と、スレ一覧の立てた人(ID の付く掲示板)に出します' },
]
/** スレ一覧の行の形: ふつう・コンパクト(スレタイ 1 行と数だけ。スマホのアプリの listDensity と同じ) */
export type ListShape = 'normal' | 'compact'
export type AnchorPopup = 'hover' | 'click'
/** PC: レスのダブルクリックの操作 */
export type PostDoubleClick = 'none' | 'reply' | 'tree' | 'copy' | 'copyHeader' | 'id'
export const POST_DOUBLE_CLICKS: { key: PostDoubleClick; name: string }[] = [
  { key: 'none', name: 'なし' },
  { key: 'reply', name: '返信(書き込み欄に >>番号)' },
  { key: 'tree', name: 'アンカーツリー' },
  { key: 'copy', name: '本文をコピー' },
  { key: 'copyHeader', name: 'ヘッダ含めてコピー' },
  { key: 'id', name: 'その ID のレスを出す' },
]
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
  /** 名無しの名前を省くか。なければ全体の設定(レス表示の「名無しの名前を省く」)に合わせる */
  omitNoname?: boolean
  /** 板の既定の名前のほかに、名無しとみなす名前(「風吹けば名無し」など、名前を変えた名無し) */
  nonames?: string[]
}

/** 背景色を透かすパネルの変数(app.css)。どのパネルも同じ不透明度(panelOpacity)にする */
export const PANEL_ALPHA_VARS = ['--alpha-address-bar', '--alpha-sidebar', '--alpha-tabs', '--alpha-thread-list', '--alpha-thread-header', '--alpha-thread-view', '--alpha-reply-form']
/** パネルの不透明度の既定(背景画像があるとき) */
export const PANEL_OPACITY_DEFAULT = 0.8

/** 通知センターに溜める知らせ 1 件。押したときの行き先は link(関数は保存できないので) */
export interface StoredNotification {
  id: number
  /** 届いた時刻(ms) */
  at: number
  icon: string
  title: string
  body?: string
  read: boolean
  /** 押したら開くスレと、分かればそのレス */
  link?: { thread: ThreadSummary; no?: number }
}
/** 通知センターに溜める数 */
export const NOTIFICATION_LOG_MAX = 200

export interface AppSettings {
  // 表示
  scheme: ColorScheme
  /** OS のダーク・ライトに合わせてテーマを切り替える。そのときは scheme ではなく下の 2 つを使う */
  followOsTheme: boolean
  darkScheme: ColorScheme
  lightScheme: ColorScheme
  postStyle: PostStyle
  /** 文字の大きさ(px)。1px ずつ変えられる。スマホは mobileFontPx(画面が狭いので既定は小さい)。前の 5 段階(fontSize)は px に写した */
  fontPx: number
  /** PC: レスの本文・頭、スレ一覧の、決めていないときの大きさ(px)。基本の文字(fontPx)を変えても動かない */
  contentBasePx: number
  mobileFontPx: number
  /** スレ一覧の文字の大きさ(px)。0 なら画面全体の大きさのまま */
  listFontPx: number
  /** スレ表示のレスの本文・頭(名前・日付など)の文字の大きさ(px)。0 なら画面全体の大きさのまま */
  postBodyPx: number
  postHeadPx: number
  /** スレ一覧のスレの上下の余白・レスの上下の余白(px)。-1 なら見た目の既定のまま */
  listPadPx: number
  postPadPx: number
  /** スマホ: 知らせ(お気に入りの新着・キーワード・自分への返信)を、アプリを裏に回しているときは OS の通知でも出す */
  osNotify: boolean
  /** 通知センターに溜めた知らせ(あなた宛てのレス・お気に入りの新着など。新しいものが後ろ。NOTIFICATION_LOG_MAX まで) */
  notificationLog: StoredNotification[]
  /** スマホ: ヘッダー・フッターの高さ(px)と、中の文字の大きさ(px)。0 なら既定 */
  headerPx: number
  footerPx: number
  barFontPx: number
  /** レスの本文の行間(字の大きさの何倍か)。0 なら既定(1.625) */
  postLineHeight: number
  /** 画像・動画のサムネイル。always: いつも読む / wifi: Wi-Fi のときだけ / tap: 押したら読む(押して出るまではビューアーを開かない) / never: 出さない */
  thumbLoad: 'always' | 'wifi' | 'tap' | 'never'
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
  /** パネルの不透明度(0〜1)。背景画像があるときだけ効く(ないときは 1)。どのパネルも同じ値で、背景色だけを透かす */
  panelOpacity: number
  /** サイドバーをしまって、アイコンだけの細い帯にする */
  sidebarCollapsed: boolean
  replyLayout: ReplyLayout
  /** 書き込み欄の高さ(下に置くとき)と幅(右に置くとき) */
  replyHeight: number
  replyWidth: number
  // 起動
  /** 前回開いていた板(起動時に開く) */
  lastBoardUrl: string
  // スレ一覧
  threadSort: ThreadSort
  /** スレ一覧の上に出すタブと、その並び(左から) */
  listTabs: ListTabKey[]
  /** 履歴(閲覧履歴・未読・お気に入りのスレ)の 1 ページの件数(0 なら全部)。板のスレ一覧は分けない */
  listPageSize: number
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
  // タブ
  /** スレ一覧から開くとき、新しいタブで開く(false なら今のタブを置き換える) */
  /** PC: タブを使う。オフならタブの帯を出さず、いつも今のスレを置き換える */
  tabsEnabled: boolean
  openInNewTab: boolean
  openTabs: SavedTab[]
  /** 開いていたタブ(threadId) */
  activeTab: string
  // レス表示
  openPosition: OpenPosition
  anchorPopup: AnchorPopup
  /** スレ表示の画像のサムネイルの一辺(px) */
  postThumbSize: number
  /** スレ一覧のサムネイル(ふたばのカタログの絵など)の大きさの倍率。見た目ごとの元の大きさに掛ける */
  listThumbScale: number
  /** 「グロ」などの言葉を含む返信が付いた(または本人がそう書いた)レスの画像を、ぼかして出す */
  blurGross: boolean
  /** ぼかす目印にする言葉 */
  grossWords: string[]
  /** 画像でも動画でもないリンクに、埋め込みのカード(タイトル・説明・画像)を出す */
  showLinkPreview: boolean
  /** 掲示板でないリンク(ウェブページ・画像・動画)を、アプリの中で開く(リーダー表示。ReaderView)。スマホの既定 */
  openLinksInApp: boolean
  /** 名前が板の既定の名前(名無し)なら省く */
  omitNoname: boolean
  /** 空行を整える(3 行以上続く空行は 1 行にまとめ、本文の最後の空行は消す) */
  tidyBlankLines: boolean
  /** 本文の URL を短く見せる(https:// を外し、長いものは「…」で省く。画像の URL は「画像」の札にし、続いて並んだものは 1 つにまとめる) */
  urlShorten: boolean
  /** ID の見せ方(なし・色・模様) */
  idStyle: IdStyle
  /** >>1 と同じ ID のレスに「主」の印を付ける */
  highlightOp: boolean
  /** スレ表示の右端に、人気レス・自分のレス・画像の位置を示す縮図を出す */
  showMinimap: boolean
  /** スマホ: スレ表示のフッターの右端(送るボタンの右)に、更新ボタンを出す */
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
  /** お気に入りのスレの新着の数を確かめる間隔(分)。0 なら確かめない(スレ一覧だけ取るので軽い) */
  favCheckMin: number
  /** お気に入り板のスレ一覧を見に行き、キーワードに合うスレが立ったら知らせる間隔(分)。0 なら見に行かない */
  keywordWatchMin: number
  /** 板ごとの、キーワードのスレを最後に確かめた時刻(ms)。それより後に立ったスレを知らせる */
  keywordWatchSince: Record<string, number>
  // NG
  ngRules: NgRule[]
  /** aborn: 「あぼーん」と出す / hide: 何も出さない(透明あぼーん) */
  ngMode: NgMode
  /** 自動 NG(同じ本文の連投・繰り返しばかりの文を荒らしとして畳む。utils/autoNg.ts) */
  autoNg: boolean
  /** AI NG(本人が書いた条件に当たるレスを、端末の中の判定モデルで見つける。utils/aiNg.ts)。オンのときだけモデルを取って動かす */
  aiNgEnabled: boolean
  aiNgRules: AiNgRule[]
  /** 手で付けた「当たる・当たらない」(条件の id → 本文の鍵) */
  aiNgOverrides: Record<string, AiNgOverride>
  /**
   * スマホ: 画面ごとの、スワイプの向きの並び(「right」「right,up」)→ 操作。
   * 操作はキー操作と同じ名前(KeyAction)か、drawer(引き出しを開く)。空なら何もしない
   */
  swipeGestures: { list: Record<string, string>; thread: Record<string, string> }
  /** スマホ: スワイプの感度(1 = 鈍い 〜 5 = 敏感) */
  gestureSensitivity: number
  /** ID の位置(日時の後ろ・レスの右上・レスの右下) */
  idPosition: IdPosition
  /** ワッチョイを短く出す(「(ワッチョイ 1a2b-3c4d)」→「(1a2b-3c4d)」) */
  watchoiShort: boolean
  /** 名前欄(ワッチョイ込み)を日付・ID と同じ薄い色・大きさにする */
  nameSubtle: boolean
  /** アイコン(Discord 風・LINE 風・ID の見せ方「模様」)の種を、ワッチョイがあればワッチョイから作る(ID は日ごとに変わるが、ワッチョイは週ごと) */
  iconFromWatchoi: boolean
  /** 知らせの種類ごとのオン・オフ(ないものはオン) */
  notifyKinds: Partial<Record<NotifyKind, boolean>>
  /** 閲覧履歴(既読のスレ)の新着を、この分ごとに確かめる(0 ならしない。5 分より短くはしない) */
  historyCheckMin: number
  /** 更新(新しい版)を最後に確かめた時刻(ms)。1 日に 1 回だけ GitHub を見に行く */
  lastUpdateCheckAt: number
  /** PC: マウスジェスチャーを使う */
  mouseGestureEnabled: boolean
  /** PC: マウスジェスチャー(円盤)。8 方向(n・ne・e・se・s・sw・w・nw)→ 操作(キー操作と同じ名前か、マウスだけの操作 utils/gestures の MOUSE_ONLY_ACTIONS)。空なら何もしない */
  mouseGestures: Record<string, string>
  /** PC: マウスジェスチャーを、何を押しながら動かすか */
  mouseGestureTrigger: MouseGestureTrigger
  /** この日数より長く開いていないスレのログを、起動したときに消す(0 なら消さない)。お気に入り・自分が書いたスレ・開いているタブは残す */
  logRetentionDays: number
  /** 最後にログを整理した時刻(1 日に 1 回だけ整理する) */
  lastLogPruneAt: number
  /** 続けて並んだあぼーん(NG・自動 NG)を 1 行にまとめる */
  groupNg: boolean
  // 画像のアップロード(上げる前にいつも描き直して EXIF(撮影場所など)を取り除く)
  /** 上げる前に、長い辺がこれを超える画像を縮小する(px)。0 なら縮小しない */
  uploadMaxDimension: number
  /** catbox のアカウント(userhash)。あればアカウントで上げ、アップロード履歴からサーバー上のファイルも消せる */
  catboxUserhash: string
  /** 画像の上げ先(host/uploader.ts の UploadHost)。auto は catbox → 0x0.st → imgur → uguu.se の順に試す */
  uploadHost: UploadHost
  /** imgbb の API キー(上げ先が imgbb のとき) */
  imgbbApiKey: string
  /** imgur の Client-ID(https://api.imgur.com/oauth2/addclient で本人が登録したもの)。空なら imgur は使わない */
  imgurClientId: string
  /** 最初から入れておく掲示板・板(packages/presets/sites.json)のうち、もう足したものの id。本人が消したものを戻さないために覚える */
  presetsApplied: string[]
  /** 書き込むときにアカウント(BE など)を使うか。アカウントの id → 使うか。書いていなければ使う(登録してあれば) */
  postAccounts: Record<string, boolean>
  /** 書き込み欄をしまっておく(スレ表示が狭いときは、これに関係なく自動でしまう) */
  replyCollapsed: boolean
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
  /** ボタンの並び(画面ごとの操作 id の順。並べ替えたときだけ持つ)。スマホは PC と別 */
  barOrder: BarOrder
  mobileBarOrder: BarOrder
  /** 設定画面で、高度な設定も見せる(オフなら、よく使う項目だけ) */
  showAdvanced: boolean
  /** 差し色(ACCENTS のキー)。空ならテーマの色 */
  accent: string
  // ここからスマホのアプリ(bbs N)と同じ設定(名前と意味はアプリの data/Prefs.kt と同じ)
  /** 動きを減らす(画面の移り方・新着の光り方などを省く) */
  reduceMotion: boolean
  /** 人気のレスの示し方 */
  heatStyle: HeatStyle
  /** スレ一覧の行の形 */
  listShape: ListShape
  /** レスをダブルタップで返信(スマホ) */
  doubleTapReply: boolean
  /** PC: レスをダブルクリックしたときの操作(none なら何もしない。1 回の押しは今までどおりアンカーツリー) */
  postDoubleClick: PostDoubleClick
  /** 振動で知らせる(ジェスチャー・引っぱって更新が決まったとき、長押しのメニュー。スマホ) */
  haptics: boolean
  /** 自分の配色(地・面・字・強調・未読・自分の 6 色。CustomScheme の JSON)。空なら作っていない */
  customScheme: string
  /** レスの頭の日時の出し方(utils/displayDate.ts) */
  dateStyle: DateStyle
  /** レスの頭の ID を短く出す(先頭の 6 文字。「ID:」も省く) */
  idShort: boolean
  // 書き込み(最後に使った名前とメールを覚えておく)
  postName: string
  postMail: string
}

/** 知らせの種類(設定 → 通知 でオン・オフ。アイコンから決める) */
export type NotifyKind = 'reply' | 'fav' | 'keyword' | 'update'
export const NOTIFY_KINDS: { key: NotifyKind; name: string; note: string }[] = [
  { key: 'reply', name: 'あなた宛てのレス', note: '開いているスレで、自分の書き込みにアンカーが付いたとき' },
  { key: 'fav', name: 'お気に入りのスレの新着', note: 'お気に入りのスレに新しいレスが付いたとき(自動更新の間隔で確かめる)' },
  { key: 'keyword', name: 'キーワードに合うスレ', note: 'お気に入り板に、キーワードに合うスレが立ったとき' },
  { key: 'update', name: '新しい版', note: 'アプリの新しい版が出たとき(起動時に 1 日 1 回確かめる)' },
]
/** 知らせのアイコン → 種類(notify() が設定を見て止めるのに使う) */
export const NOTIFY_KIND_BY_ICON: Record<string, NotifyKind> = { alternate_email: 'reply', bookmark: 'fav', sell: 'keyword', system_update: 'update' }

/** ID の位置: 日時の後ろ(頭の中)/ レスの右上(頭の右端)/ レスの右下(本文の下の右端) */
export type IdPosition = 'header' | 'topRight' | 'bottomRight'
export const ID_POSITIONS: { key: IdPosition; name: string }[] = [
  { key: 'header', name: '日時の後ろ' },
  { key: 'topRight', name: 'レスの右上' },
  { key: 'bottomRight', name: 'レスの右下' },
]

/** PC: マウスジェスチャーを何を押しながら動かすか */
export type MouseGestureTrigger = 'ctrl' | 'right'
export const MOUSE_GESTURE_TRIGGERS: { key: MouseGestureTrigger; name: string }[] = [
  { key: 'ctrl', name: 'Ctrl を押しながら' },
  { key: 'right', name: '右ボタンを押しながら' },
]

export const DEFAULT_SETTINGS: AppSettings = {
  scheme: 'indigo',
  // 既定は OS のダーク・ライトに合わせる(2026-11-04 に本人の指示)
  followOsTheme: true,
  darkScheme: 'soft-dark',
  lightScheme: 'light-gray',
  postStyle: 'card',
  fontPx: 16,
  contentBasePx: 16,
  mobileFontPx: 14,
  listFontPx: 0,
  postBodyPx: 0,
  postHeadPx: 0,
  listPadPx: -1,
  postPadPx: -1,
  postLineHeight: 0,
  osNotify: true,
  notificationLog: [],
  headerPx: 0,
  footerPx: 0,
  barFontPx: 0,
  thumbLoad: 'always',
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
  panelOpacity: PANEL_OPACITY_DEFAULT,
  sidebarCollapsed: false,
  replyLayout: 'bottom',
  replyHeight: 170,
  replyWidth: 380,
  lastBoardUrl: 'https://bbs.eddibb.cc/liveedge/',
  threadSort: 'subject',
  listTabs: ['unread', 'momentum', 'newest'],
  listPageSize: 100,
  boardMeta: {},
  keywords: [],
  paneMode: 'auto',
  boardVisits: {},
  tabsEnabled: true,
  openInNewTab: true,
  openTabs: [],
  activeTab: '',
  openPosition: 'unread',
  anchorPopup: 'click',
  postThumbSize: 80,
  listThumbScale: 1,
  blurGross: true,
  grossWords: ['グロ'],
  showMinimap: true,
  showRefreshFab: true,
  hideBarsOnScroll: true,
  showLinkPreview: true,
  openLinksInApp: isMobile,
  omitNoname: true,
  tidyBlankLines: true,
  urlShorten: true,
  idStyle: 'none',
  highlightOp: true,
  imageSaveDir: '',
  autoRefreshSec: 0,
  autoScrollOnNew: true,
  favCheckMin: 5,
  keywordWatchMin: 10,
  keywordWatchSince: {},
  ngRules: [],
  ngMode: 'aborn',
  autoNg: true,
  aiNgEnabled: false,
  aiNgRules: AI_NG_SAMPLES.map((r, i) => ({ ...r, id: `sample-${i}` })),
  aiNgOverrides: {},
  // 元の Web アプリ(hono-bbs)のスマホ版に合わせた割り当て
  swipeGestures: {
    // →↑ は一番下へ・→↓ は先頭へ(引っぱる向きに動く。元の Web アプリと同じ)
    list: { right: 'drawer', left: 'forward', 'right,up': 'bottom', 'right,down': 'top', 'left,down': 'refresh', 'left,up': 'reply' },
    // スマホはタブを使わない(→ の「戻る」が閉じるのと同じ)ので、←↑ はログを削除して閉じる
    thread: { right: 'back', left: 'reply', 'right,up': 'bottom', 'right,down': 'top', 'left,down': 'refresh', 'left,up': 'deleteLog' },
  },
  gestureSensitivity: 3,
  // 上 先頭へ・下 一番下へ・右上 更新・左上 すべてのタブを閉じる・左下 設定を開く。ほかは空(本人の指示 2026-11-05)
  idPosition: 'topRight',
  watchoiShort: true,
  nameSubtle: true,
  iconFromWatchoi: true,
  notifyKinds: {},
  historyCheckMin: 0,
  lastUpdateCheckAt: 0,
  mouseGestures: { n: 'top', s: 'bottom', ne: 'refresh', nw: 'closeAllTabs', sw: 'settings' },
  mouseGestureEnabled: false,
  mouseGestureTrigger: 'ctrl',
  logRetentionDays: 90,
  lastLogPruneAt: 0,
  groupNg: true,
  uploadMaxDimension: 2560,
  catboxUserhash: '',
  uploadHost: DEFAULT_UPLOAD_HOST,
  imgbbApiKey: '',
  imgurClientId: '',
  presetsApplied: [],
  replyCollapsed: false,
  postAccounts: {},
  // 定型文は最初は空(2026-11-04 に本人の指示)
  quickPhrases: [],
  postToolbar: ['reply', 'copy', 'ng'],
  keymap: {},
  barLayout: {},
  mobileBarLayout: {},
  barOrder: {},
  mobileBarOrder: {},
  showAdvanced: false,
  accent: '',
  reduceMotion: false,
  heatStyle: 'left',
  listShape: 'normal',
  doubleTapReply: false,
  postDoubleClick: 'none',
  haptics: true,
  customScheme: '',
  // スマホは頭を短く(アプリと同じ。年と秒の下の桁を省く・ID は 6 文字)、PC は今までどおり
  dateStyle: isMobile ? 'md_w_hms' : 'full',
  idShort: isMobile,
  postName: '',
  postMail: '',
}

export const COLOR_SCHEMES: { key: ColorScheme; name: string; accent: string; border: string }[] = [
  { key: 'indigo', name: 'インディゴ', accent: '#7566e6', border: '#242933' },
  { key: 'amber-teal', name: 'アンバー×ティール', accent: '#e0993f', border: '#2a3247' },
  // 専ブラで足した、コントラストを抑えた配色(app.css)
  { key: 'soft-dark', name: 'ダーク', accent: '#8b93d9', border: '#343a44' },
  // レスの見た目のスタイル(Discord 風・LINE 風)と組み合わせる配色と、夜用の真っ黒
  { key: 'discord-dark', name: 'Discord ダーク', accent: '#5865f2', border: '#29292d' },
  { key: 'line-light', name: 'LINE ライト', accent: '#06c755', border: '#dfe2e7' },
  { key: 'oled', name: '真っ黒', accent: '#7aa2ff', border: '#222222' },
  // スマホのアプリ(ネイティブ版)で足した配色
  { key: 'gray', name: 'グレー', accent: '#dcdcdc', border: '#232323' },
  // 前のライト(soft-light)・紙・Discord ライト・2ch クラシック・夜間はやめた(2026-11)。ライトグレーをライトとする
  { key: 'light-gray', name: 'ライト', accent: '#4e5a68', border: '#d2d2d4' },
  { key: 'nord', name: 'Nord', accent: '#88c0d0', border: '#3b4252' },
  { key: 'contrast', name: 'ハイコントラスト', accent: '#ffd400', border: '#5c5c5c' },
  { key: 'line-dark', name: 'LINE ダーク', accent: '#06c755', border: '#323a45' },
  { key: 'x-dim', name: 'X(Twitter)ディム', accent: '#1d9bf0', border: '#38444d' },
  { key: 'mono', name: 'モノクロ', accent: '#e8e8e8', border: '#2e2e2e' },
]

/** 選べる配色 */
export const PICKABLE_SCHEMES = COLOR_SCHEMES

/**
 * 顔文字用の予備フォント(app.css)。日本語フォントで描けない「文字 + 重ねる記号」の組(･᷄ など)を描く。
 * どのフォントでも、日本語フォントのすぐ後ろ(sans-serif の前)に置く
 */
const KAOMOJI_FALLBACK = "'BBS Kaomoji Fallback'"

/** 同梱のフォント(main.tsx で読み込む)。ゴシック → 丸ゴシック → 明朝 の順。名前は見本に使う(設定のドロップダウンはそのフォントで描く) */
export const FONT_FAMILIES: { key: Exclude<FontFamily, 'custom'>; name: string; css: string }[] = [
  { key: 'noto', name: 'Noto Sans JP', css: `'Noto Sans JP Variable', 'Noto Sans JP', ${KAOMOJI_FALLBACK}, sans-serif` },
  { key: 'biz-ud', name: 'BIZ UDPゴシック', css: `'BIZ UDPGothic', ${KAOMOJI_FALLBACK}, sans-serif` },
  // Windows に入っている BIZ UDPゴシックは画面表示向けの調整(ヒンティング)が効いていて、小さい字もガタつきにくい
  {
    key: 'system',
    name: 'Windows 標準(BIZ UDPゴシック)',
    css: `'BIZ UDPGothic', 'Yu Gothic UI', 'Meiryo UI', 'Noto Sans CJK JP', ${KAOMOJI_FALLBACK}, sans-serif`,
  },
  { key: 'm-plus-1p', name: 'M PLUS 1p', css: `'M PLUS 1p', ${KAOMOJI_FALLBACK}, sans-serif` },
  { key: 'm-plus-2', name: 'M PLUS 2', css: `'M PLUS 2 Variable', ${KAOMOJI_FALLBACK}, sans-serif` },
  { key: 'zen-kaku', name: 'Zen Kaku Gothic New', css: `'Zen Kaku Gothic New', ${KAOMOJI_FALLBACK}, sans-serif` },
  { key: 'ibm-plex', name: 'IBM Plex Sans JP', css: `'IBM Plex Sans JP', ${KAOMOJI_FALLBACK}, sans-serif` },
  { key: 'murecho', name: 'Murecho', css: `'Murecho Variable', ${KAOMOJI_FALLBACK}, sans-serif` },
  { key: 'sawarabi', name: 'さわらびゴシック', css: `'Sawarabi Gothic', ${KAOMOJI_FALLBACK}, sans-serif` },
  { key: 'm-plus-rounded', name: 'M PLUS Rounded 1c(丸ゴシック)', css: `'M PLUS Rounded 1c', ${KAOMOJI_FALLBACK}, sans-serif` },
  { key: 'zen-maru', name: 'Zen Maru Gothic(丸ゴシック)', css: `'Zen Maru Gothic', ${KAOMOJI_FALLBACK}, sans-serif` },
  { key: 'kosugi-maru', name: 'Kosugi Maru(丸ゴシック)', css: `'Kosugi Maru', ${KAOMOJI_FALLBACK}, sans-serif` },
  { key: 'noto-serif', name: 'Noto Serif JP(明朝)', css: `'Noto Serif JP Variable', 'Noto Serif JP', ${KAOMOJI_FALLBACK}, serif` },
  { key: 'biz-ud-mincho', name: 'BIZ UDP明朝', css: `'BIZ UDPMincho', ${KAOMOJI_FALLBACK}, serif` },
  { key: 'shippori-mincho', name: 'しっぽり明朝', css: `'Shippori Mincho', ${KAOMOJI_FALLBACK}, serif` },
  { key: 'zen-old-mincho', name: 'Zen Old Mincho(明朝)', css: `'Zen Old Mincho', ${KAOMOJI_FALLBACK}, serif` },
]

const DARK_SCHEMES = new Set<ColorScheme>(['indigo', 'amber-teal', 'soft-dark', 'discord-dark', 'oled', 'gray', 'nord', 'contrast', 'night', 'line-dark', 'x-dim', 'mono'])

/** 文字の大きさ(px)の設定の名前(スマホは PC と別に持つ)。文字の大きさを変える所は、どこもこれを使う */
export const FONT_PX_KEY = isMobile ? 'mobileFontPx' : 'fontPx'
/** 選べる文字の大きさ(px) */
export const FONT_PX_MIN = 9
export const FONT_PX_MAX = 26
/**
 * レスの本文・頭、スレ一覧の、決めていないときの大きさ(px)。PC は基本の文字から切り離す(基本の文字はメニュー・ボタン・ポップアップなどの部品だけ)。
 * スマホは今までどおり基本の文字に合わせる
 */
export function contentFontPx(s: AppSettings): number {
  return isMobile ? baseFontPx(s) : s.contentBasePx || DEFAULT_SETTINGS.contentBasePx
}
/** いまの画面全体の文字の大きさ(px) */
export function baseFontPx(s: AppSettings): number {
  return s[FONT_PX_KEY] || DEFAULT_SETTINGS[FONT_PX_KEY]
}

/**
 * 差し色(スマホのアプリ・hono-bbs の web と同じ 8 色)。明るい配色と暗い配色で濃さを変える(どちらの地でも押せる所の字として読めるように)
 */
export const ACCENTS: { key: string; name: string; light: string; dark: string }[] = [
  { key: 'indigo', name: '藍', light: '#4757c9', dark: '#8f9bf5' },
  { key: 'blue', name: '青', light: '#1f6fd1', dark: '#6aa9f0' },
  { key: 'teal', name: '青緑', light: '#0e8a7e', dark: '#4fcdbe' },
  { key: 'green', name: '緑', light: '#2e8b3e', dark: '#6ccb7a' },
  { key: 'orange', name: '橙', light: '#c8641a', dark: '#f29a55' },
  { key: 'red', name: '朱', light: '#c9423a', dark: '#f07b72' },
  { key: 'pink', name: '桃', light: '#c23f7e', dark: '#f08dba' },
  { key: 'purple', name: '紫', light: '#7e4fc4', dark: '#b792f2' },
]

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(((n >> 16) & 255) / 255) + 0.7152 * f(((n >> 8) & 255) / 255) + 0.0722 * f((n & 255) / 255)
}

/** 差し色を <html> に入れる(選んでいなければテーマの色に戻す)。塗った上の字は、白と黒のうち差の大きいほう */
function applyAccent(key: string, dark: boolean) {
  const root = document.documentElement
  const a = ACCENTS.find((x) => x.key === key)
  const props = ['--c-accent', '--c-accent-hover', '--c-accent-text', '--c-accent-wash']
  if (!a) {
    for (const p of props) root.style.removeProperty(p)
    return
  }
  const c = dark ? a.dark : a.light
  const l = luminance(c)
  const text = (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#111111' : '#ffffff'
  root.style.setProperty('--c-accent', c)
  root.style.setProperty('--c-accent-hover', `color-mix(in srgb, ${c} 85%, ${dark ? '#ffffff' : '#000000'})`)
  root.style.setProperty('--c-accent-text', text)
  root.style.setProperty('--c-accent-wash', `color-mix(in srgb, ${c} ${dark ? 18 : 12}%, transparent)`)
}

/** 暗い配色か(OS のダーク・ライトに合わせるとき、どちら用かを見分ける) */
export function isDarkScheme(scheme: ColorScheme): boolean {
  return scheme === 'custom' ? customDark : DARK_SCHEMES.has(scheme)
}
/** 自分の配色が暗いか(地の明るさで決まる。apply で入れる) */
let customDark = false
/** 自分の配色で、<html> に直に入れた CSS 変数(配色を変えたら外す) */
let customApplied: string[] = []

/** OS がダークモードか */
const osDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

/** いま使うテーマ。OS に合わせるなら、OS のダーク・ライトで選んでおいた方 */
export function effectiveScheme(s: AppSettings): ColorScheme {
  if (!s.followOsTheme) return withoutOldLight(s.scheme)
  return osDark() ? withoutOldLight(s.darkScheme) : withoutOldLight(s.lightScheme)
}

/**
 * やめた配色を選んでいた人(設定の読み込みや、古い設定ファイル)は、いちばん近い配色にする。
 * 明るいもの(web 版のライト・前のライト・紙・Discord ライト・2ch クラシック)はライト(ライトグレー)、夜間(暖色)はダーク
 */
function withoutOldLight(scheme: ColorScheme): ColorScheme {
  if (scheme === 'light' || scheme === 'soft-light' || scheme === 'sepia' || scheme === 'discord-light' || scheme === '2ch-classic') return 'light-gray'
  if (scheme === 'night') return 'soft-dark'
  return scheme
}

/**
 * 2026-11-04 に消した・まとめた設定を、いまの設定に写す(保存してある古い値は、読んだあと使わない。DB の行は残っても害がない)。
 * 消したもの(起動時に開く板・ホイールで更新・タブを使う・AA の自動判定・一番下まで送る・知らせる 2 つ・アップロードを使う・EXIF を消す・
 * 書き込んだあとに待つ・畳んだサイドバーの板名・送る前に待つ・定型文のバー・タブの見せ方)は、いつもオンかサーバー任せ
 */
function migrateOld(saved: Record<string, unknown>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  // 文字の大きさ: 5 段階(fontSize・mobileFontSize)は px に写す(px を決めていなければ)
  const steps: { from: string; to: 'fontPx' | 'mobileFontPx'; px: number[] }[] = [
    { from: 'fontSize', to: 'fontPx', px: [13, 14, 16, 18, 20] },
    { from: 'mobileFontSize', to: 'mobileFontPx', px: [12, 13, 14, 16, 18] },
  ]
  for (const { from, to, px } of steps) {
    const n = saved[from]
    if (!saved[to] && typeof n === 'number' && px[n - 1]) out[to] = px[n - 1]
  }
  // サムネイルを出さない → 読み込まない
  if (saved.showThumbnails === false) out.thumbLoad = 'never'
  // 空行の整え方 2 つ → 1 つ(どちらかがオンならオン)
  if (saved.tidyBlankLines === undefined && (saved.collapseBlankLines !== undefined || saved.trimTrailingBlank !== undefined)) {
    out.tidyBlankLines = !!(saved.collapseBlankLines || saved.trimTrailingBlank)
  }
  // ID の見せ方 4 つ(色・赤く・模様・立てた人の模様)→ 1 つ
  if (saved.idStyle === undefined) {
    if (saved.showIdenticon || saved.threadAuthorIcon) out.idStyle = 'icon'
    else if (saved.idColor || saved.idHeat) out.idStyle = 'color'
  }
  // 人気のレス「示さない」はやめた
  if (saved.heatStyle === 'none') out.heatStyle = 'left'
  return out
}

/**
 * マウスジェスチャーは、向きの並び(left・right,up など)から 8 方向の円盤(n・e・…)に変えた(2026-11-05)。
 * 1 つの向きだけの割り当ては同じ方向に移し、折れ曲がる並びは捨てる。円盤の形の割り当てはそのまま
 */
function migrateMouseGestures(g: Record<string, string> | undefined): Record<string, string> {
  if (!g) return DEFAULT_SETTINGS.mouseGestures
  const dirs = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'])
  if (Object.keys(g).every((k) => dirs.has(k))) return g
  const old: Record<string, string> = { up: 'n', down: 's', left: 'w', right: 'e' }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(g)) if (old[k] && v) out[old[k]] = v
  return Object.keys(out).length > 0 ? out : DEFAULT_SETTINGS.mouseGestures
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

/**
 * 表示スタイルのメニューで配色を選んだとき。選んだ配色がすぐ見えるようにする:
 * OS に合わせていて、いまの OS と明るさの違う配色を選んだら(OS がダークのときに LINE ライトなど)、合わせるのをやめてその配色にする
 */
export function pickSchemeNow(s: AppSettings, key: ColorScheme): Partial<AppSettings> {
  if (s.followOsTheme && isDarkScheme(key) !== osDark()) return { followOsTheme: false, scheme: key }
  return pickScheme(s, key)
}

function apply(s: AppSettings, o: { font?: boolean } = {}) {
  const root = document.documentElement
  // 自分の配色を選んでいても、作っていなければ(読めなければ)ダークにしておく
  const custom = parseCustom(s.customScheme)
  if (custom) customDark = isCustomDark(custom)
  const want = effectiveScheme(s)
  const scheme: ColorScheme = want === 'custom' && !custom ? 'soft-dark' : want
  root.setAttribute('data-scheme', scheme)
  root.classList.toggle('dark', isDarkScheme(scheme))
  applyAccent(s.accent, isDarkScheme(scheme))
  // 自分の配色: 6 色から作った色を <html> に直に入れる(テーマの CSS のどの指定よりも強い)。差し色を選んでいれば、強調の色はそちら
  for (const n of customApplied) root.style.removeProperty(n)
  customApplied = []
  if (scheme === 'custom' && custom) {
    const vars: Record<string, string> = customVars(custom)
    if (effectivePostStyle(s) === 'line') vars['--c-thread-view-bg'] = customLineBg(custom)
    for (const [n, v] of Object.entries(vars)) {
      if (s.accent && n.startsWith('--c-accent') && !n.startsWith('--c-accent-self')) continue
      root.style.setProperty(n, v)
      customApplied.push(n)
    }
  }
  // カード・Discord 風はトーナル(面の濃淡)、専ブラ風は枠線(色の面なし)の部品の見た目にする
  root.setAttribute('data-pattern', effectivePostStyle(s) === 'classic' ? 'bordered' : 'tonal')
  root.setAttribute('data-post-style', effectivePostStyle(s))
  root.setAttribute('data-density', effectiveDensity(s))
  root.toggleAttribute('data-reduce-motion', s.reduceMotion)
  setHaptics(s.haptics)
  const base = baseFontPx(s)
  // 道具のウィンドウ(設定・NG)では、字の大きさは変えない(設定画面の字まで変わると、つまみの位置がずれて使いにくい)
  if (o.font !== false) root.style.fontSize = `${base}px`
  // スレ一覧・レスの本文・レスの頭の大きさ(px)。一覧と頭は中の字の大きさの比を保ったまま拡大・縮小する(zoom)。
  // 本文は字の大きさそのもの(サムネイルなどは大きさを変えない)
  const content = contentFontPx(s)
  root.style.setProperty('--list-zoom', String((s.listFontPx || content) / base))
  // スレ一覧の画像・アイコン(px で大きさを決めるもの)は、基本の文字の分を打ち消す
  root.style.setProperty('--list-unzoom', isMobile ? '1' : String(base / 16))
  root.style.setProperty('--post-head-zoom', String((s.postHeadPx || content) / base))
  root.style.setProperty('--post-body-size', `${s.postBodyPx || content}px`)
  // スライダーの窓は、基本の文字を変えても大きさを変えない(打ち消す)
  root.style.setProperty('--dialog-zoom', isMobile ? '1' : String(16 / base))
  // ヘッダー・フッターの高さと文字(スマホ。文字は中身を比のまま拡大・縮小し、高さは拡大の分で割り戻して決めた高さに保つ)
  if (s.headerPx) root.style.setProperty('--header-height', `${s.headerPx}px`)
  else root.style.removeProperty('--header-height')
  if (s.footerPx) root.style.setProperty('--footer-bar-h', `${s.footerPx}px`)
  else root.style.removeProperty('--footer-bar-h')
  root.style.setProperty('--bar-zoom', s.barFontPx ? String(s.barFontPx / base) : '1')
  if (s.postLineHeight) root.style.setProperty('--post-line-height', String(s.postLineHeight))
  else root.style.removeProperty('--post-line-height')
  // 余白(px)。決めていなければ、見た目・密度の既定のまま
  if (s.postPadPx >= 0) root.style.setProperty('--post-padding-y', `${s.postPadPx}px`)
  else root.style.removeProperty('--post-padding-y')
  if (s.listPadPx >= 0) {
    root.style.setProperty('--list-row-pad', `${s.listPadPx / 16}rem`)
    root.setAttribute('data-list-pad', '')
  } else {
    root.style.removeProperty('--list-row-pad')
    root.removeAttribute('data-list-pad')
  }
  const preset = FONT_FAMILIES.find((f) => f.key === s.fontFamily) ?? FONT_FAMILIES[0]
  // 同梱をやめた Web フォントは、選んだときだけ取りに行く(host/fonts.ts)
  if (s.fontFamily !== 'custom') ensureFont(preset.key)
  // OS のフォントが見つからなかったときのために、同梱の Noto Sans JP を後ろに置く
  const css =
    s.fontFamily === 'custom' && s.customFont
      ? `'${s.customFont.replace(/'/g, "\\'")}', ${FONT_FAMILIES[0].css}`
      : preset.css
  root.style.setProperty('--app-font', css)
  // 背景画像がないときは透かさない(透かしても後ろは地の色なので、薄く見えるだけ)
  const alpha = s.backgroundImage ? s.panelOpacity : 1
  for (const v of PANEL_ALPHA_VARS) root.style.setProperty(v, String(alpha))
  root.style.setProperty('--bg-image-opacity', String(s.backgroundOpacity))
  root.style.setProperty('--post-thumb-size', `${s.postThumbSize}px`)
  root.style.setProperty('--list-thumb-scale', String(s.listThumbScale))
}

/** 画面全体の文字の大きさを表す、applyCssVar の名前(変数ではなく <html> の font-size) */
export const ROOT_FONT_SIZE = 'font-size'

/** この画面(ウィンドウ)の変数(CSS)を書き換える(スライダーを動かしている間の見た目。data-* は属性) */
export function applyCssVar(name: string, value: string) {
  const root = document.documentElement
  if (name === ROOT_FONT_SIZE) root.style.fontSize = value
  else if (name.startsWith('data-')) root.setAttribute(name, value)
  else root.style.setProperty(name, value)
}

export type PaneMode = 'split' | 'single' | 'auto'

export type UpdateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void

/** 設定を変えてから DB に書くまで待つ時間 */
const SAVE_DELAY_MS = 400

/** 設定を読み込み、変更を即座に画面へ反映して保存する。loaded は保存済みの値を読み終えたか */
/**
 * opts.font: false なら、字の大きさは画面に当てない(道具のウィンドウ)。
 * 設定の変更は settings-changed でほかのウィンドウへ知らせ、ほかのウィンドウからの変更は受けて写す(DB に書くのは変えたウィンドウだけ)
 */
export function useSettings(store: LogStore | undefined, opts: { font?: boolean } = {}): [AppSettings, UpdateSetting, boolean] {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!store) return
    void store.getSettings().then((saved) => {
      setSettings((s) => {
        // いまある項目だけを写し、消した項目は migrateOld で写す
        const known = Object.fromEntries(Object.entries(saved as Record<string, unknown>).filter(([k]) => k in DEFAULT_SETTINGS)) as Partial<AppSettings>
        // 基本の文字を本文から切り離す前に大きさを変えていた人は、見えていた大きさを本文の既定として引き継ぐ(1 回だけ。保存する)
        if (!('contentBasePx' in saved) && typeof known.fontPx === 'number' && known.fontPx !== DEFAULT_SETTINGS.fontPx) {
          known.contentBasePx = known.fontPx
          void store.setSetting('contentBasePx', known.fontPx)
        }
        const next = { ...s, ...known, ...migrateOld(saved as Record<string, unknown>) }
        // レスの見た目「タイムライン(X 風)」はやめた(2026-11)。選んでいた人は、いちばん近い Discord 風に
        const postStyle: PostStyle = (next.postStyle as string) === 'timeline' ? 'discord' : next.postStyle
        return { ...next, postStyle, uploadHost: migrateUploadHost(next.uploadHost as string), scheme: withoutOldLight(next.scheme), lightScheme: withoutOldLight(next.lightScheme), darkScheme: withoutOldLight(next.darkScheme), swipeGestures: withoutOldGestures(next.swipeGestures), mouseGestures: migrateMouseGestures(next.mouseGestures) }
      })
      setLoaded(true)
    })
  }, [store])

  useEffect(() => {
    apply(settings, opts)
    // opts は固定
  }, [settings])
  // ほかのウィンドウで変えた設定を写す
  useEffect(() => {
    const off = onBroadcast<{ key: keyof AppSettings; value: unknown }>('settings-changed', ({ key, value }) =>
      setSettings((s) => ({ ...s, [key]: value as AppSettings[typeof key] })),
    )
    return () => void off.then((f) => f())
  }, [])
  // 設定のウィンドウでスライダーを動かしている間の見た目(css-preview)を、メインの画面に映す(決めたら settings-changed で来る)
  useEffect(() => {
    if (opts.font === false) return
    const off = onBroadcast<{ name: string; value: string }>('css-preview', ({ name, value }) => applyCssVar(name, value))
    return () => void off.then((f) => f())
    // opts は固定
  }, [])
  // OS のダーク・ライトが切り替わったら、合わせて塗り直す
  useEffect(() => {
    if (!settings.followOsTheme) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply(settings, opts)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [settings])

  // DB への保存は少し待ってまとめる(スライダーを動かすたび・1 文字打つたびに書かない)。同じ項目は最後の値だけ書く
  const pendingWrites = useRef(new Map<keyof AppSettings, unknown>())
  const writeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const flush = useCallback(() => {
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = undefined
    if (!store || pendingWrites.current.size === 0) return
    const writes = [...pendingWrites.current.entries()]
    pendingWrites.current.clear()
    for (const [key, value] of writes) void store.setSetting(key, value as AppSettings[typeof key]).catch(backgroundError('設定の保存'))
  }, [store])
  // 閉じるとき・裏に回ったときは、待っているぶんを書いてしまう
  useEffect(() => {
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
      flush()
    }
  }, [flush])
  const update = useCallback<UpdateSetting>(
    (key, value) => {
      setSettings((s) => ({ ...s, [key]: value }))
      void broadcast('settings-changed', { key, value })
      pendingWrites.current.set(key, value)
      if (!writeTimer.current) writeTimer.current = setTimeout(flush, SAVE_DELAY_MS)
    },
    [flush],
  )

  return [settings, update, loaded]
}
