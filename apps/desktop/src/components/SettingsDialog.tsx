// 設定画面。左に分類、右に中身。変更はその場で反映・保存する(「保存」ボタンはない)。

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Board, SiteConfig } from '@bbs-browser/connectors'
import {
  COLOR_SCHEMES,
  FONT_FAMILIES,
  type AppSettings,
  type FontSize,
  type UpdateSetting,
} from '../ui/settings'
import { NG_TARGETS, isValidPattern, newRule, type NgTarget } from '../utils/ng'
import { loadSystemFonts, type SystemFont } from '../host/systemFonts'

interface Props {
  settings: AppSettings
  update: UpdateSetting
  favorites: Board[]
  sites: SiteConfig[]
  onAddFavoriteUrl: (url: string) => Promise<void>
  onRemoveFavorite: (url: string) => void
  onAddSite: (name: string, menuUrl: string) => Promise<void>
  onRemoveSite: (menuUrl: string) => void
  /** BBS メニューの板一覧。refresh なら取り直す(なければ保存してあるものを返す) */
  loadBoards: (site: SiteConfig, refresh: boolean) => Promise<Board[]>
  onToggleFavorite: (board: Board) => void
  /** 最初に開く分類 */
  initialTab?: SettingsTab
  onClose: () => void
}

export type SettingsTab = 'display' | 'threads' | 'posts' | 'refresh' | 'ng' | 'boards' | 'about'
type Tab = SettingsTab

const TABS: { key: Tab; name: string; icon: string }[] = [
  { key: 'display', name: '表示', icon: 'palette' },
  { key: 'threads', name: 'スレッド一覧', icon: 'view_list' },
  { key: 'posts', name: 'レス表示', icon: 'forum' },
  { key: 'refresh', name: '自動更新', icon: 'autorenew' },
  { key: 'ng', name: 'NG', icon: 'block' },
  { key: 'boards', name: '板とサイト', icon: 'dns' },
  { key: 'about', name: 'このアプリについて', icon: 'info' },
]

const INPUT =
  'bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted py-1.5 focus:ring-c-accent focus:border-c-accent'
const BTN =
  'px-3 py-1.5 text-sm rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover transition-colors disabled:opacity-50'
const ICON_BTN = 'p-1 text-c-text-muted hover:text-c-text-strong transition-colors rounded'

