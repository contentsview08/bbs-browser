// 設定画面。左に分類、右に中身。変更はその場で反映・保存する(「保存」ボタンはない)。

import { useState, type ReactNode } from 'react'
import type { Board, SiteConfig } from '@bbs-browser/connectors'
import {
  COLOR_SCHEMES,
  FONT_FAMILIES,
  type AppSettings,
  type FontSize,
  type UpdateSetting,
} from '../ui/settings'
import { NG_TARGETS, isValidPattern, newRule, type NgTarget } from '../utils/ng'

interface Props {
  settings: AppSettings
  update: UpdateSetting
  favorites: Board[]
  sites: SiteConfig[]
  onAddFavoriteUrl: (url: string) => Promise<void>
  onRemoveFavorite: (url: string) => void
  onAddSite: (name: string, menuUrl: string) => Promise<void>
  onRemoveSite: (menuUrl: string) => void
  onClose: () => void
}

type Tab = 'display' | 'threads' | 'posts' | 'refresh' | 'ng' | 'boards' | 'about'

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
        className={`relative mt-0.5 w-9 h-5 rounded-full flex-shrink-0 transition-colors ${props.checked ? 'bg-c-accent' : 'bg-c-border-strong'}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${props.checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
      <span>
        <span className="text-sm text-c-text-body">{props.label}</span>
        {props.note && <span className="block text-xs text-c-text-muted">{props.note}</span>}
      </span>
    </label>
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
        <Choice value={s.fontFamily} options={FONT_FAMILIES} onChange={(v) => update('fontFamily', v)} />
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
      <Section title="起動時に開く板" note="お気に入りの板から選べます">
        <select
          value={s.startupBoardUrl}
          onChange={(e) => update('startupBoardUrl', e.target.value)}
          className={`${INPUT} w-72`}
        >
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

function BoardsTab(props: Pick<Props, 'favorites' | 'sites' | 'onAddFavoriteUrl' | 'onRemoveFavorite' | 'onAddSite' | 'onRemoveSite'>) {
  const [favUrl, setFavUrl] = useState('')
  const [siteName, setSiteName] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
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
      <Section title="お気に入り板" note="板の URL を貼ると登録できます(例: https://bbs.eddibb.cc/liveedge)。板一覧を公開していない掲示板もここから読めます">
        <form
          className="flex gap-2 mb-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!favUrl.trim()) return
            void act(async () => {
              await props.onAddFavoriteUrl(favUrl.trim())
              setFavUrl('')
            })
          }}
        >
          <input type="text" value={favUrl} onChange={(e) => setFavUrl(e.target.value)} placeholder="板の URL" className={`${INPUT} flex-1`} />
          <button type="submit" className={BTN} disabled={busy || !favUrl.trim()}>
            追加
          </button>
        </form>
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)]">
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
      </Section>

      <Section title="サイト(板一覧の取得元)" note="bbsmenu.html か bbsmenu.json の URL を登録すると、左の一覧に板が並びます">
        <form
          className="flex flex-wrap gap-2 mb-3"
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
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)]">
          {props.sites.map((s) => (
            <div key={s.menuUrl} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="text-c-text-strong">{s.name}</span>
              <span className="flex-1 min-w-0 truncate text-xs text-c-text-muted">{s.menuUrl}</span>
              <button type="button" className={ICON_BTN} title="削除" onClick={() => props.onRemoveSite(s.menuUrl)}>
                <span className="material-symbols-outlined text-base">delete</span>
              </button>
            </div>
          ))}
        </div>
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
  const [tab, setTab] = useState<Tab>('display')

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
