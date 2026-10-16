// スレ表示。web 版の MainBoardPage.tsx(ThreadView 部分)の見た目を移植。
// - 開いたときの位置・既読・新着の追いかけなど、スクロールまわりは hooks/useThreadScroll.ts にまとめてある
// - アンカー・返信・ID はポップアップで出す(ホバーかクリックかは設定で選ぶ)
// - 新着は若い番号から順に出して光らせる
// - 書き込み欄は下か右に置き、境界をドラッグして大きさを変えられる

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Post, PostConfirm, PostInput, PostLimits, PostResult, ThreadSummary } from '@bbs-browser/connectors'
import type { ThreadLog } from '@bbs-browser/logstore'
import PostArticle, { type PostHandlers } from './PostArticle'
import PostPopup, { type PopupEntry } from './PostPopup'
import Lightbox from './Lightbox'
import Minimap from './Minimap'
import AnchorTree from './AnchorTree'
import LoadingCenter from './LoadingCenter'
import ReplyForm, { type ReplyFormHandle } from './ReplyForm'
import NextThreadBox from './NextThreadBox'
import RefreshButton from './RefreshButton'
import { saveThread } from '../host/exportThread'
import MediaGallery, { collectMedia } from './MediaGallery'
import type { PostAccountOption } from './PostAccountMenu'
import { ActionButtons, MoreMenu, type BarAction } from './ActionBar'
import { resolvePlacements } from '../utils/toolbar'
import { REFRESH_COOLDOWN_MS } from '../utils/cooldown'
import type { NextThreadCandidate } from '../utils/nextThread'
import PullSpinner from './PullSpinner'
import { useWheelPullRefresh } from '../hooks/useWheelPullRefresh'
import { useThreadScroll } from '../hooks/useThreadScroll'
import type { ScrollPosition } from '../utils/threadScroll'
import { actionFor, isReloadKey, keyString, resolveKeymap } from '../utils/keymap'
import { PULL_HIDDEN_Y } from '../utils/pullRefresh'
import {
  anchorTree,
  anchorTreeRows,
  anchorsIn,
  countAnchors,
  countIds,
  hasLink,
  hasVideo,
  imageUrlsIn,
  normalizeForSearch,
} from '../utils/postBody'
import type { NgRule, NgTarget } from '../utils/ng'
import type { AppSettings, ReplyLayout } from '../ui/settings'

export type { ScrollPosition } from '../utils/threadScroll'

interface Props {
  /** スレを見分ける値(タブの id)。覚えておいたレスの高さの持ち主 */
  threadKey: string
  log: ThreadLog
  /** 開いているタブか。見えていないタブ(残しておいたもの)では、ポップアップを閉じる */
  active: boolean
  /** タブを切り替えて戻ってきたときの位置。あれば「開いたときの位置」の設定より優先する */
  initialPosition?: ScrollPosition
  /** 画面から外れる(タブを切り替える)ときに、読んでいた位置を渡す */
  onSavePosition: (pos: ScrollPosition) => void
  /** 開いた時点の「最初の未読」のレス番号。ここに「ここから未読」の線を引く */
  unreadFrom: number
  loading: boolean
  settings: AppSettings
  isNg: (p: Post) => boolean
  onRead: (no: number) => void
  /** 更新。Promise を返せば、引っぱって更新のくるくるが終わるまで待つ */
  onRefresh: () => Promise<unknown> | void
  onOpenInBrowser: () => void
  onUrl: (url: string) => void
  onAddNg: (rule: NgRule) => void
  /** NG の画面を、元の文字を入れた状態で開く */
  onNgDraft: (target: NgTarget, text: string) => void
  /** 自分の書き込みのレス番号 */
  ownNos: Set<number>
  /** 書き込み。コネクタが書き込みに対応していなければ undefined */
  onSubmitPost?: (input: PostInput) => Promise<PostResult>
  onConfirmPost: (confirm: PostConfirm, input: PostInput) => Promise<PostResult>
  postName: string
  postMail: string
  onChangeReplyLayout: (layout: ReplyLayout) => void
  onResizeReply: (key: 'replyHeight' | 'replyWidth', size: number) => void
  /** ログを消してタブを閉じる */
  onDeleteLog: () => void
  /** 次スレの候補を探す(板のスレ一覧を取り直して似たスレタイを並べる)。できない掲示板では undefined */
  onFindNext?: () => Promise<NextThreadCandidate[]>
  onOpenThread: (t: ThreadSummary) => void
  /** 手で更新したあとのクールダウンが明ける時刻(更新ボタンに残りを出す) */
  refreshReadyAt?: number
  /** 書き込んだあとのクールダウンが明ける時刻と、その長さ(書き込むボタンに残りを出す) */
  postReadyAt?: number
  postCooldownMs: number
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
  onUploaded: (u: { url: string; name: string; size: number; withAccount: boolean }) => void
  /** 通知などから、このレスへ飛ぶ(seq が変わるたびに飛ぶ) */
  jumpTo?: { no: number; seq: number }
  /** 板の既定の名前(名無しの省略に使う) */
  nonameName?: string
}

