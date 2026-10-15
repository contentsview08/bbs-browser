// スレ表示。web 版の MainBoardPage.tsx(ThreadView 部分)の見た目を移植。
// - 開いたら設定どおりの位置(最初の未読/先頭/末尾)へ移動し、スクロールに合わせて既読位置を知らせる
// - アンカー・返信・ID はポップアップで出す(ホバーかクリックかは設定で選ぶ)
// - 新着が届いたら光らせる。いちばん下を見ていたら、新着の頭が見えるところまで送る
//   (前回最後まで読んでいたスレを開いたときは、届いた新着の頭へ移る。末尾までは飛ばない)
// - 書き込み欄は下か右に置き、境界をドラッグして大きさを変えられる

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Post, PostInput, PostResult } from '@bbs-browser/connectors'
import type { ThreadLog } from '@bbs-browser/logstore'
import PostArticle, { type PostHandlers } from './PostArticle'
import PostPopup, { type PopupEntry } from './PostPopup'
import Lightbox from './Lightbox'
import Minimap from './Minimap'
import ReplyForm, { type ReplyFormHandle } from './ReplyForm'
import PullSpinner from './PullSpinner'
import { useWheelPullRefresh } from '../hooks/useWheelPullRefresh'
import { PULL_HIDDEN_Y } from '../utils/pullRefresh'
import {
  anchorTree,
  anchorsIn,
  countAnchors,
  countIds,
  hasLink,
  hasYoutube,
  imageUrlsIn,
  normalizeForSearch,
} from '../utils/postBody'
import type { NgRule } from '../utils/ng'
import type { AppSettings, ReplyLayout } from '../ui/settings'

/** 読んでいた位置。画面のいちばん上に見えていたレスと、ヘッダーの下端からのずれ */
export interface ScrollPosition {
  no: number
  offset: number
}

