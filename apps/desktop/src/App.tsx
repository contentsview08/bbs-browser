// 骨組み: 板一覧 / スレ一覧(または履歴)/ レスの 3 ペイン。
// ログは SQLite(LogStore)に保存し、開いたスレは手元のログを先に出してから差分を取りに行く。
// 見た目は仮。hono-bbs の web のデザインは、この骨組みが固まってから移植する。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { findConnector, type Board, type SiteConfig, type ThreadSummary } from '@bbs-browser/connectors'
import type { HistoryEntry, LogStore, ThreadLog, ThreadState } from '@bbs-browser/logstore'
import { openLogStore } from './host/logStore'
import { tauriContext as ctx } from './host/tauriContext'

const threadId = (t: ThreadSummary) => `${t.boardUrl}${t.key}`

const connectorOf = (id: string) => {
  const c = findConnector(id)
  if (!c) throw new Error(`コネクタ ${id} がありません`)
  return c
}

export default function App() {
  const [store, setStore] = useState<LogStore>()
  const [sites, setSites] = useState<SiteConfig[]>([])
  const [site, setSite] = useState<SiteConfig>()
  const [boards, setBoards] = useState<Board[]>([])
  const [boardFilter, setBoardFilter] = useState('')
  const [board, setBoard] = useState<Board>()
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [states, setStates] = useState(new Map<string, ThreadState>())
  const [history, setHistory] = useState<HistoryEntry[]>()
  const [thread, setThread] = useState<ThreadSummary>()
  const [log, setLog] = useState<ThreadLog>()
  /** 開いた時点の「最初の未読」。ここに「ここから新着」の線を引く */
  const [unreadFrom, setUnreadFrom] = useState(1)
  const [lastStatus, setLastStatus] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // 起動: DB を開いてサイト一覧を読む
  useEffect(() => {
    void run(async () => {
      const s = await openLogStore()
      const list = await s.listSites()
      setStore(s)
      setSites(list)
      setSite(list[0])
    })
  }, [])

  const refreshBoards = (s: LogStore, target: SiteConfig) =>
    run(async () => {
      const list = await connectorOf(target.connectorId).listBoards(target, ctx)
      await s.replaceBoards(target.menuUrl, list)
      setBoards(list)
    })

  // サイトを切り替えたら、保存してある板一覧をすぐ出す。なければ取りに行く
  useEffect(() => {
    if (!store || !site) return
    void run(async () => {
      const cached = await store.getBoards(site.menuUrl)
      setBoards(cached)
      if (cached.length === 0) await refreshBoards(store, site)
    })
  }, [store, site])

  const openBoard = (b: Board) =>
    run(async () => {
      if (!store) return
      setBoard(b)
      setHistory(undefined)
      const [list, st] = await Promise.all([connectorOf(b.connectorId).listThreads(b, ctx), store.getThreadStates(b.url)])
      setThreads(list)
      setStates(st)
    })

  const showHistory = () =>
    run(async () => {
      if (store) setHistory(await store.history())
    })

  const openThread = (t: ThreadSummary) =>
    run(async () => {
      if (!store) return
      // 手元のログを先に出す(通信に失敗しても読める)
      const local = await store.loadThread(t)
      setThread(t)
      setLog(local ?? undefined)
      setUnreadFrom((local?.readNo ?? 0) + 1)

      const r = await connectorOf(t.connectorId).fetchPosts(t, local?.cursor ?? null, ctx)
      await store.saveFetch(t, r)
      setLastStatus(r.status)
      setLog((await store.loadThread(t)) ?? undefined)
      if (board?.url === t.boardUrl) setStates(await store.getThreadStates(t.boardUrl))
    })

  const markRead = useCallback(
    (no: number) => {
      if (!store || !thread) return
      void store.markRead(thread, no).then(async () => {
        if (board?.url === thread.boardUrl) setStates(await store.getThreadStates(thread.boardUrl))
      })
    },
    [store, thread, board],
  )

  const addSite = () =>
    run(async () => {
      const menuUrl = prompt('bbsmenu の URL(.html か .json)')?.trim()
      if (!store || !menuUrl) return
      const s: SiteConfig = { connectorId: '2ch-compat', name: new URL(menuUrl).host, menuUrl }
      await store.addSite(s)
      setSites(await store.listSites())
      setSite(s)
    })

  const grouped = useMemo(() => {
    const q = boardFilter.trim()
    const map = new Map<string, Board[]>()
    for (const b of boards) {
      if (q && !b.name.includes(q)) continue
      const cat = b.category ?? ''
      map.set(cat, [...(map.get(cat) ?? []), b])
    }
    return [...map]
  }, [boards, boardFilter])

  return (
    <div className="layout">
      <header className="toolbar">
        <select value={site?.menuUrl ?? ''} onChange={(e) => setSite(sites.find((s) => s.menuUrl === e.target.value))}>
          {sites.map((s) => (
            <option key={s.menuUrl} value={s.menuUrl}>
              {s.name}
            </option>
          ))}
        </select>
        <button onClick={addSite}>サイトを追加</button>
        {store && site && <button onClick={() => refreshBoards(store, site)}>板一覧を更新</button>}
        <button onClick={showHistory}>履歴</button>
        {board && !history && <button onClick={() => openBoard(board)}>スレ一覧を更新</button>}
        {thread && <button onClick={() => openThread(thread)}>レスを更新</button>}
        <span className="status">{busy ? '読み込み中…' : lastStatus}</span>
        {error && <span className="error">{error}</span>}
      </header>

      <nav className="pane boards">
        <input placeholder="板を絞り込む" value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)} />
        {grouped.map(([cat, list]) => (
          <details key={cat} open={!!boardFilter}>
            <summary>{cat || '(未分類)'}</summary>
            {list.map((b) => (
              <div key={b.url} className={b.url === board?.url ? 'item active' : 'item'} onClick={() => openBoard(b)}>
                {b.name}
              </div>
            ))}
          </details>
        ))}
      </nav>

      <section className="pane threads">
        {history ? (
          <>
            <div className="pane-title">履歴</div>
            {history.map((h) => (
              <ThreadRow
                key={threadId(h.thread)}
                thread={h.thread}
                active={thread !== undefined && threadId(thread) === threadId(h.thread)}
                state={h}
                onOpen={openThread}
              />
            ))}
          </>
        ) : (
          threads.map((t) => (
            <ThreadRow
              key={t.key}
              thread={t}
              active={t.key === thread?.key && t.boardUrl === thread.boardUrl}
              state={states.get(t.key)}
              onOpen={openThread}
            />
          ))
        )}
      </section>

      {thread && log ? (
        <PostList key={threadId(thread)} log={log} unreadFrom={unreadFrom} onRead={markRead} />
      ) : (
        <main className="pane posts" />
      )}
    </div>
  )
}

