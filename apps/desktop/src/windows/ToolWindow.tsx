// 道具のウィンドウ(PC)。設定・NG の管理表を、メインのウィンドウの外に出す(index.html?window=settings / ng)。
// DB は同じものを開く。設定の変更は useSettings が settings-changed で写し合う。
// お気に入り板・サイト・アカウントは DB に直に書き、*-changed でメインに知らせる。メインでしかできないこと(板の一覧を取る・ログイン・板を開く)は callMain で頼む
import { useEffect, useMemo, useState } from 'react'
import type { Board, LoginResult, SiteConfig } from '@bbs-browser/connectors'
import type { AccountRecord, LogStore } from '@bbs-browser/logstore'
import { openLogStore } from '../host/logStore'
import { useSettings } from '../ui/settings'
import { broadcast, callMain, onBroadcast, onToolOpen, toolKindOfThisWindow } from '../host/crossWindow'
import { mirrorAiModelStatus } from '../hooks/useAiNg'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { backupDatabase, restoreDatabase } from '../host/backup'
import SettingsDialog, { type SettingsTab } from '../components/SettingsDialog'
import NgManager from '../components/NgManager'
import { backgroundError } from '../utils/backgroundError'

const closeWindow = () => void getCurrentWindow().close()

export default function ToolWindow() {
  const kind = toolKindOfThisWindow() ?? 'settings'
  const [store, setStore] = useState<LogStore>()
  useEffect(() => {
    openLogStore().then(setStore, backgroundError('DB を開く'))
  }, [])
  const [settings, update, loaded] = useSettings(store, { font: false })
  if (!store || !loaded) return <div className="h-full w-full bg-c-base" />
  return kind === 'ng' ? (
    <div className="h-full w-full flex flex-col bg-c-surface text-c-text-body">
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5">
        <NgManager rules={settings.ngRules} onChange={(v) => update('ngRules', v)} />
      </div>
    </div>
  ) : (
    <SettingsWindow store={store} settings={settings} update={update} />
  )
}

function SettingsWindow({ store, settings, update }: { store: LogStore; settings: ReturnType<typeof useSettings>[0]; update: ReturnType<typeof useSettings>[1] }) {
  const initialTab = (new URLSearchParams(location.search).get('tab') as SettingsTab | null) ?? 'display'
  const [requestedTab, setRequestedTab] = useState<{ tab: SettingsTab; seq: number }>()
  const [favorites, setFavorites] = useState<Board[]>([])
  const [sites, setSites] = useState<SiteConfig[]>([])
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [loginStatus, setLoginStatus] = useState(new Map<string, LoginResult>())
  const reloadFavorites = async () => setFavorites(await store.listFavorites())
  const reloadSites = async () => setSites(await store.listSites())
  const reloadAccounts = async () => {
    setAccounts(await store.listAccounts())
    const st = await callMain<[string, LoginResult][]>('loginStatus').catch(() => [] as [string, LoginResult][])
    setLoginStatus(new Map(st))
  }
  useEffect(() => {
    void reloadFavorites()
    void reloadSites()
    void reloadAccounts()
    const offs = [
      onBroadcast('favorites-changed', () => void reloadFavorites()),
      onBroadcast('sites-changed', () => void reloadSites()),
      onBroadcast('accounts-changed', () => void reloadAccounts()),
      mirrorAiModelStatus(),
      onToolOpen((p) => {
        if (p.tab) setRequestedTab({ tab: p.tab as SettingsTab, seq: Date.now() })
      }),
    ]
    return () => offs.forEach((o) => void o.then((f) => f()))
    // store は固定
  }, [])
  const props = useMemo(
    () => ({
      loadBoards: (site: SiteConfig, refresh: boolean) => callMain<Board[]>('loadBoards', { site, refresh }),
      onToggleFavorite: (b: Board) => void callMain('toggleFavorite', b).then(reloadFavorites).catch(backgroundError('お気に入り板')),
      onOpenBoard: (b: Board) => {
        void callMain('openBoard', b)
        closeWindow()
      },
      onAddFavoriteUrl: (url: string) => callMain<void>('addFavoriteUrl', url).then(reloadFavorites),
      onRemoveFavorite: (url: string) =>
        void store
          .removeFavorite(url)
          .then(() => reloadFavorites())
          .then(() => broadcast('favorites-changed', null))
          .catch(backgroundError('お気に入り板')),
      onReorderFavorites: (urls: string[]) =>
        void store
          .reorderFavorites(urls)
          .then(() => reloadFavorites())
          .then(() => broadcast('favorites-changed', null))
          .catch(backgroundError('お気に入り板の並べ替え')),
      onAddSite: (name: string, menuUrl: string) => callMain<void>('addSite', { name, menuUrl }).then(reloadSites),
      onRemoveSite: (menuUrl: string) =>
        void store
          .removeSite(menuUrl)
          .then(() => reloadSites())
          .then(() => broadcast('sites-changed', null))
          .catch(backgroundError('BBS メニュー')),
      onLogin: (a: AccountRecord) => callMain<LoginResult>('login', a).finally(() => void reloadAccounts()),
      onSaveAccount: (a: AccountRecord) =>
        void store
          .setAccount(a)
          .then(() => reloadAccounts())
          .then(() => broadcast('accounts-changed', null))
          .catch(backgroundError('アカウントの保存')),
      onDeleteAccount: (connectorId: string, accountId: string) =>
        void store
          .deleteAccount(connectorId, accountId)
          .then(() => reloadAccounts())
          .then(() => broadcast('accounts-changed', null))
          .catch(backgroundError('アカウントの削除')),
      onBackupDb: () => backupDatabase(store),
      onRestoreDb: restoreDatabase,
      onPruneLogs: () => callMain<number>('pruneLogs'),
    }),
    // store は固定
    [],
  )
  return (
    <SettingsDialog
      {...props}
      windowed
      initialTab={initialTab}
      requestedTab={requestedTab}
      settings={settings}
      update={update}
      favorites={favorites}
      sites={sites}
      accounts={accounts}
      loginStatus={loginStatus}
      onClose={closeWindow}
    />
  )
}
