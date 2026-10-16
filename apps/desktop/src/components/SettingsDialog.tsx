// 設定画面。左に分類、右に中身。変更はその場で反映・保存する(「保存」ボタンはない)。

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { builtinConnectors, type AccountKind, type Board, type LoginResult, type SiteConfig } from '@bbs-browser/connectors'
import type { AccountRecord } from '@bbs-browser/logstore'
import {
  COLOR_SCHEMES,
  DEFAULT_SETTINGS,
  FONT_FAMILIES,
  PANELS,
  type AppSettings,
  type FontSize,
  type UpdateSetting,
} from '../ui/settings'
import { isValidPattern, newRule, todayDateString, type NgTarget } from '../utils/ng'
import { loadSystemFonts, type SystemFont } from '../host/systemFonts'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { backgroundImageUrl, importBackgroundImage } from '../host/backgroundImage'
import BoardIcon from './BoardIcon'
import type { BoardMeta } from '../ui/settings'
import { importableSettings, mergeNgRules, ngFile, parseBackup, settingsFile } from '../utils/backup'
import { openJson, saveJson } from '../host/backup'
import { DEFAULT_KEYMAP, KEY_ACTIONS, keyLabel, keyString, resolveKeymap, type KeyAction, type Keymap } from '../utils/keymap'

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
  /** 板一覧でダブルクリックした板を開く(設定は閉じる) */
  onOpenBoard: (board: Board) => void
  /** サイトのアカウント(保存してあるもの)と、ログインの状態 */
  accounts: AccountRecord[]
  loginStatus: Map<string, LoginResult>
  /** 保存してログインする */
  onLogin: (a: AccountRecord) => Promise<LoginResult>
  onDeleteAccount: (connectorId: string, accountId: string) => void
  /** DB 全体(ログ・設定・NG・履歴)を書き出す。保存先を選ばなかったら false */
  onBackupDb: () => Promise<boolean>
  /** 書き出しておいた DB に入れ替える(アプリを起動し直す) */
  onRestoreDb: () => Promise<boolean>
  /** 最初に開く分類 */
  initialTab?: SettingsTab
  onClose: () => void
}

export type SettingsTab = 'display' | 'threads' | 'posts' | 'write' | 'refresh' | 'keys' | 'ng' | 'boardlist' | 'boards' | 'accounts' | 'backup' | 'about'
type Tab = SettingsTab

