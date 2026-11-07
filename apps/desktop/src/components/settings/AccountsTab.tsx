import { useEffect, useState } from 'react'
import { normalizeForSearch } from '../../utils/postBody'
import { allConnectors, siteDomain, uniqueSiteDomains, type AccountKind, type Board, type LoginResult } from '@bbs-browser/connectors'
import { LOGIN_HIDDEN_CONNECTORS } from '../../hooks/useAccounts'
import type { AccountRecord } from '@bbs-browser/logstore'
import type { BoardMeta } from '../../ui/settings'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ManagerDialog, OpenRow, Toggle } from '../SettingParts'
import { BTN_PRIMARY, INPUT } from '../DialogParts'
import BoardIcon from '../BoardIcon'
import { type SettingsProps, Section, withBoardMeta, BoardMetaEditor } from './common'

/** アカウント 1 つぶんの欄(メールアドレス・パスワード・自動ログイン・ログイン) */
function AccountForm(props: {
  connectorId: string
  kind: AccountKind
  saved?: AccountRecord
  status?: LoginResult
  onLogin: (a: AccountRecord) => Promise<LoginResult>
  /** ログインし直さずに保存だけする(「自動でログイン」を変えたとき) */
  onSave: (a: AccountRecord) => void
  onDelete: () => void
}) {
  const [user, setUser] = useState(props.saved?.user ?? '')
  const [password, setPassword] = useState(props.saved?.password ?? '')
  const [autoLogin, setAutoLogin] = useState(props.saved?.autoLogin ?? true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LoginResult | undefined>(props.status)
  const ready = user.trim() !== '' && password !== '' && !busy

  return (
    <div className="p-4 border border-c-border rounded-[var(--card-radius)] space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-c-text-strong">{props.kind.name}</span>
        <span className="text-xs text-c-text-muted">{props.kind.site}</span>
        {result && (
          <span className={`ml-auto text-xs ${result.ok ? 'text-c-accent' : 'text-c-heat-very-hot'}`}>
            <span className="material-symbols-outlined text-sm align-[-3px] mr-0.5">{result.ok ? 'check_circle' : 'error'}</span>
            {result.message}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          type={props.kind.userLabel ? 'text' : 'email'}
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder={props.kind.userLabel ?? 'メールアドレス'}
          autoComplete="off"
          className={`${INPUT} flex-1 min-w-[200px]`}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード"
          autoComplete="off"
          className={`${INPUT} flex-1 min-w-[160px]`}
        />
      </div>
      <Toggle
        checked={autoLogin}
        onChange={(v) => {
          setAutoLogin(v)
          // 保存済みのアカウントは、トグルだけ変えてもすぐ保存する
          if (props.saved) props.onSave({ ...props.saved, autoLogin: v })
        }}
        label="起動したときに自動でログインする"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={!ready}
          onClick={async () => {
            setBusy(true)
            try {
              setResult(await props.onLogin({ connectorId: props.connectorId, accountId: props.kind.id, user: user.trim(), password, autoLogin }))
            } catch (e) {
              setResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'ログイン中…' : '保存してログイン'}
        </button>
        {props.saved && (
          <button
            type="button"
            onClick={() => {
              props.onDelete()
              setUser('')
              setPassword('')
              setResult(undefined)
            }}
            className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border border-c-border text-c-text-body hover:border-c-border-strong"
          >
            保存したものを消す
          </button>
        )}
        {props.kind.registerUrl && (
          <button type="button" onClick={() => void openUrl(props.kind.registerUrl!)} className="ml-auto text-xs text-c-text-muted hover:text-c-accent underline">
            登録・確認のページを開く
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * 掲示板ごとの設定。全体の設定(ほかの分類)の上に、掲示板(サービス)ごと・板ごとに上書きするもの。
 * - サイトごと: BBS メニュー・板・スレの URL の主ドメインで 1 行。アカウント(5ch の BE など。コネクタが申告したもの)はそのサイトの中に
 * - 板ごと: 別名・名前欄とメール欄の既定値・名無しの扱い
 */
export function AccountsTab(
  props: Pick<SettingsProps, 'accounts' | 'loginStatus' | 'onLogin' | 'onSaveAccount' | 'onDeleteAccount' | 'favorites' | 'sites' | 'loadSiteUrls' | 'settings' | 'update'>,
) {
  const key = (connectorId: string, accountId: string) => `${connectorId}:${accountId}`
  const kinds = allConnectors()
    .filter((c) => !LOGIN_HIDDEN_CONNECTORS.has(c.id))
    .flatMap((c) => (c.accounts ?? []).map((kind) => ({ c, kind })))
  const kindDomains = (kind: AccountKind) => uniqueSiteDomains(kind.hosts.filter((h) => h !== '*').map((h) => `https://${h}/`))
  const [loadedUrls, setLoadedUrls] = useState<string[]>([])
  const { loadSiteUrls, sites: menus } = props
  useEffect(() => {
    let alive = true
    void loadSiteUrls?.().then((u) => {
      if (alive) setLoadedUrls(u)
    })
    return () => {
      alive = false
    }
    // BBS メニューを足し引きしたら、取ってある板一覧も変わる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menus.length])
  // 保存したアカウントのサイトは、板がなくても出す(消す場所をなくさない)
  const savedSites = kinds.filter(({ c, kind }) => props.accounts.some((a) => a.connectorId === c.id && a.accountId === kind.id)).flatMap(({ kind }) => kindDomains(kind).slice(0, 1))
  const sites = uniqueSiteDomains([
    ...menus.map((s) => s.menuUrl),
    ...loadedUrls,
    ...props.favorites.map((b) => b.url),
    ...Object.keys(props.settings.boardMeta),
    ...savedSites.map((d) => `https://${d}/`),
  ]).map((domain) => ({
    domain,
    name: menus.find((s) => siteDomain(s.menuUrl) === domain)?.name,
    list: kinds.filter(({ kind }) => kindDomains(kind).includes(domain)),
  }))
  const [editing, setEditing] = useState<string>()
  /** ポップアップで開いているサイト(5ch など) */
  const [openSite, setOpenSite] = useState<string>()
  const [query, setQuery] = useState('')
  const [addUrl, setAddUrl] = useState('')
  /** URL で足した板(設定を入れるまでは保存しないので、ここで覚えておく) */
  const [added, setAdded] = useState<string[]>([])
  const meta = props.settings.boardMeta
  const setMeta = (url: string, m: BoardMeta) => props.update('boardMeta', withBoardMeta(meta, url, m))
  // 板の一覧: お気に入りの板と、設定のある板(お気に入りでない板は名前が分からないので URL で出す)
  const boards: Board[] = [
    ...props.favorites,
    ...[...new Set([...Object.keys(meta), ...added])]
      .filter((u) => !props.favorites.some((b) => b.url === u))
      .map((u): Board => ({ connectorId: '', url: u, name: u.replace(/^https?:\/\//, '').replace(/\/$/, '') })),
  ]
  const q = normalizeForSearch(query.trim())
  const shown = q ? boards.filter((b) => normalizeForSearch(`${meta[b.url]?.alias ?? ''} ${b.name} ${b.url}`).includes(q)) : boards
  const summary = (m: BoardMeta | undefined) =>
    [
      m?.alias && `別名「${m.alias}」`,
      m?.defaultName && `名前「${m.defaultName}」`,
      m?.defaultMail && `メール「${m.defaultMail}」`,
      m?.omitNoname !== undefined && (m.omitNoname ? '名無しを省く' : '名無しを省かない'),
      m?.nonames?.length && `名無し扱い ${m.nonames.length} 件`,
    ]
      .filter(Boolean)
      .join('・')
  /** 板の 1 行。押すと設定の欄を開く */
  const boardRow = (b: Board) => {
    const m = meta[b.url]
    return (
      <div key={b.url}>
        <button
          type="button"
          onClick={() => setEditing((e) => (e === b.url ? undefined : b.url))}
          className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-c-surface2"
        >
          <BoardIcon boardUrl={b.url} override={m?.icon} />
          <span className="text-c-text-strong">{m?.alias || b.name}</span>
          <span className="flex-1 min-w-0 truncate text-xs text-c-text-muted">{summary(m) || '全体の設定のまま'}</span>
          <span className="material-symbols-outlined text-lg text-c-text-muted">{editing === b.url ? 'expand_less' : 'expand_more'}</span>
        </button>
        {editing === b.url && <BoardMetaEditor board={b} meta={m ?? {}} onChange={(next) => setMeta(b.url, next)} />}
      </div>
    )
  }
  return (
    <>
      <p className="mb-5 text-xs text-c-text-muted leading-relaxed">
        ほかの分類の設定はすべての掲示板に効きます。ここでは、サイトごと・板ごとに変えたいものだけを決めます。決めていないものは全体の設定のままです。
      </p>
      {sites.length > 0 && (
        <Section title="サイトごとの設定" note="BBS メニュー・板・お気に入り・開いたスレの URL から、サイトを自動で並べます(サブドメインはまとめます)。アカウントのあるサイトは、ログインするとそのサイトに書き込むときに自動で使われます(5ch の BE なら、BE に対応した板でアイコンやポイントが付きます)。パスワードはこのアプリの DB にそのまま保存します">
          {/* サイトは行で並べ、押すとそのサイトのポップアップ(アカウントと、そのサイトの板)を開く */}
          <div className="space-y-2">
            {sites.map(({ domain, name, list }) => (
              <OpenRow
                key={domain}
                label={domain}
                value={[
                  name,
                  ...list.map(({ c, kind }) => {
                    const saved = props.accounts.find((a) => a.connectorId === c.id && a.accountId === kind.id)
                    const st = props.loginStatus.get(key(c.id, kind.id))
                    return `${kind.name}: ${!saved ? '未登録' : st?.ok ? 'ログイン中' : st ? 'ログインできていない' : '登録済み'}`
                  }),
                ]
                  .filter(Boolean)
                  .join('・')}
                onOpen={() => setOpenSite(domain)}
              />
            ))}
          </div>
        </Section>
      )}
      {openSite && (
        <ManagerDialog title={`${openSite} の設定`} onClose={() => setOpenSite(undefined)}>
          <div className="space-y-5">
            {(sites.find((x) => x.domain === openSite)?.list ?? []).map(({ c, kind }) => (
              <div key={key(c.id, kind.id)}>
                <p className="mb-1.5 text-xs font-bold text-c-text-muted">{kind.name} アカウント</p>
                <AccountForm
                  connectorId={c.id}
                  kind={kind}
                  saved={props.accounts.find((a) => a.connectorId === c.id && a.accountId === kind.id)}
                  status={props.loginStatus.get(key(c.id, kind.id))}
                  onLogin={props.onLogin}
                  onSave={props.onSaveAccount}
                  onDelete={() => props.onDeleteAccount(c.id, kind.id)}
                />
                <p className="mt-2 text-xs text-c-text-muted">
                  ログインで受け取った Cookie は、ふだんの通信の Cookie と一緒に保存されます。保存したものを消しても、受け取った Cookie はその期限まで残ります。
                </p>
              </div>
            ))}
            <div>
              <p className="mb-1.5 text-xs font-bold text-c-text-muted">このサイトの板</p>
              <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)]">
                {boards.filter((b) => siteDomain(b.url) === openSite).map(boardRow)}
                {!boards.some((b) => siteDomain(b.url) === openSite) && <p className="px-3 py-2 text-sm text-c-text-muted">お気に入りの板も、設定のある板もありません</p>}
              </div>
            </div>
          </div>
        </ManagerDialog>
      )}
      <Section title="板ごとの設定" note="別名・名前欄とメール欄の既定値・名無しの扱いを、板ごとに決めます。お気に入りの板と、設定のある板が並びます">
        {boards.length > 8 && (
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`${boards.length} 板から絞り込む`} className={`${INPUT} w-full mb-2`} />
        )}
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)] mb-3">
          {shown.map(boardRow)}
          {shown.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">{boards.length === 0 ? 'お気に入りの板がまだありません' : '見つかりません'}</p>}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const u = addUrl.trim().replace(/\/?$/, '/')
            if (!/^https?:\/\//.test(u)) return
            setAdded((a) => (a.includes(u) ? a : [...a, u]))
            setEditing(u)
            setAddUrl('')
          }}
        >
          <input type="text" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} placeholder="お気に入りでない板の URL(例: https://eagle.5ch.net/livejupiter/)" className={`${INPUT} flex-1`} />
          <button type="submit" className={BTN_PRIMARY} disabled={!/^https?:\/\//.test(addUrl.trim())}>
            設定する
          </button>
        </form>
      </Section>
    </>
  )
}