function Section({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="mb-8">
      <h3 className="text-sm font-bold text-c-text-strong mb-1">{title}</h3>
      {note && <p className="text-xs text-c-text-muted mb-2">{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

/** 横に並べる択一ボタン */
function Choice<T extends string | number>(props: {
  value: T
  options: { key: T; name: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {props.options.map((o) => {
        const active = o.key === props.value
        return (
          <button
            key={String(o.key)}
            type="button"
            onClick={() => props.onChange(o.key)}
            className={`px-3 py-1.5 text-sm border transition-colors rounded-[var(--chip-radius)] ${
              active
                ? 'border-c-accent text-c-accent bg-[var(--c-accent-wash)]'
                : 'border-c-border text-c-text-body hover:border-c-border-strong'
            }`}
          >
            {o.name}
          </button>
        )
      })}
    </div>
  )
}

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; note?: string }) {
  return (
    <label className="flex items-start gap-3 py-1.5 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        onClick={() => props.onChange(!props.checked)}
        className={`relative mt-0.5 w-11 h-6 rounded-full flex-shrink-0 transition-all shadow-inner ${props.checked ? 'bg-c-accent' : 'bg-c-border-strong'}`}
      >
        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm ${props.checked ? 'right-1' : 'left-1'}`} />
      </button>
      <span>
        <span className="text-sm text-c-text-body">{props.label}</span>
        {props.note && <span className="block text-xs text-c-text-muted">{props.note}</span>}
      </span>
    </label>
  )
}

/** OS に入っているフォントから選ぶ。各行をそのフォント自体で描くので、見た目を比べられる */
function SystemFontPicker({ value, onPick }: { value: string; onPick: (family: string) => void }) {
  const [fonts, setFonts] = useState<SystemFont[]>()
  const [query, setQuery] = useState('')
  const [japaneseOnly, setJapaneseOnly] = useState(true)
  const [message, setMessage] = useState<string>()

  useEffect(() => {
    loadSystemFonts().then(setFonts, (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)))
  }, [])

  const q = query.trim().toLowerCase()
  const shown = (fonts ?? []).filter(
    (f) =>
      (!japaneseOnly || f.localName) &&
      (!q || f.family.toLowerCase().includes(q) || (f.localName ?? '').toLowerCase().includes(q)),
  )

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3 mb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="フォント名で絞り込む"
          className={`${INPUT} flex-1`}
        />
        <label className="flex items-center gap-1.5 text-sm text-c-text-body select-none whitespace-nowrap">
          <input type="checkbox" checked={japaneseOnly} onChange={(e) => setJapaneseOnly(e.target.checked)} className="rounded" />
          日本語フォントだけ
        </label>
      </div>
      {message && <p className="text-sm text-c-heat-very-hot mb-2">{message}</p>}
      <div className="max-h-64 overflow-y-auto custom-scrollbar border border-c-border rounded-[var(--card-radius)] divide-y divide-c-border">
        {!fonts && !message && <p className="px-3 py-2 text-sm text-c-text-muted">フォントを探しています...</p>}
        {shown.map((f) => {
          const active = f.family === value
          return (
            <button
              key={f.family}
              type="button"
              onClick={() => onPick(f.family)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-c-surface2 ${active ? 'bg-[var(--c-accent-wash)]' : ''}`}
            >
              <span className="flex-1 min-w-0 truncate text-base text-c-text-body" style={{ fontFamily: `'${f.family}'` }}>
                {f.localName ?? f.family} あア亜 Aa1
              </span>
              <span className="text-xs text-c-text-muted truncate max-w-[40%]">{f.family}</span>
              {active && <span className="material-symbols-outlined text-base text-c-accent">check</span>}
            </button>
          )
        })}
        {fonts && shown.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">見つかりません</p>}
      </div>
    </div>
  )
}

function DisplayTab({ settings: s, update }: Pick<Props, 'settings' | 'update'>) {
  return (
    <>
      <Section title="テーマ">
        <div className="grid grid-cols-2 gap-2">
          {COLOR_SCHEMES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => update('scheme', c.key)}
              className={`flex items-center gap-2.5 px-3 py-2 text-sm border rounded-[var(--card-radius)] transition-colors ${
                s.scheme === c.key ? 'border-c-accent text-c-text-strong' : 'border-c-border text-c-text-body hover:border-c-border-strong'
              }`}
            >
              <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: c.accent, boxShadow: `inset 0 0 0 1px ${c.border}` }} />
              {c.name}
            </button>
          ))}
        </div>
      </Section>
      <Section title="フォント">
        <Choice
          value={s.fontFamily}
          options={[...FONT_FAMILIES, { key: 'custom' as const, name: s.customFont ? `OS のフォント(${s.customFont})` : 'OS のフォント' }]}
          onChange={(v) => update('fontFamily', v)}
        />
        {s.fontFamily === 'custom' && (
          <SystemFontPicker
            value={s.customFont}
            onPick={(family) => {
              update('customFont', family)
              update('fontFamily', 'custom')
            }}
          />
        )}
        <p className="mt-3 p-3 text-base text-c-text-body bg-c-surface2 rounded-[var(--card-radius)]">
          あのイーハトーヴォのすきとおった風、0123456789 ABCabc
        </p>
      </Section>
      <Section title="文字サイズ">
        <Choice
          value={s.fontSize}
          options={([1, 2, 3, 4, 5] as FontSize[]).map((n) => ({ key: n, name: ['極小', '小', '標準', '大', '特大'][n - 1] }))}
          onChange={(v) => update('fontSize', v)}
        />
      </Section>
      <Section title="密度" note="高密度は余白を詰めた専ブラ風の表示です">
        <Choice
          value={s.density}
          options={[
            { key: 'list', name: '一覧表示' },
            { key: 'dense', name: '高密度' },
          ]}
          onChange={(v) => update('density', v)}
        />
      </Section>
      <Section title="枠線スタイル">
        <Choice
          value={s.pattern}
          options={[
            { key: 'tonal', name: 'トーナルカード' },
            { key: 'bordered', name: '枠線' },
          ]}
          onChange={(v) => update('pattern', v)}
        />
      </Section>
    </>
  )
}

