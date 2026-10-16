// 画面全体: サイドバー(板一覧)/ スレ一覧パネル / タブとスレ表示 の 3 カラム。
// データの流れはここに集め、見た目は components/ の各部品(web 版から移植)に任せる。
// ログは SQLite(LogStore)に保存し、開いたスレは手元のログを先に出してから差分を取りに行く。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  builtinConnectors,
  findConnector,
  type Board,
  type BoardInfo,
  type NewThreadInput,
  type PostConfirm,
  type PostInput,
  type PostResult,
  type SiteConfig,
  type ThreadSummary,
} from '@bbs-browser/connectors'
import {
  applyFetch,
  type FavoriteThreadEntry,
  type HistoryEntry,
  type LogStore,
  type PostHistoryEntry,
  type ThreadLog,
  type ThreadState,
  type UploadRecord,
} from '@bbs-browser/logstore'
import SettingsDialog, { type SettingsTab } from './components/SettingsDialog'
import AddressBar from './components/AddressBar'
import Notifications, { type AppNotification } from './components/Notifications'
import { anchorsIn } from './utils/postBody'
import LoadingCenter from './components/LoadingCenter'
import NewThreadDialog from './components/NewThreadDialog'
import NgRuleDialog, { type NgDraft } from './components/NgRuleDialog'
import UploadHistoryDialog from './components/UploadHistoryDialog'
import PostHistoryDialog from './components/PostHistoryDialog'
import Sidebar from './components/Sidebar'
import StyleMenu from './components/StyleMenu'
import TabBar from './components/TabBar'
import ThreadListPanel, { threadId } from './components/ThreadListPanel'
import TabPane, { type Tab, type TabEvents } from './components/TabPane'
import type { ScrollPosition } from './components/ThreadView'
import { openLogStore } from './host/logStore'
import { tauriContext as ctx } from './host/tauriContext'
import { useSettings, type ReplyLayout, type SavedTab } from './ui/settings'
import { useNarrow } from './hooks/useNarrow'
import { useEvent } from './hooks/useEvent'
import { backgroundImageUrl } from './host/backgroundImage'
import { initFavicons } from './host/favicon'
import { initOgp } from './host/ogp'
import { isReloadKey } from './utils/keymap'
import { findNextThreads } from './utils/nextThread'
import { backupDatabase, restoreDatabase } from './host/backup'
import { deleteFromCatbox } from './host/uploader'
import { postMatcher, pruneExpired, threadMatcher, type NgRule, type NgTarget } from './utils/ng'

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

type Loading = 'threads' | 'posts'

/** スレ表示を残しておくタブの数(切り替えを軽くするため。多すぎると覚えておくぶん重くなる) */
const KEEP_TABS = 5

function newTab(thread: ThreadSummary): Tab {
  return { id: threadId(thread), thread, unreadFrom: 1, readNo: 0, ownNos: new Set(), loading: false }
}

function fromSaved(s: SavedTab): ThreadSummary {
  return { ...s, order: 0, createdAt: s.createdAt === undefined ? undefined : new Date(s.createdAt) }
}

