// 画面全体: サイドバー(板一覧)/ スレ一覧パネル / スレ表示 の 3 カラム。
// データの流れはここに集め、見た目は components/ の各部品(web 版から移植)に任せる。
// ログは SQLite(LogStore)に保存し、開いたスレは手元のログを先に出してから差分を取りに行く。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  builtinConnectors,
  findConnector,
  type Board,
  type SiteConfig,
  type ThreadSummary,
} from '@bbs-browser/connectors'
import type { HistoryEntry, LogStore, ThreadLog, ThreadState } from '@bbs-browser/logstore'
import SettingsDialog from './components/SettingsDialog'
import Sidebar from './components/Sidebar'
import StyleMenu from './components/StyleMenu'
import ThreadListPanel, { threadId } from './components/ThreadListPanel'
import ThreadView from './components/ThreadView'
import { openLogStore } from './host/logStore'
import { tauriContext as ctx } from './host/tauriContext'
import { useSettings } from './ui/settings'
import { postMatcher, pruneExpired, threadMatcher, type NgRule } from './utils/ng'

const connectorOf = (id: string) => {
  const c = findConnector(id)
  if (!c) throw new Error(`コネクタ ${id} がありません`)
  return c
}

/** URL を扱えるコネクタで、板(とスレ)に読み替える */
async function resolve(url: string) {
  const connector = builtinConnectors.find((c) => c.canHandle(url))
  const r = connector ? await connector.resolveUrl(url, ctx) : null
  if (!r) throw new Error(`開けない URL です: ${url}`)
  return r
}

type Loading = 'boards' | 'threads' | 'posts'