function ThreadsTab({ settings: s, update, favorites }: Pick<Props, 'settings' | 'update' | 'favorites'>) {
  return (
    <>
      <Section title="最初の並び順" note="板を開いたときの並び順です。スレ一覧のタブでその場で変えられます">
        <Choice
          value={s.threadSort}
          options={[
            { key: 'subject', name: 'サーバーの順(更新順)' },
            { key: 'momentum', name: '勢い順' },
            { key: 'newest', name: '新しい順' },
          ]}
          onChange={(v) => update('threadSort', v)}
        />
      </Section>
      <Section title="タブ" note="Ctrl+W で閉じる、Ctrl+Tab で切り替え。開いていたタブは次の起動で戻ります">
        <Toggle
          checked={s.openInNewTab}
          onChange={(v) => update('openInNewTab', v)}
          label="スレ一覧から開くときは新しいタブで開く"
          note="オフにすると、いま見ているタブを置き換えます"
        />
      </Section>
      <Section title="起動時に開く板" note="前回開いていた板か、お気に入りの板から選べます">
        <select
          value={s.startupBoardUrl}
          onChange={(e) => update('startupBoardUrl', e.target.value)}
          className={`${INPUT} w-72`}
        >
          <option value="@last">前回開いていた板</option>
          <option value="">開かない</option>
          {favorites.map((b) => (
            <option key={b.url} value={b.url}>
              {b.name}
            </option>
          ))}
        </select>
      </Section>
    </>
  )
}

function PostsTab({ settings: s, update }: Pick<Props, 'settings' | 'update'>) {
  return (
    <>
      <Section title="スレを開いたときの位置">
        <Choice
          value={s.openPosition}
          options={[
            { key: 'unread', name: '最初の未読' },
            { key: 'top', name: '先頭' },
            { key: 'bottom', name: '末尾' },
          ]}
          onChange={(v) => update('openPosition', v)}
        />
      </Section>
      <Section title="アンカー(>>1)のポップアップ" note="レス番号と ID は押すと一覧が出ます">
        <Choice
          value={s.anchorPopup}
          options={[
            { key: 'hover', name: 'マウスを乗せたら出す' },
            { key: 'click', name: '押したら出す' },
          ]}
          onChange={(v) => update('anchorPopup', v)}
        />
      </Section>
      <Section title="本文">
        <Toggle
          checked={s.showThumbnails}
          onChange={(v) => update('showThumbnails', v)}
          label="画像のサムネイルを出す"
          note="本文中の画像 URL(jpg・png・gif・webp)を小さく表示します"
        />
        <Toggle
          checked={s.showMinimap}
          onChange={(v) => update('showMinimap', v)}
          label="ミニマップを出す"
          note="スレ表示の右端に、人気レス・自分のレス・画像の位置と、未読の始まりを示します"
        />
        <Toggle
          checked={s.aaAutoDetect}
          onChange={(v) => update('aaAutoDetect', v)}
          label="AA を自動で見分ける"
          note="空白が続く本文を AA 用のフォントで表示します。レスの ⋯ から個別に切り替えられます"
        />
      </Section>
    </>
  )
}

