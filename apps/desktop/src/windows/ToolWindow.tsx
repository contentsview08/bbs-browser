// 道具のウィンドウ(PC)。設定・NG の管理表を、メインのウィンドウの外に出す(index.html?window=settings / ng)。
// DB は同じものを開く。設定の変更は useSettings が settings-changed で写し合う。
// お気に入り板・サイト・アカウントは DB に直に書き、*-changed でメインに知らせる。メインでしかできないこと(板の一覧を取る・ログイン・板を開く)は callMain で頼む
import { useEffect, useMemo, useRef, useState } from 'react'
import { findConnector, type Board, type LoginResult, type PostConfirm, type PostInput, type PostResult, type SiteConfig, type ThreadSummary } from '@bbs-browser/connectors'
import { UserOps, type AccountRecord, type LogStore } from '@bbs-browser/logstore'
import { openLogStore } from '../host/logStore'
import { useSettings } from '../ui/settings'
import { broadcast, callMain, onBroadcast, onToolOpen, toolKindOfThisWindow, REPLY_CONTEXT_EVENT, REPLY_INSERT_EVENT, REPLY_POPUP_EVENT, type ReplyContext } from '../host/crossWindow'
import ReplyForm, { type ReplyFormHandle } from '../components/ReplyForm'
import type { UploadedFile } from '../host/uploader'
import { mirrorAiModelStatus } from '../hooks/useAiNg'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { BackupExtras } from '../utils/backup'
import { backupDatabase, restoreDatabase } from '../host/backup'
import { pickChmateBackup } from '../host/chmate'
import SettingsDialog, { type SettingsTab } from '../components/SettingsDialog'
import NgManager from '../components/NgManager'
import KeywordManager from '../components/KeywordManager'
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
        <NgManager rules={settings.ngRules} onChange={(v) => update('ngRules', v, settings.ngRules)} />
      </div>
    </div>
  ) : kind === 'keywords' ? (
    <KeywordsWindow store={store} settings={settings} update={update} />
  ) : kind === 'reply' ? (
    <ReplyWindow settings={settings} update={update} />
  ) : (
    <SettingsWindow store={store} settings={settings} update={update} />
  )
}

/**
 * 書き込み欄のポップアップ。欄は 1 つで、メインで「いま開いているスレ」に書く(スレを切り替えるとこちらも切り替わる)。
 * 書き込みそのもの(コネクタ・アカウント・書き込み後の取り直し)はメインに頼む(replySubmit など。関数は窓をまたげないので値だけ渡す)。
 * 開いている間、メインはスレ表示の中の欄を出さない。この窓を閉じると欄は元の場所に戻る(REPLY_POPUP_EVENT)
 */
function ReplyWindow({ settings, update }: { settings: ReturnType<typeof useSettings>[0]; update: ReturnType<typeof useSettings>[1] }) {
  const [ctx, setCtx] = useState<ReplyContext | null>()
  const ref = useRef<ReplyFormHandle>(null)
  useEffect(() => {
    const load = () => callMain<ReplyContext | null>('replyContext').then(setCtx, backgroundError('書き込むスレ'))
    void load()
    void broadcast(REPLY_POPUP_EVENT, { open: true })
    const offs = [
      onBroadcast(REPLY_CONTEXT_EVENT, () => void load()),
      onBroadcast<string>(REPLY_INSERT_EVENT, (text) => {
        ref.current?.insert(text)
        ref.current?.focus()
        void getCurrentWindow().setFocus()
      }),
      // 閉じたことは Rust(lib.rs の on_window_event)がメインに知らせる(JS の onCloseRequested だと destroy の権限が要って閉じなくなる)
    ]
    return () => offs.forEach((o) => void o.then((f) => f()))
  }, [])
  useEffect(() => {
    void getCurrentWindow().setTitle(ctx ? `書き込み: ${ctx.title}` : '書き込み')
  }, [ctx?.title])
  if (ctx === undefined) return <div className="h-full w-full bg-panel-reply" />
  if (ctx === null || !ctx.canPost) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-panel-reply text-sm text-c-text-muted px-4 text-center">
        {ctx === null ? 'スレを開くと、ここに書き込み欄が出ます' : 'この掲示板には書き込めません'}
      </div>
    )
  }
  const t = ctx.thread
  const connector = findConnector(t.connectorId)
  const key = `${t.boardUrl}${t.key}`
  return (
    <div className="h-full w-full flex flex-col bg-panel-reply text-c-text-body">
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-c-border text-xs text-c-text-muted">
        <span className="material-symbols-outlined text-base">edit</span>
        <span className="flex-1 truncate" title={ctx.title}>
          {ctx.title}
        </span>
        <button type="button" className="text-c-accent hover:underline whitespace-nowrap" title="このウィンドウを閉じて、書き込み欄をスレ表示に戻す" onClick={closeWindow}>
          元の場所に戻す
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <ReplyForm
          key={key}
          ref={ref}
          layout="bottom"
          disabled={ctx.disabled}
          initialName={ctx.postName}
          initialMail={ctx.postMail}
          onSubmit={(input: PostInput) => callMain<PostResult>('replySubmit', input)}
          onConfirm={(confirm: PostConfirm, input: PostInput) => callMain<PostResult>('replyConfirm', { confirm, input })}
          onOpenUrl={(url) => void callMain('replyOpenUrl', url)}
          uploader={{
            maxDimension: settings.uploadMaxDimension,
            userhash: settings.catboxUserhash.trim() || undefined,
            host: settings.uploadHost,
            imgbbApiKey: settings.imgbbApiKey.trim() || undefined,
            imgurClientId: settings.imgurClientId.trim() || undefined,
          }}
          onUploaded={(u: UploadedFile) => void callMain('replyUploaded', u)}
          draft={{
            load: () => callMain<string | undefined>('replyLoadDraft', t),
            save: (body: string) => void callMain('replySaveDraft', { thread: t, body }),
            key: `reply:${key}`,
          }}
          limits={ctx.limits}
          byteLength={connector?.postByteLength}
          accounts={ctx.accounts}
          onToggleAccount={(id, on) => void callMain('replyToggleAccount', { id, on })}
          onOpenAccountSettings={() => void callMain('replyOpenAccountSettings')}
          attach={connector?.attachments}
          phraseBar={settings.quickPhrases}
          fieldHistory={settings.fieldHistory}
          onFieldHistoryChange={(h) => update('fieldHistory', h)}
          stamp={{ title: ctx.title, url: ctx.threadUrl }}
        />
      </div>
    </div>
  )
}