const ICON_BTN = 'p-2 text-c-text-muted hover:text-c-text-strong transition-colors rounded-lg'

/** レスの絞り込み(web 版と同じ 4 種。選んだもののどれかに当たれば出す) */
type PostFilter = 'popular' | 'image' | 'video' | 'link'
const FILTERS: { key: PostFilter; label: string; icon: string }[] = [
  { key: 'popular', label: '人気レス', icon: 'local_fire_department' },
  { key: 'image', label: '画像', icon: 'image' },
  { key: 'video', label: '動画', icon: 'play_circle' },
  { key: 'link', label: 'リンク', icon: 'link' },
]
/** ホバーで開くまでの待ち時間。通り過ぎただけで開かないように */
const HOVER_DELAY_MS = 150
/** ホバーで開いたポップアップは、まだ中に入っていなければ、開いた位置からこれだけ離れたら(その 1 枚を)閉じる */
const HOVER_ESCAPE_PX = 60

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
          latest = Math.min(vertical ? 600 : 900, Math.max(vertical ? 90 : 240, startSize - delta))
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

function Divider({ label, self }: { label: string; self?: boolean }) {
  const color = self ? 'var(--c-accent-self)' : 'var(--c-border)'
  return (
    <div
      className={`flex items-center gap-3 py-1 select-none ${self ? '' : 'text-c-text-muted'}`}
      style={self ? { color, opacity: 0.6 } : undefined}
    >
      <div className="flex-1 h-[3px]" style={{ background: color, opacity: self ? 0.4 : 1 }} />
      <span className="text-sm font-extrabold tracking-widest whitespace-nowrap">{label}</span>
      <div className="flex-1 h-[3px]" style={{ background: color, opacity: self ? 0.4 : 1 }} />
    </div>
  )
}