const TABS: { key: Tab; name: string; icon: string }[] = [
  { key: 'display', name: '表示', icon: 'palette' },
  { key: 'threads', name: 'スレッド一覧', icon: 'view_list' },
  { key: 'posts', name: 'レス表示', icon: 'forum' },
  { key: 'write', name: '書き込み', icon: 'edit' },
  { key: 'refresh', name: '自動更新', icon: 'autorenew' },
  { key: 'keys', name: 'キー操作', icon: 'keyboard' },
  { key: 'ng', name: 'NG', icon: 'block' },
  { key: 'boardlist', name: '板一覧', icon: 'list_alt' },
  { key: 'boards', name: '板とサイト', icon: 'dns' },
  { key: 'accounts', name: 'アカウント', icon: 'badge' },
  { key: 'backup', name: 'バックアップ', icon: 'backup' },
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
      <Section title="背景画像" note="パネルの後ろに置きます。下の「パネルの不透明度」でパネルを透かすと見えます。選んだ画像はアプリのフォルダにコピーして使います">
        <div className="flex items-center gap-3">
          <div
            className="w-24 h-16 flex-shrink-0 rounded-[var(--card-radius)] border border-c-border bg-c-surface2 bg-cover bg-center"
            style={s.backgroundImage ? { backgroundImage: `url("${backgroundImageUrl(s.backgroundImage)}")` } : undefined}
          />
          <div className="flex-1 space-y-2">
            <div className="flex gap-2">
              <button
                type="button"
                className={BTN}
                onClick={async () => {
                  const file = await openDialog({
                    title: '背景画像を選ぶ',
                    filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
                  })
                  if (typeof file === 'string') update('backgroundImage', await importBackgroundImage(file))
                }}
              >
                画像を選ぶ
              </button>
              {s.backgroundImage && (
                <button type="button" className="px-3 py-1.5 text-sm text-c-text-muted hover:text-c-text-strong" onClick={() => update('backgroundImage', '')}>
                  外す
                </button>
              )}
            </div>
            <label className="flex items-center gap-3 text-sm text-c-text-body">
              <span className="w-12 flex-shrink-0">濃さ</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(s.backgroundOpacity * 100)}
                onChange={(e) => update('backgroundOpacity', Number(e.target.value) / 100)}
                className="flex-1"
                disabled={!s.backgroundImage}
              />
              <span className="w-10 text-right tabular-nums text-c-text-muted">{Math.round(s.backgroundOpacity * 100)}%</span>
            </label>
          </div>
        </div>
      </Section>
      <Section title="サイドバー">
        <Toggle
          checked={s.showStripNames}
          onChange={(v) => update('showStripNames', v)}
          label="しまったサイドバーに板名を出す"
          note="お気に入り板のアイコンの下に、板名を小さく出します(別名があれば別名)"
        />
      </Section>
      <Section title="パネルの不透明度" note="パネルの背景色だけを透かします(文字は透けません)。背景画像と組み合わせて使います">
        <div className="space-y-1.5">
          {PANELS.map((p) => {
            const v = s.panelAlpha[p.key] ?? 1
            return (
              <label key={p.key} className="flex items-center gap-3 text-sm text-c-text-body">
                <span className="w-56 flex-shrink-0 truncate">{p.name}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(v * 100)}
                  onChange={(e) => update('panelAlpha', { ...s.panelAlpha, [p.key]: Number(e.target.value) / 100 })}
                  className="flex-1"
                />
                <span className="w-10 text-right tabular-nums text-c-text-muted">{Math.round(v * 100)}%</span>
              </label>
            )
          })}
        </div>
        <button
          type="button"
          className="mt-2 text-xs text-c-text-muted hover:text-c-accent"
          onClick={() =>
            update('panelAlpha', { addressBar: 1, sidebar: 1, tabs: 1, threadList: 1, threadHeader: 1, threadView: 1, replyForm: 1 })
          }
        >
          すべて 100% に戻す
        </button>
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
  const [keyword, setKeyword] = useState('')
  const addKeyword = () => {
    const k = keyword.trim()
    if (!k || s.keywords.includes(k)) return
    update('keywords', [...s.keywords, k])
    setKeyword('')
  }
  return (
    <>
      <Section title="更新">
        <Toggle
          checked={s.pullToRefreshList}
          onChange={(v) => update('pullToRefreshList', v)}
          label="一番上でさらにホイールを上に回したら、スレ一覧を更新する"
          note="一番上に着いてから少し待って、さらに大きく回したときだけ更新します。一度更新したら 10 秒はしません。切っても、更新ボタンでは更新できます"
        />
      </Section>
      <Section
        title="キーワード"
        note="スレタイに含むスレを、スレ一覧の上にキーワードの帯をつけてまとめます。上に並んでいるキーワードほど先に出ます"
      >
        <form
          className="flex gap-2 mb-2"
          onSubmit={(e) => {
            e.preventDefault()
            addKeyword()
          }}
        >
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="例: 実況" className={`${INPUT} flex-1`} />
          <button type="submit" className={BTN} disabled={!keyword.trim()}>
            追加
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          {s.keywords.map((k) => (
            <span
              key={k}
              className="flex items-center gap-1 pl-2.5 pr-1 py-0.5 text-sm text-c-accent border border-c-accent rounded-[var(--chip-radius)]"
              style={{ background: 'var(--c-accent-wash)' }}
            >
              {k}
              <button
                type="button"
                className="p-0.5 rounded-full hover:bg-c-surface2"
                title="外す"
                onClick={() => update('keywords', s.keywords.filter((x) => x !== k))}
              >
                <span className="material-symbols-outlined text-sm leading-none">close</span>
              </button>
            </span>
          ))}
          {s.keywords.length === 0 && <p className="text-sm text-c-text-muted">まだありません</p>}
        </div>
      </Section>
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
          checked={s.tabsEnabled}
          onChange={(v) => update('tabsEnabled', v)}
          label="タブを使う"
          note="オフにすると、タブ列を出さず、スレを開くたびに今のスレを置き換えます(開いているスレ以外のタブは閉じます)"
        />
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
            { key: 'click', name: '押したら出す' },
            { key: 'hover', name: 'マウスを乗せたら出す' },
          ]}
          onChange={(v) => update('anchorPopup', v)}
        />
      </Section>
      <Section title="画像の保存先" note="画像ビューワーの保存ボタンで、ここへ保存します。空のときはダウンロードフォルダです">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={s.imageSaveDir}
            onChange={(e) => update('imageSaveDir', e.target.value)}
            placeholder="ダウンロードフォルダ"
            className={`${INPUT} flex-1`}
          />
          <button
            type="button"
            className={BTN}
            onClick={async () => {
              const dir = await openDialog({ directory: true, title: '画像の保存先を選ぶ' })
              if (typeof dir === 'string') update('imageSaveDir', dir)
            }}
          >
            フォルダを選ぶ
          </button>
          {s.imageSaveDir && (
            <button type="button" className={ICON_BTN} title="ダウンロードフォルダに戻す" onClick={() => update('imageSaveDir', '')}>
              <span className="material-symbols-outlined text-base">restart_alt</span>
            </button>
          )}
        </div>
      </Section>
      <Section title="レスの見せ方">
        <Toggle
          checked={s.omitNoname}
          onChange={(v) => update('omitNoname', v)}
          label="名無しの名前を省く"
          note="名前が板の既定の名前(「名無しさん」など)なら省きます。後ろのトリップなどは残します"
        />
        <Toggle
          checked={s.collapseBlankLines}
          onChange={(v) => update('collapseBlankLines', v)}
          label="3 行以上続く空行を 1 行にまとめる"
        />
        <Toggle checked={s.trimTrailingBlank} onChange={(v) => update('trimTrailingBlank', v)} label="本文の最後の空行を消す" />
        <Toggle
          checked={s.highlightOp}
          onChange={(v) => update('highlightOp', v)}
          label="スレ主を強調する"
          note=">>1 と同じ ID の書き込みに「主」の印を付けます(ID のない板では付きません)"
        />
      </Section>
      <Section title="本文">
        <Toggle
          checked={s.showLinkPreview}
          onChange={(v) => update('showLinkPreview', v)}
          label="リンクの埋め込みを出す"
          note="画像でも動画でもないリンクに、ページのタイトル・説明・画像のカードを出します(画面に見えたときにページを取りに行きます)"
        />
        <Toggle
          checked={s.showThumbnails}
          onChange={(v) => update('showThumbnails', v)}
          label="画像のサムネイルを出す"
          note="本文中の画像 URL(jpg・png・gif・webp)を小さく表示します"
        />
        <Toggle
          checked={s.showIdenticon}
          onChange={(v) => update('showIdenticon', v)}
          label="ID のアイコンを出す"
          note="ID から作る GitHub 風の模様を、レス番号の左に出します(同じ ID はいつも同じ模様)。右下の数字はその ID の書き込み数です"
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