function RefreshTab({ settings: s, update }: Pick<Props, 'settings' | 'update'>) {
  return (
    <>
      <Section title="開いているスレの自動更新" note="実況板など、流れの速いスレ向けです。差分だけを取りに行きます">
        <Choice
          value={s.autoRefreshSec}
          options={[0, 5, 10, 20, 30, 60].map((n) => ({ key: n, name: n === 0 ? 'しない' : `${n} 秒` }))}
          onChange={(v) => update('autoRefreshSec', v)}
        />
      </Section>
      <Section title="新着">
        <Toggle
          checked={s.autoScrollOnNew}
          onChange={(v) => update('autoScrollOnNew', v)}
          label="いちばん下を見ているときは、新着まで自動でスクロールする"
        />
      </Section>
    </>
  )
}

function NgTab({ settings: s, update }: Pick<Props, 'settings' | 'update'>) {
  const [target, setTarget] = useState<NgTarget>('content')
  const [pattern, setPattern] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const valid = isValidPattern(pattern, isRegex)
  const rules = s.ngRules

  return (
    <>
      <Section title="NG に当たったレスの扱い">
        <Choice
          value={s.ngMode}
          options={[
            { key: 'aborn', name: '「あぼーん」と出す' },
            { key: 'hide', name: '何も出さない(透明あぼーん)' },
          ]}
          onChange={(v) => update('ngMode', v)}
        />
      </Section>
      <Section title="NG を追加" note="ID は完全一致、それ以外は部分一致です。レスの ⋯ からも追加できます">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid) return
            update('ngRules', [...rules, newRule(target, pattern, { isRegex })])
            setPattern('')
          }}
        >
          <select value={target} onChange={(e) => setTarget(e.target.value as NgTarget)} className={INPUT}>
            {NG_TARGETS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={isRegex ? '正規表現' : '言葉'}
            className={`${INPUT} flex-1 min-w-48 ${pattern && !valid ? 'border-c-heat-very-hot' : ''}`}
          />
          <label className="flex items-center gap-1.5 text-sm text-c-text-body">
            <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)} className="rounded" />
            正規表現
          </label>
          <button type="submit" className={BTN} disabled={!valid}>
            追加
          </button>
        </form>
      </Section>
      <Section title={`登録済み (${rules.length})`}>
        {rules.length === 0 ? (
          <p className="text-sm text-c-text-muted">まだありません</p>
        ) : (
          <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)]">
            {rules.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => update('ngRules', rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))}
                  className="rounded"
                  title="有効"
                />
                <span className="w-14 flex-shrink-0 text-xs text-c-text-muted">{NG_TARGETS.find((t) => t.key === r.target)?.name}</span>
                <span className={`flex-1 min-w-0 truncate ${r.isRegex ? 'font-mono' : ''} ${r.enabled ? 'text-c-text-body' : 'text-c-text-muted line-through'}`}>
                  {r.pattern}
                </span>
                {r.isRegex && <span className="text-[10px] text-c-text-muted">正規表現</span>}
                {r.expiresOnDate && <span className="text-[10px] text-c-text-muted">{r.expiresOnDate} まで</span>}
                <button
                  type="button"
                  className={ICON_BTN}
                  title="削除"
                  onClick={() => update('ngRules', rules.filter((x) => x.id !== r.id))}
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  )
}

