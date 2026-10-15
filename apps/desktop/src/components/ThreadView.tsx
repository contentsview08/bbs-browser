// スレ表示。web 版の MainBoardPage.tsx(ThreadView 部分)の見た目を移植。
// 開いたら最初の未読へ移動し、スクロールに合わせて既読位置を知らせる。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ThreadLog } from '@bbs-browser/logstore'
import PostArticle from './PostArticle'
import { countAnchors, countIds } from '../utils/postBody'

interface Props {
  log: ThreadLog
  /** 開いた時点の「最初の未読」のレス番号。ここに「ここから未読」の線を引く */
  unreadFrom: number
  loading: boolean
  onRead: (no: number) => void
  onRefresh: () => void
  onOpenInBrowser: () => void
  onUrl: (url: string) => void
}

const ICON_BTN = 'p-2 text-c-text-muted hover:text-c-text-strong transition-colors rounded-lg'

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

export default function ThreadView({ log, unreadFrom, loading, onRead, onRefresh, onOpenInBrowser, onUrl }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const positioned = useRef(false)
  const sent = useRef(log.readNo)

  const anchorCounts = useMemo(() => countAnchors(log.posts), [log.posts])
  const idCounts = useMemo(() => countIds(log.posts), [log.posts])

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
    for (const el of root.querySelectorAll<HTMLElement>('[data-no]')) {
      if (el.getBoundingClientRect().top >= bottom) break
      last = Number(el.dataset.no)
    }
    if (last > sent.current) {
      sent.current = last
      onRead(last)
    }
  }, [onRead])

  // 最初にレスが出たときだけ位置を合わせる(差分の追加で飛ばないように)
  useLayoutEffect(() => {
    const root = ref.current
    if (!root || positioned.current || log.posts.length === 0) return
    positioned.current = true
    if (unreadFrom > 1) {
      if (log.posts.some((p) => p.no === unreadFrom)) scrollToPost(unreadFrom)
      else root.scrollTop = root.scrollHeight
    }
    reportRead()
  }, [log, unreadFrom, reportRead, scrollToPost])

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
              <span className="text-xs text-c-text-muted tabular-nums">{log.posts.length} レス</span>
              <button type="button" className={ICON_BTN} title="ブラウザで開く" onClick={onOpenInBrowser}>
                <span className="material-symbols-outlined text-xl">open_in_new</span>
              </button>
              <button type="button" className={ICON_BTN} title="更新" onClick={onRefresh} disabled={loading}>
                <span className={`material-symbols-outlined text-xl ${loading ? 'animate-spin' : ''}`}>refresh</span>
              </button>
            </div>
          </header>
        </div>

        <div className="flex-1 flex flex-col" style={{ padding: 'var(--list-padding-post)', gap: 'var(--list-gap-post)' }}>
          {log.posts.length === 0 ? (
            <div className="text-c-text-muted text-sm">{loading ? '読み込み中...' : '投稿がありません'}</div>
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
                      onAnchor={scrollToPost}
                      onUrl={onUrl}
                    />
                  </div>
                )
              })}
              <Divider label="-END-" />
            </>
          )}
        </div>
      </div>
    </main>
  )
}