/** 操作バーに並べられるもの(定型文はこのほかに 1 つずつ) */
const TOOLBAR_ITEMS: { key: string; name: string; icon: string }[] = [
  { key: 'reply', name: '返信', icon: 'reply' },
  { key: 'copy', name: 'コピー', icon: 'content_copy' },
  { key: 'ng', name: 'NG に追加', icon: 'block' },
  { key: 'tree', name: 'アンカーツリー', icon: 'account_tree' },
]

/** userhash の入力欄。ふだんは伏せて、目のボタンで見られるようにする */
function UserhashInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <input
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="登録しない(匿名で上げる)"
        autoComplete="off"
        spellCheck={false}
        className={`${INPUT} flex-1 font-mono`}
      />
      <button type="button" className={ICON_BTN} title={shown ? '伏せる' : '見る'} onClick={() => setShown((v) => !v)}>
        <span className="material-symbols-outlined text-base">{shown ? 'visibility_off' : 'visibility'}</span>
      </button>
    </div>
  )
}

function WriteTab({ settings: s, update }: Pick<Props, 'settings' | 'update'>) {
  const [phrase, setPhrase] = useState('')
  const addPhrase = () => {
    const p = phrase.trim()
    if (!p || s.quickPhrases.includes(p)) return
    update('quickPhrases', [...s.quickPhrases, p])
    setPhrase('')
  }
  const removePhrase = (p: string) => {
    update('quickPhrases', s.quickPhrases.filter((x) => x !== p))
    update('postToolbar', s.postToolbar.filter((x) => x !== `phrase:${p}`))
  }
  // 並べられるもの全部(いま並べているものを先に、並びのとおりに)
  const all = [
    ...TOOLBAR_ITEMS,
    ...s.quickPhrases.map((p) => ({ key: `phrase:${p}`, name: `定型文「${p}」`, icon: 'bolt' })),
  ]
  const shown = s.postToolbar.filter((k) => all.some((a) => a.key === k))
  const ordered = [...shown.map((k) => all.find((a) => a.key === k)!), ...all.filter((a) => !shown.includes(a.key))]
  const move = (key: string, d: number) => {
    const i = shown.indexOf(key)
    const j = i + d
    if (i < 0 || j < 0 || j >= shown.length) return
    const next = [...shown]
    ;[next[i], next[j]] = [next[j], next[i]]
    update('postToolbar', next)
  }
  return (
    <>
      <Section title="定型文" note="レスの操作バーや ⋯ から、そのレスへのアンカーを付けて、押すとすぐ書き込みます">
        <form
          className="flex gap-2 mb-2"
          onSubmit={(e) => {
            e.preventDefault()
            addPhrase()
          }}
        >
          <input type="text" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="例: ワロタ" className={`${INPUT} flex-1`} />
          <button type="submit" className={BTN} disabled={!phrase.trim()}>
            追加
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          {s.quickPhrases.map((p) => (
            <span key={p} className="flex items-center gap-1 pl-2.5 pr-1 py-0.5 text-sm text-c-text-body border border-c-border rounded-[var(--chip-radius)]">
              {p}
              <button type="button" className="p-0.5 rounded-full hover:bg-c-surface2" title="外す" onClick={() => removePhrase(p)}>
                <span className="material-symbols-outlined text-sm leading-none">close</span>
              </button>
            </span>
          ))}
          {s.quickPhrases.length === 0 && <p className="text-sm text-c-text-muted">まだありません</p>}
        </div>
      </Section>

      <Section title="レスの操作バー" note="レスにマウスを乗せたとき右上に出すボタンです。チェックしたものを、上から順に左から並べます(⋯ はいつも一番右)">
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)]">
          {ordered.map((item) => {
            const on = shown.includes(item.key)
            return (
              <div key={item.key} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => update('postToolbar', e.target.checked ? [...shown, item.key] : shown.filter((k) => k !== item.key))}
                />
                <span className="material-symbols-outlined text-base text-c-text-muted">{item.icon}</span>
                <span className={`flex-1 ${on ? 'text-c-text-body' : 'text-c-text-muted'}`}>{item.name}</span>
                {on && (
                  <>
                    <button type="button" className={ICON_BTN} title="左へ" onClick={() => move(item.key, -1)}>
                      <span className="material-symbols-outlined text-base">arrow_upward</span>
                    </button>
                    <button type="button" className={ICON_BTN} title="右へ" onClick={() => move(item.key, 1)}>
                      <span className="material-symbols-outlined text-base">arrow_downward</span>
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </Section>
      <Section
        title="画像のアップロード(catbox.moe)"
        note="書き込み欄のボタン・貼り付け・ドラッグで画像や動画を catbox.moe に上げ、本文に URL を入れます"
      >
        <Toggle checked={s.uploaderEnabled} onChange={(v) => update('uploaderEnabled', v)} label="画像のアップロードを使う" />
        <Toggle
          checked={s.uploadStripMetadata}
          onChange={(v) => update('uploadStripMetadata', v)}
          label="上げる前に、画像の位置情報など(EXIF)を消す"
          note="JPEG・PNG・WebP は描き直して取り除きます。GIF と動画は描き直すとアニメが崩れるので、そのまま上げます"
        />
        <div className="mt-3">
          <p className="text-sm text-c-text-body mb-1.5">大きい画像を縮小してから上げる(長い辺)</p>
          <Choice
            value={s.uploadMaxDimension}
            options={[0, 1280, 1920, 2560, 4096].map((n) => ({ key: n, name: n === 0 ? '縮小しない' : `${n}px まで` }))}
            onChange={(v) => update('uploadMaxDimension', v)}
          />
          <p className="text-[10px] text-c-text-muted mt-1">
            アップローダーの負担を減らすため、ほどほどの大きさにしてから上げます(JPEG・PNG・WebP)。まとめて貼られても 1 枚ずつ、一度に 10 枚まで上げます
          </p>
        </div>
        <div className="mt-3">
          <p className="text-sm text-c-text-body mb-1.5">catbox のアカウント(userhash)</p>
          <UserhashInput value={s.catboxUserhash} onChange={(v) => update('catboxUserhash', v)} />
          <p className="text-[10px] text-c-text-muted mt-1 leading-relaxed">
            <button type="button" className="text-c-link hover:underline" onClick={() => void openUrl('https://catbox.moe/user/register.php')}>
              catbox.moe でアカウントを作り
            </button>
            、
            <button type="button" className="text-c-link hover:underline" onClick={() => void openUrl('https://catbox.moe/user/login.php')}>
              ログイン
            </button>
            したあとのアカウントの画面にある userhash を貼ってください。登録すると、そのアカウントで上げ、アップロード履歴から catbox
            上のファイルも消せるようになります(消せるのは登録してから上げたものだけ)。userhash はこのパソコンの中に保存し、catbox に送るときだけ使います
          </p>
        </div>
        <div className="mt-3 p-3 text-xs leading-relaxed text-c-text-body bg-c-surface2 rounded-[var(--card-radius)]">
          <p className="font-bold text-c-text-strong mb-1">使う前に</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>上げたファイルは誰でも見られます。匿名で上げたものはあとから消せません(2 年間アクセスがなければ消えます)</li>
            <li>catbox は EXIF を残したまま公開します。スマホの写真は撮った場所が分かることがあります(上の設定で消せます)</li>
            <li>児童ポルノ・マルウェア・アニメやドラマの丸ごとの配信・ひどいグロなどは禁止です。責任は上げた人にあります</li>
            <li>このアプリから上げられるのは 50MB まで(GIF は 20MB)。利用規約: catbox.moe/legal.php</li>
          </ul>
        </div>
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
      <Section
        title="お気に入りのスレの新着"
        note="お気に入りのスレがある板のスレ一覧だけを取りに行き、新着の数を確かめます(本文は取りません)。本文はお気に入りのスレの一覧で更新したときに取ります"
      >
        <Choice
          value={s.favCheckMin}
          options={[0, 3, 5, 10, 30].map((n) => ({ key: n, name: n === 0 ? 'しない' : `${n} 分ごと` }))}
          onChange={(v) => update('favCheckMin', v)}
        />
      </Section>
      <Section title="新着">
        <Toggle
          checked={s.autoScrollOnNew}
          onChange={(v) => update('autoScrollOnNew', v)}
          label="いちばん下を見ているときは、新着まで自動でスクロールする"
        />
        <Toggle
          checked={s.notifyReplies}
          onChange={(v) => update('notifyReplies', v)}
          label="自分宛てのレスが届いたら通知する"
          note="画面の右下に出します。押すとそのレスへ飛びます。自動更新は開いているタブだけなので、裏のタブは更新したときに知らせます"
        />
      </Section>
    </>
  )
}

/**
 * キー操作の割り当て。操作ごとにキーを並べ、× で外し、「+」を押してから押したキーを足す。
 * 同じキーをほかの操作に使っていたら、そちらから外して付け替える
 */
function KeysTab({ settings: s, update }: Pick<Props, 'settings' | 'update'>) {
  const keymap = resolveKeymap(s.keymap)
  // キーを待っている操作
  const [waiting, setWaiting] = useState<KeyAction>()

  const save = (next: Keymap) => {
    // 既定と同じものは保存しない(あとで既定が変わったときに追いつけるように)
    const changed: Partial<Keymap> = {}
    for (const { key } of KEY_ACTIONS) if (next[key].join('\n') !== DEFAULT_KEYMAP[key].join('\n')) changed[key] = next[key]
    update('keymap', changed)
  }

  useEffect(() => {
    if (!waiting) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setWaiting(undefined)
      const k = keyString(e)
      if (!k) return
      const next = { ...keymap }
      for (const { key } of KEY_ACTIONS) next[key] = next[key].filter((x) => x !== k)
      next[waiting] = [...next[waiting], k]
      save(next)
      setWaiting(undefined)
    }
    // 開いているスレのキー操作より先に受け取る
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [waiting, keymap])

  return (
    <>
      <Section
        title="スレ表示のキー操作"
        note="スレ表示で、入力欄にカーソルがないときに使えます。「+」を押してから、割り当てたいキーを押してください(Esc でやめる)"
      >
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)]">
          {KEY_ACTIONS.map(({ key, name }) => (
            <div key={key} className="flex items-center gap-3 px-3 py-2">
              <span className="w-32 flex-shrink-0 text-sm text-c-text-body">{name}</span>
              <div className="flex-1 flex flex-wrap items-center gap-1.5">
                {keymap[key].map((k) => (
                  <span key={k} className="inline-flex items-center gap-0.5 pl-2 pr-0.5 py-0.5 text-xs font-mono rounded border border-c-border bg-c-surface2 text-c-text-strong">
                    {keyLabel(k)}
                    <button
                      type="button"
                      className={ICON_BTN}
                      title="外す"
                      onClick={() => save({ ...keymap, [key]: keymap[key].filter((x) => x !== k) })}
                    >
                      <span className="material-symbols-outlined text-sm leading-none">close</span>
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => setWaiting(waiting === key ? undefined : key)}
                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                    waiting === key ? 'border-c-accent text-c-accent animate-pulse' : 'border-dashed border-c-border text-c-text-muted hover:text-c-text-strong'
                  }`}
                >
                  {waiting === key ? 'キーを押してください' : '+'}
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => update('keymap', {})} className="mt-3 text-xs text-c-text-muted hover:text-c-accent underline">
          すべて既定に戻す
        </button>
      </Section>
      <Section title="決まっているキー" note="ここは変えられません">
        <ul className="text-sm text-c-text-body space-y-1">
          <li><span className="font-mono text-xs">Esc</span> … 一番上のポップアップを閉じる。なければ絞り込みを解く</li>
          <li><span className="font-mono text-xs">Ctrl+Tab / Ctrl+Shift+Tab</span>(Ctrl+PageDown / PageUp)… タブを切り替える</li>
          <li><span className="font-mono text-xs">Ctrl+W / Ctrl+Shift+W</span> … タブを閉じる / すべて閉じる</li>
          <li><span className="font-mono text-xs">Delete</span> … 選んだタブのログを消す</li>
          <li><span className="font-mono text-xs">Ctrl+Enter</span> … 書き込む(書き込み欄で)</li>
        </ul>
      </Section>
    </>
  )
}

/** アカウント 1 つぶんの欄(メールアドレス・パスワード・自動ログイン・ログイン) */
function AccountForm(props: {
  connectorId: string
  kind: AccountKind
  saved?: AccountRecord
  status?: LoginResult
  onLogin: (a: AccountRecord) => Promise<LoginResult>
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
          type="email"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="メールアドレス"
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
      <Toggle checked={autoLogin} onChange={setAutoLogin} label="起動したときに自動でログインする" />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={BTN}
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

/** サイトのアカウント。コネクタが申告したものだけ並べる */
function AccountsTab(props: Pick<Props, 'accounts' | 'loginStatus' | 'onLogin' | 'onDeleteAccount'>) {
  const kinds = builtinConnectors.flatMap((c) => (c.accounts ?? []).map((kind) => ({ connectorId: c.id, kind })))
  const key = (connectorId: string, accountId: string) => `${connectorId}:${accountId}`
  return (
    <>
      <Section
        title="アカウント"
        note="ログインすると、そのサイトに書き込むときに自動で使われます(5ch の BE なら、BE に対応した板でアイコンやポイントが付きます)。パスワードはこのアプリの DB にそのまま保存します。設定の書き出し(JSON)には入りませんが、まるごとバックアップのファイルには入ります"
      >
        <div className="space-y-3">
          {kinds.map(({ connectorId, kind }) => (
            <AccountForm
              key={key(connectorId, kind.id)}
              connectorId={connectorId}
              kind={kind}
              saved={props.accounts.find((a) => a.connectorId === connectorId && a.accountId === kind.id)}
              status={props.loginStatus.get(key(connectorId, kind.id))}
              onLogin={props.onLogin}
              onDelete={() => props.onDeleteAccount(connectorId, kind.id)}
            />
          ))}
        </div>
        <p className="mt-3 text-xs text-c-text-muted">
          ログインで受け取った Cookie は、ふだんの通信の Cookie と一緒に保存されます。保存したものを消しても、受け取った Cookie はその期限まで残ります。
        </p>
      </Section>
    </>
  )
}

/** 設定・NG の書き出しと読み込み、DB 全体のバックアップと復元 */
function BackupTab({ settings: s, update, onBackupDb, onRestoreDb }: Pick<Props, 'settings' | 'update' | 'onBackupDb' | 'onRestoreDb'>) {
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()
  const [busy, setBusy] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)

  const act = async (fn: () => Promise<string | undefined>) => {
    setBusy(true)
    setMessage(undefined)
    try {
      const text = await fn()
      if (text) setMessage({ ok: true, text })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  /** 選んだファイルを、設定か NG かを見分けて読み込む */
  const importFile = (expect: 'settings' | 'ng') =>
    act(async () => {
      const text = await openJson()
      if (text === undefined) return undefined
      const parsed = parseBackup(text)
      if (parsed.kind === 'error') throw new Error(parsed.error)
      if (parsed.kind !== expect) throw new Error(expect === 'settings' ? '設定のファイルではありません(NG のファイルです)' : 'NG のファイルではありません(設定のファイルです)')
      if (parsed.kind === 'settings') {
        const values = importableSettings(parsed, DEFAULT_SETTINGS)
        for (const [k, v] of Object.entries(values)) update(k as keyof AppSettings, v as never)
        return `設定を読み込みました(${Object.keys(values).length} 項目)`
      }
      const { rules, added } = mergeNgRules(s.ngRules, parsed.rules, () => crypto.randomUUID())
      update('ngRules', rules)
      return `NG を ${added} 件足しました(同じものは足していません)`
    })

  return (
    <>
      {message && (
        <p className={`mb-4 text-sm ${message.ok ? 'text-c-accent' : 'text-c-heat-very-hot'}`}>
          <span className="material-symbols-outlined text-base align-[-3px] mr-1">{message.ok ? 'check_circle' : 'error'}</span>
          {message.text}
        </p>
      )}
      <Section
        title="設定"
        note="表示・スレ一覧・キー操作などの設定を JSON に書き出します。catbox のアカウント、開いていたタブ、背景画像、画像の保存先は入れません"
      >
        <div className="flex gap-2">
          <button type="button" className={BTN} disabled={busy} onClick={() => act(async () => ((await saveJson('settings', settingsFile(s))) ? '書き出しました' : undefined))}>
            書き出す
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => importFile('settings')}>
            読み込む
          </button>
        </div>
      </Section>
      <Section title="NG" note={`NG(いま ${s.ngRules.length} 件)を JSON に書き出します。読み込むと、いまの NG に足します(同じものは重ねません)`}>
        <div className="flex gap-2">
          <button type="button" className={BTN} disabled={busy} onClick={() => act(async () => ((await saveJson('ng', ngFile(s.ngRules))) ? '書き出しました' : undefined))}>
            書き出す
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => importFile('ng')}>
            読み込む
          </button>
        </div>
      </Section>
      <Section
        title="まるごとバックアップ"
        note="ログ・既読・お気に入り・書き込み履歴・設定・NG を含む DB 全体を 1 つのファイルに書き出します。使っている最中でもそのまま書き出せます。アカウントのパスワードも入るので、ファイルの置き場所に気をつけてください"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} disabled={busy} onClick={() => act(async () => ((await onBackupDb()) ? 'バックアップを書き出しました' : undefined))}>
            バックアップを書き出す
          </button>
          {!confirmRestore ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmRestore(true)}
              className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border border-c-border text-c-text-body hover:border-c-border-strong"
            >
              バックアップから戻す…
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-sm text-c-text-body">
              いまの状態をバックアップの時点に戻し、アプリを起動し直します。いまの DB は消さずに別の名前で残します。
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const chosen = await onRestoreDb()
                    if (!chosen) setConfirmRestore(false)
                    return undefined
                  })
                }
                className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] bg-c-heat-very-hot text-white hover:opacity-90"
              >
                ファイルを選んで戻す
              </button>
              <button type="button" onClick={() => setConfirmRestore(false)} className="text-xs text-c-text-muted hover:text-c-text-strong underline">
                やめる
              </button>
            </span>
          )}
        </div>
      </Section>
    </>
  )
}

const NG_TABS: { key: NgTarget; name: string; placeholder: string; note: string }[] = [
  { key: 'content', name: 'NG ワード', placeholder: '本文に含まれる言葉', note: '本文に含むレスを NG にします(部分一致)' },
  { key: 'posterName', name: 'NG ネーム', placeholder: '名前', note: '名前に含むレスを NG にします(部分一致)' },
  { key: 'posterId', name: 'NG ID', placeholder: 'ID', note: 'その ID のレスを NG にします(完全一致)' },
  { key: 'threadTitle', name: 'NG スレタイ', placeholder: 'スレタイに含まれる言葉', note: 'スレタイに含むスレを、スレ一覧に出しません(部分一致)' },
]

/** NG の管理。種類(本文・名前・ID・スレタイ)ごとのタブに分け、それぞれに追加欄と一覧を置く */
function NgTab({ settings: s, update }: Pick<Props, 'settings' | 'update'>) {
  const [target, setTarget] = useState<NgTarget>('content')
  const [pattern, setPattern] = useState('')
  const [isRegex, setIsRegex] = useState(false)
  const [todayOnly, setTodayOnly] = useState(false)
  const valid = isValidPattern(pattern.trim(), isRegex)
  const rules = s.ngRules
  const tab = NG_TABS.find((t) => t.key === target)!
  const shown = rules.filter((r) => r.target === target)

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

      <div className="flex border-b border-c-border mb-4">
        {NG_TABS.map((t) => {
          const active = t.key === target
          const count = rules.filter((r) => r.target === t.key).length
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTarget(t.key)}
              className={`relative px-4 py-2 text-sm font-medium transition-colors ${active ? 'text-c-accent' : 'text-c-text-muted hover:text-c-text-body'}`}
            >
              {t.name}
              <span className="ml-1.5 text-xs tabular-nums opacity-70">{count}</span>
              {active && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-c-accent rounded-full" />}
            </button>
          )
        })}
      </div>

      <p className="text-xs text-c-text-muted mb-2">{tab.note}。レスの ⋯ やスレ一覧の NG ボタンからも追加できます</p>
      <form
        className="flex flex-wrap items-center gap-2 mb-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          update('ngRules', [
            ...rules,
            newRule(target, pattern.trim(), { isRegex, expiresOnDate: todayOnly ? todayDateString() : undefined }),
          ])
          setPattern('')
        }}
      >
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder={isRegex ? '正規表現' : tab.placeholder}
          className={`${INPUT} flex-1 min-w-48 ${pattern.trim() && !valid ? 'border-c-heat-very-hot' : ''}`}
        />
        <label className="flex items-center gap-1.5 text-sm text-c-text-body select-none">
          <input type="checkbox" checked={isRegex} onChange={(e) => setIsRegex(e.target.checked)} className="rounded" />
          正規表現
        </label>
        <label className="flex items-center gap-1.5 text-sm text-c-text-body select-none">
          <input type="checkbox" checked={todayOnly} onChange={(e) => setTodayOnly(e.target.checked)} className="rounded" />
          今日だけ
        </label>
        <button type="submit" className={BTN} disabled={!valid}>
          追加
        </button>
      </form>

      {shown.length === 0 ? (
        <p className="text-sm text-c-text-muted">まだありません</p>
      ) : (
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)]">
          {shown.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={(e) => update('ngRules', rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))}
                className="rounded"
                title="有効"
              />
              <span
                className={`flex-1 min-w-0 truncate ${r.isRegex ? 'font-mono' : ''} ${r.enabled ? 'text-c-text-body' : 'text-c-text-muted line-through'}`}
                title={r.pattern}
              >
                {r.pattern}
              </span>
              {r.isRegex && <span className="text-[10px] text-c-text-muted">正規表現</span>}
              {r.expiresOnDate && <span className="text-[10px] text-c-text-muted">{r.expiresOnDate} まで</span>}
              <button type="button" className={ICON_BTN} title="削除" onClick={() => update('ngRules', rules.filter((x) => x.id !== r.id))}>
                <span className="material-symbols-outlined text-base">delete</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function BoardListTab(props: {
  sites: SiteConfig[]
  initialSite?: string
  favorites: Board[]
  loadBoards: Props['loadBoards']
  onToggleFavorite: Props['onToggleFavorite']
  onOpenBoard: Props['onOpenBoard']
}) {
  const [siteUrl, setSiteUrl] = useState(props.initialSite ?? props.sites[0]?.menuUrl)
  const site = props.sites.find((s) => s.menuUrl === siteUrl)
  const [boards, setBoards] = useState<Board[]>()
  const [query, setQuery] = useState('')
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const favoriteUrls = useMemo(() => new Set(props.favorites.map((b) => b.url)), [props.favorites])

  const load = async (refresh: boolean) => {
    if (!site) return
    setBusy(true)
    setMessage(undefined)
    try {
      setBoards(await props.loadBoards(site, refresh))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  // BBS メニューを切り替えたら、保存してある板一覧を出す(なければ取りに行く)
  useEffect(() => {
    setBoards(undefined)
    void load(false)
  }, [siteUrl])

  const grouped = useMemo(() => {
    const q = query.trim()
    const map = new Map<string, Board[]>()
    for (const b of boards ?? []) {
      if (q && !b.name.includes(q) && !(b.category ?? '').includes(q)) continue
      const cat = b.category ?? '(未分類)'
      map.set(cat, [...(map.get(cat) ?? []), b])
    }
    return [...map]
  }, [boards, query])

  const toggleCat = (cat: string) =>
    setOpenCats((s) => {
      const next = new Set(s)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })

  if (props.sites.length === 0) {
    return <p className="text-sm text-c-text-muted">BBS メニューが登録されていません。「板とサイト」から追加してください</p>
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Choice
          value={siteUrl ?? ''}
          options={props.sites.map((s) => ({ key: s.menuUrl, name: s.name }))}
          onChange={setSiteUrl}
        />
        <button type="button" className={`${ICON_BTN} ml-auto`} title="板一覧を取り直す" onClick={() => void load(true)}>
          <span className={`material-symbols-outlined text-lg ${busy ? 'animate-spin' : ''}`}>refresh</span>
        </button>
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="板の名前やカテゴリで絞り込む"
        className={`${INPUT} w-full mb-1`}
      />
      <p className="text-xs text-c-text-muted mb-2">☆ でお気に入りに登録・解除、ダブルクリックでその板を開きます</p>
      {message && <p className="text-sm text-c-heat-very-hot mb-2">{message}</p>}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar border border-c-border rounded-[var(--card-radius)]">
        {!boards && busy && <p className="px-3 py-2 text-sm text-c-text-muted">読み込み中...</p>}
        {grouped.map(([cat, list]) => {
          const open = query.trim() !== '' || openCats.has(cat)
          return (
            <div key={cat} className="border-b border-c-border last:border-b-0">
              <button
                type="button"
                onClick={() => toggleCat(cat)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-bold text-c-text-strong hover:bg-c-surface2"
              >
                <span
                  className="material-symbols-outlined text-base transition-transform"
                  style={{ transform: open ? 'rotate(90deg)' : undefined }}
                >
                  chevron_right
                </span>
                <span className="flex-1 text-left">{cat}</span>
                <span className="text-xs font-normal text-c-text-muted">{list.length}</span>
              </button>
              {open &&
                list.map((b) => {
                  const fav = favoriteUrls.has(b.url)
                  return (
                    <div
                      key={b.url}
                      onDoubleClick={() => props.onOpenBoard(b)}
                      className="flex items-center gap-2 pl-8 pr-3 py-1 text-sm cursor-default select-none hover:bg-c-surface2"
                      title="ダブルクリックで開く"
                    >
                      <button
                        type="button"
                        onClick={() => props.onToggleFavorite(b)}
                        className={fav ? 'text-c-heat-warm' : 'text-c-text-muted hover:text-c-text-strong'}
                        title={fav ? 'お気に入りから外す' : 'お気に入りに追加'}
                      >
                        <span className={`material-symbols-outlined text-lg leading-none ${fav ? 'fill' : ''}`}>star</span>
                      </button>
                      <span className="text-c-text-body">{b.name}</span>
                    </div>
                  )
                })}
            </div>
          )
        })}
        {boards && grouped.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">見つかりません</p>}
      </div>
    </div>
  )
}

/** お気に入り板 1 つぶんの情報の編集欄。入力はすぐに反映・保存し、空にすれば既定に戻る */
function BoardMetaEditor({ board, meta, onChange }: { board: Board; meta: BoardMeta; onChange: (m: BoardMeta) => void }) {
  const field = (key: keyof BoardMeta, label: string, placeholder: string, note?: string) => (
    <label className="block">
      <span className="block text-xs text-c-text-muted mb-1">{label}</span>
      <input
        type="text"
        value={meta[key] ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          const next = { ...meta, [key]: e.target.value || undefined }
          onChange(next)
        }}
        className={`${INPUT} w-full`}
      />
      {note && <span className="block text-[10px] text-c-text-muted mt-0.5">{note}</span>}
    </label>
  )
  return (
    <div className="px-3 pb-3 pt-1 grid grid-cols-2 gap-3 bg-c-surface2">
      {field('alias', '別名(板名の代わりに出す名前)', board.name)}
      <div>
        {field('icon', 'ファビコン(画像の URL)', '自動(板のページから探す)')}
      </div>
      {field('defaultName', 'この板での名前欄の既定値', 'ふだんの名前のまま')}
      {field('defaultMail', 'この板でのメール欄の既定値', 'ふだんのメールのまま', 'sage にしておきたい板など')}
    </div>
  )
}

function BoardsTab(
  props: Pick<
    Props,
    'favorites' | 'sites' | 'onAddFavoriteUrl' | 'onRemoveFavorite' | 'onAddSite' | 'onRemoveSite' | 'settings' | 'update'
  > & { onShowBoardList: (menuUrl: string) => void },
) {
  const [editing, setEditing] = useState<string>()
  const metaOf = (url: string) => props.settings.boardMeta[url] ?? {}
  const setMeta = (url: string, m: BoardMeta) => {
    const next = { ...props.settings.boardMeta }
    // 全部空になったら消す
    if (Object.values(m).some((v) => v !== undefined)) next[url] = m
    else delete next[url]
    props.update('boardMeta', next)
  }
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
      <Section title="お気に入り板" note="サイドバーの「お気に入り」に並ぶ板です。「板一覧」で ☆ を押すか、板の URL を貼って登録します">
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)] mb-3">
          {props.favorites.map((b) => (
            <div key={b.url}>
              <div className="flex items-center gap-3 px-3 py-2 text-sm">
                <BoardIcon boardUrl={b.url} override={metaOf(b.url).icon} />
                <span className="text-c-text-strong">{metaOf(b.url).alias || b.name}</span>
                {metaOf(b.url).alias && <span className="text-xs text-c-text-muted">({b.name})</span>}
                <span className="flex-1 min-w-0 truncate text-xs text-c-text-muted">{b.url}</span>
                <button
                  type="button"
                  onClick={() => setEditing((e) => (e === b.url ? undefined : b.url))}
                  className={`px-2 py-0.5 text-xs border rounded-[var(--btn-radius)] transition-colors ${
                    editing === b.url ? 'border-c-accent text-c-accent' : 'border-c-border text-c-text-body hover:border-c-accent hover:text-c-accent'
                  }`}
                >
                  編集
                </button>
                <button type="button" className={ICON_BTN} title="外す" onClick={() => props.onRemoveFavorite(b.url)}>
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
              {editing === b.url && <BoardMetaEditor board={b} meta={metaOf(b.url)} onChange={(m) => setMeta(b.url, m)} />}
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

      <Section title="BBS メニュー" note="掲示板の板一覧(bbsmenu.html か bbsmenu.json)です。「板一覧を見る」から、お気に入りに登録する板を探せます">
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)] mb-3">
          {props.sites.map((s) => (
            <div key={s.menuUrl}>
              <div className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="text-c-text-strong">{s.name}</span>
                <span className="flex-1 min-w-0 truncate text-xs text-c-text-muted">{s.menuUrl}</span>
                <button
                  type="button"
                  onClick={() => props.onShowBoardList(s.menuUrl)}
                  className="px-2 py-0.5 text-xs border border-c-border rounded-[var(--btn-radius)] text-c-text-body hover:border-c-accent hover:text-c-accent transition-colors"
                >
                  板一覧を見る
                </button>
                <button type="button" className={ICON_BTN} title="削除" onClick={() => props.onRemoveSite(s.menuUrl)}>
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
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
  /** 「板とサイト」から板一覧へ移るときに、どの BBS メニューを出すか */
  const [listSite, setListSite] = useState<string>()

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
          <div
            className={`flex-1 min-h-0 px-6 py-5 ${tab === 'boardlist' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto custom-scrollbar'}`}
          >
            {tab === 'display' && <DisplayTab {...props} />}
            {tab === 'threads' && <ThreadsTab {...props} />}
            {tab === 'posts' && <PostsTab {...props} />}
            {tab === 'write' && <WriteTab {...props} />}
            {tab === 'refresh' && <RefreshTab {...props} />}
            {tab === 'keys' && <KeysTab {...props} />}
            {tab === 'ng' && <NgTab {...props} />}
            {tab === 'boardlist' && (
              <BoardListTab
                key={listSite}
                sites={props.sites}
                initialSite={listSite}
                favorites={props.favorites}
                loadBoards={props.loadBoards}
                onToggleFavorite={props.onToggleFavorite}
                onOpenBoard={props.onOpenBoard}
              />
            )}
            {tab === 'boards' && (
              <BoardsTab
                {...props}
                onShowBoardList={(menuUrl) => {
                  setListSite(menuUrl)
                  setTab('boardlist')
                }}
              />
            )}
            {tab === 'accounts' && <AccountsTab {...props} />}
            {tab === 'backup' && <BackupTab {...props} />}
            {tab === 'about' && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  )
}