/** BBS メニューから板を選ぶ。名前で絞り込み、☆で登録・解除する */
function BoardPicker(props: {
  site: SiteConfig
  favorites: Board[]
  loadBoards: Props['loadBoards']
  onToggleFavorite: Props['onToggleFavorite']
}) {
  const [boards, setBoards] = useState<Board[]>()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const favoriteUrls = useMemo(() => new Set(props.favorites.map((b) => b.url)), [props.favorites])

  const load = async (refresh: boolean) => {
    setBusy(true)
    setMessage(undefined)
    try {
      setBoards(await props.loadBoards(props.site, refresh))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  // 開いたときは保存してある板一覧を出す(なければ取りに行く)
  useEffect(() => {
    void load(false)
    // 開いたときに一度だけ読む
  }, [])

  const q = query.trim()
  const shown = (boards ?? []).filter((b) => !q || b.name.includes(q) || (b.category ?? '').includes(q))

  return (
    <div className="px-3 pb-3">
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="板の名前やカテゴリで絞り込む"
          autoFocus
          className={`${INPUT} flex-1`}
        />
        <button type="button" className={ICON_BTN} title="板一覧を取り直す" onClick={() => void load(true)}>
          <span className={`material-symbols-outlined text-lg ${busy ? 'animate-spin' : ''}`}>refresh</span>
        </button>
      </div>
      {message && <p className="text-sm text-c-heat-very-hot mb-2">{message}</p>}
      <div className="max-h-72 overflow-y-auto custom-scrollbar border border-c-border rounded-[var(--card-radius)] divide-y divide-c-border">
        {shown.slice(0, 300).map((b) => {
          const fav = favoriteUrls.has(b.url)
          return (
            <button
              key={b.url}
              type="button"
              onClick={() => props.onToggleFavorite(b)}
              className="w-full flex items-center gap-3 px-3 py-1.5 text-sm text-left hover:bg-c-surface2"
            >
              <span className={`material-symbols-outlined text-lg ${fav ? 'fill text-c-heat-warm' : 'text-c-text-muted'}`}>star</span>
              <span className="text-c-text-body">{b.name}</span>
              <span className="ml-auto text-xs text-c-text-muted truncate">{b.category}</span>
            </button>
          )
        })}
        {boards && shown.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">見つかりません</p>}
        {!boards && busy && <p className="px-3 py-2 text-sm text-c-text-muted">読み込み中...</p>}
      </div>
      {shown.length > 300 && <p className="mt-1 text-xs text-c-text-muted">先頭の 300 件だけ出しています。絞り込んでください</p>}
    </div>
  )
}

function BoardsTab(
  props: Pick<
    Props,
    'favorites' | 'sites' | 'onAddFavoriteUrl' | 'onRemoveFavorite' | 'onAddSite' | 'onRemoveSite' | 'loadBoards' | 'onToggleFavorite'
  >,
) {
  const [favUrl, setFavUrl] = useState('')
  const [siteName, setSiteName] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [picking, setPicking] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMessage(undefined)
    try {
      await fn()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Section title="お気に入り板" note="サイドバーの「お気に入り」に並ぶ板です。下の BBS メニューから選ぶか、板の URL を貼って登録します">
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)] mb-3">
          {props.favorites.map((b) => (
            <div key={b.url} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="text-c-text-strong">{b.name}</span>
              <span className="flex-1 min-w-0 truncate text-xs text-c-text-muted">{b.url}</span>
              <button type="button" className={ICON_BTN} title="外す" onClick={() => props.onRemoveFavorite(b.url)}>
                <span className="material-symbols-outlined text-base">delete</span>
              </button>
            </div>
          ))}
          {props.favorites.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">まだありません</p>}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!favUrl.trim()) return
            void act(async () => {
              await props.onAddFavoriteUrl(favUrl.trim())
              setFavUrl('')
            })
          }}
        >
          <input
            type="text"
            value={favUrl}
            onChange={(e) => setFavUrl(e.target.value)}
            placeholder="板の URL(例: https://bbs.eddibb.cc/liveedge)"
            className={`${INPUT} flex-1`}
          />
          <button type="submit" className={BTN} disabled={busy || !favUrl.trim()}>
            追加
          </button>
        </form>
      </Section>

      <Section title="BBS メニュー" note="掲示板の板一覧(bbsmenu.html か bbsmenu.json)です。「板を選ぶ」から、お気に入りに登録する板を探せます">
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)] mb-3">
          {props.sites.map((s) => (
            <div key={s.menuUrl}>
              <div className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="text-c-text-strong">{s.name}</span>
                <span className="flex-1 min-w-0 truncate text-xs text-c-text-muted">{s.menuUrl}</span>
                <button
                  type="button"
                  onClick={() => setPicking((p) => (p === s.menuUrl ? undefined : s.menuUrl))}
                  className={`px-2 py-0.5 text-xs border rounded-[var(--btn-radius)] transition-colors ${
                    picking === s.menuUrl ? 'border-c-accent text-c-accent' : 'border-c-border text-c-text-body hover:border-c-border-strong'
                  }`}
                >
                  板を選ぶ
                </button>
                <button type="button" className={ICON_BTN} title="削除" onClick={() => props.onRemoveSite(s.menuUrl)}>
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
              {picking === s.menuUrl && (
                <BoardPicker site={s} favorites={props.favorites} loadBoards={props.loadBoards} onToggleFavorite={props.onToggleFavorite} />
              )}
            </div>
          ))}
          {props.sites.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">まだありません</p>}
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!siteUrl.trim()) return
            void act(async () => {
              await props.onAddSite(siteName.trim(), siteUrl.trim())
              setSiteName('')
              setSiteUrl('')
            })
          }}
        >
          <input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="名前(省略可)" className={`${INPUT} w-36`} />
          <input type="text" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="bbsmenu の URL" className={`${INPUT} flex-1 min-w-48`} />
          <button type="submit" className={BTN} disabled={busy || !siteUrl.trim()}>
            追加
          </button>
        </form>
      </Section>
      {message && <p className="text-sm text-c-heat-very-hot">{message}</p>}
    </>
  )
}

