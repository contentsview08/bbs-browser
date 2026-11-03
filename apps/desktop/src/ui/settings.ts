// アプリの設定。SQLite の settings 表に 1 項目 1 行(JSON)で保存する。
import { AI_NG_SAMPLES, type AiNgOverride, type AiNgRule } from '../utils/aiNg'
import { setHaptics } from '../utils/haptics'
import { customLineBg, customVars, isCustomDark, parseCustom } from './customScheme'
import type { DateStyle } from '../utils/displayDate'
// 見た目の設定は <html> の data-scheme / data-pattern / data-density 属性と .dark クラスに反映し、
// 実際の色や余白は theme/theme.css・theme/patterns.css(web 版の複製)が CSS 変数で切り替える。

import { isMobile } from '../utils/platform'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogStore } from '@bbs-browser/logstore'
import type { NgRule } from '../utils/ng'
import type { Keymap } from '../utils/keymap'
import { backgroundError } from '../utils/backgroundError'
import type { BarLayout, BarOrder } from '../utils/toolbar'
import { DEFAULT_UPLOAD_HOST, migrateUploadHost, type UploadHost } from '../host/uploader'

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
export type FontSize = 1 | 2 | 3 | 4 | 5
/** custom は OS に入っているフォントから選んだもの(customFont に名前を持つ) */
export type FontFamily = 'noto' | 'biz-ud' | 'system' | 'custom'
export type ThreadSort = 'subject' | 'momentum' | 'newest' | 'count'
/** スレ一覧の上のタブ。unread・visited は絞り込み(押すとその条件のスレだけ)、ほかは並べ替え */
export type ListTabKey = 'unread' | 'visited' | 'momentum' | 'newest' | 'count' | 'viewed'
export const LIST_TABS: { key: ListTabKey; name: string; icon: string; note: string }[] = [
  { key: 'unread', name: '未読', icon: 'mark_email_unread', note: 'ログがあり、新着レスのあるスレだけを出す' },
  { key: 'visited', name: '閲覧済み', icon: 'history', note: '一度でも開いた(ログのある)スレだけを出す' },
  { key: 'momentum', name: '勢い順', icon: 'local_fire_department', note: '勢い(1 日あたりのレス数)の多い順に並べる' },
  { key: 'newest', name: '新しい順', icon: 'schedule', note: '立った時刻の新しい順に並べる' },
  { key: 'count', name: 'レス数順', icon: 'format_list_numbered', note: 'レス数の多い順に並べる' },
]
/** 閲覧履歴だけのタブ: 見た順(最近見たものが上。押すたびに上下を入れ替える)。設定のタブの並びには出さない */
export const VIEWED_TAB = { key: 'viewed' as const, name: '見た順', icon: 'history', note: '最近見た順に並べる。押すたびに、最近見たものが上か下かを入れ替える' }
export type OpenPosition = 'unread' | 'top' | 'bottom'
/** 人気のレス(返信 3 件から)の示し方: 左の帯・右の帯・本文の色・示さない(スマホのアプリの heatStyle と同じ) */
export type HeatStyle = 'left' | 'right' | 'text' | 'none'
/** スレ一覧の行の形: ふつう・コンパクト(スレタイ 1 行と数だけ。スマホのアプリの listDensity と同じ) */
export type ListShape = 'normal' | 'compact'
/** タブの見せ方: both はアイコンと文字、icon はアイコンだけ、text は文字だけ */
export type TabLabel = 'both' | 'icon' | 'text'
export const TAB_LABELS: { key: TabLabel; name: string }[] = [
  { key: 'both', name: 'アイコンと文字' },
  { key: 'icon', name: 'アイコンだけ' },
  { key: 'text', name: '文字だけ' },
]
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
  /** 名無しの名前を省くか。なければ全体の設定(レス表示の「名無しの名前を省く」)に合わせる */
  omitNoname?: boolean
  /** 板の既定の名前のほかに、名無しとみなす名前(「風吹けば名無し」など、名前を変えた名無し) */
  nonames?: string[]
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
  /** 文字の大きさ(px)。1px ずつ変えられる。0 なら上の段階(fontSize・mobileFontSize)で決める。スマホは mobileFontPx */
  fontPx: number
  mobileFontPx: number
  /** スレ一覧の文字の大きさ(px)。0 なら画面全体の大きさのまま */
  listFontPx: number
  /** スレ表示のレスの本文・頭(名前・日付など)の文字の大きさ(px)。0 なら画面全体の大きさのまま */
  postBodyPx: number
  postHeadPx: number
  /** スレ一覧のスレの上下の余白・レスの上下の余白(px)。-1 なら見た目の既定のまま */
  listPadPx: number
  postPadPx: number
  /** タブの見せ方(アイコンと文字・アイコンだけ・文字だけ)。スレ一覧のタブ(未読・勢い順など)と、スレ表示の絞り込み(人気・画像など) */
  listTabLabel: TabLabel
  filterTabLabel: TabLabel
  /** スマホ: 知らせ(お気に入りの新着・キーワード・自分への返信)を、アプリを裏に回しているときは OS の通知でも出す */
  osNotify: boolean
  /** スマホ: ヘッダー・フッターの高さ(px)と、中の文字の大きさ(px)。0 なら既定 */
  headerPx: number
  footerPx: number
  barFontPx: number
  /** レスの本文の行間(字の大きさの何倍か)。0 なら既定(1.625) */
  postLineHeight: number
  /** 画像・動画のサムネイルを読みに行くか。always: いつも / wifi: Wi-Fi のときだけ / tap: 押したら読む(押して出るまではビューアーを開かない) */
  thumbLoad: 'always' | 'wifi' | 'tap'
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
  /** スレ一覧の 1 ページの件数(0 なら全部)。多い板では分けたほうが軽い */
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
  /** 本文の URL を短く見せる(https:// を外し、長いものは「…」で省く) */
  urlShorten: boolean
  /** 本文の画像の URL は「画像」の札にする */
  imageUrlOmit: boolean
  /** 続いて並んだ画像の URL を 1 つにまとめる */
  imageUrlCollapse: boolean
  /** 同じ ID の書き込みが多いほど、ID を赤くする */
  idHeat: boolean
  /** スレ一覧で、立てた人の ID(エッジ)を模様で出す。切っているときは、カードの右下に ID を小さく出す */
  threadAuthorIcon: boolean
  /** >>1 と同じ ID のレスに「主」の印を付ける */
  highlightOp: boolean
  /** レスの番号の左に、ID から作るアイコン(GitHub 風の Identicon)を出す */
  showIdenticon: boolean
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
  /** この日数より長く開いていないスレのログを、起動したときに消す(0 なら消さない)。お気に入り・自分が書いたスレ・開いているタブは残す */
  logRetentionDays: number
  /** 最後にログを整理した時刻(1 日に 1 回だけ整理する) */
  lastLogPruneAt: number
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
  /** 2 回以上書いた ID を、ID ごとの色にする */
  idColor: boolean
  /** スレ一覧の行の形 */
  listShape: ListShape
  /** 書いている間、本文の欄の上に定型文のバーを出す(押すとカーソルの所に入る) */
  phraseBar: boolean
  /** 送る前に 3 秒待つ(その間は取り消せる) */
  sendDelay: boolean
  /** レスをダブルタップで返信(スマホ) */
  doubleTapReply: boolean
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