export default function App() {
  const [store, setStore] = useState<LogStore>()
  const [settings, updateSetting, settingsLoaded] = useSettings(store)
  const [sites, setSites] = useState<SiteConfig[]>([])
  const [site, setSite] = useState<SiteConfig>()
  const [boards, setBoards] = useState<Board[]>([])
  const [favorites, setFavorites] = useState<Board[]>()
  const [board, setBoard] = useState<Board>()
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [states, setStates] = useState(new Map<string, ThreadState>())
  const [history, setHistory] = useState<HistoryEntry[]>()
  const [thread, setThread] = useState<ThreadSummary>()
  const [log, setLog] = useState<ThreadLog>()
  const [unreadFrom, setUnreadFrom] = useState(1)
  const [loading, setLoading] = useState(new Set<Loading>())
  const [error, setError] = useState<string>()
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  // 起動: DB を開いてサイト一覧とお気に入りを読む
  useEffect(() => {
    void run(null, async () => {
      const s = await openLogStore()
      const [list, favs] = await Promise.all([s.listSites(), s.listFavorites()])
      setStore(s)
      setSites(list)
      setSite(list[0])
      setFavorites(favs)
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

  // 既読状態は「いま開いている板」のものだけを持つ。別の板のスレを読んでいても混ざらないように
  const boardRef = useRef<Board | undefined>(undefined)
  boardRef.current = board
  const reloadStates = async (s: LogStore, boardUrl: string) => {
    const st = await s.getThreadStates(boardUrl)
    if (boardRef.current?.url === boardUrl) setStates(st)
  }

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

  /** スレを取りに行って保存し、表示を差し替える(開いたときと更新のときの共通部分) */
  const fetching = useRef(false)
  const fetchThread = async (s: LogStore, t: ThreadSummary, cursor: unknown) => {
    fetching.current = true
    try {
      const r = await connectorOf(t.connectorId).fetchPosts(t, cursor, ctx)
      await s.saveFetch(t, r)
      const saved = await s.loadThread(t)
      // 取りに行っている間に別のスレへ移っていたら、表示は差し替えない
      if (saved && currentThread.current === threadId(t)) setLog(saved)
      await reloadStates(s, t.boardUrl)
    } finally {
      fetching.current = false
    }
  }

  const currentThread = useRef<string | undefined>(undefined)
  const openThread = (t: ThreadSummary) =>
    run('posts', async () => {
      if (!store) return
      currentThread.current = threadId(t)
      // 手元のログを先に出す(通信に失敗しても読める)
      const local = await store.loadThread(t)
      setThread(t)
      setLog(local ?? { title: t.title, posts: [], cursor: null, postCount: 0, readNo: 0, status: 'active' })
      setUnreadFrom((local?.readNo ?? 0) + 1)
      await fetchThread(store, t, local?.cursor ?? null)
      if (history) setHistory(await store.history())
    })

  const refreshThread = () =>
    run('posts', async () => {
      if (!store || !thread || fetching.current) return
      const local = await store.loadThread(thread)
      await fetchThread(store, thread, local?.cursor ?? null)
    })

  // 自動更新。前の取得が終わっていなければその回は飛ばす
  const refreshRef = useRef(refreshThread)
  refreshRef.current = refreshThread
  useEffect(() => {
    if (!thread || settings.autoRefreshSec <= 0) return
    const id = setInterval(() => void refreshRef.current(), settings.autoRefreshSec * 1000)
    return () => clearInterval(id)
  }, [thread, settings.autoRefreshSec])

  const openUrlInApp = (url: string) =>
    run(null, async () => {
      const r = await resolve(url)
      await openBoard(r.board)
      if (r.thread) await openThread(r.thread)
    })

  // 起動時に開く板(設定)。設定とお気に入りを読み終えてから一度だけ
  const startupDone = useRef(false)
  useEffect(() => {
    if (startupDone.current || !settingsLoaded || !favorites) return
    startupDone.current = true
    const url = settings.startupBoardUrl
    if (!url) return
    const fav = favorites.find((b) => b.url === url)
    if (fav) void openBoard(fav)
    else void openUrlInApp(url)
  }, [settingsLoaded, favorites, settings.startupBoardUrl])

  // 期限の切れた一時 NG を片づける
  useEffect(() => {
    if (!settingsLoaded) return
    const kept = pruneExpired(settings.ngRules)
    if (kept.length !== settings.ngRules.length) updateSetting('ngRules', kept)
  }, [settingsLoaded])

  const markRead = useCallback(
    (no: number) => {
      if (!store || !thread) return
      void store.markRead(thread, no).then(() => reloadStates(store, thread.boardUrl))
    },
    [store, thread],
  )

  // ── お気に入り・サイト ──

  const reloadFavorites = async (s: LogStore) => setFavorites(await s.listFavorites())

  const toggleFavorite = (b: Board) =>
    run(null, async () => {
      if (!store) return
      if (favorites?.some((f) => f.url === b.url)) await store.removeFavorite(b.url)
      else await store.addFavorite({ connectorId: b.connectorId, url: b.url, name: b.name })
      await reloadFavorites(store)
    })

  const addFavoriteUrl = async (url: string) => {
    if (!store) return
    const r = await resolve(url)
    await store.addFavorite(r.board)
    await reloadFavorites(store)
  }

  const addSite = async (name: string, menuUrl: string) => {
    if (!store) return
    const host = new URL(menuUrl).host // URL として読めなければここで例外になる
    const s: SiteConfig = { connectorId: '2ch-compat', name: name || host, menuUrl }
    await store.addSite(s)
    setSites(await store.listSites())
    setSite(s)
  }

  const removeSite = (menuUrl: string) =>
    run(null, async () => {
      if (!store) return
      await store.removeSite(menuUrl)
      const list = await store.listSites()
      setSites(list)
      if (site?.menuUrl === menuUrl) {
        setSite(list[0])
        if (list.length === 0) setBoards([])
      }
    })

  // ── NG ──

  const isNgPost = useMemo(() => postMatcher(settings.ngRules), [settings.ngRules])
  const isNgThread = useMemo(() => threadMatcher(settings.ngRules), [settings.ngRules])
  const addNg = useCallback(
    (rule: NgRule) => updateSetting('ngRules', [...settings.ngRules, rule]),
    [settings.ngRules, updateSetting],
  )

  const historyStates = new Map(history?.map((h) => [threadId(h.thread), h as ThreadState]))
  const stateOf = history
    ? (t: ThreadSummary) => historyStates.get(threadId(t))
    : (t: ThreadSummary) => (t.boardUrl === board?.url ? states.get(t.key) : undefined)
  const isFavorite = !!board && !!favorites?.some((f) => f.url === board.url)

  return (
    <div className="flex h-full w-full overflow-hidden bg-c-base text-c-text-body">
      <Sidebar
        sites={sites}
        site={site}
        onSelectSite={setSite}
        boards={boards}
        favorites={favorites ?? []}
        activeBoardUrl={board?.url}
        onOpenBoard={openBoard}
        onToggleFavorite={toggleFavorite}
        onRefreshBoards={() => store && site && refreshBoards(store, site)}
        onOpenUrl={openUrlInApp}
        historyActive={history !== undefined}
        onOpenHistory={openHistory}
        onOpenSettings={() => setSettingsOpen(true)}
        loading={loading.has('boards')}
      />

      {settingsLoaded && (
        <ThreadListPanel
          key={history ? 'history' : board?.url}
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
          defaultSort={history ? 'subject' : settings.threadSort}
          isNg={isNgThread}
          favorite={!history && board ? { active: isFavorite, onToggle: () => toggleFavorite(board) } : undefined}
          actions={<StyleMenu settings={settings} update={updateSetting} />}
        />
      )}

      {thread && log ? (
        <ThreadView
          key={threadId(thread)}
          log={log}
          unreadFrom={unreadFrom}
          loading={loading.has('posts')}
          settings={settings}
          isNg={isNgPost}
          onRead={markRead}
          onRefresh={refreshThread}
          onOpenInBrowser={() => void openUrl(connectorOf(thread.connectorId).threadWebUrl(thread))}
          onUrl={(url) => void openUrl(url)}
          onAddNg={addNg}
        />
      ) : (
        <main className="flex-1 flex items-center justify-center bg-c-base">
          <div className="text-c-text-muted text-sm">スレッドを選択してください</div>
        </main>
      )}

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          update={updateSetting}
          favorites={favorites ?? []}
          sites={sites}
          onAddFavoriteUrl={addFavoriteUrl}
          onRemoveFavorite={(url) =>
            void run(null, async () => {
              if (!store) return
              await store.removeFavorite(url)
              await reloadFavorites(store)
            })
          }
          onAddSite={addSite}
          onRemoveSite={removeSite}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {error && (
        <div
          className="fixed bottom-4 right-4 z-[9999] max-w-md flex items-start gap-2 px-4 py-3 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl text-sm"
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
