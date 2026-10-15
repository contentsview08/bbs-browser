// スレ表示。web 版の MainBoardPage.tsx(ThreadView 部分)の見た目を移植。
// - 開いたら設定どおりの位置(最初の未読/先頭/末尾)へ移動し、スクロールに合わせて既読位置を知らせる
// - アンカー・返信・ID はポップアップで出す(ホバーかクリックかは設定で選ぶ)
// - 自動更新などで新着が届いたら光らせ、いちばん下を見ていれば新着まで追いかける

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Post } from '@bbs-browser/connectors'
import type { ThreadLog } from '@bbs-browser/logstore'
import PostArticle, { type PostHandlers } from './PostArticle'
import PostPopup, { type PopupEntry } from './PostPopup'
import Lightbox from './Lightbox'
import { anchorsIn, countAnchors, countIds } from '../utils/postBody'
import type { NgRule } from '../utils/ng'
import type { AppSettings } from '../ui/settings'

interface Props {
  log: ThreadLog
  /** 開いた時点の「最初の未読」のレス番号。ここに「ここから未読」の線を引く */
  unreadFrom: number
  loading: boolean
  settings: AppSettings
  isNg: (p: Post) => boolean
  onRead: (no: number) => void
  onRefresh: () => void
  onOpenInBrowser: () => void
  onUrl: (url: string) => void
  onAddNg: (rule: NgRule) => void
}

const ICON_BTN = 'p-2 text-c-text-muted hover:text-c-text-strong transition-colors rounded-lg'
/** ホバーで開くまでの待ち時間。通り過ぎただけで開かないように */
const HOVER_DELAY_MS = 150
/** ホバーで開いたポップアップは、まだ中に入っていなければ、開いた位置からこれだけ離れたら閉じる */
const HOVER_ESCAPE_PX = 60

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
  const headerRef = useRef<HTMLDivElement>(null)
  const positioned = useRef(false)
  const sent = useRef(log.readNo)
  const atBottom = useRef(false)
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

  const anchorCounts = useMemo(() => countAnchors(log.posts), [log.posts])
  const idCounts = useMemo(() => countIds(log.posts), [log.posts])
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

  // 前回の描画より後ろの番号は「新着」として光らせる(最初の表示では光らせない)
  const flashFrom = positioned.current ? lastMax.current + 1 : Infinity
  useEffect(() => {
    lastMax.current = log.posts.at(-1)?.no ?? 0
  }, [log.posts])

  /** レスの頭がヘッダーの下に来るようにスクロールする */
  const scrollToPost = useCallback((no: number) => {
    const root = ref.current
    const el = root?.querySelector<HTMLElement>(`[data-no="${no}"]`)
    if (!root || !el) return
    const headerH = headerRef.current?.offsetHeight ?? 0
    root.scrollTop += el.getBoundingClientRect().top - root.getBoundingClientRect().top - headerH - 8
  }, [])

  // 画面の下端より上に頭が出ているレスのうち、いちばん後ろの番号を既読にする
  const reportRead = useCallback(() => {
    const root = ref.current
    if (!root) return
    const bottom = root.getBoundingClientRect().bottom
    let last = 0
    for (const el of root.querySelectorAll<HTMLElement>(':scope [data-no]')) {
      if (el.getBoundingClientRect().top >= bottom) break
      last = Number(el.dataset.no)
    }
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
    if (settings.openPosition === 'bottom') root.scrollTop = root.scrollHeight
    else if (settings.openPosition === 'unread' && unreadFrom > 1) {
      if (byNo.has(unreadFrom)) scrollToPost(unreadFrom)
      else root.scrollTop = root.scrollHeight
    }
    reportRead()
  }, [log, unreadFrom, byNo, settings.openPosition, reportRead, scrollToPost])

  // いちばん下を見ていたら、届いた新着まで追いかける
  const prevCount = useRef(log.posts.length)
  useLayoutEffect(() => {
    const root = ref.current
    const grew = log.posts.length > prevCount.current
    prevCount.current = log.posts.length
    if (!root || !grew || !positioned.current) return
    if (settings.autoScrollOnNew && atBottom.current) root.scrollTo({ top: root.scrollHeight, behavior: 'smooth' })
  }, [log.posts.length, settings.autoScrollOnNew])

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
        if (ref.current)
          setPopupFrame({
            rect: ref.current.getBoundingClientRect(),
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
        onUrl: props.onUrl,
        onImage: (urls, index) => setLightbox({ urls, index }),
        onAddNg: props.onAddNg,
      }
    },
    // renderPosts は下で定義する関数で、handlersFor と同じ依存で作り直される
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byNo, replies, log.posts, settings, isNg, anchorCounts, idCounts, props.onUrl, props.onAddNg],
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
            handlers={handlers}
          />
        ))}
      </div>
    )
  }

  const mainHandlers = useMemo(() => handlersFor(0), [handlersFor])

  return (
    <main className="flex-1 min-w-0 flex flex-col bg-[var(--c-thread-view-bg)] overflow-hidden">
      <div ref={ref} className="h-full overflow-y-auto custom-scrollbar flex flex-col">
        <div ref={headerRef} className="sticky top-0 z-10 frosted-glass border-b border-c-border flex-shrink-0">
          <header className="flex items-center justify-between px-6" style={{ height: 'var(--header-height, 80px)' }}>
            <div className="min-w-0 flex-1 flex items-center gap-2">
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
              <button type="button" className={ICON_BTN} title="ブラウザで開く" onClick={props.onOpenInBrowser}>
                <span className="material-symbols-outlined text-xl">open_in_new</span>
              </button>
              <button type="button" className={ICON_BTN} title="更新" onClick={props.onRefresh} disabled={props.loading}>
                <span className={`material-symbols-outlined text-xl ${props.loading ? 'animate-spin' : ''}`}>refresh</span>
              </button>
            </div>
          </header>
        </div>

        <div className="flex-1 flex flex-col" style={{ padding: 'var(--list-padding-post)', gap: 'var(--list-gap-post)' }}>
          {log.posts.length === 0 ? (
            <div className="text-c-text-muted text-sm">{props.loading ? '読み込み中...' : '投稿がありません'}</div>
          ) : (
            <>
              {log.posts.map((p, i) => {
                const firstUnread = p.no === unreadFrom && unreadFrom > 1
                return (
                  <div key={p.no}>
                    {firstUnread && <Divider label="ここから未読" self />}
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
