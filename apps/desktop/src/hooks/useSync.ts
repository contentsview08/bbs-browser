// 同期のきっかけと、設定の窓からの頼みごと。自動の同期は前面にいる間だけ(きっかけの決まりは SyncScheduler)
import { useEffect, useMemo, useRef } from 'react'
import type { LogStore } from '@bbs-browser/logstore'
import { favoriteBoardAdapters, FavoriteThreadAdapter, historyAdapters, ImageAdapter, NgAdapter, OwnPostAdapter, PostAdapter, SecretAdapter, SettingAdapter, SiteAdapter, SyncController, SyncScheduler, type ConfirmChoice, type CycleResult, type DroppedThread, type SyncGroup, type SyncStore } from '@bbs-browser/sync'
import { broadcast } from '../host/crossWindow'
import { cancelGoogleLogin, googleDrive } from '../host/google'
import { DEFAULT_SYNC_SERVER, openSyncStartWindow, resolveSyncBoard, resolveSyncSite, syncKeyHint, syncKeyStore, syncNgHost, syncSettingsHost, syncTransport } from '../host/sync'
import { PRESET_URLS } from '../presets'
import { isAppVisible } from '../utils/visibility'

/** 適用で変わった種類ごとに、画面が読み直すもの。NG は設定の流れで写る */
export interface SyncReloaders {
  favoriteThreads: (s: LogStore) => void
  favoriteBoards: (s: LogStore) => void
  sites: (s: LogStore) => void
  uploads: (s: LogStore) => void
  posts: (s: LogStore) => void
  /** 自分のレスの印(開いているタブの印を読み直す) */
  ownPosts: (s: LogStore) => void
  /** 閲覧履歴と既読。dropped は他の端末のログの削除が写ったスレ(タブを閉じる) */
  reads: (s: LogStore, dropped: readonly DroppedThread[]) => void
  retentionDays: () => number
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
      drive: googleDrive,
      adapters: [
        new FavoriteThreadAdapter(store.db, resolveSyncBoard),
        ...favoriteBoardAdapters(store.db, resolveSyncBoard),
        new SiteAdapter(store.db, resolveSyncSite),
        new ImageAdapter(store.db),
        new SecretAdapter(store.db),
        new NgAdapter(syncNgHost(store.db)),
        new PostAdapter(store.db, resolveSyncBoard),
        new OwnPostAdapter(store.db, resolveSyncBoard),
        new SettingAdapter(syncSettingsHost(store.db), store.db),
        ...historyAdapters(store.db, { resolve: resolveSyncBoard, retentionDays: () => applied.current.retentionDays(), newResetId: () => crypto.randomUUID().replaceAll('-', '') }),
      ],
      now: Date.now,
      allowLocalhost: import.meta.env.DEV,
      leaseOwner: crypto.randomUUID(),
      presetUrls: PRESET_URLS,
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
        if (r.applied.ownPosts) applied.current.ownPosts(store)
        if (r.applied.history || r.applied.reads || r.dropped.length > 0) applied.current.reads(store, r.dropped)
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
      cycle: (reason) => ctl.autoCycle(reason),
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
    const closing = () => quiet(scheduler.flush(true))
    const activity = () => scheduler.activity()
    const network = () => scheduler.networkBack()
    if (isAppVisible()) quiet(scheduler.foreground())
    window.addEventListener('focus', focus)
    window.addEventListener('blur', flush)
    window.addEventListener('pagehide', closing)
    window.addEventListener('online', network)
    window.addEventListener('pointerdown', activity, { passive: true })
    window.addEventListener('keydown', activity)
    // ホイールだけで読み続けても放置と見なさない
    window.addEventListener('wheel', activity, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    return () => {
      scheduler.dispose()
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', flush)
      window.removeEventListener('pagehide', closing)
      window.removeEventListener('online', network)
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
      window.removeEventListener('wheel', activity)
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
      // 適用の有無によらず、画面が読むものを DB の値にする。閉じるスレは onCycle が渡し済み
      if (storeRef.current) applied.current.reads(storeRef.current, [])
      return summary(r)
    }),
    syncLeave: () => need(latest.current).leave(),
    syncSetMaster: (on: boolean) => need(latest.current).setMaster(on),
    syncSetKind: (a: { group: SyncGroup; on: boolean }) => need(latest.current).setKind(a.group, a.on),
    syncSetServer: (url: string) => need(latest.current).setServerUrl(url),
    syncSetStore: (store: SyncStore) => need(latest.current).setStore(store),
    syncGoogleCancel: () => cancelGoogleLogin(),
    syncGoogleRevoke: () => need(latest.current).revokeGoogle(),
    syncConfirm: (choice: ConfirmChoice) => need(latest.current).resolveConfirm(choice).then(summary),
    syncSummary: () => need(latest.current).summary(),
    syncMismatches: () => need(latest.current).mismatches(),
  }).current
}

const need = (c: SyncController | undefined): SyncController => {
  if (!c) throw new Error('not_ready')
  return c
}

/** 設定の窓へ返す分。confirm は参加で手元を送る前の確認(画面が出す) */
const summary = (r: CycleResult) => ({ state: r.state, pulled: r.pulled, pushed: r.pushed, confirm: r.confirm ?? null })