function AboutTab() {
  return (
    <>
      <Section title="bbs-browser 0.1.0">
        <p className="text-sm text-c-text-body leading-relaxed">
          コネクタで掲示板を読む専用ブラウザです。いまは 2ch 互換(5ch・eddibb・eddist・hono-bbs など)を読めます。
        </p>
      </Section>
      <Section title="データの保存場所">
        <p className="text-sm font-mono text-c-text-body break-all">%APPDATA%\io.github.yumekui8.bbs-browser\bbs-browser.db</p>
        <p className="text-xs text-c-text-muted mt-1">ログ・既読位置・設定はすべてこのファイルに入っています</p>
      </Section>
    </>
  )
}

export default function SettingsDialog(props: Props) {
  const [tab, setTab] = useState<Tab>(props.initialTab ?? 'display')

  return (
    <div className="fixed inset-0 z-[9500] bg-black/50 flex items-center justify-center p-6" onClick={props.onClose}>
      <div
        className="w-full max-w-4xl h-full max-h-[720px] flex bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-2xl overflow-hidden rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="w-52 flex-shrink-0 bg-c-surface2 border-r border-c-border py-3">
          <h2 className="px-5 pb-3 text-lg font-bold text-c-text-strong">設定</h2>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`w-full flex items-center gap-3 px-5 py-2 text-sm transition-colors ${
                tab === t.key ? 'active-board text-c-text-strong' : 'text-c-text-body hover:bg-c-surface3'
              }`}
            >
              <span className={`material-symbols-outlined text-lg ${tab === t.key ? 'fill' : ''}`}>{t.icon}</span>
              {t.name}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center justify-between px-6 py-3 border-b border-c-border">
            <h3 className="text-base font-bold text-c-text-strong">{TABS.find((t) => t.key === tab)?.name}</h3>
            <button type="button" onClick={props.onClose} className={ICON_BTN} title="閉じる">
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
            {tab === 'display' && <DisplayTab {...props} />}
            {tab === 'threads' && <ThreadsTab {...props} />}
            {tab === 'posts' && <PostsTab {...props} />}
            {tab === 'refresh' && <RefreshTab {...props} />}
            {tab === 'ng' && <NgTab {...props} />}
            {tab === 'boards' && <BoardsTab {...props} />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  )
}
