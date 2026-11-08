// スレ表示。
// - 開いたときの位置・既読・新着の追いかけなど、スクロールまわりは hooks/useThreadScroll.ts にまとめてある
// - アンカー・返信・ID はポップアップで出す(ホバーかクリックかは設定で選ぶ)
// - 新着は若い番号から順に出して光らせる
// - 書き込み欄は下か右に置き、境界をドラッグして大きさを変えられる

import { countIconKeys, iconKeyOf, watchoiOf } from '../utils/watchoi'
import { isMobile } from '../utils/platform'
import { useHideOnScroll } from '../hooks/useHideOnScroll'
import { useTouchPull } from '../hooks/useTouchPull'
import { judgeAutoNg, type AutoNgReason, type TrollMarks } from '../utils/autoNg'
import { activeRules, judgeAiNg, setOverride, trainRules, threadContextOf } from '../utils/aiNg'
import { scoreOf as aiScoreOf, useAiNgScores } from '../hooks/useAiNg'
import type { Judgement } from '../utils/trollModel'
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import type { AttachmentRules, Post, PostActionDef, ReactionDef, PostConfirm, PostInput, PostLimits, PostResult, ThreadSummary } from '@bbs-browser/connectors'
import type { ThreadLog } from '@bbs-browser/logstore'
import PostArticle, { type PostHandlers, type PostVariant } from './PostArticle'
import PostPopup, { type PopupEntry } from './PostPopup'
import Lightbox from './Lightbox'
import Minimap from './Minimap'
import AnchorTree from './AnchorTree'
import LoadingCenter from './LoadingCenter'
import LoadFailed from './LoadFailed'
import ReplyForm, { type ReplyFormHandle } from './ReplyForm'
import NextThreadBox from './NextThreadBox'
import NextUnreadButton from './NextUnreadButton'
import RefreshButton from './RefreshButton'
import { saveThread } from '../host/exportThread'
import { openUrl } from '@tauri-apps/plugin-opener'
import { postWebUrl, shareItems } from '../utils/share'
import MediaGallery, { collectMedia } from './MediaGallery'
import type { PostAccountOption } from './PostAccountMenu'
import { ActionButtons, MOBILE_HEAD_BTN, MOBILE_HEAD_ICON, MoreMenu, useBarContextMenu, type BarAction } from './ActionBar'
import { inBar, mobileMenuActions, orderBy, resolvePlacements } from '../utils/toolbar'
import ActionSheet, { type SheetItem } from './ActionSheet'
import { onWifi } from '../utils/network'
import { StyleDialog } from './StyleMenu'
import { BaseFontSlider, PostFontSliders } from './FontSizeSlider'
import { REFRESH_COOLDOWN_MS } from '../utils/cooldown'
import type { NextThreadCandidate } from '../utils/nextThread'
import type { UploadedFile } from '../host/uploader'
import PullSpinner from './PullSpinner'
import { useWheelPullRefresh } from '../hooks/useWheelPullRefresh'
import { animateScroll, closedPosition, framesIn, useThreadScroll } from '../hooks/useThreadScroll'
import { useDragHeight } from '../hooks/useDragHeight'
import DragEdge from './DragEdge'
import { CURSOR_MARGIN, CURSOR_SCROLL_MS, DOUBLE_ESC_MS, firstAfter, followDelta, frameIndexOf, isDoublePress, isNear, isSeen, keepCursorOnNew, pickAfterPage, pickAfterPageAt, spanOf, stepCursor } from '../utils/cursor'
import { openTarget, type ScrollPosition } from '../utils/threadScroll'

import { createKeyReader, isTypingTarget, modalOpen, isReloadKey, resolveKeymap, type KeyAction } from '../utils/keymap'
import { PULL_HIDDEN_Y } from '../utils/pullRefresh'
import {
  anchorTree,
  anchorTreeRows,
  anchorTargets,
  countAnchors,
  makeAnchorResolver,
  quoteLinksOf,
  quotedText,
  targetsOfPost,
  countIds,
  hasLink,
  hasVideo,
  imageUrlsIn,
  normalizeForSearch,
  videoFileUrlsIn,
  youtubeLinksIn, mostCommonName } from '../utils/postBody'
import type { NgRule, NgTarget } from '../utils/ng'
import { ngHitsOf } from '../utils/ng'
import { effectivePostStyle, effectiveScheme, isDarkScheme, baseVariant, type AppSettings, type ReplyLayout, type UpdateSetting } from '../ui/settings'

export type { ScrollPosition } from '../utils/threadScroll'

interface Props {
  /** スレを見分ける値(タブの id)。覚えておいたレスの高さの持ち主 */
  threadKey: string
  log: ThreadLog
  /** 開いているタブか。見えていないタブ(残しておいたもの)では、ポップアップを閉じる */
  active: boolean
  /** キー操作を受け取るか(2 画面でスレ一覧を触っているときは false。開いているタブでも) */
  keyFocus?: boolean
  /** タブを切り替えて戻ってきたときの位置。あれば「開いたときの位置」の設定より優先する */
  initialPosition?: ScrollPosition
  /** 画面から外れる(タブを切り替える)ときに、読んでいた位置を渡す */
  onSavePosition: (pos: ScrollPosition) => void
  /** 開いた時点の「最初の未読」のレス番号。ここに「ここから未読」の線を引く */
  unreadFrom: number
  loading: boolean
  /** 読み込めなかった理由。レスがまだないときは、取り直しのボタンと一緒に出す */
  errorText?: string
  settings: AppSettings
  isNg: (p: Post) => boolean
  /** 自動 NG にユーザーが付けた印 */
  trollMarks: TrollMarks
  /** 印から学んだ判定(印が少ないうちは undefined) */
  trollJudge?: (body: string) => Judgement | undefined
  /** 自動 NG の印を付ける(true: 荒らし、false: 荒らしじゃない、null: 外す) */
  onMarkTroll: (p: Post, troll: boolean | null, reason?: string) => void
  onRead: (no: number) => void
  /** 更新。Promise を返せば、引っぱって更新のくるくるが終わるまで待つ */
  onRefresh: () => Promise<unknown> | void
  onOpenInBrowser: () => void
  onUrl: (url: string) => void
  onAddNg: (rule: NgRule) => void
  onRemoveNg?: (rules: NgRule[]) => void
  onEditNg?: (rule: NgRule, values: Partial<Record<NgTarget, string>>) => void
  /** NG の画面を、元の文字を入れた状態で開く */
  onNgDraft: (target: NgTarget, text: string, values?: Partial<Record<NgTarget, string>>) => void
  /** 自分の書き込みのレス番号 */
  ownNos: Set<number>
  /** 書き込み。コネクタが書き込みに対応していなければ undefined */
  onSubmitPost?: (input: PostInput) => Promise<PostResult>
  onConfirmPost: (confirm: PostConfirm, input: PostInput) => Promise<PostResult>
  postName: string
  postMail: string
  onChangeReplyLayout: (layout: ReplyLayout) => void
  onResizeReply: (key: 'replyHeight' | 'replyWidth', size: number) => void
  /** 1 画面のとき、スレ一覧に戻る(スレタイの左にボタンを出す) */
  onBackToList?: () => void
  /** スマホ: サイドバーの引き出しを開く */
  onOpenDrawer?: () => void
  /** 書き込み欄をしまう・出す(設定に覚える) */
  onSetReplyCollapsed: (collapsed: boolean) => void
  /** ログを消してタブを閉じる */
  onDeleteLog: () => void
  /** 次スレの候補を探す(板のスレ一覧を取り直して似たスレタイを並べる)。できない掲示板では undefined */
  onFindNext?: () => Promise<NextThreadCandidate[]>
  /** このスレの板のスレ一覧を開く */
  onOpenBoard?: () => void
  /** 設定を変える(︙ の表示スタイル) */
  onUpdateSetting?: UpdateSetting
  /** ヘッダー(スレタイの行)の高さを変えた(下の端をつかんで)。0 なら既定に戻した */
  onHeaderHeight?: (height: number) => void
  /** 本文の >>番号 が指すもの(コネクタの anchorTarget)。'ref' なら板の本当の番号 */
  anchorTarget?: 'no' | 'ref'
  /** 引用を「>前のレスの文章」で書く掲示板(コネクタの textQuotes) */
  textQuotes?: boolean
  /** 書き込みにファイルを付けられる掲示板の決まり(コネクタの attachments) */
  attachments?: AttachmentRules
  /** レスへの反応を押す(ふたばの「そうだね」など)。反応のない掲示板は undefined */
  onReact?: (post: Post, reactionId: string) => void
  /** レスへの操作(通報など)。操作のない掲示板は undefined */
  onPostAction?: (post: Post, actionId: string) => void
  /** 自分の書き込みを消す。消せない掲示板は undefined */
  onDeletePost?: (post: Post) => void
  /** 自分のレスの印を手で付ける・外す(このスレのレス番号) */
  onMarkOwn?: (nos: number[], own: boolean) => void
  /** レスへの反応の数(キーはレスの画面の番号、中は反応の id → 数)と、反応・操作の種類 */
  reactions?: Map<number, Record<string, number>>
  reactionDefs?: ReactionDef[]
  postActions?: PostActionDef[]
  /** 1 つのスレのレスの上限(2ch は 1000)。上限のない掲示板は undefined */
  maxPosts?: number
  onOpenThread: (t: ThreadSummary) => void
  /**
   * スレの最後の横長の「次の未読スレへ」(PC)。いまのスレ一覧で次に未読のあるスレのスレタイ(なければ '')・未読の数・一覧の名前。
   * 一覧を開いていなければ undefined(出さない)
   */
  nextUnread?: { title: string; count: number; listTitle: string }
  onOpenNextUnread?: () => void
  /** 手で更新したあとのクールダウンが明ける時刻(更新ボタンに残りを出す) */
  refreshReadyAt?: number
  /** 本文からアイコン(BE アイコンなど)を取り出す。掲示板ごとの書き方なのでコネクタのもの */
  splitPostIcon?: (body: string) => { icon?: string; body: string }
  /** 板の書き込みの上限と、その掲示板での数え方(書き込み欄に長さを出す) */
  postLimits?: PostLimits
  postByteLength?: (text: string) => number
  /** スレのブラウザ用の URL(保存するファイルに書く) */
  threadUrl: string
  /**
   * 「いま見えているところまでの既読をすぐ知らせる」関数を App に渡す。
   * 更新の直前に呼んでもらい、既読の記録(スクロールが止まって少し後)が間に合わないまま
   * 「ここから未読」を古い位置で引き直さないようにする
   */
  registerReadFlush?: (flush: (() => void) | undefined) => void
  /** 書き込みの下書き(このスレの書きかけ) */
  draft?: { load: () => Promise<string | undefined>; save: (body: string) => void }
  /** この板で使えるアカウント(書き込み欄の ︙ で選ぶ) */
  postAccounts?: PostAccountOption[]
  onTogglePostAccount?: (id: string, on: boolean) => void
  onOpenAccountSettings?: () => void
  /** お気に入りのスレか、と足す・外す */
  isFavorite: boolean
  onToggleFavorite: () => void
  /** 上げ終わった画像(アップロード履歴に残す) */
  onUploaded: (u: UploadedFile) => void
  /** 通知などから、このレスへ飛ぶ(seq が変わるたびに飛ぶ) */
  jumpTo?: { no: number; seq: number; flash?: boolean }
  /** 板の既定の名前(名無しの省略に使う) */
  nonameName?: string
  /** スレの板(AI NG の「この板だけ」の条件に使う) */
  boardUrl?: string
  /** 板ごとの設定: 名無しを省くか(なければ全体の設定)と、名無しとみなす名前 */
  omitNoname?: boolean
  extraNonames?: string[]
}

const ICON_BTN = 'p-2 text-c-text-muted hover:text-c-text-strong transition-colors rounded-lg'

/** レスの絞り込み(4 種と、PC だけの「自分」。選んだもののどれかに当たれば出す) */
type PostFilter = 'popular' | 'image' | 'video' | 'link' | 'own'
/** スマホのフッターの高さ */
const MOBILE_BAR_H = 60
/** スマホのフッターのボタン(大きく押しやすく) */
const MOBILE_BTN = 'p-2.5 rounded-xl text-c-text-muted hover:text-c-text-strong active:bg-c-surface2 transition-colors disabled:opacity-40'
// 絞り込みのアイコンには、意味の色を付ける(人気は橙、画像は緑、動画は赤、リンクは青)
const FILTERS: { key: PostFilter; label: string; icon: string; color: string }[] = [
  { key: 'popular', label: '人気', icon: 'local_fire_department', color: 'var(--c-mark-hot)' },
  { key: 'image', label: '画像', icon: 'image', color: 'var(--c-mark-image)' },
  { key: 'video', label: '動画', icon: 'play_circle', color: 'var(--c-mark-video)' },
  { key: 'link', label: 'リンク', icon: 'link', color: 'var(--c-mark-link)' },
]
/** 自分の書き込み(書き込み履歴にあるレス)だけを出す。PC だけ(スマホは 5 つを等分に並べているため) */
const OWN_FILTER = { key: 'own', label: '自分', icon: 'person', color: 'var(--c-own)' } as const
/** 引用のない(文章で引用する掲示板の)レスに渡す、空のつながり(描き直しを起こさないよう、いつも同じもの) */
const NO_QUOTES = new Map<string, number>()
/**
 * スレを開いたときに、最初に中身まで作るレスの数(開く位置の前後)。
 * 全部を一度に作ると、1000 レスのスレで開くまでに時間がかかるので、見える所から先に作る
 */
const FIRST_RENDER = 80
/**
 * 見えているレスの前後に、何件まで中身を作っておくか(全部作ると 1000 レスのスレで重い)。
 * 範囲の端から WIN_MARGIN 件以内まで見えてきたら範囲を動かす。はじいても空箱が見えないよう、下は多めに作り、早めに動かす
 */
// 上へ読むときに範囲を動かす間隔は WIN_BEFORE − WIN_MARGIN 件。少ないと数レスごとに全枠を見直すことになる
const WIN_BEFORE = 80
const WIN_AFTER = 100
const WIN_MARGIN = 35
/** 書き込み欄(下に置いたとき)を伸ばせる高さの上限。つかんで伸ばすときの上限と同じ */
const REPLY_MAX_HEIGHT = 600
/** スレ表示がこれより狭い(書き込み欄が右)・低い(書き込み欄が下)ときは、書き込み欄を自動でしまう */
const AUTO_COLLAPSE_WIDTH = 720
const AUTO_COLLAPSE_HEIGHT = 420
/** 新着の札を出しておく時間 */
const NEW_TOAST_MS = 2500
/** ホバーで開くまでの待ち時間。通り過ぎただけで開かないように */
const HOVER_DELAY_MS = 150
/** ホバーで開いたポップアップは、まだ中に入っていなければ、開いた位置からこれだけ離れたら(その 1 枚を)閉じる */
const HOVER_ESCAPE_PX = 100

/**
 * 書き込み欄との境界。ドラッグ中は親に大きさを知らせ、離したときに保存してもらう。
 * 下に置くときは上下に、右に置くときは左右に動かす(書き込み欄側が伸び縮みする)
 */
function Splitter(props: { layout: ReplyLayout; size: number; onChange: (size: number) => void; onEnd: (size: number) => void }) {
  const vertical = props.layout === 'bottom'
  return (
    <div
      className={`flex-shrink-0 bg-c-border hover:bg-c-accent transition-colors ${vertical ? 'h-1 cursor-row-resize' : 'w-1 cursor-col-resize'}`}
      onMouseDown={(e) => {
        e.preventDefault()
        const start = vertical ? e.clientY : e.clientX
        const startSize = props.size
        let latest = startSize
        const onMove = (ev: MouseEvent) => {
          const delta = (vertical ? ev.clientY : ev.clientX) - start
          latest = Math.min(vertical ? REPLY_MAX_HEIGHT : 900, Math.max(vertical ? 90 : 240, startSize - delta))
          props.onChange(latest)
        }
        const onUp = () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          document.body.style.userSelect = ''
          props.onEnd(latest)
        }
        document.body.style.userSelect = 'none'
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }}
    />
  )
}

