// 同期のきっかけと、設定の窓からの頼みごと。自動の同期は前面にいる間だけ(きっかけの決まりは SyncScheduler)
import { useEffect, useMemo, useRef } from 'react'
import type { LogStore } from '@bbs-browser/logstore'
import { favoriteBoardAdapters, FavoriteThreadAdapter, historyAdapters, ImageAdapter, NgAdapter, PostAdapter, SecretAdapter, SettingAdapter, SiteAdapter, SyncController, SyncScheduler, type ConfirmChoice, type CycleResult, type SyncGroup } from '@bbs-browser/sync'
import { broadcast } from '../host/crossWindow'
import { DEFAULT_SYNC_SERVER, openSyncStartWindow, resolveSyncBoard, resolveSyncSite, syncKeyHint, syncKeyStore, syncNgHost, syncSettingsHost, syncTransport } from '../host/sync'
import { isAppVisible } from '../utils/visibility'

/** 適用で変わった種類ごとに、画面が読み直すもの。NG は設定の流れで写る */
export interface SyncReloaders {
  favoriteThreads: (s: LogStore) => void
  favoriteBoards: (s: LogStore) => void
  sites: (s: LogStore) => void
  uploads: (s: LogStore) => void
  posts: (s: LogStore) => void
  /** 閲覧履歴と既読 */
  reads: (s: LogStore) => void
  retentionDays: () => number
  /** 画面で開いているスレか(開いているスレのログは、他の端末の削除が届いても消さない) */
  isOpen: (boardUrl: string, key: string) => boolean
}

export function useSync(store: LogStore | undefined, reloaders: SyncReloaders) {
  const applied = useRef(reloaders)
  applied.current = reloaders
  const ctl = useMemo(() => {
    if (!store) return undefined
    return new SyncController({
      db: store.db,
      keyStore: syncKeyStore,
      transport: syncTransport,
      defaultServerUrl: DEFAULT_SYNC_SERVER,
      adapters: [
        new FavoriteThreadAdapter(store.db, resolveSyncBoard),
        ...favoriteBoardAdapters(store.db, resolveSyncBoard),
        new SiteAdapter(store.db, resolveSyncSite),
        new ImageAdapter(store.db),
        new SecretAdapter(store.db),
        new NgAdapter(syncNgHost(store.db)),
        new PostAdapter(store.db, resolveSyncBoard),
        new SettingAdapter(syncSettingsHost(store.db), store.db),
        ...historyAdapters(store.db, { resolve: resolveSyncBoard, retentionDays: () => applied.current.retentionDays(), newResetId: () => crypto.randomUUID().replaceAll('-', ''), isOpen: (b, k) => applied.current.isOpen(b, k) }),
      ],
      now: Date.now,
      allowLocalhost: import.meta.env.DEV,
      leaseOwner: crypto.randomUUID(),
      keyHint: syncKeyHint,
      openStartWindow: openSyncStartWindow,
      onCycle: (r: CycleResult) => {
        if (r.applied.favoriteThreads) applied.current.favoriteThreads(store)
        if (r.applied.favoriteBoards) {
          applied.current.favoriteBoards(store)
          void broadcast('favorites-changed', null)
        }
        if (r.applied.sites) {
          applied.current.sites(store)
          void broadcast('sites-changed', null)
        }
        if (r.applied.uploads) applied.current.uploads(store)
        if (r.applied.posts) applied.current.posts(store)
        if (r.applied.history || r.applied.reads) applied.current.reads(store)
      },
    })
  }, [store])

  useEffect(() => {
    if (!ctl) return
    const scheduler = new SyncScheduler({
      now: Date.now,
      setTimer: (f, ms) => window.setTimeout(f, ms),
      clearTimer: (t) => window.clearTimeout(t as number),
      enabled: () => ctl.autoEnabled(),
      cycle: () => ctl.autoCycle(),
      check: () => ctl.autoCheck(),
      hasChanges: () => ctl.hasChanges(),
      pace: () => ctl.pace(),
      idleStops: true,
    })
    const quiet = (p: Promise<void>) => void p.catch(() => undefined)
    const visibility = () => quiet(isAppVisible() ? scheduler.foreground() : scheduler.background())
    const focus = () => {
      if (isAppVisible()) quiet(scheduler.foreground())
    }
    const flush = () => quiet(scheduler.flush())
    const activity = () => scheduler.activity()
    const network = () => scheduler.networkBack()
    if (isAppVisible()) quiet(scheduler.foreground())
    window.addEventListener('focus', focus)
    window.addEventListener('blur', flush)
    window.addEventListener('pagehide', flush)
    window.addEventListener('online', network)
    window.addEventListener('pointerdown', activity, { passive: true })
    window.addEventListener('keydown', activity)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      scheduler.dispose()
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', flush)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('online', network)
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [ctl])

  const latest = useRef(ctl)
  latest.current = ctl
  const storeRef = useRef(store)
  storeRef.current = store
  // 設定の窓は鍵の命令を呼べないので、main で行う
  return useRef({
    syncStatus: () => need(latest.current).status(),
    syncStart: () => need(latest.current).start().then(summary),
    syncPairingCode: () => need(latest.current).pairingCode(),
    syncJoin: (code: string) => need(latest.current).join(code).then(summary),
    syncNow: () => need(latest.current).syncNow().then((r) => {
      // 適用の有無によらず、画面が読むものを DB の値にする
      if (storeRef.current) applied.current.reads(storeRef.current)
      return summary(r)
    }),
    syncLeave: () => need(latest.current).leave(),
    syncSetMaster: (on: boolean) => need(latest.current).setMaster(on),
    syncSetKind: (a: { group: SyncGroup; on: boolean }) => need(latest.current).setKind(a.group, a.on),
    syncSetServer: (url: string) => need(latest.current).setServerUrl(url),
    syncConfirm: (choice: ConfirmChoice) => need(latest.current).resolveConfirm(choice).then(summary),
    syncSummary: () => need(latest.current).summary(),
    syncMismatches: () => need(latest.current).mismatches(),
  }).current
}

const need = (c: SyncController | undefined): SyncController => {
  if (!c) throw new Error('not_ready')
  return c
}

const summary = (r: CycleResult) => ({ state: r.state, pulled: r.pulled, pushed: r.pushed })