export default function ThreadView(props: Props) {
  const { log, unreadFrom, settings, isNg, onRead } = props
  const ref = useRef<HTMLDivElement>(null)
  /** レス一覧とミニマップの領域。ポップアップの幅をこれに合わせる */
  const viewRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const headerInScroll = settings.replyLayout === 'bottom'
  const headerOffset = () => (ref.current?.contains(headerRef.current) ? (headerRef.current?.offsetHeight ?? 0) : 0)
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

  // 端でさらにホイールを回すと更新する(web 版と同じ)。上端と下端で別々に持つ
  // 手で更新したあとのクールダウン中(App が決める)は、引っぱっても数えない
  const refreshReadyRef = useRef(props.refreshReadyAt)
  refreshReadyRef.current = props.refreshReadyAt
  const canRefresh = () => Date.now() >= (refreshReadyRef.current ?? 0)
  const topPull = useWheelPullRefresh({ onRefresh: props.onRefresh, sign: 1, canRefresh })
  const bottomPull = useWheelPullRefresh({ onRefresh: props.onRefresh, sign: -1, canRefresh })
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
  const [searchActive, setSearchActive] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (searchActive) searchRef.current?.focus()
  }, [searchActive])

  // Esc：ポップアップが出ていれば一番上を 1 層だけ閉じ、出ていなければ絞り込みを解いてすべて表示する。
  // 入力欄の中の Esc(検索欄・ダイアログなど)と、画像を大きく見ているとき(Lightbox が閉じる)は手を出さない
  useEffect(() => {
    if (!props.active || lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (popups.length > 0) {
        e.preventDefault()
        setPopups((ps) => ps.slice(0, -1))
      } else if (filters.size > 0) {
        e.preventDefault()
        setFilters(new Set())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.active, lightbox, popups.length, filters.size])

  // 「草」などのすぐ書き込む操作の結果。スレ表示の下に少しのあいだ出す
  const [quickMessage, setQuickMessage] = useState<{ ok: boolean; text: string }>()
  const quickTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(quickTimer.current), [])
  /** スレ表示の下に、少しのあいだ結果を出す */
  const showQuick = (ok: boolean, text: string) => {
    setQuickMessage({ ok, text })
    clearTimeout(quickTimer.current)
    quickTimer.current = setTimeout(() => setQuickMessage(undefined), ok ? 2500 : 6000)
  }
  const quickPost = async (body: string) => {
    if (!props.onSubmitPost) return
    const show = showQuick
    show(true, '書き込み中…')
    try {
      const r = await props.onSubmitPost({ name: props.postName, mail: props.postMail, body })
      if (r.status === 'ok') show(true, `書き込みました: ${body.replace(/\n/g, ' ')}`)
      else if (r.status === 'auth') show(false, '認証が必要です。書き込み欄から一度書き込んで、認証を済ませてください')
      else if (r.status === 'confirm') show(false, '書き込み確認が出ました。書き込み欄から一度書き込んで、承諾してください')
      else show(false, r.message)
    } catch (e) {
      show(false, e instanceof Error ? e.message : String(e))
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
  useEffect(() => setReplySize(savedSize), [savedSize])
  const canReply = props.onSubmitPost !== undefined && log.status !== 'archived'
  const anchorCounts = useMemo(() => countAnchors(log.posts), [log.posts])
  /** 自分の書き込みへのアンカーを含むレス */
  const replyToOwn = useMemo(() => {
    const set = new Set<number>()
    if (ownNos.size === 0) return set
    for (const p of log.posts) if (anchorsIn(p.body).some((n) => ownNos.has(n) && n !== p.no)) set.add(p.no)
    return set
  }, [log.posts, ownNos])
  const idCounts = useMemo(() => countIds(log.posts), [log.posts])
  // レスの見せ方(名無しの省略・空行の扱い)と、スレ主の ID
  const display = useMemo(
    () => ({
      nonameName: props.nonameName,
      omitNoname: settings.omitNoname,
      collapseBlankLines: settings.collapseBlankLines,
      trimTrailingBlank: settings.trimTrailingBlank,
      splitIcon: props.splitPostIcon,
    }),
    [props.nonameName, settings.omitNoname, settings.collapseBlankLines, settings.trimTrailingBlank, props.splitPostIcon],
  )
  const opId = settings.highlightOp && log.posts[0]?.no === 1 ? log.posts[0].id : undefined
  /** 絞り込みと検索のあとに見えるレス。何も選んでいなければ undefined(全部見える) */
  const visibleNos = useMemo(() => {
    const q = normalizeForSearch(query.trim())
    if (filters.size === 0 && !q) return undefined
    const set = new Set<number>()
    for (const p of log.posts) {
      if (filters.size > 0) {
        const hit =
          (filters.has('popular') && (anchorCounts.get(p.no) ?? 0) >= 3) ||
          (filters.has('image') && imageUrlsIn(p.body).length > 0) ||
          (filters.has('video') && hasVideo(p.body)) ||
          (filters.has('link') && hasLink(p.body))
        if (!hit) continue
      }
      if (q && !normalizeForSearch(`${p.no} ${p.name} ${p.body}`).includes(q)) continue
      set.add(p.no)
    }
    return set
  }, [log.posts, filters, query, anchorCounts])

  const visiblePosts = useMemo(
    () => (visibleNos ? log.posts.filter((p) => visibleNos.has(p.no)) : log.posts),
    [log.posts, visibleNos],
  )
  const byNo = useMemo(() => new Map(log.posts.map((p) => [p.no, p])), [log.posts])
  /** レス番号 → そのレスにアンカーを付けているレスの番号 */
  const replies = useMemo(() => {
    const map = new Map<number, number[]>()
    for (const p of log.posts) {
      for (const n of new Set(anchorsIn(p.body))) {
        if (n !== p.no) map.set(n, [...(map.get(n) ?? []), p.no])
      }
    }
    return map
  }, [log.posts])

  const {
    scrollToPost,
    scrollToUnread,
    jumpToBottom,
    jumpToTop,
    stepPost,
    page,
    showJump,
    flashNos,
    intrinsicHeight,
    getPosition,
    restorePosition,
    flushRead,
  } = useThreadScroll({
    rootRef: ref,
    listRef,
    headerRef,
    threadKey: props.threadKey,
    log,
    byNo,
    unreadFrom,
    active: props.active,
    initialPosition: props.initialPosition,
    onSavePosition: props.onSavePosition,
    onRead,
    openPosition: settings.openPosition,
    autoScrollOnNew: settings.autoScrollOnNew,
    showThumbnails: settings.showThumbnails,
    jumpTo: props.jumpTo,
  })

  // スレが終わったら(dat 落ち・1000 到達)、一番下に次スレの候補を出す。ヘッダーのボタンでも出せる
  const ended = log.status === 'archived' || (log.posts.at(-1)?.no ?? 0) >= 1000
  const [showNext, setShowNext] = useState(false)

  // ヘッダー・フッター・︙ に並べる操作。どこに置くかは設定(ボタンの配置)で決まる
  const placements = useMemo(() => resolvePlacements('thread', settings.barLayout), [settings.barLayout])
  const barActions: BarAction[] = [
    { id: 'search', label: 'レス検索', icon: 'search', active: searchActive || !!query, onClick: () => setSearchActive((v) => !v) },
    {
      id: 'favorite',
      label: props.isFavorite ? 'お気に入りのスレから外す' : 'お気に入りのスレに足す',
      icon: 'star',
      active: props.isFavorite,
      activeColor: 'var(--c-heat-warm)',
      fillWhenActive: true,
      onClick: props.onToggleFavorite,
    },
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
            id: 'replyLayout',
            label: replyLayout === 'bottom' ? '書き込み欄を右に置く' : '書き込み欄を下に置く',
            icon: replyLayout === 'bottom' ? 'view_sidebar' : 'view_agenda',
            onClick: () => props.onChangeReplyLayout(replyLayout === 'bottom' ? 'right' : 'bottom'),
          },
        ]
      : []),
    { id: 'gallery', label: '画像一覧', icon: 'photo_library', active: galleryOpen, onClick: () => setGalleryOpen(true) },
    { id: 'delete', label: 'ログを削除して閉じる (Delete)', icon: 'delete', onClick: props.onDeleteLog },
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
      onClick: () => {
        const left = (props.refreshReadyAt ?? 0) - Date.now()
        if (left > 0) return showQuick(false, `続けて取りに行かないよう、あと ${Math.ceil(left / 1000)} 秒で更新できます`)
        void props.onRefresh()
      },
      // 帯に置いたときは、クールダウンの残りが見えるボタンにする
      render: () => (
        <RefreshButton
          className={ICON_BTN}
          onClick={() => void props.onRefresh()}
          loading={props.loading}
          readyAt={props.refreshReadyAt}
          cooldownMs={REFRESH_COOLDOWN_MS}
        />
      ),
    },
  ]
  const hasFooter = barActions.some((a) => placements[a.id] === 'footer')

  // キー操作(設定で割り当てを変えられる)。開いているタブで、入力欄にいないときだけ。
  // ポップアップや画像を見ているときは、後ろのスレ表示を動かさない
  const keymap = useMemo(() => resolveKeymap(settings.keymap), [settings.keymap])
  useEffect(() => {
    if (!props.active || lightbox || popups.length > 0) return
    const onKey = (e: KeyboardEvent) => {
      // F5・Ctrl+R はアプリ全体で扱う(App.tsx)ので、ここでは見ない
      if (e.defaultPrevented || isReloadKey(e)) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const action = actionFor(keymap, keyString(e))
      if (!action) return
      e.preventDefault()
      if (action === 'nextPost') stepPost(1)
      else if (action === 'prevPost') stepPost(-1)
      else if (action === 'pageDown') page(1)
      else if (action === 'pageUp') page(-1)
      else if (action === 'top') jumpToTop()
      else if (action === 'bottom') jumpToBottom()
      else if (action === 'unread') scrollToUnread(unreadFrom, 'animate')
      else if (action === 'refresh') void props.onRefresh()
      else if (action === 'search') setSearchActive(true)
      else if (action === 'reply') replyRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.active, props.onRefresh, lightbox, popups.length, keymap, unreadFrom, stepPost, page, jumpToTop, jumpToBottom, scrollToUnread])

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
  useLayoutEffect(() => {
    if (filtering) {
      beforeFilter.current ??= getPosition()
      return
    }
    const before = beforeFilter.current
    beforeFilter.current = undefined
    if (!before) return
    const readToEnd = filteredScrollable.current && getPosition()?.bottom
    restorePosition(readToEnd ? { ...before, bottom: true } : before)
  }, [filtering])

  // 見えなくなったら(別のタブに移ったら)、開いていたポップアップと画像を閉じる
  useEffect(() => {
    if (props.active) return
    setPopups([])
    setLightbox(undefined)
    setGalleryOpen(false)
  }, [props.active])

  // ── ポップアップ ──

  const closeAll = useCallback(() => {
    clearTimeout(hover.current.timer)
    hover.current.active = false
    setPopups([])
  }, [])

  // handlersFor と renderPosts は互いを使う(ポップアップの中のレスにも、1 段深いハンドラを渡す)
  const handlersFor = useCallback(
    (level: number): PostHandlers => {
      const open = (title: string, posts: Post[], el: HTMLElement, viaHover: boolean) =>
        openContent(title, renderPosts(posts, level + 1), el, viaHover)
      const openContent = (title: string, content: ReactNode, el: HTMLElement, viaHover = false) => {
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
        }
        setPopups((ps) => [...ps.slice(0, level), entry])
      }
      return {
        onAnchor: (nos, el, via) => {
          const posts = nos.map((n) => byNo.get(n)).filter((p): p is Post => p !== undefined)
          const title = `>>${nos.length > 1 ? `${nos[0]}-${nos.at(-1)}` : nos[0]}`
          if (via === 'click') {
            clearTimeout(hover.current.timer)
            open(title, posts, el, false)
            return
          }
          if (settings.anchorPopup !== 'hover') return
          clearTimeout(hover.current.timer)
          hover.current.timer = setTimeout(() => open(title, posts, el, true), HOVER_DELAY_MS)
        },
        onAnchorLeave: () => clearTimeout(hover.current.timer),
        onReplies: (no, el) => {
          const list = (replies.get(no) ?? []).map((n) => byNo.get(n)!).filter(Boolean)
          open(`>>${no} への返信 (${list.length})`, list, el, false)
        },
        onId: (id, el) => {
          const list = log.posts.filter((p) => p.id === id)
          open(`ID:${id} (${list.length})`, list, el, false)
        },
        onName: (name, el) => {
          const list = log.posts.filter((p) => p.name === name)
          open(`${name} (${list.length})`, list, el, false)
        },
        onBody: (no, el) => {
          const tree = anchorTree(no, log.posts)
          if (tree.length <= 1) return
          openContent(`>>${no} のアンカーツリー (${tree.length})`, renderTree(no, level + 1), el)
        },
        onUrl: props.onUrl,
        onImage: (urls, index, post) => setLightbox({ urls, index, post }),
        onAddNg: props.onAddNg,
        onNgDraft: props.onNgDraft,
        onReply: canReply
          ? (no) => {
              setPopups([])
              replyRef.current?.insert(`>>${no}\n`)
            }
          : undefined,
        onQuickReply: canReply ? (no, text) => void quickPostRef.current(`>>${no}\n${text}`) : undefined,
      }
    },
    // renderPosts は下で定義する関数で、handlersFor と同じ依存で作り直される
    [byNo, replies, log.posts, settings, isNg, anchorCounts, idCounts, ownNos, replyToOwn, canReply, display, opId, props.onUrl, props.onAddNg],
  )

  /** アンカーツリーを線でつないで描く(ポップアップの中身) */
  function renderTree(start: number, level: number) {
    const handlers = handlersFor(level)
    return (
      <AnchorTree
        rows={anchorTreeRows(start, log.posts)}
        focus={start}
        renderPost={(no) => {
          const p = byNo.get(no)!
          return (
            <PostArticle
              post={p}
              anchorCount={anchorCounts.get(p.no) ?? 0}
              idCount={p.id ? (idCounts.get(p.id) ?? 1) : 0}
              showTopDivider={false}
              ng={isNg(p)}
              ngMode="aborn"
              showThumbnails={settings.showThumbnails}
              aaAutoDetect={settings.aaAutoDetect}
              showIdenticon={settings.showIdenticon}
              showLinkPreview={settings.showLinkPreview}
              display={display}
              toolbar={settings.postToolbar}
              phrases={settings.quickPhrases}
              isOp={opId !== undefined && p.id === opId}
              isOwn={ownNos.has(p.no)}
              isReplyToOwn={replyToOwn.has(p.no)}
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
            post={p}
            anchorCount={anchorCounts.get(p.no) ?? 0}
            idCount={p.id ? (idCounts.get(p.id) ?? 1) : 0}
            showTopDivider={i > 0}
            ng={isNg(p)}
            ngMode="aborn"
            showThumbnails={settings.showThumbnails}
            aaAutoDetect={settings.aaAutoDetect}
            showIdenticon={settings.showIdenticon}
            showLinkPreview={settings.showLinkPreview}
            display={display}
            toolbar={settings.postToolbar}
            phrases={settings.quickPhrases}
            isOp={opId !== undefined && p.id === opId}
            isOwn={ownNos.has(p.no)}
            isReplyToOwn={replyToOwn.has(p.no)}
            handlers={handlers}
          />
        ))}
      </div>
    )
  }

  const mainHandlers = useMemo(() => handlersFor(0), [handlersFor])

  // スレタイ・絞り込みの帯。書き込み欄が下のときはスクロール領域の中に置いて(すりガラス越しにレスが透ける)、
  // 右のときはスクロール領域の外に出して横いっぱいに置く(書き込み欄はその下に並ぶ)
  const headerBlock = (
    <div
      ref={headerRef}
      className={`${headerInScroll ? 'sticky top-0 z-10 frosted-glass' : ''} bg-panel-thread-header border-b border-c-border flex-shrink-0`}
    >
        <header className="flex items-center justify-between px-6" style={{ height: 'var(--header-height, 80px)' }}>
          <div className="relative min-w-0 flex-1 h-10 flex items-center gap-2">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => {
                if (!query.trim()) setSearchActive(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('')
                  setSearchActive(false)
                }
              }}
              placeholder="レス検索..."
              className={`absolute inset-y-0 right-0 z-10 bg-c-surface border border-c-border rounded-[var(--card-radius)] px-3 text-sm text-c-text-body placeholder-c-text-muted focus:outline-none focus:ring-0 transition-[left,opacity] duration-300 ease-out ${
                searchActive ? 'left-0 opacity-100' : 'left-full opacity-0 pointer-events-none'
              }`}
            />
            <h2
              className="font-bold truncate text-base cursor-pointer hover:text-c-accent transition-colors"
              style={{ color: 'var(--thread-title-color, var(--c-text-strong))' }}
              onClick={() => {
                if (ref.current) ref.current.scrollTop = 0
              }}
              title="クリックで先頭へスクロール"
            >
              {log.title}
              <span className="ml-1.5 text-sm font-normal text-c-text-muted tabular-nums">({log.posts.length})</span>
            </h2>
            {log.status === 'archived' && (
              <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-c-surface3 text-c-text-muted">
                dat落ち
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 ml-4">
            {settings.autoRefreshSec > 0 && (
              <span className="flex items-center gap-1 text-xs text-c-accent" title="自動更新中">
                <span className="material-symbols-outlined text-base">autorenew</span>
                {settings.autoRefreshSec}秒
              </span>
            )}
            <ActionButtons actions={barActions} placements={placements} where="header" btnClass={ICON_BTN} iconClass="text-xl" />
            <MoreMenu actions={barActions} btnClass={ICON_BTN} iconClass="text-xl" />
          </div>
        </header>
        <div className="flex items-center gap-5 px-4 overflow-x-auto no-scrollbar text-base font-medium">
          {FILTERS.map(({ key, label, icon }) => {
            const active = filters.has(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() =>
                  setFilters((f) => {
                    const next = new Set(f)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })
                }
                className={`relative shrink-0 flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  active ? 'text-c-accent' : 'text-c-text-muted hover:text-c-text-body'
                }`}
                style={{ paddingTop: 10, paddingBottom: 10 }}
              >
                <span className="material-symbols-outlined text-xl leading-none">{icon}</span>
                {label}
                {active && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-c-accent rounded-full" />}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setFilters(new Set())}
            className={`relative shrink-0 transition-colors ${filters.size === 0 ? 'text-c-accent' : 'text-c-text-muted hover:text-c-text-body'}`}
            style={{ paddingTop: 10, paddingBottom: 10 }}
          >
            すべて
            {filters.size === 0 && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-c-accent rounded-full" />}
          </button>
          {visibleNos && (
            <span className="ml-auto shrink-0 text-xs text-c-text-muted tabular-nums">
              {visibleNos.size} / {log.posts.length} レス
            </span>
          )}
        </div>
      </div>
  )

  return (
    <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-panel-view overflow-hidden">
      {!headerInScroll && headerBlock}
      <div className={`flex-1 min-h-0 min-w-0 flex ${replyLayout === 'right' ? 'flex-row' : 'flex-col'}`}>
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
      <div ref={viewRef} className="relative flex-1 min-h-0 min-w-0 flex overflow-hidden">
      <button
        type="button"
        onClick={jumpToBottom}
        title="いちばん下へ"
        className={`absolute bottom-5 z-20 w-11 h-11 flex items-center justify-center rounded-full bg-c-surface border border-c-border shadow-lg text-c-text-body hover:text-c-accent hover:border-c-accent transition-all duration-200 ${
          showJump ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
        }`}
        // ミニマップを出しているときは、その左に置く
        style={{ right: settings.showMinimap ? 44 : 20 }}
      >
        <span className="material-symbols-outlined text-2xl">keyboard_double_arrow_down</span>
      </button>
      <div
        ref={topPull.indicatorRef}
        className="absolute left-0 right-0 flex justify-center pointer-events-none z-20"
        style={{ top: headerInScroll ? headerHeight : 0, opacity: 0, transform: `translateY(${PULL_HIDDEN_Y}px)` }}
      >
        <PullSpinner iconRef={topPull.iconRef} />
      </div>
      <div
        ref={bottomPull.indicatorRef}
        className="absolute left-0 right-0 bottom-0 flex justify-center pointer-events-none z-20"
        style={{ opacity: 0, transform: `translateY(${-PULL_HIDDEN_Y}px)` }}
      >
        <PullSpinner iconRef={bottomPull.iconRef} />
      </div>
      <div
        ref={ref}
        onWheel={onWheel}
        onScroll={onScrollPull}
        className={`flex-1 min-w-0 overflow-y-auto flex flex-col ${settings.showMinimap ? 'no-scrollbar' : 'custom-scrollbar'}`}
      >
        {headerInScroll && headerBlock}

        <div ref={listRef} className="flex-1 flex flex-col" style={{ padding: 'var(--list-padding-post)', gap: 'var(--list-gap-post)' }}>
          {log.posts.length === 0 ? (
            props.loading ? <LoadingCenter /> : <div className="text-c-text-muted text-sm">投稿がありません</div>
          ) : (
            <>
              {log.posts.map((p, i) => {
                const firstUnread = p.no === unreadFrom && unreadFrom > 1
                const enterDelay = flashNos.get(p.no)
                return (
                  <div
                    key={p.no}
                    className={`post-cv ${enterDelay !== undefined ? 'post-enter' : ''}`}
                    style={
                      {
                        // 画面の外で描くのを省いている間の仮の高さ(覚えておいた高さか、本文からの見積もり)
                        containIntrinsicSize: `auto ${intrinsicHeight(p)}px`,
                        ...(enterDelay !== undefined && { '--enter-delay': `${enterDelay}ms` }),
                      } as CSSProperties
                    }
                    data-post={p.no}
                    hidden={visibleNos !== undefined && !visibleNos.has(p.no)}>
                    {firstUnread && !visibleNos && <Divider label="ここから未読" self />}
                    <PostArticle
                      post={p}
                      anchorCount={anchorCounts.get(p.no) ?? 0}
                      idCount={p.id ? (idCounts.get(p.id) ?? 1) : 0}
                      showTopDivider={i > 0 && !firstUnread}
                      ng={isNg(p)}
                      ngMode={settings.ngMode}
                      showThumbnails={settings.showThumbnails}
                      aaAutoDetect={settings.aaAutoDetect}
                      showIdenticon={settings.showIdenticon}
                      showLinkPreview={settings.showLinkPreview}
                      display={display}
                      toolbar={settings.postToolbar}
                      phrases={settings.quickPhrases}
                      isOp={opId !== undefined && p.id === opId}
                      flash={flashNos.has(p.no)}
                      isOwn={ownNos.has(p.no)}
                      isReplyToOwn={replyToOwn.has(p.no)}
                      handlers={mainHandlers}
                    />
                  </div>
                )
              })}
              <Divider label="-END-" />
              {props.onFindNext && (ended || showNext) && <NextThreadBox find={props.onFindNext} onOpen={props.onOpenThread} />}
            </>
          )}
        </div>
      </div>
      {settings.showMinimap && log.posts.length > 0 && (
        <Minimap
          posts={visiblePosts}
          scrollRef={ref}
          listRef={listRef}
          anchorCounts={anchorCounts}
          ownNos={ownNos}
          replyToOwn={replyToOwn}
          unreadFrom={unreadFrom}
          topOffset={headerInScroll ? headerHeight : 0}
          onJump={scrollToPost}
        />
      )}
      </div>
      {/* フッター。ボタンの配置で「フッター」にした操作だけ並べる(なければ出さない) */}
      {hasFooter && (
        <div className="flex-shrink-0 h-10 px-3 flex items-center justify-end gap-1 border-t border-c-border bg-panel-thread-header">
          <ActionButtons actions={barActions} placements={placements} where="footer" btnClass={ICON_BTN} iconClass="text-xl" />
        </div>
      )}
      </div>

      {props.onSubmitPost && (
        <>
          <Splitter
            layout={replyLayout}
            size={replySize}
            onChange={setReplySize}
            onEnd={(size) => props.onResizeReply(sizeKey, size)}
          />
          <div
            className="flex-shrink-0 min-h-0 min-w-0"
            style={replyLayout === 'bottom' ? { height: replySize } : { width: replySize }}
          >
            <ReplyForm
              ref={replyRef}
              layout={replyLayout}
              disabled={log.status === 'archived' ? 'dat 落ちしたスレには書き込めません' : undefined}
              initialName={props.postName}
              initialMail={props.postMail}
              onSubmit={props.onSubmitPost}
              onConfirm={props.onConfirmPost}
              onUploaded={props.onUploaded}
              readyAt={props.postReadyAt}
              cooldownMs={props.postCooldownMs}
              accounts={props.postAccounts}
              draft={props.draft}
              limits={props.postLimits}
              byteLength={props.postByteLength}
              onToggleAccount={props.onTogglePostAccount}
              onOpenAccountSettings={props.onOpenAccountSettings}
              onImage={(urls, index) => setLightbox({ urls, index })}
              uploader={
                settings.uploaderEnabled
                  ? {
                      stripMetadata: settings.uploadStripMetadata,
                      maxDimension: settings.uploadMaxDimension,
                      userhash: settings.catboxUserhash.trim() || undefined,
                    }
                  : undefined
              }
              onOpenUrl={props.onUrl}
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
            borderColor: quickMessage.ok ? 'var(--c-border)' : 'var(--c-accent-self)',
          }}
        >
          <span className={`material-symbols-outlined text-lg ${quickMessage.ok ? 'text-c-accent' : 'text-c-heat-very-hot'}`}>
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
          items={collectMedia(log.posts.filter((p) => !isNg(p)))}
          saveDir={settings.imageSaveDir}
          onOpen={(items, index) => setLightbox({ urls: items.map((m) => m.url), index, posts: items.map((m) => m.post) })}
          onClose={() => setGalleryOpen(false)}
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
