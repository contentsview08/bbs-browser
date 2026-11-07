// 同期のきっかけと、設定の窓からの頼みごと。自動の送信はまだ持たない(手動と前面復帰だけ)
import { useEffect, useMemo, useRef } from 'react'
import type { LogStore } from '@bbs-browser/logstore'
import { FavoriteThreadAdapter, SyncController, type ConfirmChoice, type CycleResult } from '@bbs-browser/sync'
import { DEFAULT_SYNC_SERVER, openSyncStartWindow, resolveSyncBoard, syncKeyHint, syncKeyStore, syncTransport } from '../host/sync'
import { isAppVisible } from '../utils/visibility'

export function useSync(store: LogStore | undefined, onFavoriteThreads: (s: LogStore) => void) {
  const applied = useRef(onFavoriteThreads)
  applied.current = onFavoriteThreads
  const ctl = useMemo(() => {
    if (!store) return undefined
    return new SyncController({
      db: store.db,
      keyStore: syncKeyStore,
      transport: syncTransport,
      defaultServerUrl: DEFAULT_SYNC_SERVER,
      adapters: [new FavoriteThreadAdapter(store.db, resolveSyncBoard)],
      now: Date.now,
      allowLocalhost: import.meta.env.DEV,
      leaseOwner: crypto.randomUUID(),
      keyHint: syncKeyHint,
      openStartWindow: openSyncStartWindow,
      onCycle: (r: CycleResult) => {
        if (r.applied.favoriteThreads) applied.current(store)
      },
    })
  }, [store])

  useEffect(() => {
    if (!ctl) return
    const front = () => {
      if (isAppVisible()) void ctl.foreground().catch(() => undefined)
    }
    front()
    window.addEventListener('focus', front)
    document.addEventListener('visibilitychange', front)
    return () => {
      window.removeEventListener('focus', front)
      document.removeEventListener('visibilitychange', front)
    }
  }, [ctl])

  const latest = useRef(ctl)
  latest.current = ctl
  // 設定の窓は鍵の命令を呼べないので、main で行う
  return useRef({
    syncStatus: () => need(latest.current).status(),
    syncStart: () => need(latest.current).start().then(summary),
    syncPairingCode: () => need(latest.current).pairingCode(),
    syncJoin: (code: string) => need(latest.current).join(code).then(summary),
    syncNow: () => need(latest.current).syncNow().then(summary),
    syncLeave: () => need(latest.current).leave(),
    syncSetServer: (url: string) => need(latest.current).setServerUrl(url),
    syncConfirm: (choice: ConfirmChoice) => need(latest.current).resolveConfirm(choice).then(summary),
  }).current
}

const need = (c: SyncController | undefined): SyncController => {
  if (!c) throw new Error('not_ready')
  return c
}

const summary = (r: CycleResult) => ({ state: r.state, pulled: r.pulled, pushed: r.pushed })
