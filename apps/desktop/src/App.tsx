// 最初の骨組み: 板一覧 / スレ一覧 / レスの 3 ペイン。
// 見た目は仮。hono-bbs の web のデザインは、この骨組みが動いてから移植する。

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  findConnector,
  type Board,
  type Cursor,
  type Post,
  type SiteConfig,
  type ThreadSummary,
} from '@bbs-browser/connectors'
import { tauriContext as ctx } from './host/tauriContext'

const DEFAULT_SITES: SiteConfig[] = [
  { connectorId: '2ch-compat', name: '5ch', menuUrl: 'https://menu.5ch.net/bbsmenu.json' },
]

/** スレごとの取得結果。開き直したときは cursor から差分だけ取る(いまはメモリ上だけ) */
interface ThreadLog {
  posts: Post[]
  cursor: Cursor | null
  title?: string
  status?: string
}

const threadKey = (t: ThreadSummary) => `${t.boardUrl}${t.key}`

export default function App() {
  const [sites, setSites] = useState(DEFAULT_SITES)
  const [site, setSite] = useState(DEFAULT_SITES[0])
  const [boards, setBoards] = useState<Board[]>([])
  const [boardFilter, setBoardFilter] = useState('')
  const [board, setBoard] = useState<Board>()
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [thread, setThread] = useState<ThreadSummary>()
  const [, forceRender] = useState(0)
  const logs = useRef(new Map<string, ThreadLog>())
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

  useEffect(() => {
    void run(async () => setBoards(await findConnector(site.connectorId)!.listBoards(site, ctx)))
  }, [site])

  const openBoard = (b: Board) =>
    run(async () => {
      setBoard(b)
      setThreads(await findConnector(b.connectorId)!.listThreads(b, ctx))
    })

  const openThread = (t: ThreadSummary) =>
    run(async () => {
      setThread(t)
      const key = threadKey(t)
      const prev = logs.current.get(key) ?? { posts: [], cursor: null }
      const r = await findConnector(t.connectorId)!.fetchPosts(t, prev.cursor, ctx)
      const posts = r.status === 'reset' ? r.posts : [...prev.posts, ...r.posts]
      logs.current.set(key, { posts, cursor: r.cursor, title: r.title ?? prev.title, status: r.status })
      forceRender((n) => n + 1)
    })

  const addSite = () => {
    const menuUrl = prompt('bbsmenu の URL(.html か .json)')?.trim()
    if (!menuUrl) return
    const s: SiteConfig = { connectorId: '2ch-compat', name: new URL(menuUrl).host, menuUrl }
    setSites((list) => [...list, s])
    setSite(s)
  }

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

  const log = thread ? logs.current.get(threadKey(thread)) : undefined

  return (
    <div className="layout">
      <header className="toolbar">
        <select
          value={site.menuUrl}
          onChange={(e) => setSite(sites.find((s) => s.menuUrl === e.target.value)!)}
        >
          {sites.map((s) => (
            <option key={s.menuUrl} value={s.menuUrl}>
              {s.name}
            </option>
          ))}
        </select>
        <button onClick={addSite}>サイトを追加</button>
        {board && <button onClick={() => openBoard(board)}>スレ一覧を更新</button>}
        {thread && <button onClick={() => openThread(thread)}>レスを更新</button>}
        <span className="status">{busy ? '読み込み中…' : (log?.status ?? '')}</span>
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
        {threads.map((t) => (
          <div key={t.key} className={t.key === thread?.key ? 'item active' : 'item'} onClick={() => openThread(t)}>
            <span className="count">{t.postCount}</span> {t.title}
          </div>
        ))}
      </section>

      <main className="pane posts">
        {log && <h1>{log.title ?? thread?.title}</h1>}
        {log?.posts.map((p) => (
          <article key={p.no} className="post">
            <div className="post-head">
              <b>{p.no}</b> <span className="name">{p.name}</span> {p.mail && <span>[{p.mail}]</span>} {p.date}{' '}
              {p.id && <span className="id">ID:{p.id}</span>}
            </div>
            <div className="post-body">{p.body}</div>
          </article>
        ))}
      </main>
    </div>
  )
}
