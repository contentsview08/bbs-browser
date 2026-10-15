// 画面全体: サイドバー(板一覧)/ スレ一覧パネル / スレ表示 の 3 カラム。
// データの流れはここに集め、見た目は components/ の各部品(web 版から移植)に任せる。
// ログは SQLite(LogStore)に保存し、開いたスレは手元のログを先に出してから差分を取りに行く。

import { useCallback, useEffect, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { findConnector, type Board, type SiteConfig, type ThreadSummary } from '@bbs-browser/connectors'
import type { HistoryEntry, LogStore, ThreadLog, ThreadState } from '@bbs-browser/logstore'
import Sidebar from './components/Sidebar'
import StyleMenu from './components/StyleMenu'
import ThreadListPanel, { threadId } from './components/ThreadListPanel'
import ThreadView from './components/ThreadView'
import { openLogStore } from './host/logStore'
import { tauriContext as ctx } from './host/tauriContext'
import { useDisplaySettings } from './ui/settings'

const connectorOf = (id: string) => {
  const c = findConnector(id)
  if (!c) throw new Error(`コネクタ ${id} がありません`)
  return c
}

type Loading = 'boards' | 'threads' | 'posts'

export default function App() {
  const [store, setStore] = useState<LogStore>()
  const [settings, updateSetting] = useDisplaySettings(store)
  const [sites, setSites] = useState<SiteConfig[]>([])
  const [site, setSite] = useState<SiteConfig>()
  const [boards, setBoards] = useState<Board[]>([])
  const [board, setBoard] = useState<Board>()
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [states, setStates] = useState(new Map<string, ThreadState>())
  const [history, setHistory] = useState<HistoryEntry[]>()
  const [thread, setThread] = useState<ThreadSummary>()
  const [log, setLog] = useState<ThreadLog>()
  const [unreadFrom, setUnreadFrom] = useState(1)
  const [loading, setLoading] = useState(new Set<Loading>())
  const [error, setError] = useState<string>()

  const run = async (kind: Loading | null, fn: () => Promise<void>) => {
    if (kind) setLoading((s) => new Set(s).add(kind))
    setError(undefined)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (kind)
        setLoading((s) => {
          const next = new Set(s)
          next.delete(kind)
          return next
        })
    }
  }

  // 起動: DB を開いてサイト一覧を読む
  useEffect(() => {
    void run(null, async () => {
      const s = await openLogStore()
      const list = await s.listSites()
      setStore(s)
      setSites(list)
      setSite(list[0])
    })
  }, [])

  const refreshBoards = (s: LogStore, target: SiteConfig) =>
    run('boards', async () => {
      const list = await connectorOf(target.connectorId).listBoards(target, ctx)
      await s.replaceBoards(target.menuUrl, list)
      setBoards(list)
    })

  // サイトを切り替えたら、保存してある板一覧をすぐ出す。なければ取りに行く
  useEffect(() => {
    if (!store || !site) return
    void run('boards', async () => {
      const cached = await store.getBoards(site.menuUrl)
      setBoards(cached)
      if (cached.length === 0) await refreshBoards(store, site)
    })
  }, [store, site])

  const openBoard = (b: Board) =>
    run('threads', async () => {
      if (!store) return
      setBoard(b)
      setHistory(undefined)
      setThreads([])
      const [list, st] = await Promise.all([connectorOf(b.connectorId).listThreads(b, ctx), store.getThreadStates(b.url)])
      setThreads(list)
      setStates(st)
    })

  const openHistory = () =>
    run('threads', async () => {
      if (store) setHistory(await store.history())
    })

  const openThread = (t: ThreadSummary) =>
    run('posts', async () => {
      if (!store) return
      // 手元のログを先に出す(通信に失敗しても読める)
      const local = await store.loadThread(t)
      setThread(t)
      setLog(local ?? { title: t.title, posts: [], cursor: null, postCount: 0, readNo: 0, status: 'active' })
      setUnreadFrom((local?.readNo ?? 0) + 1)

      const r = await connectorOf(t.connectorId).fetchPosts(t, local?.cursor ?? null, ctx)
      await store.saveFetch(t, r)
      setLog((await store.loadThread(t)) ?? undefined)
      if (board?.url === t.boardUrl) setStates(await store.getThreadStates(t.boardUrl))
      if (history) setHistory(await store.history())
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
    run(null, async () => {
      const menuUrl = prompt('bbsmenu の URL(.html か .json)')?.trim()
      if (!store || !menuUrl) return
      const s: SiteConfig = { connectorId: '2ch-compat', name: new URL(menuUrl).host, menuUrl }
      await store.addSite(s)
      setSites(await store.listSites())
      setSite(s)
    })

  const historyStates = new Map(history?.map((h) => [threadId(h.thread), h as ThreadState]))
  const stateOf = history
    ? (t: ThreadSummary) => historyStates.get(threadId(t))
    : (t: ThreadSummary) => (t.boardUrl === board?.url ? states.get(t.key) : undefined)

  return (
    <div className="flex h-full w-full overflow-hidden bg-c-base text-c-text-body">
      <Sidebar
        sites={sites}
        site={site}
        onSelectSite={setSite}
        onAddSite={addSite}
        boards={boards}
        activeBoardUrl={board?.url}
        onOpenBoard={openBoard}
        onRefreshBoards={() => store && site && refreshBoards(store, site)}
        historyActive={history !== undefined}
        onOpenHistory={openHistory}
        loading={loading.has('boards')}
      />

      <ThreadListPanel
        title={history ? '閲覧履歴' : (board?.name ?? '板を選択')}
        threads={history ? history.map((h) => h.thread) : threads}
        stateOf={stateOf}
        activeId={thread && threadId(thread)}
        loading={loading.has('threads')}
        emptyText={history ? '閲覧履歴はありません' : board ? 'スレッドがありません' : '左の一覧から板を選んでください'}
        onOpen={openThread}
        onRefresh={history ? openHistory : board ? () => openBoard(board) : undefined}
        width={settings.threadPanelWidth}
        onResize={(w) => updateSetting('threadPanelWidth', w)}
        actions={<StyleMenu settings={settings} update={updateSetting} />}
      />

      {thread && log ? (
        <ThreadView
          key={threadId(thread)}
          log={log}
          unreadFrom={unreadFrom}
          loading={loading.has('posts')}
          onRead={markRead}
          onRefresh={() => openThread(thread)}
          onOpenInBrowser={() => void openUrl(connectorOf(thread.connectorId).threadWebUrl(thread))}
          onUrl={(url) => void openUrl(url)}
        />
      ) : (
        <main className="flex-1 flex items-center justify-center bg-c-base">
          <div className="text-c-text-muted text-sm">スレッドを選択してください</div>
        </main>
      )}

      {error && (
        <div
          className="fixed bottom-4 right-4 z-50 max-w-md flex items-start gap-2 px-4 py-3 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl text-sm"
          role="alert"
        >
          <span className="material-symbols-outlined text-lg text-c-heat-very-hot">error</span>
          <span className="flex-1 text-c-text-body break-all">{error}</span>
          <button type="button" onClick={() => setError(undefined)} className="text-c-text-muted hover:text-c-text-strong">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      )}
    </div>
  )
}
