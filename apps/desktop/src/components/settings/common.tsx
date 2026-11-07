// 設定画面の各分類で使う型と部品。

import { useRef, createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { normalizeForSearch } from '../../utils/postBody'
import type { Board, LoginResult, SiteConfig } from '@bbs-browser/connectors'
import type { AccountRecord } from '@bbs-browser/logstore'
import { LIST_TABS, type ListTabKey, type AppSettings, type BoardMeta, type UpdateSetting } from '../../ui/settings'
import { isMobile } from '../../utils/platform'
import { DragHandle, DragList } from '../DragSort'
import { ListEditor, SamplePosts, TextSetting } from '../SettingParts'
import { INPUT } from '../DialogParts'

export interface SettingsProps {
  settings: AppSettings
  update: UpdateSetting
  favorites: Board[]
  sites: SiteConfig[]
  onAddFavoriteUrl: (url: string) => Promise<void>
  onRemoveFavorite: (url: string) => void
  onReorderFavorites: (urls: string[]) => void
  onAddSite: (name: string, menuUrl: string) => Promise<void>
  onRemoveSite: (menuUrl: string) => void
  /** BBS メニューの板一覧。refresh なら取り直す(なければ保存してあるものを返す) */
  loadBoards: (site: SiteConfig, refresh: boolean) => Promise<Board[]>
  /** サイトごとの設定の一覧を作る URL(取ってある板一覧・お気に入りのスレ・閲覧履歴の板) */
  loadSiteUrls?: () => Promise<string[]>
  onToggleFavorite: (board: Board) => void
  /** 板一覧でダブルクリックした板を開く(設定は閉じる) */
  onOpenBoard: (board: Board) => void
  /** サイトのアカウント(保存してあるもの)と、ログインの状態 */
  accounts: AccountRecord[]
  loginStatus: Map<string, LoginResult>
  /** 保存してログインする */
  onLogin: (a: AccountRecord) => Promise<LoginResult>
  onSaveAccount: (a: AccountRecord) => void
  onDeleteAccount: (connectorId: string, accountId: string) => void
  /** DB 全体(ログ・設定・NG・履歴)を書き出す。保存先を選ばなかったら false */
  onBackupDb: () => Promise<boolean>
  /** 書き出しておいた DB に入れ替える(アプリを起動し直す) */
  onRestoreDb: () => Promise<boolean>
  /** 古いログを今すぐ消す(設定の日数で)。消したスレの数を返す */
  onPruneLogs: () => Promise<number>
  /** 最初に開く分類 */
  initialTab?: SettingsTab
  /** 自分のウィンドウに出しているとき(PC)。枠いっぱいに描き、動かす・大きさを変えるのは OS に任せる */
  windowed?: boolean
  /** 開いている間に外から分類を変える(seq が変わったら tab にする) */
  requestedTab?: { tab: SettingsTab; seq: number }
  onClose: () => void
}

export type SettingsTab =
  | 'display'
  | 'threads'
  | 'posts'
  | 'write'
  | 'upload'
  | 'refresh'
  | 'notify'
  | 'keys'
  | 'toolbars'
  | 'ng'
  | 'boardlist'
  | 'boards'
  | 'menus'
  | 'accounts'
  | 'backup'
  | 'about'

/** 高度な設定を見せるか(設定画面の左下のチェック) */
export const AdvancedContext = createContext(false)

/**
 * スマホの設定(components/mobile/MobileSettings)の中に、この画面の部品(NG・板の一覧・バックアップなど)を埋め込むときの囲い。
 * 高度な設定も出し、Section はふつうに中身まで出す
 */
export function SettingsEmbed(props: { children: ReactNode }) {
  return <AdvancedContext.Provider value={true}>{props.children}</AdvancedContext.Provider>
}

/** 設定の検索の言葉(空なら探していない)。Section は、中の文字に言葉が入っていなければ隠れる */
export const SearchContext = createContext('')

/** 設定のまとまり。advanced なら、高度な設定を見せるときだけ出す */
export function Section({
  title,
  children,
  note,
  advanced,
  desktopOnly,
}: {
  title: string
  children: ReactNode
  note?: string
  advanced?: boolean
  /** PC だけの設定(キー操作・サイドバー・マウスの操作・フォルダなど)。スマホでは出さない */
  desktopOnly?: boolean
}) {
  const showAdvanced = useContext(AdvancedContext)
  const query = useContext(SearchContext)
  const ref = useRef<HTMLElement>(null)
  // 検索中は、題・説明・中の文字(選べる項目の名前など)に言葉が入っている Section だけを出す
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const q = normalizeForSearch(query.trim())
    el.hidden = q !== '' && !normalizeForSearch(el.textContent ?? '').includes(q)
  })
  if (advanced && !showAdvanced) return null
  if (desktopOnly && isMobile) return null
  return (
    <section ref={ref} className={isMobile ? 'mb-10' : 'mb-8'}>
      <h3 className={`${isMobile ? 'text-base mb-1.5' : 'text-sm mb-1'} font-bold text-c-text-strong flex items-center gap-2`}>
        {title}
        {advanced && <span className="text-[10px] font-normal px-1.5 rounded border border-c-border text-c-text-muted">高度</span>}
      </h3>
      {note && <p className={`${isMobile ? 'text-[13px] leading-relaxed mb-3' : 'text-xs mb-2'} text-c-text-muted`}>{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

/** 見本のレス(表示・レス表示の分類の上)。検索の結果では出さない */
export function StickySample({ settings }: { settings: AppSettings }) {
  const query = useContext(SearchContext)
  const [hidden, setHidden] = useState(sampleHidden)
  if (query.trim() !== '') return null
  if (hidden)
    return (
      <button
        type="button"
        onClick={() => setHidden((sampleHidden = false))}
        className="mb-4 text-xs text-c-text-muted hover:text-c-accent underline"
      >
        見本のレスを出す
      </button>
    )
  return (
    // 入れ物の上の余白(20px)まで地で覆い、スクロールした設定が見本の上に透けないようにする
    <div className="sticky z-10 -mx-1 px-1 pb-1 bg-c-surface -top-5 -mt-5 pt-5">
      <SamplePosts settings={settings} compact title="見本(変えるとすぐ映ります)" onHide={() => setHidden((sampleHidden = true))} />
    </div>
  )
}

/** 見本を隠したか(設定画面を開き直しても覚えておく。アプリを起動し直したら出す) */
let sampleHidden = false

/**
 * 1 つを選ぶ。少なくて短い(3 つまで・どれも 6 文字まで・説明なし)ものは横に並べたボタン、それ以外はドロップダウン
 * (ボタンが何行にも折り返すと、どれを選んでいるか見にくいため)
 */
export function Choice<T extends string | number>(props: {
  value: T
  options: { key: T; name: string }[]
  onChange: (v: T) => void
}) {
  // 「自動(狭いときだけ 1 画面)」のような括弧の中は説明
  if (props.options.length > 3 || props.options.some((o) => o.name.length > 6 || /\(.*\)\s*$/.test(o.name))) {
    const i = props.options.findIndex((o) => o.key === props.value)
    return (
      <select
        value={i < 0 ? '' : String(i)}
        onChange={(e) => props.onChange(props.options[Number(e.target.value)].key)}
        className={`${INPUT} w-full max-w-md`}
      >
        {i < 0 && <option value="">選んでいません</option>}
        {props.options.map((o, n) => (
          <option key={String(o.key)} value={String(n)}>
            {o.name}
          </option>
        ))}
      </select>
    )
  }
  return (
    <div className="flex flex-wrap gap-2">
      {props.options.map((o) => (
        <button
          key={String(o.key)}
          type="button"
          onClick={() => props.onChange(o.key)}
          className={`px-3 py-1.5 text-sm border transition-colors rounded-[var(--chip-radius)] ${
            o.key === props.value
              ? 'border-c-accent text-c-accent bg-[var(--c-accent-wash)]'
              : 'border-c-border text-c-text-body hover:border-c-border-strong'
          }`}
        >
          {o.name}
        </button>
      ))}
    </div>
  )
}

/**
 * 出すものを選んで並べる(スレ一覧のタブ・レスの操作バー)。出しているものは右のつまみをつかんで上下に動かして並べる(上が左)。
 * − で外し、下の「出していないもの」の + で足す
 */
export function OrderEditor<K extends string>(props: {
  all: { key: K; name: string; icon: string; note?: string }[]
  value: K[]
  onChange: (v: K[]) => void
  /** 出していないものの見出し */
  restTitle?: string
  /** これより少なくは外せない */
  minShown?: number
}) {
  const shown = props.value.filter((k) => props.all.some((t) => t.key === k))
  const rest = props.all.map((t) => t.key).filter((k) => !shown.includes(k))
  const def = (k: K) => props.all.find((t) => t.key === k)!
  const pad = isMobile ? 'px-3 py-2.5 rounded-xl' : 'px-3 py-1.5 rounded-lg'
  const text = isMobile ? 'text-[15px]' : 'text-sm'
  return (
    <div className="flex flex-col gap-3">
      <DragList
        items={shown}
        onChange={props.onChange}
        render={(k, handle, dragging) => (
          <div className={`flex items-center gap-3 ${pad} border border-c-border ${dragging ? 'bg-c-surface2' : 'bg-c-surface'}`}>
            <button type="button" disabled={shown.length <= (props.minShown ?? 0)} onClick={() => props.onChange(shown.filter((x) => x !== k))} className="text-c-heat-very-hot disabled:opacity-30" title="外す">
              <span className="material-symbols-outlined fill text-xl">do_not_disturb_on</span>
            </button>
            <span className="material-symbols-outlined text-xl text-c-text-muted">{def(k).icon}</span>
            <span className="flex-1 min-w-0">
              <span className={`block ${text} text-c-text-strong`}>{def(k).name}</span>
              {def(k).note && <span className="block text-xs text-c-text-muted">{def(k).note}</span>}
            </span>
            <DragHandle handle={handle} />
          </div>
        )}
      />
      {shown.length === 0 && <p className="text-xs text-c-text-muted">何も出していません</p>}
      {rest.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-bold text-c-text-muted">{props.restTitle ?? '出していないもの'}</p>
          {rest.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => props.onChange([...shown, k])}
              className={`flex items-center gap-3 ${pad} border border-dashed border-c-border text-left hover:bg-c-surface2 active:bg-c-surface2`}
            >
              <span className="material-symbols-outlined fill text-xl text-c-accent">add_circle</span>
              <span className="material-symbols-outlined text-xl text-c-text-muted">{def(k).icon}</span>
              <span className={`${text} text-c-text-body`}>{def(k).name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** スレ一覧のタブを選んで並べる */
export function ListTabsEditor(props: { value: ListTabKey[]; onChange: (v: ListTabKey[]) => void }) {
  return <OrderEditor all={LIST_TABS} value={props.value} onChange={props.onChange} restTitle="出していないタブ" />
}

/** 板 1 つぶんの設定を入れ替えた全体。全部空になったら消す */
export function withBoardMeta(all: AppSettings['boardMeta'], url: string, m: BoardMeta): AppSettings['boardMeta'] {
  const next = { ...all }
  if (Object.values(m).some((v) => v !== undefined)) next[url] = m
  else delete next[url]
  return next
}

/** 板 1 つぶんの設定の欄(見せ方・書き込みの既定・名無しの扱い)。打ち終わると反映・保存し、空にすれば全体の設定に戻る */
export function BoardMetaEditor({ board, meta, onChange }: { board: Board; meta: BoardMeta; onChange: (m: BoardMeta) => void }) {
  const field = (key: 'alias' | 'icon' | 'defaultName' | 'defaultMail', label: string, placeholder: string, note?: string) => (
    <label className="block">
      <span className="block text-xs text-c-text-muted mb-1">{label}</span>
      <TextSetting value={meta[key] ?? ''} placeholder={placeholder} onChange={(v) => onChange({ ...meta, [key]: v || undefined })} className="w-full" />
      {note && <span className="block text-[10px] text-c-text-muted mt-0.5">{note}</span>}
    </label>
  )
  return (
    <div className="px-3 pb-3 pt-2 bg-c-surface2 space-y-3">
      <p className="text-[11px] font-bold text-c-text-muted">見せ方</p>
      <div className="grid grid-cols-2 gap-3">
        {field('alias', '別名(板名の代わりに出す名前)', board.name)}
        {field('icon', 'ファビコン(画像の URL)', '自動(板のページから探す)')}
      </div>
      <p className="text-[11px] font-bold text-c-text-muted">書き込み</p>
      <div className="grid grid-cols-2 gap-3">
        {field('defaultName', '名前欄の既定値', 'ふだんの名前のまま')}
        {field('defaultMail', 'メール欄の既定値', 'ふだんのメールのまま', 'sage にしておきたい板など')}
      </div>
      <p className="text-[11px] font-bold text-c-text-muted">名無しの扱い</p>
      <Choice
        value={meta.omitNoname === undefined ? 'global' : meta.omitNoname ? 'omit' : 'keep'}
        options={[
          { key: 'global' as const, name: '全体の設定に合わせる' },
          { key: 'omit' as const, name: '名無しの名前を省く' },
          { key: 'keep' as const, name: '省かない' },
        ]}
        onChange={(v) => onChange({ ...meta, omitNoname: v === 'global' ? undefined : v === 'omit' })}
      />
      <div>
        <span className="block text-xs text-c-text-muted mb-1">板の既定の名前のほかに、名無しとみなす名前(名前を変えた名無し・ワッチョイの頭など)</span>
        <ListEditor noun="名無しとみなす名前" items={meta.nonames ?? []} onChange={(v) => onChange({ ...meta, nonames: v.length ? v : undefined })} placeholder="例: 風吹けば名無し" />
      </div>
    </div>
  )
}