export const DEFAULT_SETTINGS: AppSettings = {
  scheme: 'indigo',
  followOsTheme: false,
  darkScheme: 'soft-dark',
  lightScheme: 'light-gray',
  pattern: 'tonal',
  postStyle: 'card',
  density: 'dense',
  fontSize: 3,
  mobileFontSize: 3,
  fontPx: 0,
  mobileFontPx: 0,
  listFontPx: 0,
  postBodyPx: 0,
  postHeadPx: 0,
  listPadPx: -1,
  postPadPx: -1,
  postLineHeight: 0,
  osNotify: true,
  headerPx: 0,
  footerPx: 0,
  barFontPx: 0,
  listTabLabel: 'both',
  filterTabLabel: 'both',
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
  listPageSize: 100,
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
  urlShorten: true,
  imageUrlOmit: true,
  imageUrlCollapse: true,
  idHeat: false,
  threadAuthorIcon: false,
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
  logRetentionDays: 90,
  lastLogPruneAt: 0,
  groupNg: true,
  uploaderEnabled: true,
  uploadStripMetadata: true,
  uploadMaxDimension: 2560,
  catboxUserhash: '',
  uploadHost: DEFAULT_UPLOAD_HOST,
  imgbbApiKey: '',
  imgurClientId: '',
  presetsApplied: [],
  postCooldownSec: 10,
  replyCollapsed: false,
  postAccounts: {},
  quickPhrases: ['草'],
  postToolbar: ['reply', 'phrase:草', 'copy', 'ng'],
  keymap: {},
  barLayout: {},
  mobileBarLayout: {},
  barOrder: {},
  mobileBarOrder: {},
  showAdvanced: false,
  accent: '',
  reduceMotion: false,
  heatStyle: 'left',
  idColor: false,
  listShape: 'normal',
  phraseBar: false,
  sendDelay: false,
  doubleTapReply: false,
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

const DARK_SCHEMES = new Set<ColorScheme>(['indigo', 'amber-teal', 'soft-dark', 'discord-dark', 'oled', 'gray', 'nord', 'contrast', 'night', 'line-dark', 'x-dim', 'mono'])

/** 文字の大きさ(px)。極小・小・標準・大・特大。スマホは画面が小さいので 1 段ずつ小さくし、PC の「小」をスマホの「標準」にする */
const FONT_SIZES = isMobile ? [12, 13, 14, 16, 18] : [13, 14, 16, 18, 20]
/** 文字の大きさの設定の名前(スマホは PC と別に持つ)。文字の大きさを変える所は、どこもこれを使う */
export const FONT_SIZE_KEY = isMobile ? 'mobileFontSize' : 'fontSize'
/** 文字の大きさ(px)の設定の名前(スマホは PC と別に持つ) */
export const FONT_PX_KEY = isMobile ? 'mobileFontPx' : 'fontPx'
/** 選べる文字の大きさ(px) */
export const FONT_PX_MIN = 9
export const FONT_PX_MAX = 26
/** いまの画面全体の文字の大きさ(px) */
export function baseFontPx(s: AppSettings): number {
  return s[FONT_PX_KEY] || FONT_SIZES[s[FONT_SIZE_KEY] - 1]
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

function apply(s: AppSettings) {
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
  root.style.fontSize = `${base}px`
  // スレ一覧・レスの本文・レスの頭の大きさ(px)。一覧と頭は中の字の大きさの比を保ったまま拡大・縮小する(zoom)。
  // 本文は字の大きさそのもの(サムネイルなどは大きさを変えない)
  root.style.setProperty('--list-zoom', s.listFontPx ? String(s.listFontPx / base) : '1')
  root.style.setProperty('--post-head-zoom', s.postHeadPx ? String(s.postHeadPx / base) : '1')
  if (s.postBodyPx) root.style.setProperty('--post-body-size', `${s.postBodyPx}px`)
  else root.style.removeProperty('--post-body-size')
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
    root.style.setProperty('--list-row-pad', `${s.listPadPx}px`)
    root.setAttribute('data-list-pad', '')
  } else {
    root.style.removeProperty('--list-row-pad')
    root.removeAttribute('data-list-pad')
  }
  const preset = FONT_FAMILIES.find((f) => f.key === s.fontFamily) ?? FONT_FAMILIES[0]
  // OS のフォントが見つからなかったときのために、同梱の Noto Sans JP を後ろに置く
  const css =
    s.fontFamily === 'custom' && s.customFont
      ? `'${s.customFont.replace(/'/g, "\\'")}', ${FONT_FAMILIES[0].css}`
      : preset.css
  root.style.setProperty('--app-font', css)
  for (const p of PANELS) root.style.setProperty(p.cssVar, String(s.panelAlpha[p.key] ?? 1))
  root.style.setProperty('--bg-image-opacity', String(s.backgroundOpacity))
  root.style.setProperty('--post-thumb-size', `${s.postThumbSize}px`)
  root.style.setProperty('--list-thumb-scale', String(s.listThumbScale))
}

export type PaneMode = 'split' | 'single' | 'auto'

export type UpdateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void

/** 設定を変えてから DB に書くまで待つ時間 */
const SAVE_DELAY_MS = 400

/** 設定を読み込み、変更を即座に画面へ反映して保存する。loaded は保存済みの値を読み終えたか */
export function useSettings(store: LogStore | undefined): [AppSettings, UpdateSetting, boolean] {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!store) return
    void store.getSettings().then((saved) => {
      setSettings((s) => {
        const next = { ...s, ...(saved as Partial<AppSettings>) }
        // レスの見た目「タイムライン(X 風)」はやめた(2026-11)。選んでいた人は、いちばん近い Discord 風に
        const postStyle: PostStyle = (next.postStyle as string) === 'timeline' ? 'discord' : next.postStyle
        return { ...next, postStyle, uploadHost: migrateUploadHost(next.uploadHost as string), scheme: withoutOldLight(next.scheme), lightScheme: withoutOldLight(next.lightScheme), darkScheme: withoutOldLight(next.darkScheme), swipeGestures: withoutOldGestures(next.swipeGestures) }
      })
      setLoaded(true)
    })
  }, [store])

  useEffect(() => {
    apply(settings)
  }, [settings])
  // OS のダーク・ライトが切り替わったら、合わせて塗り直す
  useEffect(() => {
    if (!settings.followOsTheme) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply(settings)
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
      pendingWrites.current.set(key, value)
      if (!writeTimer.current) writeTimer.current = setTimeout(flush, SAVE_DELAY_MS)
    },
    [flush],
  )

  return [settings, update, loaded]
}