export default function App() {
  const [store, setStore] = useState<LogStore>()
  const [settings, updateSetting, settingsLoaded] = useSettings(store)
  // 非同期の処理(取得の後始末など)から、いまの設定を見るための控え
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [sites, setSites] = useState<SiteConfig[]>([])
  const [favorites, setFavorites] = useState<Board[]>()
  const [board, setBoard] = useState<Board>()
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [states, setStates] = useState(new Map<string, ThreadState>())
  const [history, setHistory] = useState<HistoryEntry[]>()
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string>()
  /** Ctrl/Shift+クリックで選んだタブ */
  const [selectedTabs, setSelectedTabs] = useState<Set<string>>(new Set())
  const [refreshingAll, setRefreshingAll] = useState(false)
  /** 閲覧履歴を取り直した回数(「未読」で絞り込んだ顔ぶれを控え直すきっかけ) */
  const [historyVersion, setHistoryVersion] = useState(0)
  /** 板ごとの設定(名無しの名前など)。板ごとに一度だけ取る */
  const [boardInfos, setBoardInfos] = useState(new Map<string, BoardInfo>())
  const boardInfoAsked = useRef(new Set<string>())
  const [loading, setLoading] = useState(new Set<Loading>())
  const [error, setError] = useState<string>()
  /** 開いている設定画面の分類。undefined なら閉じている */
  const [settingsTab, setSettingsTab] = useState<SettingsTab>()
  const [newThreadOpen, setNewThreadOpen] = useState(false)
  /** サイドバーに出す直近の閲覧履歴 */
  const [recentHistory, setRecentHistory] = useState<ThreadSummary[]>([])
  const reloadRecent = async (s: LogStore) => setRecentHistory((await s.history(10)).map((h) => h.thread))
  /** 画像のアップロード履歴(開いているときだけ中身を持つ) */
  const [uploads, setUploads] = useState<UploadRecord[]>()
  const [hasUploads, setHasUploads] = useState(false)
  const openUploads = () =>
    run(null, async () => {
      if (store) setUploads(await store.listUploads())
    })
  /** 書き込み履歴(開いているときだけ中身を持つ) */
  const [postHistory, setPostHistory] = useState<PostHistoryEntry[]>()
  const openPostHistory = () =>
    run(null, async () => {
      if (store) setPostHistory(await store.listPostHistory())
    })
  /** アプリ内の通知(右下) */
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const notifySeq = useRef(0)
  const notify = (n: Omit<AppNotification, 'id'>) => setNotifications((ns) => [...ns, { ...n, id: ++notifySeq.current }])
  /** 通知から、そのタブのそのレスへ飛ぶ */
  const [jump, setJump] = useState<{ tabId: string; no: number; seq: number }>()
  /** NG を登録する画面(元の文字を入れて開く) */
  const [ngDraft, setNgDraft] = useState<NgDraft>()
  // 縦長のときは、スレ一覧をしまってスレ表示だけにする。スレ一覧は左から引き出す
  const narrow = useNarrow()
  const [listOpen, setListOpen] = useState(false)

  // 非同期の処理の途中で最新の値を見るための控え
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeTab = tabs.find((t) => t.id === activeId)

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
      initFavicons(s)
      initOgp(s)
      void reloadRecent(s)
      void s.listUploads(1).then((u) => setHasUploads(u.length > 0))
      const [list, favs, favThreadList] = await Promise.all([s.listSites(), s.listFavorites(), s.listFavoriteThreads()])
      setStore(s)
      setSites(list)
      setFavorites(favs)
      setFavThreads(favThreadList)
    })
  }, [])

  /** BBS メニューの板一覧(設定画面の板選びで使う)。保存してあるものを返し、なければ・refresh なら取りに行く */
  const loadBoards = async (target: SiteConfig, refresh: boolean): Promise<Board[]> => {
    if (!store) return []
    if (!refresh) {
      const cached = await store.getBoards(target.menuUrl)
      if (cached.length > 0) return cached
    }
    const list = await connectorOf(target.connectorId).listBoards(target, ctx)
    await store.replaceBoards(target.menuUrl, list)
    return list
  }

  // 既読状態は「いま開いている板」のものだけを持つ。別の板のスレを読んでいても混ざらないように
  const boardRef = useRef<Board | undefined>(undefined)
  boardRef.current = board

  const lastBoardUrl = useRef(settings.lastBoardUrl)
  lastBoardUrl.current = settings.lastBoardUrl
  const openBoard = (b: Board) =>
    run('threads', async () => {
      if (!store) return
      setListOpen(true) // 縦長のとき、選んだ板のスレ一覧を引き出して見せる
      setBoard(b)
      // 「起動時に前回の板を開く」ために覚えておく
      if (lastBoardUrl.current !== b.url) updateSetting('lastBoardUrl', b.url)
      setHistory(undefined)
      setFavView(false)
      setThreads([])
      const [list, st] = await Promise.all([connectorOf(b.connectorId).listThreads(b, ctx), store.getThreadStates(b.url)])
      setThreads(list)
      setStates(st)
    })

  /** 閲覧履歴の更新で、スレ一覧(subject.txt)から分かったレス数(スレの id → レス数)。ログには入れず、未読の数にだけ使う */
  const [historyCounts, setHistoryCounts] = useState(new Map<string, number>())

  /**
   * 閲覧履歴の更新。dat を 1 つずつ取りに行くとサーバーの負担が大きいので、
   * 板ごとにスレ一覧(subject.txt)を 1 回だけ取り、載っていればそのレス数を新しい数として使う。
   * 載っていないスレだけ、dat 落ちかもしれないので dat を見に行く(落ちていれば dat 落ちに、残っていれば新着を取る)
   */
  const refreshHistory = () =>
    run('threads', async () => {
      if (!store) return
      const list = await store.history()
      setHistory(list)
      const byBoard = new Map<string, HistoryEntry[]>()
      for (const h of list) byBoard.set(h.thread.boardUrl, [...(byBoard.get(h.thread.boardUrl) ?? []), h])
      const counts = new Map(historyCounts)
      for (const [boardUrl, entries] of byBoard) {
        const connectorId = entries[0].thread.connectorId
        let subject: Map<string, ThreadSummary> | undefined
        try {
          const threads = await connectorOf(connectorId).listThreads({ connectorId, url: boardUrl, name: '' }, ctx)
          subject = new Map(threads.map((t) => [t.key, t]))
        } catch {
          subject = undefined // 板ごと取れなかったら、この板は今回は見送る
        }
        if (!subject) continue
        for (const h of entries) {
          const live = subject.get(h.thread.key)
          if (live) counts.set(threadId(h.thread), live.postCount)
          else if (h.status !== 'archived') await fetchThread(store, h.thread).catch(() => undefined)
        }
        setHistoryCounts(new Map(counts))
        setHistory(await store.history())
      }
      setHistoryVersion((v) => v + 1)
      await reloadRecent(store)
    })

  const openHistory = () =>
    run('threads', async () => {
      setListOpen(true)
      setFavView(false)
      if (store) setHistory(await store.history())
      setHistoryVersion((v) => v + 1)
    })

  // ── お気に入りのスレ ──

  /** お気に入りのスレ。サイドバーの新着の数と ☆ の印に使うので、いつも読み込んでおく */
  const [favThreads, setFavThreads] = useState<FavoriteThreadEntry[]>([])
  /** スレ一覧に、お気に入りのスレを出しているか */
  const [favView, setFavView] = useState(false)
  /** スレ一覧(subject.txt)から分かったレス数(スレの id → レス数)。ログには入れず、未読の数にだけ使う */
  const [favCounts, setFavCounts] = useState(new Map<string, number>())
  const favCountsRef = useRef(favCounts)
  favCountsRef.current = favCounts
  const [favVersion, setFavVersion] = useState(0)
  const favIds = useMemo(() => new Set(favThreads.map((f) => threadId(f.thread))), [favThreads])
  const reloadFavThreads = async (s: LogStore) => setFavThreads(await s.listFavoriteThreads())
  /** 手元の既読・レス数が変わったら、お気に入りの行にも写す(未読の数がずれないように) */
  const patchFav = (t: ThreadSummary, patch: (f: FavoriteThreadEntry) => FavoriteThreadEntry) => {
    const id = threadId(t)
    setFavThreads((list) => (list.some((f) => threadId(f.thread) === id) ? list.map((f) => (threadId(f.thread) === id ? patch(f) : f)) : list))
  }

  const toggleFavoriteThread = (t: ThreadSummary) => {
    if (!store) return
    const on = favIds.has(threadId(t))
    void run(null, async () => {
      await (on ? store.removeFavoriteThread(t) : store.addFavoriteThread(t))
      await reloadFavThreads(store)
    })
  }

  /**
   * お気に入りのスレの新着を確かめる。閲覧履歴と同じく、板ごとにスレ一覧(subject.txt)を 1 回だけ取り、
   * 載っていればそのレス数を新しい数にする(本文は取りに行かないので軽い)。
   * fetchDats(まとめて更新)のときは、新着のあるスレと、一覧に載っていない(dat 落ちかもしれない)スレの本文も取る
   */
  const checkFavThreads = async (s: LogStore, fetchDats: boolean) => {
    const list = await s.listFavoriteThreads()
    const byBoard = new Map<string, FavoriteThreadEntry[]>()
    for (const f of list) byBoard.set(f.thread.boardUrl, [...(byBoard.get(f.thread.boardUrl) ?? []), f])
    const counts = new Map(favCountsRef.current)
    for (const [boardUrl, entries] of byBoard) {
      const connectorId = entries[0].thread.connectorId
      let subject: Map<string, ThreadSummary>
      try {
        const threads = await connectorOf(connectorId).listThreads({ connectorId, url: boardUrl, name: '' }, ctx)
        subject = new Map(threads.map((t) => [t.key, t]))
      } catch {
        continue // 板ごと取れなかったら、この板は今回は見送る
      }
      for (const f of entries) {
        const live = subject.get(f.thread.key)
        if (live) counts.set(threadId(f.thread), live.postCount)
        if (!fetchDats || f.status === 'archived') continue
        if (!live || live.postCount > f.postCount) await fetchThread(s, f.thread).catch(() => undefined)
      }
      setFavCounts(new Map(counts))
    }
    await reloadFavThreads(s)
  }

  /** まとめて更新(スレ一覧の更新ボタン・引っぱって更新) */
  const refreshFavThreads = () =>
    run('threads', async () => {
      if (!store) return
      await checkFavThreads(store, true)
      setFavVersion((v) => v + 1)
    })

  const openFavThreads = () =>
    run('threads', async () => {
      setListOpen(true)
      setHistory(undefined)
      setFavView(true)
      if (store) await reloadFavThreads(store)
      setFavVersion((v) => v + 1)
    })

  // 数分おきに、お気に入りのスレの新着の数だけを確かめる(起動してしばらくしたら一度)
  const hasFavThreads = favThreads.length > 0
  useEffect(() => {
    if (!store || settings.favCheckMin <= 0 || !hasFavThreads) return
    const check = () => void checkFavThreads(store, false).catch(() => undefined)
    const first = setTimeout(check, 5000)
    const timer = setInterval(check, settings.favCheckMin * 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [store, settings.favCheckMin, hasFavThreads])

  // ── タブ ──

  const patchTab = (id: string, patch: Partial<Tab>) =>
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  /**
   * スレを取りに行って保存し、そのタブの表示を差し替える。
   * 同じスレを取りに行っている最中なら、それを待つ。force なら、待ったあとでもう一度取りに行く
   * (書き込んだ直後は、自分のレスが入った状態を必ず取りたいので)
   */
  const inflight = useRef(new Map<string, Promise<void>>())
  const fetchThread = async (
    s: LogStore,
    t: ThreadSummary,
    // keepUnread: 「ここから未読」を動かさない(開いたときの取得。線は更新したときだけ引き直す)
    opts: { force?: boolean; keepUnread?: boolean } = {},
  ) => {
    const id = threadId(t)
    const running = inflight.current.get(id)
    if (running) {
      await running
      if (!opts.force) return
    }
    const job = (async () => {
      patchTab(id, { loading: true })
      try {
        // 手元のログ(タブで開いていればそれ、なければ DB)に、取ってきた差分を当てはめる。
        // 取得のたびにスレ全体を DB から読み直さないため(1000 レスのスレほど効く)
        const inTab = tabsRef.current.find((x) => x.id === id)?.log
        const before = inTab && inTab.cursor !== null ? inTab : await s.loadThread(t)
        const r = await connectorOf(t.connectorId).fetchPosts(t, before?.cursor ?? null, ctx)
        await s.saveFetch(t, r)
        const saved = applyFetch(before, t, r)
        const changed = saved !== before
        // 「ここから未読」は、更新したときにその時点の既読位置の次へ引き直す
        // (開いた時点の位置のままにすると、読み終えて更新しても線が残り続ける)。
        // 開いたときの取得では動かさない(開いた直後に画面に見えたレスが既読になり、線が下へずれてしまうため)。
        // 変わらなかったときはログを差し替えない(スレ表示を描き直さない)
        setTabs((ts) =>
          ts.map((x) => {
            if (x.id !== id) return x
            const unreadFrom = opts.keepUnread ? x.unreadFrom : x.readNo + 1
            if (!changed && x.log && unreadFrom === x.unreadFrom) return x
            return { ...x, log: changed || !x.log ? saved : x.log, unreadFrom }
          }),
        )
        // 自分宛てのレスが新しく届いたら知らせる(初めて開いたスレの、もとからあるレスでは知らせない)
        if (changed && before && settingsRef.current.notifyReplies) await notifyReplies(s, t, saved, before.postCount)
        if (changed) patchFav(t, (f) => ({ ...f, postCount: saved.postCount, status: saved.status, thread: { ...f.thread, postCount: saved.postCount } }))
        // スレ一覧の印(レス数・dat 落ち)は、このスレの 1 行だけ書き換える(板全体を読み直さない)
        if (changed && boardRef.current?.url === t.boardUrl)
          setStates((m) => {
            const cur = m.get(t.key)
            return new Map(m).set(t.key, { postCount: saved.postCount, readNo: cur?.readNo ?? saved.readNo, status: saved.status })
          })
      } finally {
        patchTab(id, { loading: false })
      }
    })()
    inflight.current.set(id, job)
    try {
      await job
    } finally {
      if (inflight.current.get(id) === job) inflight.current.delete(id)
    }
  }

  /** 新着の中に、自分の書き込みへのアンカーがあれば通知する。たくさんあるときは 3 件までにしてまとめる */
  const notifyReplies = async (s: LogStore, t: ThreadSummary, log: ThreadLog, beforeCount: number) => {
    const own = new Set(await s.getOwnPosts(t))
    if (own.size === 0) return
    const replies = log.posts.filter((p) => p.no > beforeCount && !own.has(p.no) && anchorsIn(p.body).some((n) => own.has(n)))
    const id = threadId(t)
    replies.slice(0, 3).forEach((p, i) =>
      notify({
        icon: 'alternate_email',
        title: `あなた宛てのレス: ${log.title}`,
        body: `${p.no}: ${p.body}${i === 2 && replies.length > 3 ? `\n(ほか ${replies.length - 3} 件)` : ''}`,
        onClick: () => {
          selectTab(id)
          setJump({ tabId: id, no: p.no, seq: Date.now() })
        },
      }),
    )
  }

  /** タブにログを読み込み(手元のものをすぐ出す)、差分を取りに行く */
  const loadTab = async (s: LogStore, t: ThreadSummary) => {
    const id = threadId(t)
    const [local, own] = await Promise.all([s.loadThread(t), s.getOwnPosts(t)])
    patchTab(id, {
      log: local ?? { title: t.title, posts: [], cursor: null, postCount: 0, readNo: 0, status: 'active' },
      unreadFrom: (local?.readNo ?? 0) + 1,
      readNo: local?.readNo ?? 0,
      ownNos: new Set(own),
    })
    await fetchThread(s, t, { keepUnread: true })
  }

  const selectTab = (id: string) => {
    setActiveId(id)
    const tab = tabsRef.current.find((t) => t.id === id)
    if (store && tab && !tab.log) void run('posts', () => loadTab(store, tab.thread))
  }

  const openThread = (t: ThreadSummary, opts: { newTab?: boolean } = {}) =>
    run('posts', async () => {
      if (!store) return
      const id = threadId(t)
      const existing = tabsRef.current.find((x) => x.id === id)
      if (existing) {
        // もう開いているスレは、そのタブに移って差分を取りに行く(スレ一覧で新着があるのを見て押したとき)
        selectTab(id)
        if (existing.log) await fetchThread(store, existing.thread)
        return
      }
      // タブを使わないときは、いつも今のスレを置き換える
      const inNew = settings.tabsEnabled && (opts.newTab ?? settings.openInNewTab)
      const current = activeId
      setTabs((ts) => {
        const i = ts.findIndex((x) => x.id === current)
        if (i < 0) return [...ts, newTab(t)]
        if (!inNew) return ts.map((x, j) => (j === i ? newTab(t) : x))
        return [...ts.slice(0, i + 1), newTab(t), ...ts.slice(i + 1)]
      })
      setActiveId(id)
      await loadTab(store, t)
      if (history) setHistory(await store.history())
      await reloadRecent(store)
    })

  const closeTabs = (ids: string[]) => {
    const ts = tabsRef.current
    const rest = ts.filter((t) => !ids.includes(t.id))
    setTabs(rest)
    if (activeId && ids.includes(activeId)) {
      // 閉じたタブの右隣(なければ左隣)へ移る
      const idx = ts.findIndex((t) => t.id === activeId)
      const next = rest[Math.min(idx, rest.length - 1)]
      if (next) selectTab(next.id)
      else setActiveId(undefined)
    }
  }

  /** ログを消してタブを閉じる(Delete キー・タブの右クリック・スレ表示のボタン) */
  const deleteLogs = (ids: string[], extra: ThreadSummary[] = []) => {
    if (!store) return
    // タブで開いているスレに加えて、閲覧履歴から選んだスレ(タブにないもの)も消す
    const targets = new Map<string, ThreadSummary>()
    for (const t of tabsRef.current) if (ids.includes(t.id)) targets.set(t.id, t.thread)
    for (const t of extra) targets.set(threadId(t), t)
    // 先に画面から消す(DB の処理を待たない)
    closeTabs([...targets.keys()].filter((id) => tabsRef.current.some((t) => t.id === id)))
    const gone = (t: ThreadSummary) => targets.has(threadId(t))
    setRecentHistory((list) => list.filter((t) => !gone(t)))
    setHistory((list) => list?.filter((h) => !gone(h.thread)))
    setStates((m) => {
      const boardUrl = boardRef.current?.url
      const keys = [...targets.values()].filter((t) => t.boardUrl === boardUrl).map((t) => t.key)
      if (keys.length === 0) return m
      const next = new Map(m)
      keys.forEach((k) => next.delete(k))
      return next
    })
    // DB は裏で消す。取りに行っている最中のスレは、終わるのを待ってから(消したあとに書き戻されないように)
    void run(null, async () => {
      await Promise.all(
        [...targets].map(async ([id, thread]) => {
          await inflight.current.get(id)?.catch(() => undefined)
          await store.deleteThread(thread)
        }),
      )
    })
  }

  const refreshThread = () =>
    run('posts', async () => {
      if (store && activeTab) await fetchThread(store, activeTab.thread)
    })

  const refreshAll = () =>
    run(null, async () => {
      if (!store) return
      setRefreshingAll(true)
      try {
        for (const t of tabsRef.current) {
          if (t.log) await fetchThread(store, t.thread)
          else await loadTab(store, t.thread)
        }
      } finally {
        setRefreshingAll(false)
      }
    })

  // 自動更新(開いているタブだけ)。前の取得が終わっていなければその回は飛ばす
  const refreshRef = useRef(refreshThread)
  refreshRef.current = refreshThread
  useEffect(() => {
    if (!activeId || settings.autoRefreshSec <= 0) return
    const id = setInterval(() => void refreshRef.current(), settings.autoRefreshSec * 1000)
    return () => clearInterval(id)
  }, [activeId, settings.autoRefreshSec])

  // キー操作: Ctrl+W で閉じる、Ctrl+Tab / Ctrl+PageDown で次、Ctrl+Shift+Tab / Ctrl+PageUp で前
  // Delete で開いているスレのログを消してタブを閉じる(文字を入力しているときは除く)
  /** キー操作の対象: 選んでいるタブがあれば、それと開いているタブ。なければ開いているタブだけ */
  const targetTabs = () => {
    const ids = tabsRef.current.map((t) => t.id).filter((id) => selectedTabs.has(id) || id === activeId)
    return ids.length > 0 ? ids : activeId ? [activeId] : []
  }
  const keyRef = useRef({ closeTabs, selectTab, activeId, deleteLogs, targetTabs, setSelectedTabs })
  keyRef.current = { closeTabs, selectTab, activeId, deleteLogs, targetTabs, setSelectedTabs }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F5・Ctrl+R で WebView がページごと読み直すと、開いていたものが全部消えるので止める
      // (スレ表示では「スレを更新」に割り当ててある)
      if (isReloadKey(e)) {
        e.preventDefault()
        return
      }
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (e.key === 'Delete' && !typing && !e.ctrlKey && !e.altKey) {
        const { deleteLogs, targetTabs, setSelectedTabs } = keyRef.current
        const targets = targetTabs()
        if (targets.length > 0) {
          e.preventDefault()
          setSelectedTabs(new Set())
          void deleteLogs(targets)
        }
        return
      }
      if (!e.ctrlKey) return
      const { closeTabs, selectTab, activeId, targetTabs, setSelectedTabs } = keyRef.current
      const ids = tabsRef.current.map((t) => t.id)
      const i = activeId ? ids.indexOf(activeId) : -1
      const step = (d: number) => {
        if (ids.length === 0) return
        e.preventDefault()
        selectTab(ids[(i + d + ids.length) % ids.length])
      }
      if (e.key.toLowerCase() === 'w') {
        e.preventDefault()
        setSelectedTabs(new Set())
        if (e.shiftKey) closeTabs(ids)
        else closeTabs(targetTabs())
      } else if (e.key === 'Tab') step(e.shiftKey ? -1 : 1)
      else if (e.key === 'PageDown') step(1)
      else if (e.key === 'PageUp') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 開いていたタブを次の起動で戻す。戻したタブは、選んだときに読み込む
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current || !settingsLoaded || !store) return
    restored.current = true
    const ts = settings.openTabs.map((s) => newTab(fromSaved(s)))
    setTabs(ts)
    const active = ts.find((t) => t.id === settings.activeTab) ?? ts[0]
    if (active) {
      setActiveId(active.id)
      void run('posts', () => loadTab(store, active.thread))
    }
  }, [settingsLoaded, store])

  const savedTabs = JSON.stringify(
    tabs.map(
      (t): SavedTab => ({
        connectorId: t.thread.connectorId,
        boardUrl: t.thread.boardUrl,
        key: t.thread.key,
        title: t.log?.title || t.thread.title,
        postCount: t.thread.postCount,
        createdAt: t.thread.createdAt?.getTime(),
      }),
    ),
  )
  useEffect(() => {
    if (restored.current) updateSetting('openTabs', JSON.parse(savedTabs) as SavedTab[])
  }, [savedTabs])
  useEffect(() => {
    if (restored.current) updateSetting('activeTab', activeId ?? '')
  }, [activeId])

  /**
   * 書き込み。成功したら差分を取り直し、書き込んだレスを「自分の書き込み」として覚える。
   * レス番号はサーバーが教えてくれればそれを、なければ新着の中から本文が同じものを探す
   */
  const submitPost = async (input: PostInput): Promise<PostResult> => {
    if (!store || !activeTab) return { status: 'error', message: 'スレを開いていません' }
    const t = activeTab.thread
    const connector = connectorOf(t.connectorId)
    if (!connector.createPost) return { status: 'error', message: 'この掲示板には書き込めません' }
    return afterPost(t, input, await connector.createPost(t, input, ctx))
  }

  /** 書き込み確認で承諾したとき。成功したら、ふつうの書き込みと同じ後始末をする */
  const confirmPost = async (confirm: PostConfirm, input: PostInput): Promise<PostResult> => {
    if (!store || !activeTab) return { status: 'error', message: 'スレを開いていません' }
    const t = activeTab.thread
    const connector = connectorOf(t.connectorId)
    if (!connector.submitConfirm) return { status: 'error', message: 'この掲示板では承諾して書き込めません' }
    return afterPost(t, input, await connector.submitConfirm(confirm, ctx))
  }

  /** 書き込みが通ったら、差分を取り直し、書き込んだレスを「自分の書き込み」として覚える */
  const afterPost = async (t: ThreadSummary, input: PostInput, r: PostResult): Promise<PostResult> => {
    if (!store || r.status !== 'ok') return r
    // 板ごとの既定値がある欄は、アプリ全体の「最後に使った値」を書き換えない
    const meta = settings.boardMeta[t.boardUrl]
    if (meta?.defaultName === undefined && input.name !== settings.postName) updateSetting('postName', input.name)
    if (meta?.defaultMail === undefined && input.mail !== settings.postMail) updateSetting('postMail', input.mail)
    const before = (await store.loadThread(t))?.postCount ?? 0
    await fetchThread(store, t, { force: true })
    const after = await store.loadThread(t)
    const normalize = (s: string) => s.replace(/\s+/g, '')
    const no =
      r.resNumber ??
      after?.posts
        .filter((p) => p.no > before)
        .reverse()
        .find((p) => normalize(p.body) === normalize(input.body))?.no
    if (no) {
      await store.addOwnPost(t, no)
      patchTab(threadId(t), { ownNos: new Set(await store.getOwnPosts(t)) })
    }
    // 書き込み履歴には、番号が分からなくても書いた内容を残す。URL から開いたスレはスレタイが空なので、ログのものを使う
    await store.addPostHistory({ ...t, title: after?.title || t.title }, { no, name: input.name, mail: input.mail, body: input.body })
    return r
  }

  /**
   * スレ立て。成功したらスレ一覧を取り直して同じスレタイのスレを探し、新しいタブで開く。
   * サーバーの一覧に載るまで少しかかることがあるので、見つからなければ間を置いて探し直す
   */
  const createThread = async (input: NewThreadInput): Promise<PostResult> => {
    if (!store || !board) return { status: 'error', message: '板を開いていません' }
    const b = board
    const connector = connectorOf(b.connectorId)
    if (!connector.createThread) return { status: 'error', message: 'この掲示板ではスレを立てられません' }
    return afterThread(b, input, await connector.createThread(b, input, ctx))
  }

  /** スレ立ての書き込み確認で承諾したとき */
  const confirmThread = async (confirm: PostConfirm, input: NewThreadInput): Promise<PostResult> => {
    if (!store || !board) return { status: 'error', message: '板を開いていません' }
    const connector = connectorOf(board.connectorId)
    if (!connector.submitConfirm) return { status: 'error', message: 'この掲示板では承諾して書き込めません' }
    return afterThread(board, input, await connector.submitConfirm(confirm, ctx))
  }

  /** スレが立ったら、スレ一覧を取り直して同じスレタイのスレを探し、新しいタブで開く */
  const afterThread = async (b: Board, input: NewThreadInput, r: PostResult): Promise<PostResult> => {
    if (!store || r.status !== 'ok') return r
    const connector = connectorOf(b.connectorId)

    if (input.name !== settings.postName) updateSetting('postName', input.name)
    if (input.mail !== settings.postMail) updateSetting('postMail', input.mail)
    const normalize = (s: string) => s.replace(/\s+/g, '')
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((ok) => setTimeout(ok, 1500))
      const list = await connector.listThreads(b, ctx)
      if (boardRef.current?.url === b.url) setThreads(list)
      const found = list
        .filter((t) => normalize(t.title) === normalize(input.title))
        .sort((x, y) => (y.createdAt?.getTime() ?? 0) - (x.createdAt?.getTime() ?? 0))[0]
      if (found) {
        await store.addOwnPost(found, 1)
        await store.addPostHistory(found, { no: 1, name: input.name, mail: input.mail, body: input.body })
        setNewThreadOpen(false)
        await openThread(found, { newTab: true })
        return r
      }
    }
    return { status: 'ok', message: `${r.message}(スレ一覧ではまだ見つかりません。少し待ってから一覧を更新してください)` }
  }

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
    const url = settings.startupBoardUrl === '@last' ? settings.lastBoardUrl : settings.startupBoardUrl
    if (!url) return
    const fav = favorites.find((b) => b.url === url)
    if (fav) void openBoard(fav)
    else void openUrlInApp(url)
  }, [settingsLoaded, favorites, settings.startupBoardUrl])

  // タブを使わなくしたら、開いているスレ以外のタブを閉じる(戻したタブも 1 つにする)
  useEffect(() => {
    if (!settings.tabsEnabled && tabs.length > 1) setTabs((ts) => ts.filter((t) => t.id === activeId).slice(0, 1))
  }, [settings.tabsEnabled, tabs.length, activeId])

  // 開いているスレの板の設定を、まだ取っていなければ取る(名無しの省略に使う)
  useEffect(() => {
    const t = activeTab?.thread
    if (!t || boardInfoAsked.current.has(t.boardUrl)) return
    boardInfoAsked.current.add(t.boardUrl)
    const connector = findConnector(t.connectorId)
    if (!connector?.boardInfo) return
    void connector
      .boardInfo({ connectorId: t.connectorId, url: t.boardUrl, name: '' }, ctx)
      .then((info) => setBoardInfos((m) => new Map(m).set(t.boardUrl, info)))
  }, [activeTab?.thread])

  // 期限の切れた一時 NG を片づける
  useEffect(() => {
    if (!settingsLoaded) return
    const kept = pruneExpired(settings.ngRules)
    if (kept.length !== settings.ngRules.length) updateSetting('ngRules', kept)
  }, [settingsLoaded])

  /**
   * 既読位置を進める。スクロールのたびに呼ばれるので、DB は書くだけにして読み直さず、
   * 手元の状態(タブとスレ一覧)を 1 件だけ書き換える
   */
  const markRead = useEvent((t: ThreadSummary, no: number) => {
    if (!store) return
    const id = threadId(t)
    setTabs((ts) => ts.map((x) => (x.id === id && no > x.readNo ? { ...x, readNo: no } : x)))
    if (boardRef.current?.url === t.boardUrl)
      setStates((m) => {
        const cur = m.get(t.key)
        if (!cur || no <= cur.readNo) return m
        return new Map(m).set(t.key, { ...cur, readNo: no })
      })
    patchFav(t, (f) => (no > f.readNo ? { ...f, readNo: no } : f))
    void store.markRead(t, no)
  })

  // ── お気に入り・サイト ──

  const reloadFavorites = async (s: LogStore) => setFavorites(await s.listFavorites())

  const toggleFavorite = (b: Board) => {
    if (!store) return
    const on = favorites?.some((f) => f.url === b.url)
    const board = { connectorId: b.connectorId, url: b.url, name: b.name }
    // 先に画面を変えてから、DB は裏で書く
    setFavorites((list) => (on ? list?.filter((f) => f.url !== b.url) : [...(list ?? []), board]))
    void run(null, () => (on ? store.removeFavorite(b.url) : store.addFavorite(board)))
  }

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
  }

  const removeSite = (menuUrl: string) =>
    run(null, async () => {
      if (!store) return
      await store.removeSite(menuUrl)
      const list = await store.listSites()
      setSites(list)
    })

  // ── NG ──

  const isNgPost = useMemo(() => postMatcher(settings.ngRules), [settings.ngRules])
  const isNgThread = useMemo(() => threadMatcher(settings.ngRules), [settings.ngRules])
  const addNg = useCallback(
    (rule: NgRule) => updateSetting('ngRules', [...settings.ngRules, rule]),
    [settings.ngRules, updateSetting],
  )

  // 最近開いたタブ(KEEP_TABS 個まで)はスレ表示を残しておく。開いているタブを先頭に、閉じたタブは外す
  const [keptIds, setKeptIds] = useState<string[]>([])
  useEffect(() => {
    if (!activeId) return
    setKeptIds((prev) => [activeId, ...prev.filter((x) => x !== activeId)].slice(0, KEEP_TABS))
  }, [activeId])
  const aliveIds = new Set(tabs.map((t) => t.id))
  // どれを残すかは最近開いた順で決めるが、並べる順は id で固定する。
  // 並びが変わると React が要素を付け替え、付け替えられたスレ表示はスクロール位置が一番上に戻ってしまうため
  const shownIds = (activeId && !keptIds.includes(activeId) ? [activeId, ...keptIds] : keptIds)
    .filter((id) => aliveIds.has(id))
    .slice(0, KEEP_TABS)
    .sort()

  const tabEvents: TabEvents = {
    savePosition: useEvent((id: string, pos: ScrollPosition) => patchTab(id, { scroll: pos })),
    markRead,
    refresh: useEvent(() => void refreshThread()),
    openInBrowser: useEvent((t: ThreadSummary) => void openUrl(connectorOf(t.connectorId).threadWebUrl(t))),
    openUrl: useEvent((url: string) => void openUrl(url)),
    addNg: useEvent((rule: NgRule) => addNg(rule)),
    ngDraft: useEvent((target: NgTarget, text: string) => setNgDraft({ target, pattern: text })),
    canPost: useEvent((t: ThreadSummary) => connectorOf(t.connectorId).createPost !== undefined),
    submitPost: useEvent((input: PostInput) => submitPost(input)),
    confirmPost: useEvent((c: PostConfirm, input: PostInput) => confirmPost(c, input)),
    changeReplyLayout: useEvent((layout: ReplyLayout) => updateSetting('replyLayout', layout)),
    resizeReply: useEvent((key: 'replyHeight' | 'replyWidth', size: number) => updateSetting(key, size)),
    deleteLog: useEvent((id: string) => deleteLogs([id])),
    uploaded: useEvent((u: { url: string; name: string; size: number; withAccount: boolean }) => {
      setHasUploads(true)
      void store?.addUpload(u)
    }),
    findNext: useEvent(async (t: ThreadSummary, title: string) => {
      const list = await connectorOf(t.connectorId).listThreads({ connectorId: t.connectorId, url: t.boardUrl, name: '' }, ctx)
      // その板を開いていれば、取り直したスレ一覧も見せる
      if (boardRef.current?.url === t.boardUrl) setThreads(list)
      return findNextThreads({ key: t.key, title, createdAt: t.createdAt }, list)
    }),
    openThread: useEvent((t: ThreadSummary) => void openThread(t, { newTab: true })),
    toggleFavoriteThread: useEvent((t: ThreadSummary) => toggleFavoriteThread(t)),
  }
  // 中身の関数はどれも変わらないので、入れ物も一度だけ作る(TabPane の memo が効くように)
  const tabEventsRef = useRef(tabEvents)
  const stableTabEvents = tabEventsRef.current

  const historyStates = new Map(history?.map((h) => [threadId(h.thread), h as ThreadState]))
  // 履歴のスレの並びは、履歴が変わったときだけ作る(描き直しのたびに作ると、スレ一覧が勢いを計算し直してしまう)
  // スレ一覧から分かったレス数があれば、それを使う(手元のレス数より多いぶんが未読として出る)
  const historyThreads = useMemo(
    () =>
      history?.map((h) => {
        const n = historyCounts.get(threadId(h.thread))
        return n !== undefined && n > h.thread.postCount ? { ...h.thread, postCount: n } : h.thread
      }),
    [history, historyCounts],
  )
  // お気に入りのスレ。ログのないスレ(足しただけでまだ開いていない)には状態を付けない(既読の線を出さない)
  const favStates = new Map(favThreads.filter((f) => f.postCount > 0).map((f) => [threadId(f.thread), f as ThreadState]))
  const favListThreads = useMemo(
    () =>
      favThreads.map((f) => {
        const n = favCounts.get(threadId(f.thread))
        return n !== undefined && n > f.thread.postCount ? { ...f.thread, postCount: n } : f.thread
      }),
    [favThreads, favCounts],
  )
  /** サイドバーに出す、お気に入りのスレの新着の合計 */
  const favNewTotal = favThreads.reduce((sum, f) => {
    if (f.postCount === 0) return sum
    const n = favCounts.get(threadId(f.thread)) ?? f.postCount
    return sum + Math.max(0, n - f.readNo)
  }, 0)
  const stateOf = favView
    ? (t: ThreadSummary) => favStates.get(threadId(t))
    : history
      ? (t: ThreadSummary) => historyStates.get(threadId(t))
      : (t: ThreadSummary) => (t.boardUrl === board?.url ? states.get(t.key) : undefined)
  const isFavorite = !!board && !!favorites?.some((f) => f.url === board.url)

  const currentUrl = activeTab
    ? connectorOf(activeTab.thread.connectorId).threadWebUrl(activeTab.thread)
    : (board?.url ?? '')

  return (
    // isolate: 背景画像(-z-10)を、この枠の背景の上・パネルの下に置くため
    <div className="relative isolate flex h-full w-full overflow-hidden bg-c-base text-c-text-body">
      {/* 背景画像。パネルの後ろに置き、パネルを透かしたところに見える */}
      {settings.backgroundImage && settings.backgroundOpacity > 0 && (
        <div
          className="absolute inset-0 -z-10 pointer-events-none bg-cover bg-center"
          style={{
            backgroundImage: `url("${backgroundImageUrl(settings.backgroundImage)}")`,
            opacity: settings.backgroundOpacity,
          }}
        />
      )}
      <Sidebar
        favorites={favorites ?? []}
        onReorderFavorites={(urls) =>
          void run(null, async () => {
            if (!store || !favorites) return
            // 先に並べ替えて見せてから保存する
            setFavorites(urls.map((u) => favorites.find((f) => f.url === u)!).filter(Boolean))
            await store.reorderFavorites(urls)
          })
        }
        recentHistory={recentHistory}
        onOpenThread={(t) => void openThread(t)}
        onDeleteHistory={(t) => void deleteLogs([], [t])}
        showStripNames={settings.showStripNames}
        onOpenUploads={settings.uploaderEnabled || hasUploads ? () => void openUploads() : undefined}
        onOpenPostHistory={() => void openPostHistory()}
        activeBoardUrl={board?.url}
        onOpenBoard={openBoard}
        onToggleFavorite={toggleFavorite}
        collapsed={settings.sidebarCollapsed}
        boardMeta={settings.boardMeta}
        onToggleCollapsed={() => updateSetting('sidebarCollapsed', !settings.sidebarCollapsed)}
        historyActive={history !== undefined}
        onOpenHistory={openHistory}
        favThreadsActive={favView}
        favThreadsNew={favNewTotal}
        onOpenFavThreads={() => void openFavThreads()}
        onOpenSettings={() => setSettingsTab('display')}
        onManageBoards={() => setSettingsTab('boardlist')}
      />

      <div className="flex-1 min-w-0 flex flex-col">
      <AddressBar
        currentUrl={currentUrl}
        onOpen={(url) => void openUrlInApp(url)}
        onToggleList={narrow ? () => setListOpen((v) => !v) : undefined}
        listOpen={listOpen}
      />
      {/* overflow-hidden: しまったスレ一覧がサイドバーの上にはみ出して見えないように */}
      <div className="relative flex-1 min-h-0 flex overflow-hidden">

      {/* 縦長のときは、スレ一覧を左から引き出す。外を押したら引っ込める */}
      {narrow && listOpen && <div className="absolute inset-0 z-20 bg-black/30" onClick={() => setListOpen(false)} />}
      {settingsLoaded && (
        <div
          className={
            narrow
              ? // 箱の幅は中身(スレ一覧)に合わせる。箱を狭く絞ると、しまったときに中身が残って見える
                `absolute inset-y-0 left-0 z-30 flex w-max transition-[transform,visibility] duration-200 ease-out ${listOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full invisible'}`
              : 'contents'
          }
        >
        <ThreadListPanel
          key={favView ? 'favorites' : history ? 'history' : board?.url}
          title={favView ? 'お気に入りのスレ' : history ? '閲覧履歴' : board ? settings.boardMeta[board.url]?.alias || board.name : '板を選択'}
          threads={favView ? favListThreads : (historyThreads ?? threads)}
          stateOf={stateOf}
          activeId={activeId}
          loading={loading.has('threads')}
          emptyText={
            favView
              ? 'お気に入りのスレはありません(スレの ☆ で足せます)'
              : history
                ? '閲覧履歴はありません'
                : board
                  ? 'スレッドがありません'
                  : '左のお気に入りから板を選んでください'
          }
          onOpen={(t) => {
            setListOpen(false)
            void openThread(t)
          }}
          onRefresh={favView ? refreshFavThreads : history ? refreshHistory : board ? () => openBoard(board) : undefined}
          // 縦長のときは、引き出してもスレ表示が少し見えるように、ウィンドウの 85% までにする
          width={narrow ? Math.min(settings.threadPanelWidth, Math.floor(window.innerWidth * 0.85)) : settings.threadPanelWidth}
          onResize={(w) => updateSetting('threadPanelWidth', w)}
          defaultSort={favView || history ? 'subject' : settings.threadSort}
          isNg={isNgThread}
          favorite={!favView && !history && board ? { active: isFavorite, onToggle: () => toggleFavorite(board) } : undefined}
          favoriteIds={favIds}
          onToggleFavoriteThread={toggleFavoriteThread}
          onDeleteLogs={history ? (list) => void deleteLogs([], list) : undefined}
          onNgThread={(title) => setNgDraft({ target: 'threadTitle', pattern: title })}
          onDeleteThreadLog={(t) => void deleteLogs([], [t])}
          threadUrl={(t) => connectorOf(t.connectorId).threadWebUrl(t)}
          keywords={favView || history ? undefined : settings.keywords}
          snapshotKey={favView ? favVersion : history ? historyVersion : undefined}
          onNewThread={!favView && !history && board && connectorOf(board.connectorId).createThread ? () => setNewThreadOpen(true) : undefined}
          actions={<StyleMenu settings={settings} update={updateSetting} />}
        />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {settings.tabsEnabled && (
        <TabBar
          tabs={tabs.map((t) => ({
            id: t.id,
            title: t.log?.title || t.thread.title,
            unread: t.log ? Math.max(0, t.log.postCount - t.readNo) : 0,
            loading: t.loading,
            ended:
              t.log?.status === 'archived' ? 'archived' : (t.log?.posts.at(-1)?.no ?? 0) >= 1000 ? 'full' : undefined,
            boardUrl: t.thread.boardUrl,
            icon: settings.boardMeta[t.thread.boardUrl]?.icon,
          }))}
          activeId={activeId}
          onSelect={selectTab}
          onClose={closeTabs}
          onRefreshAll={() => void refreshAll()}
          refreshingAll={refreshingAll}
          onDeleteLogs={(ids) => {
            setSelectedTabs(new Set())
            void deleteLogs(ids)
          }}
          selectedIds={selectedTabs}
          onSelectionChange={setSelectedTabs}
          onReorder={(id, index) =>
            setTabs((ts) => {
              const from = ts.findIndex((t) => t.id === id)
              if (from < 0) return ts
              const next = [...ts]
              const [moved] = next.splice(from, 1)
              next.splice(index, 0, moved)
              return next
            })
          }
        />
        )}

        {/* 最近開いたタブのスレ表示は残しておき、切り替えは見せる・隠すだけにする(作り直さない) */}
        <div className="relative flex-1 min-h-0 flex">
          {shownIds.map((id) => {
            const t = tabs.find((x) => x.id === id)
            if (!t?.log) return null
            const isActive = id === activeId
            return (
              <div key={id} className={`absolute inset-0 flex ${isActive ? '' : 'invisible pointer-events-none'}`}>
                <TabPane
                  tab={t as Tab & { log: ThreadLog }}
                  active={isActive}
                  settings={settings}
                  isNg={isNgPost}
                  nonameName={boardInfos.get(t.thread.boardUrl)?.nonameName}
                  jumpTo={jump?.tabId === id ? jump : undefined}
                  favorite={favIds.has(id)}
                  ev={stableTabEvents}
                />
              </div>
            )
          })}
          {!activeTab?.log && (
            <main className="absolute inset-0 flex items-center justify-center bg-panel-view">
              {activeTab ? <LoadingCenter /> : <div className="text-c-text-muted text-sm">スレッドを選択してください</div>}
            </main>
          )}
        </div>
      </div>
      </div>
      </div>

      {postHistory && (
        <PostHistoryDialog
          entries={postHistory}
          onOpen={(e) => {
            setPostHistory(undefined)
            // スレを開いてから、番号が分かっていればそのレスへ飛ぶ(開いたときの位置合わせのあとに)
            void openThread(e.thread).then(() => {
              if (e.no !== undefined) setJump({ tabId: threadId(e.thread), no: e.no, seq: Date.now() })
            })
          }}
          onDelete={async (id) => {
            if (!store) return
            await store.deletePostHistory(id)
            setPostHistory(await store.listPostHistory())
          }}
          onClose={() => setPostHistory(undefined)}
        />
      )}
      {uploads && (
        <UploadHistoryDialog
          uploads={uploads}
          onOpen={(url) => void openUrl(url)}
          canDelete={settings.catboxUserhash.trim() !== ''}
          onDelete={async (url) => {
            if (!store) return
            // サーバー上で消せてから、履歴からも外す
            await deleteFromCatbox(url, settings.catboxUserhash.trim())
            await store.removeUpload(url)
            setUploads(await store.listUploads())
          }}
          onClose={() => setUploads(undefined)}
        />
      )}

      <Notifications items={notifications} onClose={(id) => setNotifications((ns) => ns.filter((n) => n.id !== id))} />

      {ngDraft && <NgRuleDialog draft={ngDraft} onSubmit={addNg} onClose={() => setNgDraft(undefined)} />}

      {newThreadOpen && board && (
        <NewThreadDialog
          boardName={settings.boardMeta[board.url]?.alias || board.name}
          initialName={settings.boardMeta[board.url]?.defaultName ?? settings.postName}
          initialMail={settings.boardMeta[board.url]?.defaultMail ?? settings.postMail}
          onSubmit={createThread}
          onConfirm={confirmThread}
          onOpenUrl={(url) => void openUrl(url)}
          onClose={() => setNewThreadOpen(false)}
        />
      )}

      {settingsTab && (
        <SettingsDialog
          initialTab={settingsTab}
          loadBoards={loadBoards}
          onToggleFavorite={(b) => void toggleFavorite(b)}
          onOpenBoard={(b) => {
            setSettingsTab(undefined)
            void openBoard(b)
          }}
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
          onBackupDb={() => (store ? backupDatabase(store) : Promise.resolve(false))}
          onRestoreDb={restoreDatabase}
          onClose={() => setSettingsTab(undefined)}
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