/** キーワードの管理表の窓(NG の一覧と同じ作り)。「効く板」の候補にお気に入り板が要るので DB から読む */
function KeywordsWindow({ store, settings, update }: { store: LogStore; settings: ReturnType<typeof useSettings>[0]; update: ReturnType<typeof useSettings>[1] }) {
  const [favorites, setFavorites] = useState<Board[]>([])
  useEffect(() => {
    const reload = async () => setFavorites(await store.listFavorites())
    void reload()
    const off = onBroadcast('favorites-changed', () => void reload())
    return () => void off.then((f) => f())
  }, [store])
  return (
    <div className="h-full w-full flex flex-col bg-c-surface text-c-text-body">
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5">
        <KeywordManager rules={settings.keywordRules} favorites={favorites.map((b) => ({ url: b.url, name: b.name }))} onChange={(v) => update('keywordRules', v, settings.keywordRules)} />
      </div>
    </div>
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
      loadSiteUrls: () => callMain<string[]>('loadSiteUrls'),
      onToggleFavorite: (b: Board, on?: boolean) =>
        void callMain('toggleFavorite', { board: b, on }).then(reloadFavorites).catch(backgroundError('お気に入り板')),
      // 頼みを送り終えてから閉じる(先に閉じると、頼みがメインに届かず板が開かない)
      onOpenBoard: (b: Board) => void callMain('openBoard', b).finally(closeWindow),
      onAddFavoriteUrl: (url: string) => callMain<void>('addFavoriteUrl', url).then(reloadFavorites),
      onRemoveFavorite: (url: string) =>
        void new UserOps(store)
          .favoriteBoardRemove(url)
          .then(() => reloadFavorites())
          .then(() => broadcast('favorites-changed', null))
          .catch(backgroundError('お気に入り板')),
      onReorderFavorites: (urls: string[]) =>
        void new UserOps(store)
          .favoriteBoardReorder(urls)
          .then(() => reloadFavorites())
          .then(() => broadcast('favorites-changed', null))
          .catch(backgroundError('お気に入り板の並べ替え')),
      onAddSite: (name: string, menuUrl: string) => callMain<void>('addSite', { name, menuUrl }).then(reloadSites),
      onRemoveSite: (menuUrl: string) =>
        void new UserOps(store)
          .siteRemove(menuUrl)
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
      onExportExtras: () => callMain<BackupExtras>('exportBackupExtras'),
      onImportExtras: (e: BackupExtras) => callMain<string>('importBackupExtras', e).then((r) => reloadFavorites().then(() => reloadSites()).then(() => r)),
      // ZIP はこのウィンドウで選び、読んで DB に入れるのはメイン(選んだパスは Rust が覚えている)
      onImportChmate: async () => {
        const path = await pickChmateBackup()
        return path ? callMain<string | undefined>('importChmate', path) : undefined
      },
      onBackupDb: () => backupDatabase(),
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