interface Props {
  log: ThreadLog
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
  /** 自分の書き込みのレス番号 */
  ownNos: Set<number>
  /** 書き込み。コネクタが書き込みに対応していなければ undefined */
  onSubmitPost?: (input: PostInput) => Promise<PostResult>
  postName: string
  postMail: string
  onChangeReplyLayout: (layout: ReplyLayout) => void
  onResizeReply: (key: 'replyHeight' | 'replyWidth', size: number) => void
  /** ログを消してタブを閉じる */
  onDeleteLog: () => void
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
/** ホバーで開いたポップアップは、まだ中に入っていなければ、開いた位置からこれだけ離れたら閉じる */
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
  /** スクロール位置の計算で差し引くヘッダーの高さ(ヘッダーがスクロール領域の外にあれば 0) */
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
  const positioned = useRef(false)
  const sent = useRef(log.readNo)
  const atBottom = useRef(false)
  /** 開いたときに未読の頭がまだ手元になかった。新着が届いたらそこへ移る */
  const pendingUnread = useRef(false)
  const position = useRef<ScrollPosition | undefined>(props.initialPosition)
  const onSavePosition = useRef(props.onSavePosition)
  onSavePosition.current = props.onSavePosition
  const lastMax = useRef(0)
  const [popups, setPopups] = useState<PopupEntry[]>([])
  const [popupFrame, setPopupFrame] = useState<{ rect: DOMRect; headerBottom: number }>()
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number }>()
  const popupSeq = useRef(0)
  const hover = useRef<{ timer?: ReturnType<typeof setTimeout>; active: boolean; entered: boolean; x: number; y: number }>({
    active: false,
    entered: false,
    x: 0,
    y: 0,
  })

  // 端でさらにホイールを回すと更新する(web 版と同じ)。上端と下端で別々に持つ
  const topPull = useWheelPullRefresh({ onRefresh: props.onRefresh, sign: 1 })
  const bottomPull = useWheelPullRefresh({ onRefresh: props.onRefresh, sign: -1 })
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
          (filters.has('video') && hasYoutube(p.body)) ||
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

  const prevCount = useRef(log.posts.length)

  // 前回の描画より後ろの番号は「新着」として光らせる(最初の表示では光らせない)
  const flashFrom = positioned.current ? lastMax.current + 1 : Infinity
  useEffect(() => {
    lastMax.current = log.posts.at(-1)?.no ?? 0
  }, [log.posts])

  /** レスの頭がヘッダーの下に来るようにスクロールする */
  const scrollToPost = useCallback((no: number, behavior: ScrollBehavior = 'instant') => {
    const root = ref.current
    const el = root?.querySelector<HTMLElement>(`[data-no="${no}"]`)
    if (!root || !el) return
    const headerH = headerOffset()
    const top = root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top - headerH - 8
    root.scrollTo({ top, behavior })
  }, [])

  // 画面の下端より上に頭が出ているレスのうち、いちばん後ろの番号を既読にする
  const reportRead = useCallback(() => {
    const root = ref.current
    if (!root) return
    const bottom = root.getBoundingClientRect().bottom
    const viewTop = root.getBoundingClientRect().top + headerOffset()
    let last = 0
    let top: ScrollPosition | undefined
    for (const el of root.querySelectorAll<HTMLElement>(':scope [data-no]')) {
      if (el.offsetParent === null) continue // 絞り込みで隠しているレス
      const rect = el.getBoundingClientRect()
      if (rect.top >= bottom) break
      last = Number(el.dataset.no)
      // ヘッダーの下に少しでも見えている最初のレスを、読んでいた位置として覚える
      if (!top && rect.bottom > viewTop) top = { no: last, offset: rect.top - viewTop }
    }
    if (top) position.current = top
    atBottom.current = root.scrollHeight - root.scrollTop - root.clientHeight < 40
    if (last > sent.current) {
      sent.current = last
      onRead(last)
    }
  }, [onRead])

  // 最初にレスが出たときだけ、設定どおりの位置へ移動する
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || positioned.current || log.posts.length === 0) return
    positioned.current = true
    const saved = props.initialPosition
    const savedEl = saved && root.querySelector<HTMLElement>(`[data-no="${saved.no}"]`)
    if (saved && savedEl) {
      const viewTop = root.getBoundingClientRect().top + headerOffset()
      root.scrollTop += savedEl.getBoundingClientRect().top - viewTop - saved.offset
    } else if (settings.openPosition === 'bottom') root.scrollTop = root.scrollHeight
    else if (settings.openPosition === 'unread' && unreadFrom > 1) {
      if (byNo.has(unreadFrom)) scrollToPost(unreadFrom)
      else {
        root.scrollTop = root.scrollHeight
        pendingUnread.current = true
      }
    }
    // この描画で届いたレスは「新着」として扱わない(下の effect が追いかけないように)
    prevCount.current = log.posts.length
    reportRead()
  }, [log, unreadFrom, byNo, settings.openPosition, reportRead, scrollToPost])

  // 画面から外れるときに、読んでいた位置を渡す
  useEffect(() => () => {
    if (position.current) onSavePosition.current(position.current)
  }, [])

  // 新着が届いたとき: 開いた直後なら未読の頭へ移る。いちばん下を見ていたら新着の頭まで送る
  useLayoutEffect(() => {
    const root = ref.current
    const grew = log.posts.length > prevCount.current
    prevCount.current = log.posts.length
    if (!root || !grew || !positioned.current) return
    if (pendingUnread.current) {
      pendingUnread.current = false
      if (byNo.has(unreadFrom)) {
        scrollToPost(unreadFrom)
        reportRead()
        return
      }
    }
    // lastMax はまだ前回の描画の値なので、その次が新着の頭
    if (settings.autoScrollOnNew && atBottom.current) scrollToPost(lastMax.current + 1, 'smooth')
  }, [log.posts.length, byNo, unreadFrom, settings.autoScrollOnNew, scrollToPost, reportRead])

  useEffect(() => {
    const root = ref.current
    if (!root) return
    let timer: ReturnType<typeof setTimeout>
    const onScroll = () => {
      clearTimeout(timer)
      timer = setTimeout(reportRead, 300)
    }
    root.addEventListener('scroll', onScroll)
    return () => {
      root.removeEventListener('scroll', onScroll)
      clearTimeout(timer)
    }
  }, [reportRead])

  // ── ポップアップ ──

  const closeAll = useCallback(() => {
    clearTimeout(hover.current.timer)
    hover.current.active = false
    setPopups([])
  }, [])

  // handlersFor と renderPosts は互いを使う(ポップアップの中のレスにも、1 段深いハンドラを渡す)
  const handlersFor = useCallback(
    (level: number): PostHandlers => {
      const open = (title: string, posts: Post[], el: HTMLElement, viaHover: boolean) => {
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
          content: renderPosts(posts, level + 1),
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
          open(`>>${no} のアンカーツリー (${tree.length})`, tree.map((n) => byNo.get(n)!), el, false)
        },
        onUrl: props.onUrl,
        onImage: (urls, index) => setLightbox({ urls, index }),
        onAddNg: props.onAddNg,
        onReply: canReply
          ? (no) => {
              setPopups([])
              replyRef.current?.insert(`>>${no}\n`)
            }
          : undefined,
      }
    },
    // renderPosts は下で定義する関数で、handlersFor と同じ依存で作り直される
    [byNo, replies, log.posts, settings, isNg, anchorCounts, idCounts, ownNos, replyToOwn, canReply, props.onUrl, props.onAddNg],
  )

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
      className={`${headerInScroll ? 'sticky top-0 z-10 frosted-glass' : 'bg-[var(--c-thread-view-bg)]'} border-b border-c-border flex-shrink-0`}
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
            </h2>
            {log.status === 'archived' && (
              <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-c-surface3 text-c-text-muted">
                dat落ち
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button
              type="button"
              onClick={() => setSearchActive((v) => !v)}
              className={`${ICON_BTN} ${searchActive || query ? 'text-c-accent' : ''}`}
              title="レス検索"
            >
              <span className="material-symbols-outlined text-xl">search</span>
            </button>
            {settings.autoRefreshSec > 0 && (
              <span className="flex items-center gap-1 text-xs text-c-accent" title="自動更新中">
                <span className="material-symbols-outlined text-base">autorenew</span>
                {settings.autoRefreshSec}秒
              </span>
            )}
            <span className="text-xs text-c-text-muted tabular-nums">{log.posts.length} レス</span>
            <button
              type="button"
              className={ICON_BTN}
              title="いちばん下へ"
              onClick={() => ref.current?.scrollTo({ top: ref.current.scrollHeight })}
            >
              <span className="material-symbols-outlined text-xl">vertical_align_bottom</span>
            </button>
            {props.onSubmitPost && (
              <button
                type="button"
                className={ICON_BTN}
                title={replyLayout === 'bottom' ? '書き込み欄を右に置く' : '書き込み欄を下に置く'}
                onClick={() => props.onChangeReplyLayout(replyLayout === 'bottom' ? 'right' : 'bottom')}
              >
                <span className="material-symbols-outlined text-xl">{replyLayout === 'bottom' ? 'view_sidebar' : 'view_agenda'}</span>
              </button>
            )}
            <button type="button" className={ICON_BTN} title="ログを削除して閉じる (Delete)" onClick={props.onDeleteLog}>
              <span className="material-symbols-outlined text-xl">delete</span>
            </button>
            <button type="button" className={ICON_BTN} title="ブラウザで開く" onClick={props.onOpenInBrowser}>
              <span className="material-symbols-outlined text-xl">open_in_new</span>
            </button>
            <button type="button" className={ICON_BTN} title="更新" onClick={props.onRefresh} disabled={props.loading}>
              <span className={`material-symbols-outlined text-xl ${props.loading ? 'animate-spin' : ''}`}>refresh</span>
            </button>
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
    <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-[var(--c-thread-view-bg)] overflow-hidden">
      {!headerInScroll && headerBlock}
      <div className={`flex-1 min-h-0 min-w-0 flex ${replyLayout === 'right' ? 'flex-row' : 'flex-col'}`}>
      <div ref={viewRef} className="relative flex-1 min-h-0 min-w-0 flex overflow-hidden">
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
        className={`flex-1 min-w-0 overflow-y-auto flex flex-col ${settings.showMinimap ? 'no-scrollbar' : 'custom-scrollbar'}`}
      >
        {headerInScroll && headerBlock}

        <div ref={listRef} className="flex-1 flex flex-col" style={{ padding: 'var(--list-padding-post)', gap: 'var(--list-gap-post)' }}>
          {log.posts.length === 0 ? (
            <div className="text-c-text-muted text-sm">{props.loading ? '読み込み中...' : '投稿がありません'}</div>
          ) : (
            <>
              {log.posts.map((p, i) => {
                const firstUnread = p.no === unreadFrom && unreadFrom > 1
                return (
                  <div key={p.no} hidden={visibleNos !== undefined && !visibleNos.has(p.no)}>
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
                      flash={p.no >= flashFrom}
                      isOwn={ownNos.has(p.no)}
                      isReplyToOwn={replyToOwn.has(p.no)}
                      handlers={mainHandlers}
                    />
                  </div>
                )
              })}
              <Divider label="-END-" />
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
              onOpenUrl={props.onUrl}
            />
          </div>
        </>
      )}
      </div>

      <PostPopup
        popups={popups}
        containerRect={popupFrame?.rect}
        headerBottom={popupFrame?.headerBottom ?? 0}
        onCloseTop={() => setPopups((ps) => ps.slice(0, -1))}
        onCloseAll={closeAll}
        onPopupEnter={() => {
          hover.current.entered = true
        }}
        onOverlayMove={(x, y) => {
          const h = hover.current
          if (!h.active) return
          if (h.entered || Math.hypot(x - h.x, y - h.y) > HOVER_ESCAPE_PX) closeAll()
        }}
      />

      {lightbox && (
        <Lightbox
          urls={lightbox.urls}
          index={lightbox.index}
          onIndex={(index) => setLightbox((l) => l && { ...l, index })}
          onClose={() => setLightbox(undefined)}
          onOpenExternal={props.onUrl}
        />
      )}
    </main>
  )
}