function ThreadRow(props: {
  thread: ThreadSummary
  active: boolean
  state?: ThreadState
  onOpen: (t: ThreadSummary) => void
}) {
  const { thread: t, state } = props
  // subject.txt のレス数と既読位置の差が未読数。履歴では手元のレス数を使う
  const unread = state ? Math.max(0, t.postCount - state.readNo) : 0
  const cls = ['item', props.active && 'active', state && 'visited', state?.status === 'archived' && 'archived']
  return (
    <div className={cls.filter(Boolean).join(' ')} onClick={() => props.onOpen(t)}>
      <span className="count">{t.postCount}</span> {unread > 0 && <span className="unread">+{unread}</span>} {t.title}
    </div>
  )
}

/** レス一覧。開いたら最初の未読へ移動し、スクロールに合わせて既読位置を知らせる */
function PostList(props: { log: ThreadLog; unreadFrom: number; onRead: (no: number) => void }) {
  const { log, unreadFrom, onRead } = props
  const ref = useRef<HTMLElement>(null)
  const positioned = useRef(false)
  const sent = useRef(log.readNo)

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
    const target = root.querySelector<HTMLElement>(`[data-no="${unreadFrom}"]`)
    if (target && unreadFrom > 1)
      root.scrollTop += target.getBoundingClientRect().top - root.getBoundingClientRect().top - 8
    else if (unreadFrom > 1) root.scrollTop = root.scrollHeight
    reportRead()
  }, [log, unreadFrom, reportRead])

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
    <main className="pane posts" ref={ref}>
      <h1>
        {log.title}
        {log.status === 'archived' && <span className="archived-tag">dat 落ち</span>}
      </h1>
      {log.posts.map((p) => (
        <div key={p.no}>
          {p.no === unreadFrom && unreadFrom > 1 && <div className="new-line">ここから新着</div>}
          <article className="post" data-no={p.no}>
            <div className="post-head">
              <b>{p.no}</b> <span className="name">{p.name}</span> {p.mail && <span>[{p.mail}]</span>} {p.date}{' '}
              {p.id && <span className="id">ID:{p.id}</span>}
            </div>
            <div className="post-body">{p.body}</div>
          </article>
        </div>
      ))}
    </main>
  )
}