/** el の中で選んでいる文字(前後の空白を除く)。el の外にまたがって選んでいたり、何も選んでいなければ undefined */
function selectedTextIn(el: HTMLElement): string | undefined {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return undefined
  if (!el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return undefined
  const text = sel.toString().trim()
  return text || undefined
}

/** レス検索の対象の文の控え(レスは作り直されるまで中身が変わらないので、1 文字打つごとに揃え直さない) */
const searchTexts = new WeakMap<Post, string>()
function searchTextOf(p: Post): string {
  let v = searchTexts.get(p)
  if (v === undefined) {
    v = normalizeForSearch(`${p.no} ${p.name} ${p.id ?? ''} ${p.body}`)
    searchTexts.set(p, v)
  }
  return v
}

/** 絞り込みの付け外し */
function togglePostFilter(filters: Set<PostFilter>, key: PostFilter): Set<PostFilter> {
  const next = new Set(filters)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/** Tab・Shift+Tab: レスの中のリンクなどを順に選ぶ(今の次へ。端からは反対の端へ) */
function cycleTabItems(items: HTMLElement[], back: boolean): HTMLElement {
  const i = items.indexOf(document.activeElement as HTMLElement)
  const next = i < 0 ? (back ? items.length - 1 : 0) : (i + (back ? -1 : 1) + items.length) % items.length
  items[next].focus()
  return items[next]
}

/**
 * レスの中で Tab で回るもの。本文(リンク・アンカー・画像・カード)を先に、レスの頭(番号・名前・ID)を後に並べる。
 * マウスを乗せたときに出る操作バーは入れない
 */
function tabItems(post: HTMLElement): HTMLElement[] {
  const all = [...post.querySelectorAll<HTMLElement>('a[href], button, [role="button"]')].filter(
    (el) => !el.closest('[data-post-toolbar]') && el.getClientRects().length > 0,
  )
  const inHeader = (el: HTMLElement) => el.closest('[data-post-header]') !== null
  return [...all.filter((el) => !inHeader(el)), ...all.filter(inHeader)]
}

function Divider({ label, self }: { label: string; self?: boolean }) {
  const color = self ? 'var(--c-unread-ink)' : 'var(--c-border)'
  return (
    <div
      className={`flex items-center gap-3 py-1 select-none ${self ? '' : 'text-c-text-muted'}`}
      style={self ? { color } : undefined}
    >
      <div className="flex-1 h-[3px]" style={{ background: color, opacity: self ? 0.4 : 1 }} />
      <span className="text-sm font-extrabold tracking-widest whitespace-nowrap">{label}</span>
      <div className="flex-1 h-[3px]" style={{ background: color, opacity: self ? 0.4 : 1 }} />
    </div>
  )
}

type ArticleProps = ComponentProps<typeof PostArticle>

/** 続けて並んだあぼーんをまとめた 1 行。押すと広げる・まとめ直す */
function NgRunRow(props: {
  run: { nos: number[]; auto: number; ai: number; rule: number }
  first: number
  last?: Post
  open: boolean
  onToggle: () => void
}) {
  const { run } = props
  const count = run.auto + run.ai + run.rule
  const parts = [run.auto > 0 && `自動 NG ${run.auto}`, run.ai > 0 && `AI NG ${run.ai}`, run.rule > 0 && `NG ${run.rule}`].filter(Boolean).join('・')
  return (
    <article data-no={run.nos[0]} style={{ paddingLeft: 'var(--post-padding-x)', paddingRight: 'var(--post-padding-x)', paddingTop: 6, paddingBottom: 6 }}>
      <button
        type="button"
        onClick={props.onToggle}
        className="flex items-center gap-2 text-xs text-c-text-muted hover:text-c-text-body"
        title={props.open ? '1 行にまとめ直す' : '広げて 1 つずつ見る'}
      >
        <span className="material-symbols-outlined text-base leading-none">{props.open ? 'unfold_less' : 'unfold_more'}</span>
        <span className="font-bold">
          {props.first}〜{props.last ? (props.last.ref ?? props.last.no) : ''}
        </span>
        <span>
          あぼーん × {count}({parts})
        </span>
        {props.open && <span>— まとめる</span>}
      </button>
    </article>
  )
}

/** レスの枠すべてに共通の値。どれかが変わったときだけ全部の枠を描き直す */
interface FrameShared {
  handlers: PostHandlers
  onPress: (no: number) => void
  onToggleRun: (no: number) => void
  byNo: Map<number, Post>
  quotesOf: (no: number) => ArticleProps['quotes']
  grossNos?: Set<number>
  anchorCounts: Map<number, number>
  idCounts: Map<string, number>
  iconCounts: Map<string, number>
  iconFromWatchoi: boolean
  variant: PostVariant
  replyPreviewOf: (p: Post) => ArticleProps['replyPreview']
  continuedFrom: (i: number) => boolean
  isNg: (p: Post) => boolean
  autoNg: Map<number, AutoNgReason>
  aiMarkOf: (no: number) => ArticleProps['aiMark']
  ngMode: ArticleProps['ngMode']
  showThumbnails: boolean
  showIdenticon: boolean
  showLinkPreview: boolean
  toolbar: ArticleProps['toolbar']
  phrases: ArticleProps['phrases']
  display: ArticleProps['display']
  opId?: string
  ownNos: Set<number>
  replyToOwn: Set<number>
  reactions?: { get(no: number): ArticleProps['reactions'] }
}

/** レスの枠とポップアップで共通の、そのレスの中身(枠の線・操作など置き場所で違うものは呼ぶ側で足す) */
function postArticleProps(p: Post, s: FrameShared) {
  return {
    post: p,
    reactions: s.reactions?.get(p.ref ?? p.no),
    quotes: s.quotesOf(p.no),
    blurMedia: s.grossNos?.has(p.no),
    anchorCount: s.anchorCounts.get(p.no) ?? 0,
    idCount: p.id ? (s.idCounts.get(p.id) ?? 1) : 0,
    iconCount: s.iconCounts.get(iconKeyOf(p, s.iconFromWatchoi) ?? '') ?? 0,
    variant: s.variant,
    ng: s.isNg(p),
    autoNg: s.autoNg.get(p.no),
    aiMark: s.aiMarkOf(p.no),
    showThumbnails: s.showThumbnails,
    showIdenticon: s.showIdenticon,
    showLinkPreview: s.showLinkPreview,
    display: s.display,
    toolbar: s.toolbar,
    phrases: s.phrases,
    isOp: s.opId !== undefined && p.id === s.opId,
    isOwn: s.ownNos.has(p.no),
    isReplyToOwn: s.replyToOwn.has(p.no),
  }
}

/** 頭(名前の行)を省くレスか。返信のレスは、続けて書いたものでも頭とアイコンを出す(返信元からの線をつなぐため) */
function continuedHead(
  p: Post,
  i: number,
  variant: PostVariant,
  anchorCounts: Map<number, number>,
  ownNos: ReadonlySet<number> | undefined,
  replyPreviewOf: (p: Post) => unknown,
  continuedFrom: (i: number) => boolean,
  firstUnread: boolean,
): boolean {
  return ((anchorCounts.get(p.no) ?? 0) === 0 || (variant === 'line' && !!ownNos?.has(p.no))) && (variant === 'line' || (variant === 'discord' && !replyPreviewOf(p))) && !firstUnread && continuedFrom(i)
}

/**
 * レス 1 件ぶんの枠。選んでいるレスなどは枠ごとの真偽値で受け取り、値の変わった枠だけを描き直す
 * (J・K や押したときに動くのは 2〜3 枠で、1000 枠を作り直すと押し続けで詰まる)
 */
const PostFrame = memo(function PostFrame(props: {
  post: Post
  index: number
  shared: FrameShared
  /** 中身を作る範囲にあるか(外なら仮の高さの箱) */
  rendered: boolean
  /** 仮の高さ */
  height: number
  firstUnread: boolean
  /** 「ここから未読」の線を出すか */
  unreadLine: boolean
  /** 新着として順に出すときの遅れ(ms)。新着でなければ undefined */
  enterDelay?: number
  /** 選んでいるレスの印を出すか */
  cursorMark: boolean
  /** 選んでいるレスと同じ ID か */
  sameIdTint: boolean
  /** 枠ごと隠すか(絞り込み・まとめたあぼーんの 2 件目以降) */
  frameHidden: boolean
  /** 中身を出すか */
  showArticle: boolean
  /** あぼーんのまとまりの先頭なら、そのまとまり */
  runHead?: { nos: number[]; auto: number; ai: number; rule: number }
  runOpen: boolean
}) {
  const { post: p, index: i, shared: s, rendered, height, firstUnread, enterDelay, runHead } = props
  return (
    <div
      className={`post-cv relative ${enterDelay !== undefined ? 'post-enter' : ''}`}
      // スマホには「選んでいるレス」がない(押したレスに印を付けない)
      onPointerDown={isMobile ? undefined : () => s.onPress(p.no)}
      style={
        {
          // 画面の外で描くのを省いている間の仮の高さ(覚えておいた高さか、本文からの見積もり)
          containIntrinsicSize: `auto ${height}px`,
          // まだ中身を作っていないレスは、仮の高さの箱にしておく(画面に入っても高さがつぶれないように)
          ...(!rendered && { minHeight: height }),
          ...(enterDelay !== undefined && { '--enter-delay': `${enterDelay}ms` }),
        } as CSSProperties
      }
      data-post={p.no}
      data-placeholder={rendered ? undefined : ''}
      hidden={props.frameHidden}>
      {props.unreadLine && <Divider label="ここから未読" self />}
      {/* 選んでいるレスと同じ ID のレスは、さらに薄く色を付ける(同じ人の流れを追いやすく) */}
      {props.sameIdTint && (
        <span
          className="absolute inset-0 pointer-events-none -z-[1] rounded-[var(--card-radius)] opacity-50"
          style={{ background: 'var(--c-cursor-tint)' }}
        />
      )}
      {/* 選んでいるレスの印。うっすらした色と、下辺のまっすぐな線(角の丸みにかからないよう、両端を角の丸みの分だけ空ける) */}
      {props.cursorMark && (
        <>
          {/* うっすら色を敷いて、どのレスか目に入るようにする。中身(本文・吹き出し)の後ろに敷く(上に重ねると、吹き出しの文字まで色がかぶる) */}
          <span
            className="absolute inset-0 pointer-events-none -z-[1] rounded-[var(--card-radius)]"
            style={{ background: 'var(--c-cursor-tint)' }}
          />
          <span
            className="absolute bottom-0 h-[2px] bg-c-accent pointer-events-none z-[1]"
            style={{ left: 'var(--card-radius)', right: 'var(--card-radius)' }}
          />
        </>
      )}
      {runHead && (
        <NgRunRow run={runHead} first={p.ref ?? p.no} last={s.byNo.get(runHead.nos.at(-1)!)} open={props.runOpen} onToggle={() => s.onToggleRun(p.no)} />
      )}
      {props.showArticle && (
        <PostArticle
          {...postArticleProps(p, s)}
          showTopDivider={i > 0 && !firstUnread && (s.variant === 'card' || s.variant === 'matome')}
          continued={continuedHead(p, i, s.variant, s.anchorCounts, s.ownNos, s.replyPreviewOf, s.continuedFrom, firstUnread)}
          replyPreview={s.variant === 'discord' || s.variant === 'line' ? s.replyPreviewOf(p) : undefined}
          ngMode={s.ngMode}
          flash={enterDelay !== undefined}
          handlers={s.handlers}
        />
      )}
    </div>
  )
})

export default function ThreadView(props: Props) {
  const { log, unreadFrom, settings, onRead } = props
  // 見えているタブだけ、判定が届くたびに計算し直す(隠れたタブは、見せるときに計算し直す)
  const trollJudgeRef = useRef(props.trollJudge)
  if (props.active) trollJudgeRef.current = props.trollJudge
  const trollJudge = trollJudgeRef.current
  /** 自動 NG(荒らしの判定)で畳むレスと、その理由 */
  const autoNgBase = useMemo(
    () => (settings.autoNg ? judgeAutoNg(log.posts, props.trollMarks, trollJudge) : new Map<number, AutoNgReason>()),
    [settings.autoNg, log.posts, props.trollMarks, trollJudge],
  )
  // AI NG: 利用者の条件に当たったレス。畳む・隠すものは自動 NG と同じ並びに入れ、印だけのものは別に持つ
  const aiRules = useMemo(() => (settings.aiNgEnabled ? activeRules(settings.aiNgRules, props.boardUrl) : []), [settings.aiNgEnabled, settings.aiNgRules, props.boardUrl])
  // スレの話題(スレタイと 1 レス目の頭)。文脈つきの条件に添える
  const aiContext = useMemo(() => threadContextOf(log.title, log.posts[0]?.body), [log.title, log.posts[0]?.body])
  const aiVersion = useAiNgScores(
    log.posts,
    aiRules.map((r) => r.prompt),
    aiRules.length > 0,
    props.active,
    aiRules.map((r) => (r.withContext ? aiContext : undefined)),
  )
  // 手の印から学んだ判定(印が変わったときだけ学び直す)
  const aiLearned = useMemo(() => trainRules(aiRules, settings.aiNgOverrides), [aiRules, settings.aiNgOverrides])
  const aiNg = useMemo(
    () => judgeAiNg(log.posts, aiRules, aiScoreOf, settings.aiNgOverrides, aiLearned, aiContext),
    // aiVersion: 当たり具合が届いたら判定し直す
    [log.posts, aiRules, settings.aiNgOverrides, aiLearned, aiVersion, aiContext],
  )
  const autoNg = useMemo(() => {
    if (aiNg.size === 0) return autoNgBase
    const m = new Map(autoNgBase)
    for (const [no, hit] of aiNg) if (hit.rule.show !== 'mark' && !m.has(no)) m.set(no, { kind: 'ai', hit })
    return m
  }, [autoNgBase, aiNg])
  const aiMarkOf = useCallback(
    (no: number) => {
      const h = aiNg.get(no)
      return h?.rule.show === 'mark' ? h : undefined
    },
    [aiNg],
  )
  const onMarkAi = useCallback(
    (p: Post, ruleId: string, mark: 'hit' | 'miss' | null) => props.onUpdateSetting?.('aiNgOverrides', setOverride(settings.aiNgOverrides, ruleId, p.body, mark)),
    [props.onUpdateSetting, settings.aiNgOverrides],
  )
  const isNgRule = props.isNg
  // レスのメニューが読む NG の一覧(変わるたびに全部のレスを描き直さないよう、控えを読む)
  const ngContext = useRef({ rules: settings.ngRules, boardUrl: props.boardUrl })
  ngContext.current = { rules: settings.ngRules, boardUrl: props.boardUrl }
  // NG の判定は、レスが変わったときに 1 回だけ全レスに当てて番号の Set にする(描くたびに NG 1 件ごとの toLowerCase を繰り返さない)
  const ngRuleNos = useMemo(() => {
    const out = new Set<number>()
    for (const p of log.posts) if (isNgRule(p)) out.add(p.no)
    return out
  }, [log.posts, isNgRule])
  // NG は、ユーザーの NG と自動 NG のどちらかに当たったもの
  const isNg = useCallback((p: Post) => ngRuleNos.has(p.no) || autoNg.has(p.no), [ngRuleNos, autoNg])
  const ref = useRef<HTMLDivElement>(null)
  /** レス一覧とミニマップの領域。ポップアップの幅をこれに合わせる */
  const viewRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  // スマホは、ヘッダーをいつもスクロールの中に置く(下へスクロールすると隠す。useHideOnScroll)
  const headerInScroll = isMobile || settings.replyLayout === 'bottom'
  const listRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setHeaderHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
    // 書き込み欄の位置を変えるとヘッダーが作り直されるので、見張り直す
  }, [headerInScroll])
  const [popups, setPopups] = useState<PopupEntry[]>([])
  const [popupFrame, setPopupFrame] = useState<{ rect: DOMRect; headerBottom: number }>()
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number; post?: Post; posts?: Post[] }>()
  /** 画像一覧を開いているか */
  const [galleryOpen, setGalleryOpen] = useState(false)
  const popupSeq = useRef(0)
  const hover = useRef<{ timer?: ReturnType<typeof setTimeout>; active: boolean; entered: boolean; x: number; y: number }>({
    active: false,
    entered: false,
    x: 0,
    y: 0,
  })

  // 端でさらにホイールを回すと更新する。上端と下端で別々に持つ
  // 手で更新したあとのクールダウン中(App が決める)は、引っぱっても数えない
  const refreshReadyRef = useRef(props.refreshReadyAt)
  refreshReadyRef.current = props.refreshReadyAt
  const canRefresh = () => Date.now() >= (refreshReadyRef.current ?? 0)
  const topPull = useWheelPullRefresh({ onRefresh: props.onRefresh, sign: 1, canRefresh })
  const bottomPull = useWheelPullRefresh({ onRefresh: props.onRefresh, sign: -1, canRefresh })
  // スマホ: 指で引っぱって更新する(上の端で下へ・下の端で上へ)
  const touchPull = useTouchPull(ref, topPull, bottomPull)
  const onScrollPull = () => {
    topPull.noteScroll()
    bottomPull.noteScroll()
  }
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    if (e.deltaY < 0 && el.scrollTop < 1) {
      topPull.pull(-e.deltaY)
      bottomPull.reset()
    } else if (e.deltaY > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 5) {
      bottomPull.pull(e.deltaY)
      topPull.reset()
    } else {
      topPull.reset()
      bottomPull.reset()
    }
  }

  const [filters, setFilters] = useState<Set<PostFilter>>(new Set())
  /** スマホ: スレタイを押して出す、スレの操作のメニュー */
  const [titleSheet, setTitleSheet] = useState(false)
  /** ︙ の「表示スタイル」の画面 */
  const [styleOpen, setStyleOpen] = useState(false)
  /** スマホ: スレタイを 2 行に収める(入りきらなければ字を小さく)。スレタイ・幅が変わったら測り直す */
  const titleFitRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = titleFitRef.current
    if (!isMobile || !el) return
    const fit = () => {
      el.style.fontSize = ''
      const over = () => el.scrollHeight > el.clientHeight + 1
      if (!over()) return
      // 2 行(line-clamp)に収まる一番大きい字を、0.5px きざみで半分ずつ探す(測るたびにレイアウトをやり直すので、回数を減らす)
      let lo = 22 // 11px(0.5px きざみの数)
      let hi = Math.floor(parseFloat(getComputedStyle(el).fontSize) * 2) - 1
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        el.style.fontSize = `${mid / 2}px`
        if (over()) hi = mid - 1
        else lo = mid
      }
      el.style.fontSize = `${lo / 2}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el.parentElement ?? el)
    return () => observer.disconnect()
  }, [log.title, log.posts.length])
  const [searchActive, setSearchActive] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (searchActive) searchRef.current?.focus()
  }, [searchActive])
  /** 外した検索の言葉。次に検索を開いたとき(Ctrl+F・/)に戻す */
  const lastQuery = useRef('')
  /** 検索を外す(言葉は覚えておく) */
  const clearSearch = useRef(() => {})
  clearSearch.current = () => {
    if (query) lastQuery.current = query
    setQuery('')
    setSearchActive(false)
  }

  /** キー操作を受け取るか。開いているタブで、2 画面ならスレ表示の方を触っているとき */
  const keysOn = props.active && props.keyFocus !== false
  // Esc：ポップアップが出ていれば一番上を 1 層だけ閉じ、出ていなければ絞り込みを解いてすべて表示する。
  // 入力欄の中の Esc(検索欄・ダイアログなど)と、画像を大きく見ているとき(Lightbox が閉じる)は手を出さない
  useEffect(() => {
    if (!keysOn || lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (modalOpen()) return // ダイアログが開いている間は、後ろの画面を動かさない
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (isTypingTarget(t)) return
      if (popups.length > 0) {
        e.preventDefault()
        // スマホ(戻る操作)は、重なったポップアップをまとめて閉じる。PC の Esc はいちばん上から 1 つずつ
        setPopups((ps) => (isMobile ? [] : ps.slice(0, -1)))
      } else if (filters.size > 0) {
        e.preventDefault()
        setFilters(new Set())
      } else if (isMobile && (query || searchActive)) {
        // スマホ: 戻る操作で、検索も外す
        e.preventDefault()
        clearSearch.current()
      } else {
        // 閉じるものも絞り込みもないときに Esc を 2 回(素早く)押したら、選んでいるレスの印を消す(見た目だけ)。
        // 選んでいた場所は覚えていて、次に J・K などを押すとそこから続ける
        const now = Date.now()
        if (isDoublePress(lastEsc.current, now, DOUBLE_ESC_MS)) {
          e.preventDefault()
          setCursorHidden(true)
          // 検索もいっしょに外す(言葉は覚えておき、Ctrl+F でまた同じ言葉で探せる)
          clearSearch.current()
          lastEsc.current = 0
        } else lastEsc.current = now
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keysOn, lightbox, popups.length, filters.size])

  // 「草」などのすぐ書き込む操作の結果。スレ表示の下に少しのあいだ出す
  const [quickMessage, setQuickMessage] = useState<{ ok: boolean; text: string }>()
  const quickTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(quickTimer.current), [])
  /** 文字をコピーして、短く知らせる */
  const copyText = (text: string, done: string) =>
    void navigator.clipboard.writeText(text).then(
      () => showQuick(true, done),
      () => showQuick(false, 'コピーできませんでした'),
    )
  /** スレ表示の下に、少しのあいだ結果を出す */
  const showQuick = (ok: boolean, text: string) => {
    setQuickMessage({ ok, text })
    clearTimeout(quickTimer.current)
    quickTimer.current = setTimeout(() => setQuickMessage(undefined), ok ? 2500 : 6000)
  }
  // レスの手続きは作り直さない(すべてのレスを描き直して重い)ので、今の値はここから読む
  const shareTarget = useRef({ title: log.title, url: props.threadUrl })
  shareTarget.current = { title: log.title, url: props.threadUrl }
  const shareCopy = useRef(copyText)
  shareCopy.current = copyText
  const quickPost = async (body: string) => {
    if (!props.onSubmitPost) return
    showQuick(true, '書き込み中…')
    try {
      const r = await props.onSubmitPost({ name: props.postName, mail: props.postMail, body })
      if (r.status === 'ok') showQuick(true, `書き込みました: ${body.replace(/\n/g, ' ')}`)
      else if (r.status === 'auth') showQuick(false, '認証が必要です。書き込み欄から一度書き込んで、認証を済ませてください')
      else if (r.status === 'confirm') showQuick(false, '書き込み確認が出ました。書き込み欄から一度書き込んで、承諾してください')
      else showQuick(false, r.message)
    } catch (e) {
      showQuick(false, e instanceof Error ? e.message : String(e))
    }
  }

  // ハンドラーは作り置きしているので、いつも最新の名前・メールで送れるよう控えを通して呼ぶ
  const quickPostRef = useRef(quickPost)
  quickPostRef.current = quickPost

  const { ownNos } = props
  const replyRef = useRef<ReplyFormHandle>(null)
  const replyLayout = settings.replyLayout
  const sizeKey = replyLayout === 'bottom' ? 'replyHeight' : 'replyWidth'
  // ドラッグ中は手元で大きさを持ち、離したときに設定へ保存する
  const savedSize = settings[sizeKey]
  const [replySize, setReplySize] = useState(savedSize)
  useEffect(() => {
    setReplySize(savedSize)
  }, [savedSize])
  // 書き込み欄が下のとき、本文が欄に収まらなくなったら自動で伸ばす(つかんで伸ばせる上限 600px、スレ表示の 7 割まで)。
  // 本文が短くなる・書き込んで空になると、自分で決めた高さに戻る。伸ばした分は保存しない
  const [replyExtra, setReplyExtra] = useState(0)
  const replySizeRef = useRef(replySize)
  replySizeRef.current = replySize
  const onTextOverflow = useCallback((deficit: number) => {
    if (Math.abs(deficit) < 2) return
    setReplyExtra((e) => {
      const room = Math.min(REPLY_MAX_HEIGHT, (viewRef.current?.clientHeight ?? 800) * 0.7) - replySizeRef.current
      return Math.round(Math.min(Math.max(0, room), Math.max(0, e + deficit)))
    })
  }, [])
  const canReply = props.onSubmitPost !== undefined && log.status !== 'archived'

  // ── 書き込み欄をしまう ──
  // しまっておく設定に加え、スレ表示が狭い・低いとき(書き込み欄が右なら幅 720px 未満、下なら高さ 420px 未満)は自動でしまう。
  // 自動でしまっているときも、帯やボタンで出せる(大きさが戻ったら、また自動に任せる)
  const mainRef = useRef<HTMLElement>(null)
  const [autoCollapse, setAutoCollapse] = useState(false)
  const [replyForceOpen, setReplyForceOpen] = useState(false)
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      setAutoCollapse(replyLayout === 'right' ? el.clientWidth < AUTO_COLLAPSE_WIDTH : el.clientHeight < AUTO_COLLAPSE_HEIGHT)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [replyLayout])
  useEffect(() => {
    if (!autoCollapse) setReplyForceOpen(false)
  }, [autoCollapse])
  // スマホ: 書き込み欄はフッターに組み込んだ 1 行の入力欄(Discord・LINE と同じ)。いつも出ていて、書くときはそこに入る
  const replyCollapsed = isMobile ? false : settings.replyCollapsed || (autoCollapse && !replyForceOpen)
  const openReply = () => {
    if (isMobile) {
      hideBarsRef.current?.reveal()
      requestAnimationFrame(() => replyRef.current?.focus())
      return
    }
    if (settings.replyCollapsed) props.onSetReplyCollapsed(false)
    if (autoCollapse) setReplyForceOpen(true)
  }
  const closeReply = () => {
    if (isMobile) return (document.activeElement as HTMLElement | null)?.blur()
    props.onSetReplyCollapsed(true)
    setReplyForceOpen(false)
  }
  /** フッターの出し入れ(下で作る。openReply から出すため) */
  const hideBarsRef = useRef<{ reveal: () => void }>(undefined)
  /** フッターの入力欄で書いているか(書いているあいだはスクロールしてもフッターを隠さない) */
  const composing = useRef(false)
  /** 書き込み欄に何かする(しまっていたら出してから) */
  const pendingReply = useRef<((h: ReplyFormHandle) => void) | undefined>(undefined)
  const withReply = (fn: (h: ReplyFormHandle) => void) => {
    if (!replyCollapsed && replyRef.current) return fn(replyRef.current)
    pendingReply.current = fn
    openReply()
  }
  const withReplyRef = useRef(withReply)
  withReplyRef.current = withReply
  useEffect(() => {
    if (replyCollapsed || !pendingReply.current || !replyRef.current) return
    const fn = pendingReply.current
    pendingReply.current = undefined
    fn(replyRef.current)
  })
  /** アンカーの番号をスレの中の番号に読み替えるもの(2ch はそのまま、4chan などは板の本当の番号から) */
  const resolveAnchor = useMemo(() => makeAnchorResolver(log.posts, props.anchorTarget), [log.posts, props.anchorTarget])
  /** 画面に出す番号と、返信で付けるアンカーの番号(板の本当の番号があればそれ) */
  const refOf = (no: number) => dataRef.current.byNo.get(no)?.ref ?? no
  /**
   * 返信で書き込み欄に入れる文。ふつうは「>>番号」(選んだ文があれば、そのあとに「>選んだ文」)。
   * 文章で引用する掲示板(ふたば)は番号を付けず、「>選んだ文」、選んでいなければ「>そのレスの最初の行」
   * (画像だけのレスは画像のファイル名)を入れる。ふたばの引用元へのリンクは、この文から元のレスを探す
   */
  const replyText = (no: number, quote?: string) => {
    const quoted = (text: string) => `${text.split('\n').map((l) => `>${l}`).join('\n')}\n`
    if (!props.textQuotes) return `>>${refOf(no)}\n${quote ? quoted(quote) : ''}`
    if (quote) return quoted(quote)
    const lines = (dataRef.current.byNo.get(no)?.body ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
    const text = lines.find((l) => !/^https?:\/\//.test(l) && quotedText(l) === undefined)
    const image = lines.find((l) => /^https?:\/\//.test(l))?.split('/').at(-1)
    return quoted(text ?? image ?? `No.${refOf(no)}`)
  }
  /** 文章で引用する掲示板(ふたば)の、引用の行から引用元へのつながり */
  const quoteLinks = useMemo(() => (props.textQuotes ? quoteLinksOf(log.posts) : undefined), [props.textQuotes, log.posts])
  /** レスに渡す、そのレスの引用のつながり(文章で引用しない掲示板は undefined) */
  const quotesOf = useCallback((no: number) => (quoteLinks ? (quoteLinks.get(no) ?? NO_QUOTES) : undefined), [quoteLinks])
  const anchorCounts = useMemo(() => countAnchors(log.posts, resolveAnchor, quoteLinks), [log.posts, resolveAnchor, quoteLinks])
  /**
   * 画像をぼかすレス(グロ注意)。目印の言葉(「グロ」など)を含むレスが返信した先と、その言葉を書いたレス自身。
   * 画像のないレスが入っていても、ぼかすものがないだけ
   */
  const grossNos = useMemo(() => {
    const words = settings.blurGross ? settings.grossWords.map((w) => normalizeForSearch(w.trim())).filter(Boolean) : []
    if (words.length === 0) return undefined
    const set = new Set<number>()
    for (const p of log.posts) {
      const text = normalizeForSearch(p.body)
      if (!words.some((w) => text.includes(w))) continue
      set.add(p.no)
      for (const n of targetsOfPost(p, resolveAnchor, quoteLinks)) set.add(n)
    }
    return set
  }, [settings.blurGross, settings.grossWords, log.posts, resolveAnchor, quoteLinks])
  /** 自分の書き込みへのアンカーを含むレス */
  const replyToOwn = useMemo(() => {
    const set = new Set<number>()
    if (ownNos.size === 0) return set
    for (const p of log.posts) if (targetsOfPost(p, resolveAnchor, quoteLinks).some((n) => ownNos.has(n) && n !== p.no)) set.add(p.no)
    return set
  }, [log.posts, ownNos, resolveAnchor, quoteLinks])
  const idCounts = useMemo(() => countIds(log.posts), [log.posts])
  // アイコンの右下の数字(設定でワッチョイを使うなら、ワッチョイごとに数える)
  const iconCounts = useMemo(() => countIconKeys(log.posts, settings.iconFromWatchoi), [log.posts, settings.iconFromWatchoi])
  /**
   * このスレで一番多い名前(名無し)。板の setting.txt の既定の名前は、使っていない掲示板が多いので、スレの中で数えて決める。
   * トリップ・キャップ(◆・★ から後ろ)は除いて数え、レスの 3 割以上(10 件以上のスレ)がその名前なら名無しとみなす
   */
  const commonName = useMemo(() => mostCommonName(log.posts), [log.posts])
  // レスの見せ方(名無しの省略・空行の扱い)と、スレ主の ID
  const display = useMemo(
    () => ({
      nonameName: props.nonameName,
      extraNonames: commonName ? [...(props.extraNonames ?? []), commonName] : props.extraNonames,
      omitNoname: props.omitNoname ?? settings.omitNoname,
      tidyBlankLines: settings.tidyBlankLines,
      watchoiShort: settings.watchoiShort,
      splitIcon: props.splitPostIcon,
    }),
    [props.nonameName, props.extraNonames, commonName, props.omitNoname, settings.omitNoname, settings.tidyBlankLines, settings.watchoiShort, props.splitPostIcon],
  )
  const opId = settings.highlightOp && log.posts[0]?.no === 1 ? log.posts[0].id : undefined
  // ── 中身を作るレスの範囲(開く位置の前後から、少しずつ広げる) ──
  /** 開く位置の前後 FIRST_RENDER 件の範囲。レスがまだない(読み込み中)なら、まだ何も作らない(hi 0) */
  const firstWindow = () => {
    const posts = log.posts
    const n = posts.length
    const at = (no: number) => posts.findIndex((p) => p.no >= no)
    const found = (p?: ScrollPosition) => !!p && posts.some((x) => x.no === p.no)
    const closed = closedPosition(props.threadKey)
    // 開く位置(useThreadScroll が動かす先と同じ決まり)
    const t = openTarget({
      saved: props.initialPosition,
      savedFound: found(props.initialPosition),
      closed: found(closed) ? closed : undefined,
      openPosition: settings.openPosition,
      unreadFrom,
      hasUnreadPost: posts.some((p) => p.no === unreadFrom),
      readNo: log.readNo,
    })
    const anchor = t.kind === 'bottom' ? n - 1 : t.kind === 'saved' ? at(t.position.no) : t.kind === 'unread' ? at(t.no) : 0
    if (n === 0) return { lo: 0, hi: 0 }
    const a = anchor < 0 ? n - 1 : anchor
    const lo = Math.max(0, a - FIRST_RENDER / 2)
    const hi = Math.min(n, a + FIRST_RENDER / 2)
    return { lo, hi: hi >= n ? Infinity : hi }
  }
  /** 中身を作るレスの範囲 [lo, hi)(log.posts の位置)。hi が Infinity なら末尾まで(新着もすぐ作る) */
  const [renderWin, setRenderWin] = useState(firstWindow)
  // 読み込み中(レス 0 件)に開いたスレは、レスが届いたところで開く位置の前後に決め直す
  const windowPending = useRef(log.posts.length === 0)
  useLayoutEffect(() => {
    if (!windowPending.current || log.posts.length === 0) return
    windowPending.current = false
    setRenderWin(firstWindow())
    // レスが初めて届いたときだけ
  }, [log.posts.length])
  // 見えている所の前後だけ中身を作り、スクロールに合わせて範囲を動かす(下の仮想スクロール)。PC もスマホも同じ
  const isRendered = useCallback((i: number) => i >= renderWin.lo && i < renderWin.hi, [renderWin])

  /** レスの見た目のスタイル(設定) */
  const variant: PostVariant = effectivePostStyle(settings)
  /** 絞り込みと検索のあとに見えるレス。何も選んでいなければ undefined(全部見える) */
  const matchesFilter = useCallback(
    (p: Post, key: PostFilter) =>
      key === 'own'
        ? ownNos.has(p.no)
        : key === 'popular'
        ? (anchorCounts.get(p.no) ?? 0) >= 3
        : key === 'image'
          ? imageUrlsIn(p.body).length > 0
          : key === 'video'
            ? hasVideo(p.body)
            : hasLink(p.body),
    [anchorCounts, ownNos],
  )
  /** 絞り込みのボタンに出す、当てはまるレスの数(絞り込む前から分かるように) */
  const filterCounts = useMemo(() => {
    const c: Record<PostFilter, number> = { popular: 0, image: 0, video: 0, link: 0, own: 0 }
    for (const p of log.posts) for (const f of FILTERS) if (matchesFilter(p, f.key)) c[f.key]++
    c.own = log.posts.reduce((n, p) => (ownNos.has(p.no) ? n + 1 : n), 0)
    return c
  }, [log.posts, matchesFilter, ownNos])
  // 全レスを見るので、打っている間は少し遅らせて入力の反応を止めない
  const deferredQuery = useDeferredValue(query)
  const visibleNos = useMemo(() => {
    // 検索: 空白で区切った言葉はすべて含むもの(AND)。番号・名前・ID・本文から探す
    const terms = normalizeForSearch(deferredQuery.trim()).split(/\s+/).filter(Boolean)
    if (filters.size === 0 && terms.length === 0) return undefined
    const set = new Set<number>()
    for (const p of log.posts) {
      if (filters.size > 0) {
        if (![...filters].some((f) => matchesFilter(p, f))) continue
      }
      if (terms.length > 0) {
        const hay = searchTextOf(p)
        if (!terms.every((w) => hay.includes(w))) continue
      }
      set.add(p.no)
    }
    return set
  }, [log.posts, filters, deferredQuery, matchesFilter])

  const visiblePosts = useMemo(
    () => (visibleNos ? log.posts.filter((p) => visibleNos.has(p.no)) : log.posts),
    [log.posts, visibleNos],
  )
  const byNo = useMemo(() => new Map(log.posts.map((p) => [p.no, p])), [log.posts])
  /** 直前に見えているレスと同じ ID(続けて書いた)か */
  const continuedFrom = useCallback(
    (i: number) => {
      const p = log.posts[i]
      const prev = log.posts[i - 1]
      if (!p?.id || !prev || prev.id !== p.id || isNg(prev)) return false
      return visibleNos === undefined || (visibleNos.has(prev.no) && visibleNos.has(p.no))
    },
    [log.posts, isNg, visibleNos],
  )
  /**
   * 続けて並んだあぼーんのまとまり(先頭のレス番号 → まとまり)と、各レスが入っているまとまりの先頭。
   * 2 つ以上続いたときだけ。「ここから未読」の所では切る(区切りの線が隠れないように)。絞り込み中はまとめない。
   * 透明あぼーんの設定では、ユーザーの NG(描かない)は数えずに飛ばし、自動 NG だけをまとめる
   */
  const ngRuns = useMemo(() => {
    const runs = new Map<number, { nos: number[]; auto: number; ai: number; rule: number }>()
    const firstOf = new Map<number, number>()
    if (!settings.groupNg || visibleNos) return { runs, firstOf }
    let cur: number[] = []
    const close = () => {
      // AI NG の「隠す」は数えない(何も出さないので)
      const aiHidden = (no: number) => {
        const r = autoNg.get(no)
        return r?.kind === 'ai' && r.hit.rule.show === 'hide' && !isNgRule(byNo.get(no)!)
      }
      const shown = cur.filter((no) => (settings.ngMode !== 'hide' || autoNg.has(no)) && !aiHidden(no))
      if (shown.length >= 2) {
        const machine = shown.filter((no) => autoNg.has(no) && !isNgRule(byNo.get(no)!))
        const ai = machine.filter((no) => autoNg.get(no)?.kind === 'ai').length
        runs.set(cur[0], { nos: cur, auto: machine.length - ai, ai, rule: shown.length - machine.length })
        for (const no of cur) firstOf.set(no, cur[0])
      }
      cur = []
    }
    for (const p of log.posts) {
      if (p.no === unreadFrom) close()
      if (isNg(p)) cur.push(p.no)
      else close()
    }
    close()
    return { runs, firstOf }
  }, [settings.groupNg, settings.ngMode, visibleNos, log.posts, isNg, isNgRule, autoNg, byNo, unreadFrom])
  /** 広げたまとまり(先頭のレス番号) */
  const [openRuns, setOpenRuns] = useState<Set<number>>(new Set())
  const toggleRun = useCallback((first: number) =>
    setOpenRuns((s) => {
      const next = new Set(s)
      if (next.has(first)) next.delete(first)
      else next.add(first)
      return next
    }), [])
  /**
   * Discord・LINE 風: 本文がアンカーで始まるレスの、引用元の番号・本文の頭・ID。
   * レスごとに 1 回だけ作って使い回す(描くたびに作ると memo したレスが全部描き直しになり、J・K が重くなる)
   */
  const replyPreviews = useMemo(() => {
    const m = new Map<number, { no: number; text: string; id?: string }>()
    if (variant !== 'discord' && variant !== 'line') return m
    for (const p of log.posts) {
      // 本文がアンカーで始まるか、文章で引用しているレス(ふたば)の、最初の引用元
      // id は引用の行のアイコンの種。レスのアイコンと同じ決め方(設定でワッチョイがあればワッチョイ、なければ ID)
      const no = /^\s*(?:>>|＞＞)\d/.test(p.body) ? anchorTargets(p.body, resolveAnchor)[0] : quoteLinks?.get(p.no)?.values().next().value
      if (no === undefined) continue
      const src = no === p.no ? undefined : byNo.get(no)
      if (!src) continue
      const ng = isNg(src)
      m.set(p.no, { no, text: ng ? 'あぼーん' : src.body.replace(/\s+/g, ' ').slice(0, 80), id: ng ? undefined : (settings.iconFromWatchoi ? watchoiOf(src.name) : undefined) ?? src.id })
    }
    return m
  }, [variant, log.posts, byNo, isNg, resolveAnchor, quoteLinks, settings.iconFromWatchoi])
  const replyPreviewOf = useCallback((p: Post) => replyPreviews.get(p.no), [replyPreviews])
  /** レス番号 → そのレスにアンカーを付けているレスの番号 */
  const replies = useMemo(() => {
    const map = new Map<number, number[]>()
    for (const p of log.posts) {
      for (const n of new Set(targetsOfPost(p, resolveAnchor, quoteLinks))) {
        if (n === p.no) continue
        const list = map.get(n)
        if (list) list.push(p.no)
        else map.set(n, [p.no])
      }
    }
    return map
  }, [log.posts, resolveAnchor, quoteLinks])


  /** レス番号 → 並びの位置(頭を省くかの判断を、番号から引くため) */
  const indexOfNo = useMemo(() => new Map(log.posts.map((p, i) => [p.no, i])), [log.posts])
  const isContinuedPost = useCallback(
    (p: Post) => {
      const i = indexOfNo.get(p.no)
      return i !== undefined && continuedHead(p, i, variant, anchorCounts, ownNos, replyPreviewOf, continuedFrom, p.no === unreadFrom && unreadFrom > 1)
    },
    [indexOfNo, variant, anchorCounts, ownNos, replyPreviewOf, continuedFrom, unreadFrom],
  )
  /** レスの高さを変える設定。変わったら、覚えた高さと見積もりの補正を使わない */
  const layoutKey = useMemo(
    () =>
      [
        variant,
        settings.idPosition,
        settings.idStyle,
        settings.fontPx,
        settings.mobileFontPx,
        settings.contentBasePx,
        settings.postBodyPx,
        settings.postHeadPx,
        settings.postLineHeight,
        settings.postPadPx,
        settings.postThumbSize,
        settings.thumbLoad === 'never',
        settings.showLinkPreview,
        settings.urlShorten,
        settings.tidyBlankLines,
      ].join('|'),
    [variant, settings.idPosition, settings.idStyle, settings.fontPx, settings.mobileFontPx, settings.contentBasePx, settings.postBodyPx, settings.postHeadPx, settings.postLineHeight, settings.postPadPx, settings.postThumbSize, settings.thumbLoad === 'never', settings.showLinkPreview, settings.urlShorten, settings.tidyBlankLines],
  )

  const {
    scrollToPost,
    scrollToUnread,
    jumpToBottom,
    jumpToTop,
    page,
    showJump,
    flashNos,
    intrinsicHeight,
    getPosition,
    restorePosition,
    userMoveCount,
    noteUserMove,
    flushRead,
    rememberRendered,
  } = useThreadScroll({
    rootRef: ref,
    listRef,
    headerRef,
    filtering: visibleNos !== undefined,
    threadKey: props.threadKey,
    log,
    byNo,
    isCollapsed: isNg,
    isContinued: isContinuedPost,
    layoutKey,
    unreadFrom,
    active: props.active,
    initialPosition: props.initialPosition,
    onSavePosition: props.onSavePosition,
    onRead,
    openPosition: settings.openPosition,
    autoScrollOnNew: settings.autoScrollOnNew,
    showThumbnails: settings.thumbLoad !== 'never',
    showLinkPreview: settings.showLinkPreview,
    jumpTo: props.jumpTo,
  })

  // 仮想スクロール: スクロールしたら、見えているレスの前後だけ中身を作るよう、範囲を動かす(WIN_BEFORE・WIN_AFTER)。
  // 範囲の外のレスは、覚えた高さ(なければ見積もり)の空の箱にする(枠は全部あるので、既読・ミニマップ・キー操作はそのまま効く)
  const renderWinRef = useRef(renderWin)
  renderWinRef.current = renderWin
  const filteringRef = useRef(false)
  filteringRef.current = visibleNos !== undefined
  useEffect(() => {
    const root = ref.current
    if (!root) return
    let raf = 0
    const update = () => {
      raf = 0
      const frames = framesIn(listRef.current)
      const n = frames.length
      if (n === 0) return
      const box = root.getBoundingClientRect()
      // 見えている最初のレス(log.posts の位置。枠は log.posts と同じ順に並んでいる)。半分ずつ探す
      let first = firstAfter(n, (i) => (frames[i].hidden ? undefined : frames[i].getBoundingClientRect().bottom), box.top)
      if (first === n) {
        if (filteringRef.current) return
        first = n - 1
      }
      // 隠れた枠は高さ 0 で top も 0 なので、飛ばして測る(飛ばさないと範囲が全件まで広がる)
      let last = first
      for (let i = first + 1; i < n; i++) {
        if (frames[i].hidden) continue
        if (frames[i].getBoundingClientRect().top > box.bottom) break
        last = i
      }
      const w = renderWinRef.current
      const hi = w.hi === Infinity ? n : w.hi
      const nearTop = w.lo > 0 && first < w.lo + WIN_MARGIN
      const nearBottom = w.hi !== Infinity && last > hi - WIN_MARGIN
      // 広すぎる(開いたときの範囲や、飛んだあと)ときも縮める
      const tooWide = hi - w.lo > (last - first + WIN_BEFORE + WIN_AFTER) * 2
      if (!nearTop && !nearBottom && !tooWide) return
      const nextHi = last + WIN_AFTER
      const next = { lo: Math.max(0, first - WIN_BEFORE), hi: nextHi >= n ? Infinity : nextHi }
      if (next.lo === w.lo && next.hi === w.hi) return
      // 中身を外す前に、いまの高さを覚えておく(箱に戻しても高さが変わらず、スクロールバーも動かないように)
      rememberRendered()
      setRenderWin(next)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      root.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [rememberRendered])
  // 絞り込みが変わっても位置が同じなら scroll は来ないので、当たったレスの中身を作るよう範囲を見直す
  useEffect(() => {
    ref.current?.dispatchEvent(new Event('scroll'))
  }, [visibleNos])

  // スレが終わったら(dat 落ち・上限(2ch は 1000)到達)、一番下に次スレの候補を出す。ヘッダーのボタンでも出せる
  const ended = log.status === 'archived' || (props.maxPosts !== undefined && log.posts.length >= props.maxPosts)
  const [showNext, setShowNext] = useState(false)

  // ヘッダー・フッター・︙ に並べる操作。どこに置くかは設定(ボタンの配置)で決まる
  const placements = useMemo(
    () => resolvePlacements('thread', isMobile ? settings.mobileBarLayout : settings.barLayout, isMobile),
    [settings.barLayout, settings.mobileBarLayout],
  )
  const allBarActions: BarAction[] = [
    // スマホだけの操作(置き場所に出ていなければ、placements にないので並ばない)
    ...(props.onBackToList ? [{ id: 'back', label: '一覧に戻る', icon: 'arrow_back', onClick: props.onBackToList }] : []),
    { id: 'top', label: '先頭へ', icon: 'vertical_align_top', onClick: () => jumpToTop() },
    { id: 'bottom', label: '一番下へ', icon: 'vertical_align_bottom', onClick: () => jumpToBottom() },
    ...(props.onSubmitPost ? [{ id: 'reply', label: '書き込む', icon: 'edit', onClick: () => openReply() }] : []),
    ...(props.onOpenDrawer ? [{ id: 'drawer', label: 'メニュー', icon: 'menu', onClick: props.onOpenDrawer }] : []),
    { id: 'search', label: 'レス検索', icon: 'search', active: searchActive || !!query, onClick: () => setSearchActive((v) => !v) },
    {
      id: 'favorite',
      label: props.isFavorite ? 'お気に入りのスレから外す' : 'お気に入りのスレに足す',
      icon: 'star',
      active: props.isFavorite,
      activeColor: 'var(--c-mark-fav)',
      tint: 'var(--c-mark-fav)',
      fillWhenActive: true,
      onClick: props.onToggleFavorite,
    },
    ...(props.onOpenBoard ? [{ id: 'openBoard', label: '板に戻る', icon: 'list', onClick: props.onOpenBoard }] : []),
    ...(props.onFindNext
      ? [
          {
            id: 'findNext',
            label: '次スレを探す',
            icon: 'skip_next',
            active: ended,
            onClick: () => {
              setShowNext(true)
              jumpToBottom()
            },
          },
        ]
      : []),
    ...(props.onSubmitPost
      ? [
          {
            id: 'replyToggle',
            label: replyCollapsed ? '書き込み欄を出す' : '書き込み欄をしまう',
            icon: replyCollapsed ? 'edit' : 'keyboard_hide',
            onClick: () => (replyCollapsed ? openReply() : closeReply()),
          },
          {
            id: 'replyLayout',
            label: replyLayout === 'bottom' ? '書き込み欄を右に置く' : '書き込み欄を下に置く',
            icon: replyLayout === 'bottom' ? 'view_sidebar' : 'view_agenda',
            onClick: () => props.onChangeReplyLayout(replyLayout === 'bottom' ? 'right' : 'bottom'),
          },
        ]
      : []),
    { id: 'gallery', label: '画像一覧', icon: 'photo_library', active: galleryOpen, onClick: () => setGalleryOpen(true) },
    ...(props.onUpdateSetting
      ? [
          {
            id: 'style',
            label: '表示スタイル',
            icon: 'palette',
            active: styleOpen,
            onClick: () => setStyleOpen(true),
          },
          {
            // 帯に置いたときのボタン。中身は表示スタイルの画面と同じ(︙ には並べない。foldMenuActions)
            id: 'fontSize',
            label: '文字の大きさ・余白',
            icon: 'format_size',
            onClick: () => setStyleOpen(true),
          },
        ]
      : []),
    { id: 'delete', label: 'ログを削除して閉じる (Shift+Delete)', icon: 'delete', tint: 'var(--c-mark-danger)', onClick: props.onDeleteLog },
    { id: 'copyUrl', label: 'URL をコピー', icon: 'link', onClick: () => copyText(props.threadUrl, 'URL をコピーしました') },
    {
      id: 'share',
      label: '共有',
      icon: 'share',
      // 帯に置いたときは、いちばん使うリンクのコピーにする
      onClick: () => copyText(props.threadUrl, 'リンクをコピーしました'),
      children: shareItems({ title: log.title, url: props.threadUrl, copy: copyText, open: (url) => void openUrl(url) }),
    },
    { id: 'openBrowser', label: 'ブラウザで開く', icon: 'open_in_new', onClick: props.onOpenInBrowser },
    {
      id: 'save',
      label: 'スレを保存(HTML・テキスト)',
      icon: 'save',
      onClick: () =>
        void saveThread({ title: log.title, url: props.threadUrl, posts: log.posts, savedAt: new Date() }).then(
          (path) => path && showQuick(true, `保存しました: ${path}`),
          (e: unknown) => showQuick(false, `保存できませんでした: ${e instanceof Error ? e.message : String(e)}`),
        ),
    },
    {
      id: 'refresh',
      label: '更新',
      icon: 'refresh',
      disabled: props.loading,
      // 押せるかは押した時点で決める(描いた時刻で決めると、クールダウンが明けても描き直すまで押せない)
      // クールダウン中に押したときは、取りに行かずに既読の位置だけ引き直す(App の refreshThread)
      onClick: () => void props.onRefresh(),
      // 帯に置いたときは、クールダウンの残りが見えるボタンにする
      render: () => (
        <RefreshButton
          className={ICON_BTN}
          onClick={() => void props.onRefresh()}
          loading={props.loading}
          readyAt={props.refreshReadyAt}
          cooldownMs={REFRESH_COOLDOWN_MS}
          coolingAction="既読の位置(ここから未読)だけ更新します"
        />
      ),
    },
  ]
  /** ボタンの並び(設定で並べ替えたとき) */
  const barOrder = (isMobile ? settings.mobileBarOrder : settings.barOrder).thread
  // その画面(PC かスマホか)で使わない操作は、︙ の中にも出さない
  const barActions = orderBy(allBarActions.filter((a) => placements[a.id] !== undefined), barOrder)
  const headerMenu = useBarContextMenu('thread', barActions)
  const refreshFab = isMobile && settings.showRefreshFab
  // スマホで書き込める掲示板は、フッターに入力欄を置くので、いつもフッターがある
  const hasFooter = barActions.some((a) => inBar(placements[a.id], 'footer')) || (isMobile && !!props.onSubmitPost)
  const footerRef = useRef<HTMLDivElement>(null)
  // 一番下へ・新着の札は、フッターが出ている間はその上に上げる(重ならないように)。--footer-offset で動かす
  const footerShown = useRef(true)
  // スマホ: 下へスクロールするとヘッダーとフッターを隠し、上へスクロールすると戻す
  const hideBars = useHideOnScroll(
    headerRef,
    footerRef,
    useCallback((visible: boolean) => {
      footerShown.current = visible
      mainRef.current?.style.setProperty('--footer-offset', visible ? `${footerRef.current?.offsetHeight ?? MOBILE_BAR_H}px` : '0px')
    }, []),
    // 書いている途中・書き込みの返事を出している間は、スクロールしてもフッターを隠さない
    useCallback(() => composing.current || !!footerRef.current?.querySelector('textarea')?.value || !!footerRef.current?.querySelector('[data-post-result]'), []),
  )
  hideBarsRef.current = hideBars
  // フッターの入力欄が伸び縮みしたら(何行も書いた・＋の欄を開いた)、上に浮かせたボタンの位置も合わせる
  useEffect(() => {
    const el = footerRef.current
    if (!isMobile || !el) return
    const observer = new ResizeObserver(() => {
      // --footer-height は隠れていてもフッターの高さ(ミニマップは、フッターが隠れても伸ばさずにこの分を空けておく)
      mainRef.current?.style.setProperty('--footer-height', `${el.offsetHeight}px`)
      if (footerShown.current) mainRef.current?.style.setProperty('--footer-offset', `${el.offsetHeight}px`)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasFooter])

  /** Esc を 2 回押して、選んでいるレスの印を隠しているか(選んでいる場所は残す) */
  const [cursorHidden, setCursorHidden] = useState(false)
  /** 最後に Esc を押した時刻(2 回押しを見分ける) */
  const lastEsc = useRef(0)
  /** キーを読むもの(「G G」のような 2 つ続きのキーを見分けるため、直前のキーを覚えている) */
  const readKey = useRef(createKeyReader())
  /** ヘッダーの高さ(下の端をつかんで変える) */
  const titleRowRef = useRef<HTMLElement>(null)
  const headerDrag = useDragHeight(settings.threadHeaderHeight ?? 0, (h) => props.onHeaderHeight?.(h), { min: 40, max: 200 })
  /** 引き伸ばしたときのスレタイの字の大きさ(rem。既定の 80px で 1)。引き伸ばしていなければ undefined */
  const titleRem = headerDrag.height > 0 ? Math.min(2.2, Math.max(0.85, headerDrag.height / 80)) : undefined
  /** いまのキーが、押し続けたときの自動の連打か */
  const keyRepeat = useRef(false)
  /** 選んでいるレス。J・K で送ったレスと、押したレス。枠を強調色にし、Shift+E で返信する */
  const [cursorNo, setCursorNo] = useState<number>()
  // 新着が届いた・開き直した(「ここから未読」が変わった)ら、読んだところより前で選んでいたレスは忘れる(次の J は新着の頭から)。
  // 読んだところの最後のレスを選んでいたなら残す(新着があれば、J でそのまま新着の頭へ進む)
  useEffect(() => {
    setCursorNo((c) => keepCursorOnNew(c, unreadFrom))
  }, [unreadFrom])
  /** キーで呼べる、スレ表示の操作(描くたびに作り直し、いまの値を使う) */
  const threadKeyActions = useRef<Partial<Record<KeyAction, () => void>>>({})
  /** 選んでいるレスの枠(見えているもの)。なければ undefined */
  const cursorFrame = () => (cursorNo === undefined ? null : ref.current?.querySelector<HTMLElement>(`[data-post="${cursorNo}"]`))
  const cursorFrameRef = useRef(cursorFrame)
  cursorFrameRef.current = cursorFrame
  /**
   * レスの中のリンク・画像のボタンに残ったフォーカスを外す。残っていると、Enter がそのボタンを押してしまい、
   * 前に選んでいたレスの画像が開く(ビューアーを閉じたあとや、レスを押したあとに残る)
   */
  const releaseFocus = () => {
    const a = document.activeElement
    if (a instanceof HTMLElement && ref.current?.contains(a)) a.blur()
  }
  /**
   * 隠れていないレスの枠と、見えているもの(ヘッダーの下から画面の下まで)。上から順。
   * 枠は上から順に並んでいるので、見えているものは半分ずつ探す(全部の枠を測ると、キーを押すたびに 1000 回測る)
   */
  const visibleFrames = () => {
    const root = ref.current
    if (!root) return { root: undefined, frames: [] as HTMLElement[], seen: [] as HTMLElement[], seenFrom: 0, viewTop: 0, box: undefined }
    const box = root.getBoundingClientRect()
    const viewTop = box.top + (headerRef.current?.offsetHeight ?? 0)
    const frames = framesIn(listRef.current).filter((f) => !f.hidden)
    const view = { top: viewTop, bottom: box.bottom }
    const seenFrom = firstAfter(frames.length, (i) => frames[i].getBoundingClientRect().bottom, viewTop + 4)
    const seen: HTMLElement[] = []
    for (let i = seenFrom; i < frames.length && isSeen(spanOf(frames[i]), view); i++) seen.push(frames[i])
    return { root, frames, seen, seenFrom, viewTop, box }
  }
  /** 先頭へ・末尾へ・未読へ 飛んだあとに、選ぶレスを飛んだ先に合わせる(描き終わってから測る) */
  const selectAfterJump = (pick: 'first' | 'last' | number) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        releaseFocus()
        setCursorHidden(false)
        if (typeof pick === 'number') return setCursorNo(pick)
        const { frames } = visibleFrames()
        const f = pick === 'first' ? frames[0] : frames.at(-1)
        if (f) setCursorNo(Number(f.dataset.post))
      }),
    )
  /**
   * 1 画面・半画面送るとき、選ぶレスもいっしょに送る。選んでいるレスが画面のどの高さにあったかを保ったまま、
   * 送った先でその高さにあるレスを選ぶ(見えていなければ画面の一番上の高さで)。端まで来たら端のレス
   */
  const pageWithCursor = (dir: 1 | -1, half = false) => {
    releaseFocus()
    setCursorHidden(false)
    const { frames, seen, viewTop } = visibleFrames()
    const cur = cursorNo === undefined ? undefined : frames[frameIndexOf(frames, cursorNo)]
    const y = (cur && seen.includes(cur) ? Math.max(cur.getBoundingClientRect().top, viewTop) : viewTop) + 1
    // page はなめらかに送り始めるだけなので、ここではまだ動いていない(送る前の位置を測れる)
    const moved = page(dir, half)
    const i = pickAfterPageAt(frames.length, (k) => spanOf(frames[k]), y, moved, dir)
    if (i !== undefined) setCursorNo(Number(frames[i].dataset.post))
  }
  /**
   * 選んでいるレスを 1 つ動かす。画面は、選んだレスが外に出るときだけ最小限動かす(スレ一覧の J・K と同じ)。
   * まだ選んでいなければ、画面に見えている一番上のレスから始める
   */
  const moveCursor = (d: 1 | -1) => {
    releaseFocus()
    const { root, frames, seen, seenFrom, viewTop, box } = visibleFrames()
    if (!root || !box || frames.length === 0) return
    const view = { top: viewTop, bottom: box.bottom }
    const i = cursorNo === undefined ? -1 : frameIndexOf(frames, cursorNo)
    // まだ選んでいないとき(新着が届いた・開き直した直後)に J を押したら、「ここから未読」のレスから始める(新着から読む)。
    // 見えていなくても、まだ画面より下にある(一番下まで読んでいて、更新で下に届いた)ならそこへ送る
    const unreadAt =
      cursorNo === undefined && d > 0 && unreadFrom > 1
        ? frames.findIndex((f) => Number(f.dataset.post) >= unreadFrom && f.getBoundingClientRect().bottom > viewTop + 4)
        : -1
    // 決め方は utils/cursor.ts(画面から離れていたら選び直す、Esc 2 回で隠していたら出し直す など)
    const next = stepCursor({
      count: frames.length,
      current: i,
      onScreen: i >= 0 && isNear(spanOf(frames[i]), view),
      hidden: cursorHidden,
      d,
      seen: seen.map((_, k) => seenFrom + k),
      startAt: unreadAt >= 0 ? unreadAt : undefined,
    })
    setCursorHidden(false)
    if (next === undefined || next === 'stay') return
    const target = frames[next]
    setCursorNo(Number(target.dataset.post))
    // 選んだレスが外に出るときだけ、余白を残して(なめらかに)送る。押し続けている間はアニメーションさせない。
    // 行き先はレスの位置から毎回測る(画面の外で省いていたレスが描かれて高さが変わっても、ずれないように)
    const delta = followDelta(spanOf(target), view, d, CURSOR_MARGIN)
    if (delta === 0) return
    const anchor = target.getBoundingClientRect().top - delta
    animateScroll(root, () => root.scrollTop + target.getBoundingClientRect().top - anchor, keyRepeat.current ? 0 : CURSOR_SCROLL_MS)
  }

  /**
   * 選んでいるレス 1 つへの操作(本文とポップアップで共通)。h はそのレスに渡しているハンドラ(ポップアップなら 1 段深いもの)。
   * Enter: 画像・動画があればビューアー、なければ返信、それもなければアンカーツリー
   */
  const actOnPost = (action: KeyAction, p: Post, el: HTMLElement, h: PostHandlers): boolean => {
    switch (action) {
      case 'openPost': {
        const a = document.activeElement
        if (a instanceof HTMLElement && el.contains(a)) a.blur()
        const media = [...imageUrlsIn(p.body), ...videoFileUrlsIn(p.body), ...youtubeLinksIn(p.body).map((v) => v.url)]
        if (media.length > 0) setLightbox({ urls: media, index: 0, post: p })
        else if ((replies.get(p.no)?.length ?? 0) > 0) h.onReplies?.(p.no, el)
        else if (anchorTree(p.no, log.posts, resolveAnchor, quoteLinks).length > 1) h.onBody?.(p.no, el)
        else showQuick(false, `>>${refOf(p.no)} には画像も返信もアンカーもありません`)
        return true
      }
      case 'anchorTree':
        if (anchorTree(p.no, log.posts, resolveAnchor, quoteLinks).length > 1) h.onBody?.(p.no, el)
        else showQuick(false, `>>${refOf(p.no)} にはつながるレスがありません`)
        return true
      case 'copyPost':
        void navigator.clipboard.writeText(p.body).then(
          () => showQuick(true, `>>${refOf(p.no)} の本文をコピーしました`),
          () => showQuick(false, 'コピーできませんでした'),
        )
        return true
      case 'postsById':
        if (p.id) h.onId?.(p.id, el)
        return true
      case 'replyToPost': {
        if (!canReply) return true
        // そのレスの本文の一部を選んでいたら、選んだ所を「>」を付けて引用する(引用して返信)
        const quote = selectedTextIn(el)
        setPopups([])
        withReplyRef.current((r) => r.insert(replyText(p.no, quote)))
        return true
      }
      default:
        return false
    }
  }
  /** 本文で選んでいるレスへの操作 */
  const actOnCursor = (action: KeyAction) => {
    const p = cursorNo === undefined ? undefined : byNo.get(cursorNo)
    const el = cursorFrame()
    if (!p || !el) return
    setCursorHidden(false)
    actOnPost(action, p, el, mainHandlers)
  }
  threadKeyActions.current = {
    nextPost: () => moveCursor(1),
    prevPost: () => moveCursor(-1),
    openPost: () => actOnCursor('openPost'),
    anchorTree: () => actOnCursor('anchorTree'),
    copyPost: () => actOnCursor('copyPost'),
    postsById: () => actOnCursor('postsById'),
    pageDown: () => pageWithCursor(1),
    pageUp: () => pageWithCursor(-1),
    halfDown: () => pageWithCursor(1, true),
    halfUp: () => pageWithCursor(-1, true),
    top: () => {
      jumpToTop()
      selectAfterJump('first')
    },
    bottom: () => {
      jumpToBottom()
      selectAfterJump('last')
    },
    unread: () => {
      scrollToUnread(unreadFrom, 'animate')
      if (unreadFrom > 1 && byNo.has(unreadFrom)) selectAfterJump(unreadFrom)
    },
    refresh: () => void props.onRefresh(),
    // 検索を開く。外したばかりの言葉があれば戻して、すぐその言葉で探す(打ち直すときのために、言葉は選んだ状態にする)
    search: () => {
      if (!query && lastQuery.current) setQuery(lastQuery.current)
      setSearchActive(true)
      requestAnimationFrame(() => {
        searchRef.current?.focus()
        searchRef.current?.select()
      })
    },
    reply: () => withReplyRef.current((h) => h.focus()),
    // 選んでいるレス(J・K で送った・押した)への返信を書き込み欄に入れる。選んでいなければ一番上に見えているレス
    replyToPost: () => {
      if (cursorNo !== undefined) return actOnCursor('replyToPost')
      const no = getPosition()?.no
      if (!canReply || no === undefined) return
      withReplyRef.current((h) => h.insert(replyText(no)))
    },
    favorite: () => props.onToggleFavorite?.(),
    gallery: () => setGalleryOpen(true),
    copyUrl: () =>
      void navigator.clipboard.writeText(props.threadUrl).then(
        () => showQuick(true, 'スレの URL をコピーしました'),
        () => showQuick(false, 'コピーできませんでした'),
      ),
    findNext: () => {
      if (!props.onFindNext) return
      setShowNext(true)
      jumpToBottom()
    },
  }

  // キー操作(設定で割り当てを変えられる)。開いているタブで、入力欄にいないときだけ。
  // ポップアップや画像を見ているときは、後ろのスレ表示を動かさない
  const keymap = useMemo(() => resolveKeymap(settings.keymap), [settings.keymap])
  useEffect(() => {
    if (!keysOn || lightbox || popups.length > 0) return
    const onKey = (e: KeyboardEvent) => {
      if (modalOpen()) return // ダイアログが開いている間は、後ろの画面を動かさない
      // F5・Ctrl+R はアプリ全体で扱う(App.tsx)ので、ここでは見ない
      if (e.defaultPrevented || isReloadKey(e)) return
      const t = e.target as HTMLElement | null
      if (isTypingTarget(t)) return
      // Tab・Shift+Tab: 選んでいるレスの中のリンク・アンカー・画像を順に選ぶ(Enter で開く)。レスを選んでいなければ普通の Tab
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && cursorFrameRef.current) {
        const frame = cursorFrameRef.current()
        if (frame) {
          const items = tabItems(frame)
          e.preventDefault()
          if (items.length === 0) return
          cycleTabItems(items, e.shiftKey).scrollIntoView({ block: 'nearest' })
          return
        }
      }
      // ボタンやリンクの上の Enter は、そのボタンを押すのに使う
      if (e.key === 'Enter' && t && (/^(BUTTON|A)$/.test(t.tagName) || t.getAttribute('role') === 'button')) return
      const action = readKey.current(keymap, e)
      if (!action) {
        // 数字キー: 1〜4 で絞り込み(人気・画像・動画・リンク)を付け外し、5 で全部表示、PC は 6 で自分の書き込み(割り当てに使っていなければ)
        const n = !e.ctrlKey && !e.altKey && !e.metaKey && (isMobile ? /^[1-5]$/ : /^[1-6]$/).test(e.key) ? Number(e.key) : 0
        if (!n) return
        e.preventDefault()
        if (n === 5) return setFilters(new Set())
        const key = n === 6 ? OWN_FILTER.key : FILTERS[n - 1].key
        setFilters((f) => togglePostFilter(f, key))
        return
      }
      // スレ表示の操作だけをここで受ける(タブ・戻る などアプリ全体の操作は App.tsx が受ける)
      const run = threadKeyActions.current[action]
      if (!run) return
      e.preventDefault()
      keyRepeat.current = e.repeat
      run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keysOn, lightbox, popups.length, keymap])

  // ── ポップアップの中のキー操作 ──
  // ポップアップ(返信・ID・アンカー・アンカーツリー)が出ている間は、一番上のポップアップの中で、本文と同じキーが使える:
  // J・K・↑↓ でレスを選び、Enter・T・C・Shift+I・Shift+E でそのレスに、Tab でレスの中のリンクなどを選ぶ。Esc で閉じる。
  // ポップアップの中身は開いたときに作って持っているので、選んでいる印は DOM に直接付ける(.popup-cursor)
  const popupKey = useRef<(e: KeyboardEvent) => void>(() => {})
  popupKey.current = (e: KeyboardEvent) => {
    if (modalOpen()) return // ダイアログが開いている間は、後ろの画面を動かさない
    if (e.defaultPrevented || isReloadKey(e)) return
    const t = e.target as HTMLElement | null
    if (isTypingTarget(t)) return
    const box = document.querySelector<HTMLElement>('[data-popup-top]')
    if (!box) return
    const posts = [...box.querySelectorAll<HTMLElement>('article[data-no]')]
    if (posts.length === 0) return
    const cur = box.querySelector<HTMLElement>('article.popup-cursor')
    // ポップアップの上に貼り付いている見出しの高さ(この下に隠れないように送る)
    const headH = box.querySelector<HTMLElement>(':scope > .sticky')?.offsetHeight ?? 0
    const select = (el: HTMLElement) => {
      cur?.classList.remove('popup-cursor')
      el.classList.add('popup-cursor')
      const a = document.activeElement
      if (a instanceof HTMLElement && box.contains(a)) a.blur()
      const r = el.getBoundingClientRect()
      const b = box.getBoundingClientRect()
      const top = b.top + headH
      if (r.top < top || r.height > b.bottom - top) box.scrollTop -= top - r.top + 4
      else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 4
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && cur) {
      const items = tabItems(cur)
      e.preventDefault()
      if (items.length === 0) return
      cycleTabItems(items, e.shiftKey)
      return
    }
    if (e.key === 'Enter' && t && (/^(BUTTON|A)$/.test(t.tagName) || t.getAttribute('role') === 'button')) return
    const action = readKey.current(keymap, e)
    if (!action) return
    if (action === 'nextPost' || action === 'prevPost') {
      e.preventDefault()
      const i = cur ? posts.indexOf(cur) : -1
      const d = action === 'nextPost' ? 1 : -1
      select(posts[i < 0 ? (d > 0 ? 0 : posts.length - 1) : Math.min(posts.length - 1, Math.max(0, i + d))])
      return
    }
    // 先頭・末尾(G G・Home / Shift+G・End)と、1 画面・半画面(Space・PageDown・D・U)。ポップアップの中を送り、選ぶレスもいっしょに
    if (action === 'top' || action === 'bottom') {
      e.preventDefault()
      box.scrollTop = action === 'top' ? 0 : box.scrollHeight
      select(action === 'top' ? posts[0] : posts[posts.length - 1])
      return
    }
    if (action === 'pageDown' || action === 'pageUp' || action === 'halfDown' || action === 'halfUp') {
      e.preventDefault()
      const view = box.clientHeight - headH
      const dir = action === 'pageDown' || action === 'halfDown' ? 1 : -1
      // 選んでいたレスの高さ(なければ見出しのすぐ下)を保って、送った先のレスを選ぶ。端なら端のレス(utils/cursor.ts)
      const b = box.getBoundingClientRect()
      const y = (cur ? Math.max(cur.getBoundingClientRect().top, b.top + headH) : b.top + headH) + 1
      const spans = posts.map(spanOf)
      const before = box.scrollTop
      box.scrollTop += dir * (action.startsWith('half') ? view / 2 : view - 40)
      const hit = posts[pickAfterPage(spans, y, box.scrollTop - before, dir) ?? 0]
      cur?.classList.remove('popup-cursor')
      hit.classList.add('popup-cursor')
      return
    }
    if (!cur) return
    const p = byNo.get(Number(cur.dataset.no))
    // 一番上のポップアップの中身は、開いた数と同じ深さのハンドラで描いてある
    if (p && actOnPost(action, p, cur, handlersFor(popups.length))) e.preventDefault()
  }
  useEffect(() => {
    if (!keysOn || lightbox || popups.length === 0) return
    const onKey = (e: KeyboardEvent) => popupKey.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keysOn, lightbox, popups.length])

  // ── 新着の札 ──
  // 新着が届いて、その頭が画面の外(下にある・絞り込みで隠れている)なら、下から「新着 +N」を少しのあいだ出す。
  // 自動で新着の頭まで送ったときは見えているので出さない(送り終わるのを待ってから確かめる)
  const [newToast, setNewToast] = useState<{ count: number; first: number; seq: number }>()
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  useEffect(() => {
    if (flashNos.size === 0 || !props.active) return
    const first = Math.min(...flashNos.keys())
    const count = flashNos.size
    const check = setTimeout(() => {
      const root = ref.current
      const el = root?.querySelector<HTMLElement>(`[data-post="${first}"]`)
      if (!root) return
      const box = root.getBoundingClientRect()
      const r = el?.getBoundingClientRect()
      const visible = !!el && !el.hidden && !!r && r.top < box.bottom - 8 && r.bottom > box.top
      if (visible) return
      setNewToast({ count, first, seq: Date.now() })
      clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setNewToast(undefined), NEW_TOAST_MS)
    }, 450)
    return () => clearTimeout(check)
  }, [flashNos, props.active])
  // 札が出ているあいだに、自分でスクロールして新着の頭が見えたら(通り越したときも)、札を消す
  // (通り越したあとに札を押すと、上の新着の頭へ戻ってしまうため)
  useEffect(() => {
    const root = ref.current
    if (!newToast || !root) return
    const onScroll = () => {
      const el = root.querySelector<HTMLElement>(`[data-post="${newToast.first}"]`)
      if (!el || el.hidden) return
      if (el.getBoundingClientRect().top < root.getBoundingClientRect().bottom - 8) {
        clearTimeout(toastTimer.current)
        setNewToast(undefined)
      }
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [newToast])
  /** 札を押したら、絞り込みを解いて新着の頭へ */
  const jumpToNew = () => {
    if (!newToast) return
    const first = newToast.first
    setNewToast(undefined)
    if (filters.size > 0 || query) {
      setFilters(new Set())
      setQuery('')
      setSearchActive(false)
    }
    requestAnimationFrame(() => scrollToUnread(first, 'animate'))
  }

  // 開いているタブのあいだだけ、既読をすぐ知らせる関数を App に預ける
  useEffect(() => {
    if (!props.active || !props.registerReadFlush) return
    props.registerReadFlush(flushRead)
    return () => props.registerReadFlush?.(undefined)
  }, [props.active, props.registerReadFlush, flushRead])

  // 絞り込み(人気レス・画像・検索など)を始めたときの位置を覚え、解いたらそこへ戻す。
  // 絞り込んだ一覧の一番下まで見てから解いたときは、全体の一番下へ(読み進めた続きから読めるように)。
  // 何もしないと、レスの高さが大きく変わってスクロールの位置だけが残り、一番上の方へ飛んでしまう
  const filtering = visibleNos !== undefined
  const beforeFilter = useRef<ScrollPosition | undefined>(undefined)
  /** 絞り込んだ一覧がスクロールできる長さか(1 画面に収まるときは「一番下まで見た」と数えない) */
  const filteredScrollable = useRef(false)
  useLayoutEffect(() => {
    const root = ref.current
    if (filtering && root) filteredScrollable.current = root.scrollHeight - root.clientHeight > 80
  }, [visibleNos])
  /** 絞り込みを始めたときの、利用者が動かした回数。絞り込みで縮んで一番下に押し戻されただけなら、読み進めたことにしない */
  const movesAtFilter = useRef(0)
  useLayoutEffect(() => {
    if (filtering) {
      if (!beforeFilter.current) movesAtFilter.current = userMoveCount()
      beforeFilter.current ??= getPosition()
      return
    }
    const before = beforeFilter.current
    beforeFilter.current = undefined
    if (!before) return
    const readToEnd = filteredScrollable.current && userMoveCount() !== movesAtFilter.current && getPosition()?.bottom
    restorePosition(readToEnd ? { ...before, bottom: true } : before)
  }, [filtering])

  // 見えなくなったら(別のタブに移ったら)、開いていたポップアップと画像を閉じる
  useEffect(() => {
    if (props.active) return
    setPopups((ps) => (ps.length ? [] : ps))
    setLightbox((l) => (l ? undefined : l))
    setGalleryOpen((g) => (g ? false : g))
  }, [props.active])

  // ── ポップアップ ──

  const closeAll = useCallback(() => {
    clearTimeout(hover.current.timer)
    hover.current.active = false
    setPopups([])
  }, [])

  // handlersFor と renderPosts は互いを使う(ポップアップの中のレスにも、1 段深いハンドラを渡す)
  /** ポップアップの中身を描く関数(いつも最新の設定で描くよう、控えを通して呼ぶ) */
  const renderRef = useRef({ renderPosts, renderTree })
  renderRef.current = { renderPosts, renderTree }
  // 操作の関数が読むレスのデータ(新着のたびに関数を作り直すと、全レスが描き直される。ref で最新を読む)
  const dataRef = useRef({ byNo, replies, posts: log.posts, resolveAnchor, quoteLinks, anchorCounts, idCounts })
  dataRef.current = { byNo, replies, posts: log.posts, resolveAnchor, quoteLinks, anchorCounts, idCounts }
  const thumbAuto = settings.thumbLoad === 'always' || (settings.thumbLoad === 'wifi' && onWifi())
  const handlersFor = useCallback(
    (level: number): PostHandlers => {
      const d = () => dataRef.current
      // 開いたレス(el を含むレス)が一覧の中にあれば、そこを見せる(ID のレス など)
      const open = (title: string, posts: Post[], el: HTMLElement, viaHover: boolean) => {
        // el はレスの中のボタンか、キー操作のときはレスの枠
        const from = Number((el.closest<HTMLElement>('article[data-no]') ?? el.querySelector<HTMLElement>('article[data-no]'))?.dataset.no)
        openContent(title, renderRef.current.renderPosts(posts, level + 1), el, viaHover, posts.some((p) => p.no === from) ? from : undefined)
      }
      const openContent = (title: string, content: ReactNode, el: HTMLElement, viaHover = false, focusNo?: number) => {
        const rect = el.getBoundingClientRect()
        if (viewRef.current)
          setPopupFrame({
            rect: viewRef.current.getBoundingClientRect(),
            headerBottom: headerRef.current?.getBoundingClientRect().bottom ?? 0,
          })
        hover.current = { active: viaHover, entered: false, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        const entry: PopupEntry = {
          id: ++popupSeq.current,
          title,
          triggerY: rect.top,
          level,
          content,
          focusNo,
        }
        setPopups((ps) => [...ps.slice(0, level), entry])
      }
      return {
        onAnchor: (nos, el, via) => {
          const posts = nos.map((n) => d().byNo.get(n)).filter((p): p is Post => p !== undefined)
          const title = `>>${nos.length > 1 ? `${refOf(nos[0])}-${refOf(nos.at(-1)!)}` : refOf(nos[0])}`
          if (via === 'click') {
            clearTimeout(hover.current.timer)
            open(title, posts, el, false)
            return
          }
          if (isMobile || settings.anchorPopup !== 'hover') return
          clearTimeout(hover.current.timer)
          hover.current.timer = setTimeout(() => open(title, posts, el, true), HOVER_DELAY_MS)
        },
        onAnchorLeave: () => clearTimeout(hover.current.timer),
        onReplies: (no, el) => {
          const list = (d().replies.get(no) ?? []).map((n) => d().byNo.get(n)!).filter(Boolean)
          open(`>>${refOf(no)} への返信 (${list.length})`, list, el, false)
        },
        onId: (id, el) => {
          const list = d().posts.filter((p) => p.id === id)
          open(`ID:${id} (${list.length})`, list, el, false)
        },
        onWatchoi: (watchoi, el) => {
          const list = d().posts.filter((p) => watchoiOf(p.name) === watchoi)
          open(`ワッチョイ ${watchoi} (${list.length})`, list, el, false)
        },
        onName: (name, el) => {
          const list = d().posts.filter((p) => p.name === name)
          open(`${name} (${list.length})`, list, el, false)
        },
        onBody: (no, el) => {
          const tree = anchorTree(no, d().posts, d().resolveAnchor, d().quoteLinks)
          if (tree.length <= 1) return
          openContent(`>>${refOf(no)} のアンカーツリー (${tree.length})`, renderRef.current.renderTree(no, level + 1), el, false, no)
        },
        onUrl: props.onUrl,
        onImage: (urls, index, post) => setLightbox({ urls, index, post }),
        onAddNg: props.onAddNg,
        ngHits: (post) => ngHitsOf(ngContext.current.rules, post, ngContext.current.boardUrl),
        onRemoveNg: props.onRemoveNg,
        onEditNg: props.onEditNg,
        onNgDraft: props.onNgDraft,
        onMarkTroll: props.onMarkTroll,
        onMarkAi: aiRules.length > 0 && props.onUpdateSetting ? onMarkAi : undefined,
        aiRules: aiRules.map((r) => ({ id: r.id, name: r.name || r.prompt })),
        onReply: canReply
          ? (no) => {
              setPopups([])
              withReplyRef.current((h) => h.insert(replyText(no)))
            }
          : undefined,
        toNo: (n: number) => d().resolveAnchor(n),
        urls: { shorten: settings.urlShorten, omitImages: settings.urlShorten, collapseImageRuns: settings.urlShorten },
        // ID ごとの色は配色の明るさで変える。LINE ライトの LINE 風は空色の地なので、白っぽい字に合う淡い色(スマホのアプリと同じ)
        idColor: settings.idStyle === 'color'
          ? { dark: isDarkScheme(effectiveScheme(settings)), sky: effectiveScheme(settings) === 'line-light' && effectivePostStyle(settings) === 'line' }
          : undefined,
        heatStyle: settings.heatStyle,
        doubleTapReply: settings.doubleTapReply,
        doubleClick: settings.postDoubleClick,
        dateStyle: settings.dateStyle,
        idShort: settings.idShort,
        idPosition: settings.idPosition,
        iconFromWatchoi: settings.iconFromWatchoi,
        nameSubtle: settings.nameSubtle,
        thumbAuto,
        onReact: props.onReact,
        reactionDefs: props.reactionDefs,
        onPostAction: props.onPostAction,
        postActions: props.postActions,
        shareOf: (post) => {
          const { title, url } = shareTarget.current
          return shareItems({ title, url: postWebUrl(url, post.no), copy: (text, done) => shareCopy.current(text, done), open: (u) => void openUrl(u) })
        },
        onDeletePost: props.onDeletePost,
        onMarkOwn: props.onMarkOwn
          ? (post, own, sameId) =>
              props.onMarkOwn!(sameId && post.id ? d().posts.filter((p) => p.id === post.id).map((p) => p.no) : [post.no], own)
          : undefined,
        onQuickReply: canReply ? (no, text) => void quickPostRef.current(`${replyText(no)}${text}`) : undefined,
      }
    },
    // ポップアップの中身は renderRef で最新の値で描くので、NG の判定や自分のレスなど描くための値はここに入れない
    // 設定は、ここで使うものだけを見る(設定全体を見ると、配色を変えただけで、すべてのレスを描き直して重い)
    // レスのデータ(byNo・replies・posts・anchorCounts など)は dataRef で読むので、ここには入れない
    [settings.anchorPopup, settings.idStyle, settings.heatStyle, settings.doubleTapReply, settings.postDoubleClick, settings.dateStyle, settings.idShort, settings.idPosition, settings.iconFromWatchoi, settings.nameSubtle, settings.scheme, settings.darkScheme, settings.lightScheme, settings.followOsTheme, settings.postStyle, thumbAuto, settings.urlShorten, canReply, props.onUrl, props.onAddNg, props.onRemoveNg, props.onEditNg, props.onNgDraft, props.textQuotes, props.onMarkTroll, onMarkAi, aiRules, props.onReact, props.reactionDefs, props.onPostAction, props.postActions, props.onDeletePost, props.onMarkOwn],
  )

  /** アンカーツリーを線でつないで描く(ポップアップの中身) */
  function renderTree(start: number, level: number) {
    const handlers = handlersFor(level)
    return (
      <AnchorTree
        rows={anchorTreeRows(start, log.posts, resolveAnchor, quoteLinks)}
        focus={start}
        variant={baseVariant(variant)}
        renderPost={(no) => {
          const p = byNo.get(no)!
          return (
            <PostArticle
              {...postArticleProps(p, frameShared)}
              showTopDivider={false}
              alignLeft
              ngMode="aborn"
              handlers={handlers}
            />
          )
        }}
      />
    )
  }

  function renderPosts(posts: Post[], level: number) {
    if (posts.length === 0) return <p className="text-c-text-muted text-sm text-center py-4">レスが見つかりません</p>
    const handlers = handlersFor(level)
    return (
      <div className="flex flex-col" style={{ gap: 'var(--list-gap-post)' }}>
        {posts.map((p, i) => (
          <PostArticle
            key={p.no}
            {...postArticleProps(p, frameShared)}
            showTopDivider={i > 0 && (variant === 'card' || variant === 'matome')}
            ngMode="aborn"
            // Discord・LINE 風は、ポップアップの中でも返信元を頭に出し、本文の頭のアンカーを省く
            replyPreview={variant === 'discord' || variant === 'line' ? replyPreviewOf(p) : undefined}
            handlers={handlers}
          />
        ))}
      </div>
    )
  }

  const mainHandlers = useMemo(() => handlersFor(0), [handlersFor])

  /** 選んでいるレスの ID(印を出しているときだけ。同じ ID のレスに薄く色を付ける) */
  const cursorId = keysOn && !cursorHidden && cursorNo !== undefined ? byNo.get(cursorNo)?.id : undefined

  // スレタイ・絞り込みの帯。書き込み欄が下のときはスクロール領域の中に置いて(すりガラス越しにレスが透ける)、
  // 右のときはスクロール領域の外に出して横いっぱいに置く(書き込み欄はその下に並ぶ)
  const headerBlock = (
    <div
      ref={headerRef}
      // bar-zoom: スマホのヘッダーの文字の大きさ(設定)
      className={`relative ${headerInScroll ? 'sticky top-0 z-10' : ''} ${isMobile ? 'bar-zoom transition-transform duration-200' : ''} bg-panel-thread-header border-b border-c-border flex-shrink-0`}
    >
        {/* 下の端をつかんで、スレタイの行の高さを変える(スレタイの字も合わせて大きくなる) */}
        <DragEdge
          edge="bottom"
          onMouseDown={(e) => headerDrag.startDrag(e, titleRowRef.current?.getBoundingClientRect().height ?? 80, 1)}
          onReset={headerDrag.reset}
        />
        <header
          ref={titleRowRef}
          // スマホ: 左上のメニューのボタンとスレタイの間を広めに(gap-3)
          // スマホ: 端のボタン(︙・更新)が画面の縁にくっつくと押しにくいので、左右に 8〜12px 空ける
          className={`flex items-center justify-between ${isMobile ? `gap-3 ${props.onOpenDrawer ? 'pl-2 pr-3' : 'pl-4 pr-3'}` : 'px-6'}`}
          onContextMenu={headerMenu.onContextMenu}
          // スマホ: スレタイを省かずに折り返すので、長いスレタイでは帯を高くする(既定の高さより低くはしない)
          style={isMobile ? { minHeight: 'calc(var(--header-height, 72px) / var(--bar-zoom, 1))' } : { height: headerDrag.height || 'var(--header-height, 80px)' }}
        >
          {/* スマホ: スレタイの左にメニュー(サイドバーの引き出し) */}
          {isMobile && props.onOpenDrawer && (
            <button type="button" onClick={props.onOpenDrawer} className={MOBILE_HEAD_BTN} title="メニュー">
              <span className={`material-symbols-outlined ${MOBILE_HEAD_ICON}`}>menu</span>
            </button>
          )}
          <div
            className={`relative min-w-0 flex-1 flex items-center gap-2 ${isMobile ? 'min-h-10 py-1.5' : 'h-10'}`}
            // 字を大きくしたら、行の高さもそれに合わせる(固定の 40px のままだと、大きい字の上下が切れる)
            style={titleRem ? { height: Math.max(40, titleRem * 16 * 1.5) } : undefined}
          >
            <input
              ref={searchRef}
              data-search
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => {
                if (!query.trim()) setSearchActive(false)
              }}
              onKeyDown={(e) => {
                // Enter: 検索はそのままで欄から抜け、スレ表示のキー操作(J・K など)に戻る
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  if (!query.trim()) setSearchActive(false)
                  e.currentTarget.blur()
                  return
                }
                // Esc: 検索を外して欄から抜け、スレ表示のキー操作に戻る(日本語の変換中の Esc は変換の取り消し)
                if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  clearSearch.current()
                  e.currentTarget.blur()
                }
              }}
              placeholder="レスを探す(本文・名前・ID)"
              className={`absolute inset-y-0 right-0 z-10 bg-c-surface border border-c-border rounded-[var(--card-radius)] px-3 text-sm text-c-text-body placeholder-c-text-muted focus:outline-none focus:ring-0 transition-[left,opacity] duration-300 ease-out ${
                searchActive ? 'left-0 opacity-100' : 'left-full opacity-0 pointer-events-none'
              }`}
            />
            {props.onBackToList && !isMobile && (
              <button
                type="button"
                onClick={props.onBackToList}
                className="flex-shrink-0 -ml-2 p-1.5 rounded-lg text-c-text-muted hover:text-c-text-strong hover:bg-c-surface2 transition-colors"
                title="スレ一覧に戻る"
              >
                <span className="material-symbols-outlined text-xl leading-none">arrow_back</span>
              </button>
            )}
            {!isMobile && <ActionButtons actions={barActions} placements={placements} where="headerStart" btnClass={ICON_BTN} iconClass="text-xl" />}
            {/* スレタイが長いときに省くのはスレタイだけ。後ろのレス数は別の情報なので、いつも出す */}
            <h2
              className={`min-w-0 flex items-baseline font-bold text-base cursor-pointer transition-colors ${isMobile ? '' : 'hover:text-c-accent'}`}
              style={{
                color: 'var(--thread-title-color, var(--c-text-strong))',
                // ヘッダーを引き伸ばしたら、高さに合わせて字も大きくする(既定の 80px で 1rem)。
                // 行の高さは字に合わせる(決まった行の高さのままだと、大きい字の上下が切れる)
                ...(titleRem && { fontSize: `${titleRem}rem`, lineHeight: 1.45 }),
              }}
              onClick={() => {
                // スマホ: スレタイを押したら、スレの操作のメニュー(板を開く・コピー・NG など)
                if (isMobile) return setTitleSheet(true)
                if (ref.current) ref.current.scrollTop = 0
              }}
              title={isMobile ? 'スレの操作' : 'クリックで先頭へスクロール'}
            >
              {isMobile ? (
                // スマホ: 2 行まで。入りきらなければ字を小さくして収める(titleFitRef)。レス数はスレタイの続きに
                <span ref={titleFitRef} className="text-[15px] leading-snug break-words line-clamp-2">
                  {log.title}
                  <span className="ml-1.5 text-xs font-normal text-c-text-muted tabular-nums">({log.posts.length})</span>
                </span>
              ) : (
                <>
                  <span className="truncate">{log.title}</span>
                  <span className="flex-shrink-0 ml-1.5 text-sm font-normal text-c-text-muted tabular-nums">({log.posts.length})</span>
                </>
              )}
            </h2>
            {log.status === 'archived' && (
              <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-c-surface3 text-c-text-muted">
                dat 落ち
              </span>
            )}
          </div>
          <div className={`flex items-center ${isMobile ? 'gap-1 ml-1' : 'gap-2 ml-4'}`}>
            {settings.autoRefreshSec > 0 && (
              <span className="flex items-center gap-1 text-xs text-c-accent" title="自動更新中">
                <span className="material-symbols-outlined text-base">autorenew</span>
                {settings.autoRefreshSec}秒
              </span>
            )}
            <ActionButtons actions={barActions} placements={placements} where="header" btnClass={isMobile ? MOBILE_HEAD_BTN : ICON_BTN} iconClass={isMobile ? MOBILE_HEAD_ICON : 'text-xl'} />
            <MoreMenu area="thread" actions={isMobile ? mobileMenuActions('thread', barActions, placements, barOrder) : barActions} btnClass={isMobile ? MOBILE_HEAD_BTN : ICON_BTN} iconClass={isMobile ? MOBILE_HEAD_ICON : 'text-xl'} />
          </div>
          {headerMenu.menu}
        </header>
        {/* スマホは、左右の端までを等分して並べる(人気・画像・動画・リンク・すべて) */}
        <div className={`items-center font-medium ${isMobile ? 'grid grid-cols-5 text-[13px]' : 'flex overflow-x-auto no-scrollbar gap-5 px-4 text-base'}`}>
          {(isMobile ? FILTERS : [...FILTERS, OWN_FILTER]).map(({ key, label, icon, color }, i) => {
            const active = filters.has(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilters((f) => togglePostFilter(f, key))}
                className={`relative shrink-0 flex items-center ${isMobile ? 'justify-center gap-1' : 'gap-1.5 px-2'} transition-colors whitespace-nowrap ${
                  // 選んでいる絞り込みは、強調色を薄く敷く
                  active ? 'text-c-accent bg-[var(--c-accent-wash)]' : 'text-c-text-muted hover:text-c-text-body'
                }`}
                style={{ paddingTop: isMobile ? 8 : 10, paddingBottom: isMobile ? 8 : 10 }}
                title={key === 'own' ? '自分の書き込みだけを出す(6 キー)' : `${label}だけを出す(${i + 1} キー)`}
              >
                <span className={`material-symbols-outlined ${isMobile ? 'text-base' : 'text-xl'} leading-none ${active ? 'fill' : ''}`} style={active ? { color } : undefined}>
                    {icon}
                  </span>
                {label}
                {isMobile ? (
                  filterCounts[key] > 0 && <span className="text-[10px] tabular-nums opacity-70 -ml-0.5">{filterCounts[key]}</span>
                ) : (
                  <span className="text-xs tabular-nums opacity-70">({filterCounts[key]})</span>
                )}
                {active && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-c-accent rounded-full" />}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setFilters(new Set())}
            className={`relative shrink-0 transition-colors ${isMobile ? 'text-center' : 'px-2'} ${filters.size === 0 ? 'text-c-accent bg-[var(--c-accent-wash)]' : 'text-c-text-muted hover:text-c-text-body'}`}
            style={{ paddingTop: 10, paddingBottom: 10 }}
            title="絞り込みを外す(5 キー・Esc)"
          >
            すべて
            {filters.size === 0 && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-c-accent rounded-full" />}
          </button>
          {/* 絞り込んだ数(スマホは等分の並びが崩れるので出さない。数は各ボタンに出ている) */}
          {visibleNos && !isMobile && (
            <span className="ml-auto shrink-0 text-xs text-c-text-muted tabular-nums">
              {visibleNos.size} / {log.posts.length} レス
            </span>
          )}
        </div>
      </div>
  )

  const pressPost = useCallback((no: number) => {
    setCursorNo(no)
    setCursorHidden(false)
  }, [])
  const frameShared = useMemo<FrameShared>(
    () => ({
      handlers: mainHandlers,
      onPress: pressPost,
      onToggleRun: toggleRun,
      byNo,
      quotesOf,
      grossNos,
      anchorCounts,
      idCounts,
      iconCounts,
      iconFromWatchoi: settings.iconFromWatchoi,
      variant,
      replyPreviewOf,
      continuedFrom,
      isNg,
      autoNg,
      aiMarkOf,
      ngMode: settings.ngMode,
      showThumbnails: settings.thumbLoad !== 'never',
      showIdenticon: settings.idStyle === 'icon',
      showLinkPreview: settings.showLinkPreview,
      toolbar: settings.postToolbar,
      phrases: settings.quickPhrases,
      display,
      opId,
      ownNos,
      replyToOwn,
      reactions: props.reactions,
    }),
    [mainHandlers, pressPost, toggleRun, byNo, quotesOf, grossNos, anchorCounts, idCounts, iconCounts, settings.iconFromWatchoi, variant, replyPreviewOf, continuedFrom, isNg, autoNg, aiMarkOf, settings.ngMode, settings.thumbLoad, settings.idStyle, settings.showLinkPreview, settings.postToolbar, settings.quickPhrases, display, opId, ownNos, replyToOwn, props.reactions],
  )
  const galleryItems = useMemo(() => (galleryOpen ? collectMedia(log.posts.filter((p) => !isNg(p))) : []), [galleryOpen, log.posts, isNg])
  /**
   * レスの枠(1000 件ぶん)。読み込み中の印・既読・ポップアップの開閉で ThreadView が描き直されても作り直さない。
   * 変わるものだけを依存に並べる(見積もりの高さは intrinsicHeight の関数が変わる)。
   * 作り直しても、値の変わらない枠は PostFrame の memo で描き直さない
   */
  const postFrames = useMemo(
    () => log.posts.map((p, i) => {
      const firstUnread = p.no === unreadFrom && unreadFrom > 1
      // 続けて並んだあぼーん: まとめているあいだは、先頭に 1 行だけ出し、ほかは隠す
      const runFirst = ngRuns.firstOf.get(p.no)
      const run = runFirst === undefined ? undefined : ngRuns.runs.get(runFirst)
      const runClosed = run !== undefined && !openRuns.has(runFirst!)
      const filteredIn = visibleNos === undefined || visibleNos.has(p.no)
      const rendered = isRendered(i)
      return (
        <PostFrame
          key={p.no}
          post={p}
          index={i}
          shared={frameShared}
          rendered={rendered}
          height={intrinsicHeight(p)}
          firstUnread={firstUnread}
          unreadLine={firstUnread && !visibleNos}
          enterDelay={flashNos.get(p.no)}
          // スマホには「選んでいるレス」がない(押したレスに印を付けない)
          cursorMark={!isMobile && keysOn && !cursorHidden && p.no === cursorNo}
          sameIdTint={!isMobile && cursorId !== undefined && p.id === cursorId && p.no !== cursorNo}
          frameHidden={!filteredIn || (runClosed && p.no !== runFirst)}
          showArticle={rendered && !runClosed && filteredIn}
          runHead={runFirst === p.no ? run : undefined}
          runOpen={!runClosed}
        />
      )
    }),
    [log.posts, unreadFrom, flashNos, ngRuns, openRuns, isRendered, intrinsicHeight, visibleNos, cursorId, cursorNo, cursorHidden, keysOn, frameShared],
  )

  /** 書き込み欄の中身(スマホのフッターと PC の欄で共通)。書けない掲示板は undefined */
  const replyFormProps = props.onSubmitPost && {
    stamp: { title: log.title, url: props.threadUrl },
    phraseBar: settings.quickPhrases,
    attach: props.attachments,
    disabled: log.status === 'archived' ? 'dat 落ちしたスレには書き込めません' : undefined,
    initialName: props.postName,
    initialMail: props.postMail,
    onSubmit: props.onSubmitPost,
    onConfirm: props.onConfirmPost,
    onUploaded: props.onUploaded,
    accounts: props.postAccounts,
    draft: props.draft,
    limits: props.postLimits,
    byteLength: props.postByteLength,
    onToggleAccount: props.onTogglePostAccount,
    onOpenAccountSettings: props.onOpenAccountSettings,
    onImage: (urls: string[], index: number) => setLightbox({ urls, index }),
    uploader: {
      maxDimension: settings.uploadMaxDimension,
      userhash: settings.catboxUserhash.trim() || undefined,
      host: settings.uploadHost,
      imgbbApiKey: settings.imgbbApiKey.trim() || undefined,
      imgurClientId: settings.imgurClientId.trim() || undefined,
    },
    onOpenUrl: props.onUrl,
  }

  return (
    <main
      ref={mainRef}
      // 絞り込み・検索をしている印(スマホの戻る操作は、スレを閉じる前にまずこれを外す。App の backRef)
      data-filtering={props.active && (filters.size > 0 || query || searchActive) ? 'thread' : undefined}
      className="flex-1 min-w-0 min-h-0 flex flex-col bg-panel-view overflow-hidden"
      style={isMobile && hasFooter ? ({ '--footer-offset': `${MOBILE_BAR_H}px`, '--footer-height': `${MOBILE_BAR_H}px` } as CSSProperties) : undefined}
    >
      {!headerInScroll && headerBlock}
      <div className={`flex-1 min-h-0 min-w-0 flex ${replyLayout === 'right' ? 'flex-row' : 'flex-col'}`}>
      <div className="relative flex-1 min-h-0 min-w-0 flex flex-col">
      <div ref={viewRef} className="relative flex-1 min-h-0 min-w-0 flex overflow-hidden">
      <button
        type="button"
        onClick={() => jumpToBottom()}
        title="いちばん下へ"
        className={`absolute z-20 ${isMobile ? 'w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl' : 'w-11 h-11 rounded-full'} flex items-center justify-center bg-c-surface border border-c-border shadow-lg text-c-text-body hover:text-c-accent hover:border-c-accent transition-all duration-200 ${
          showJump ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
        }`}
        // ミニマップを出しているときは、その左に置く。スマホでフッターが出ているときは、その上に置く
        // スマホは右下の角に寄せる(ミニマップは本文に重ねてあるので、その左に)
        style={
          isMobile
            ? { right: settings.showMinimap ? 40 : 8, bottom: 'calc(var(--footer-offset, 0px) + 8px)' }
            : { right: settings.showMinimap ? 44 : 20, bottom: 'calc(var(--footer-offset, 0px) + 20px)' }
        }
      >
        <span className={`material-symbols-outlined ${isMobile ? 'text-[22px]' : 'text-2xl'}`}>keyboard_double_arrow_down</span>
      </button>
      {/* 新着が届いたのに画面の外(下・絞り込みで隠れている)にあるとき、下から少しのあいだ出す札。押すと新着の頭へ */}
      {newToast && (
        <button
          key={newToast.seq}
          type="button"
          onClick={jumpToNew}
          className="absolute left-1/2 z-20 flex items-center gap-1.5 px-4 py-2 rounded-full shadow-md text-sm font-bold badge-in hover:brightness-110"
          style={{ background: 'var(--c-accent)', color: 'var(--c-accent-text)', bottom: 'calc(var(--footer-offset, 0px) + 20px)' }}
          title="新着の頭へ飛ぶ"
        >
          <span className="material-symbols-outlined text-lg leading-none">arrow_downward</span>
          新着 +{newToast.count}
        </button>
      )}
      <div
        ref={topPull.indicatorRef}
        className="absolute left-0 right-0 flex justify-center pointer-events-none z-[9]"
        style={{ top: headerInScroll ? headerHeight : 0, opacity: 0, transform: `translateY(${PULL_HIDDEN_Y}px)` }}
      >
        <PullSpinner iconRef={topPull.iconRef} />
      </div>
      <div
        ref={bottomPull.indicatorRef}
        className="absolute left-0 right-0 flex justify-center pointer-events-none z-[9]"
        // フッター(スマホの書き込み欄など)の上の端から出す。後ろに隠れて見えなくならないように
        style={{ bottom: 'var(--footer-offset, 0px)', opacity: 0, transform: `translateY(${-PULL_HIDDEN_Y}px)` }}
      >
        <PullSpinner iconRef={bottomPull.iconRef} />
      </div>
      <div
        ref={ref}
        onWheel={onWheel}
        onScroll={(e) => {
          onScrollPull()
          if (isMobile && settings.hideBarsOnScroll) hideBars.onScroll(e)
        }}
        onTouchStart={
          isMobile
            ? (e) => {
                hideBars.arm()
                touchPull.onTouchStart(e)
              }
            : undefined
        }
        onTouchMove={isMobile ? touchPull.onTouchMove : undefined}
        onTouchEnd={isMobile ? touchPull.onTouchEnd : undefined}
        onTouchCancel={isMobile ? touchPull.onTouchCancel : undefined}
        className={`post-scroller flex-1 min-w-0 overflow-y-auto flex flex-col ${settings.showMinimap ? 'no-scrollbar' : 'custom-scrollbar'}`}
      >
        {headerInScroll && headerBlock}

        <div
          ref={listRef}
          className="flex-1 flex flex-col"
          // スマホ: フッターは本文の上に重ねるので、最後のレスがその下に隠れないよう、下に余白を足す
          style={{
            padding: 'var(--list-padding-post)',
            gap: 'var(--list-gap-post)',
            ...(isMobile && hasFooter && { paddingBottom: `calc(var(--list-padding-post) + ${MOBILE_BAR_H + 8}px)` }),
            // スマホ: 右端に重ねたミニマップの分、本文を左へ寄せる
            ...(isMobile && settings.showMinimap && { paddingRight: 'calc(var(--list-padding-post) + 24px)' }),
          }}
        >
          {log.posts.length === 0 ? (
            props.loading ? (
              <LoadingCenter />
            ) : props.errorText ? (
              <LoadFailed message={props.errorText} onRetry={() => void props.onRefresh()} />
            ) : (
              <div className="text-c-text-muted text-sm">レスがありません</div>
            )
          ) : (
            <>
              {postFrames}
              <Divider label="-END-" />
              {!isMobile && props.nextUnread && props.onOpenNextUnread && (
                <NextUnreadButton {...props.nextUnread} onOpen={props.onOpenNextUnread} />
              )}
              {props.onFindNext && (ended || showNext) && <NextThreadBox find={props.onFindNext} onOpen={props.onOpenThread} />}
            </>
          )}
        </div>
      </div>
      {settings.showMinimap && log.posts.length > 0 && (
        // スマホ: ミニマップは本文の右端に重ねる(横に並べると、ヘッダーの右に同じ幅の空きができ、本文も狭くなる)
        // フッターの上で終わらせる。フッターが隠れても伸ばさない(伸び縮みすると、縮図がぐにゃぐにゃ動いて見にくい)
        <div
          onPointerDownCapture={noteUserMove}
          className={isMobile ? 'absolute right-0 z-[5] flex' : 'contents'}
          style={isMobile ? { top: headerInScroll ? headerHeight : 0, bottom: hasFooter ? 'var(--footer-height, 0px)' : 0 } : undefined}
        >
        <Minimap
          posts={visiblePosts}
          scrollRef={ref}
          listRef={listRef}
          anchorCounts={anchorCounts}
          ownNos={ownNos}
          replyToOwn={replyToOwn}
          unreadFrom={unreadFrom}
          topOffset={headerInScroll && !isMobile ? headerHeight : 0}
          onJump={scrollToPost}
        />
        </div>
      )}
      </div>
      {/* フッター。ボタンの配置で「フッター」にした操作だけ並べる(なければ出さない) */}
      {hasFooter && !isMobile && (
        <div className="flex-shrink-0 h-10 px-3 flex items-center gap-1 border-t border-c-border bg-panel-thread-header">
          <ActionButtons actions={barActions} placements={placements} where="footerStart" btnClass={ICON_BTN} iconClass="text-xl" />
          <span className="flex-1" />
          <ActionButtons actions={barActions} placements={placements} where="footer" btnClass={ICON_BTN} iconClass="text-xl" />
        </div>
      )}
      {/* スマホ: フッターは本文の上に重ね、下へスクロールすると隠す。「戻る」は左端、ほかは右に寄せる */}
      {hasFooter && isMobile && (
        <div
          ref={footerRef}
          className="bar-zoom absolute inset-x-0 z-20 border-t border-c-border bg-panel-thread-header transition-transform duration-200"
          // キーボードが出ていれば、その上に持ち上げる(main.tsx が --kb-inset を測る)。高さは設定(--footer-bar-h)で変えられる
          style={{ bottom: 'var(--kb-inset, 0px)', minHeight: `calc(var(--footer-bar-h, ${MOBILE_BAR_H}px) / var(--bar-zoom, 1))` }}
        >
          {replyFormProps ? (
            // 書き込める掲示板: Discord・LINE のような 1 行の入力欄(戻るはジェスチャーで)
            <ReplyForm
              ref={replyRef}
              {...replyFormProps}
              variant="chat"
              // フッターの右端(送るボタンの右)に更新ボタン(設定で消せる)
              trailing={
                refreshFab && (
                  <button
                    type="button"
                    onClick={() => void props.onRefresh()}
                    title="更新"
                    className="flex-shrink-0 w-11 h-11 ml-1.5 mr-3 rounded-full flex items-center justify-center text-c-text-muted active:bg-c-surface2"
                  >
                    <span className={`material-symbols-outlined text-[28px] ${props.loading ? 'animate-spin' : ''}`}>refresh</span>
                  </button>
                )
              }
              layout="bottom"
              onFocusChange={(f) => {
                composing.current = f
              }}
            />
          ) : (
            <div className="px-2 flex items-center gap-2" style={{ height: MOBILE_BAR_H }}>
              <ActionButtons actions={barActions.filter((a) => a.id === 'back')} placements={placements} where="footer" btnClass={MOBILE_BTN} iconClass="text-[28px]" />
              <div className="flex-1" />
              <ActionButtons actions={barActions.filter((a) => a.id !== 'back')} placements={placements} where="footer" btnClass={MOBILE_BTN} iconClass="text-[28px]" />
            </div>
          )}
        </div>
      )}
      </div>

      {props.onSubmitPost && replyCollapsed && !isMobile && (
        // しまっているときは、細い帯(右に置くときは細い縦の帯)だけを出す。押すと書き込み欄を出す
        <button
          type="button"
          onClick={openReply}
          className={`flex-shrink-0 flex items-center justify-center gap-2 bg-panel-reply text-sm text-c-text-muted hover:text-c-text-strong transition-colors border-c-border ${
            replyLayout === 'bottom' ? 'h-9 border-t' : 'w-9 border-l flex-col'
          }`}
          title="書き込み欄を出す (W)"
        >
          <span className="material-symbols-outlined text-lg">edit</span>
          {replyLayout === 'bottom' && '書き込む'}
        </button>
      )}
      {replyFormProps && !replyCollapsed && !isMobile && (
        <>
          <Splitter
            layout={replyLayout}
            size={replySize}
            onChange={(size) => {
              // 自分でつかんで変えたら、自動で伸ばしていた分はやめる
              setReplyExtra(0)
              setReplySize(size)
            }}
            onEnd={(size) => props.onResizeReply(sizeKey, size)}
          />
          <div
            className="flex-shrink-0 min-h-0 min-w-0"
            style={replyLayout === 'bottom' ? { height: replySize + replyExtra } : { width: replySize }}
          >
            <ReplyForm
              ref={replyRef}
              {...replyFormProps}
              layout={replyLayout}
              onTextOverflow={replyLayout === 'bottom' ? onTextOverflow : undefined}
              onCollapse={closeReply}
            />
          </div>
        </>
      )}
      </div>

      {quickMessage && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9700] flex items-center gap-2 px-4 py-2 rounded-full shadow-lg text-sm border"
          style={{
            background: 'var(--c-surface)',
            borderColor: quickMessage.ok ? 'var(--c-border)' : 'var(--c-error)',
          }}
        >
          <span className={`material-symbols-outlined text-lg ${quickMessage.ok ? 'text-c-accent' : 'text-[var(--c-error)]'}`}>
            {quickMessage.ok ? 'check_circle' : 'error'}
          </span>
          <span className="max-w-[60vw] truncate text-c-text-body">{quickMessage.text}</span>
        </div>
      )}

      <PostPopup
        popups={popups}
        containerRect={popupFrame?.rect}
        headerBottom={popupFrame?.headerBottom ?? 0}
        onCloseTop={() => setPopups((ps) => ps.slice(0, -1))}
        onCloseAll={closeAll}
        onCloseAt={(i) => setPopups((ps) => ps.slice(0, i))}
        onPopupEnter={() => {
          // 一度中に入ったら、外を押す(一段ずつ閉じる)かスクロールする(全部閉じる)まで残す
          hover.current.entered = true
          hover.current.active = false
        }}
        onOverlayMove={(x, y) => {
          const h = hover.current
          // ホバーで開いて、まだ中に入っていないうちに離れたら、その 1 枚だけ閉じる
          if (!h.active || h.entered) return
          if (Math.hypot(x - h.x, y - h.y) > HOVER_ESCAPE_PX) {
            h.active = false
            setPopups((ps) => ps.slice(0, -1))
          }
        }}
      />

      {galleryOpen && (
        <MediaGallery
          // NG のレスは除く(見えていないレスの画像は出さない)
          items={galleryItems}
          blurNos={grossNos}
          saveDir={settings.imageSaveDir}
          onOpen={(items, index) => setLightbox({ urls: items.map((m) => m.url), index, posts: items.map((m) => m.post) })}
          onClose={() => setGalleryOpen(false)}
        />
      )}
      {styleOpen && props.onUpdateSetting && (
        <StyleDialog
          settings={settings}
          update={props.onUpdateSetting}
          from="thread"
          onClose={() => setStyleOpen(false)}
          sliders={
            <>
              {!isMobile && <BaseFontSlider settings={settings} update={props.onUpdateSetting} />}
              <PostFontSliders settings={settings} update={props.onUpdateSetting} />
            </>
          }
        />
      )}
      {titleSheet && (
        <ActionSheet
          title={log.title}
          onClose={() => setTitleSheet(false)}
          items={[
            ...(props.onOpenBoard ? [{ label: '板を開く', icon: 'list', onClick: props.onOpenBoard }] : []),
            {
              label: props.isFavorite ? 'お気に入りのスレから外す' : 'お気に入りのスレに足す',
              icon: 'star',
              onClick: props.onToggleFavorite,
            },
            { label: 'スレタイをコピー', icon: 'content_copy', onClick: () => copyText(log.title, 'スレタイをコピーしました') },
            { label: 'URL をコピー', icon: 'link', onClick: () => copyText(props.threadUrl, 'URL をコピーしました') },
            { label: 'スレタイと URL をコピー', icon: 'content_paste', onClick: () => copyText(`${log.title}\n${props.threadUrl}`, 'スレタイと URL をコピーしました') },
            { label: 'スレタイを NG に追加', icon: 'block', onClick: () => props.onNgDraft('threadTitle', log.title, { threadTitle: log.title, posterId: log.posts[0]?.no === 1 ? log.posts[0].id : undefined, posterName: log.posts[0]?.name }) },
            { label: '先頭へ', icon: 'vertical_align_top', onClick: () => jumpToTop() },
            { label: 'ブラウザで開く', icon: 'open_in_new', onClick: props.onOpenInBrowser },
            { label: 'ログを削除して閉じる', icon: 'delete', danger: true, onClick: props.onDeleteLog },
          ] satisfies SheetItem[]}
        />
      )}
      {lightbox && (
        <Lightbox
          urls={lightbox.urls}
          index={lightbox.index}
          post={lightbox.post}
          posts={lightbox.posts}
          saveDir={settings.imageSaveDir}
          onIndex={(index) => setLightbox((l) => l && { ...l, index })}
          onClose={() => setLightbox(undefined)}
          onOpenExternal={props.onUrl}
        />
      )}
    </main>
  )
}
