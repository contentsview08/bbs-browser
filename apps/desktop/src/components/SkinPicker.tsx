// スキンを選ぶ窓(SkinDialog)と、設定「表示」のいまのスキンの行(SkinSummaryRow)。
// 配色もスキンも同じ族として、大きな見本の札で並べて眺めて選ぶ(拡張機能の一覧のように)。
// 配色(同梱)→ 入れたスキン → もっと探す(一覧から入れる)の順。下に、いまの見た目を保存・ファイルの出し入れ・配色を編集。
// スマホのアプリの SkinPanel と同じ考え方・同じ並び。JSON という言葉は詳しい設定の中だけ
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, COLOR_SCHEMES, POST_STYLES, isDarkScheme, pickScheme, type AppSettings, type ColorScheme, type UpdateSetting } from '../ui/settings'
import { customOf, customToJson, customVars, parseCustom, readSchemeVars } from '../ui/customScheme'
import { BUILTIN_SKINS, isBuiltinSkinScheme, lookThemeByKey, lookThemeKeyName, lookThemeName, lookThemeOf, lookThemePatch, lookThemeShareJson, lookThemeSwatch, pickBuiltinSkin, withSavedTheme, withoutSavedTheme, type LookTheme } from '../ui/lookTheme'
import { AccentDots, PostDisplayItems, PostStyleChips, StyleOptionItems } from './StyleMenu'
import CustomSchemeEditor from './mobile/CustomSchemeEditor'
import { installedSkin, skinKeyOf, type CatalogSkin } from '../ui/skinCatalog'
import { fetchSkinCatalog, installSkin, updateInstalledSkins } from '../host/skinCatalog'
import { openJson, saveJson } from '../host/backup'
import { ManagerDialog } from './SettingParts'
import { INPUT } from './DialogParts'
import { isMobile } from '../utils/platform'

type Props = { settings: AppSettings; update: UpdateSetting }

const BTN = 'h-8 px-3 text-sm rounded-md border border-c-border text-c-text-strong hover:bg-c-surface2 disabled:opacity-50 whitespace-nowrap'

/** いま使っているスキン(配色)の名前 */
export function currentSkinName(s: AppSettings): string {
  const saved = lookThemeKeyName(s.lookThemeKey)
  if (saved) return saved
  const nameOf = (k: string) => (k === 'custom' ? '自分の配色' : COLOR_SCHEMES.find((c) => c.key === k)?.name ?? k)
  if (s.lookThemeKey.startsWith('builtin:')) return nameOf(s.lookThemeKey.slice(8))
  if (s.followOsTheme) return `${nameOf(s.darkScheme)} / ${nameOf(s.lightScheme)}`
  return nameOf(s.scheme)
}

/** 設定「表示」の、いまのスキンの行。押すとスキンの窓 */
export function SkinSummaryRow({ settings: s, onOpen }: { settings: AppSettings; onOpen: () => void }) {
  const saved = s.lookThemes.find((t) => skinKeyOf(t) === s.lookThemeKey)
  const sw = (saved && lookThemeSwatch(saved)) ?? ['var(--c-base)', 'var(--c-surface)', 'var(--c-accent)', 'var(--c-accent-self)', 'var(--c-text-strong)']
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full flex items-center gap-3 px-3 ${isMobile ? 'py-3.5 rounded-xl' : 'py-2.5 rounded-lg'} border border-c-border bg-c-surface hover:border-c-border-strong text-left`}
    >
      <span className="flex items-center gap-1 px-1.5 py-1 rounded flex-shrink-0" style={{ background: sw[0], boxShadow: 'inset 0 0 0 1px var(--c-border)' }}>
        {sw.slice(1).map((c, i) => (
          <span key={i} className="w-3.5 h-3.5 rounded-[3px]" style={{ background: c, boxShadow: 'inset 0 0 0 1px rgba(128,128,128,0.4)' }} />
        ))}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-c-text-strong truncate">{currentSkinName(s)}</span>
        <span className="block text-xs text-c-text-muted">{s.followOsTheme ? 'OS のダーク・ライトに合わせています' : saved ? 'スキン' : '同梱の配色'}</span>
      </span>
      <span className="text-sm text-c-accent whitespace-nowrap">スキンを選ぶ…</span>
      <span className="material-symbols-outlined text-c-text-muted">chevron_right</span>
    </button>
  )
}

/** スキン(配色)1 つの大きな札: 見本(上の帯・スレ一覧の行・レス・書き込み欄)と、名前・一言。押すと当てる。
 * 見本の色は、同梱の配色なら data-scheme で、スキンの自分の配色なら CSS の変数を直に入れて描く。
 * action: 右下のボタン(一覧の「入れる」)。menu: ⋯(と右クリック)で出すメニュー(編集・消す など) */
function SkinCard(props: {
  name: string
  caption: string
  on: boolean
  schemeKey?: string
  vars?: Record<string, string>
  onPick?: () => void
  action?: { label: string; busy?: boolean; onClick: () => void }
  menu?: { label: string; danger?: boolean; onClick: () => void }[]
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div
      role={props.onPick ? 'button' : undefined}
      tabIndex={props.onPick ? 0 : undefined}
      onClick={props.onPick}
      onKeyDown={(e) => {
        if (props.onPick && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault()
          props.onPick()
        }
      }}
      onContextMenu={
        props.menu
          ? (e) => {
              e.preventDefault()
              setMenuOpen(true)
            }
          : undefined
      }
      className={`relative text-left rounded-[var(--card-radius)] border bg-c-surface overflow-visible transition-colors ${props.on ? 'border-c-accent' : 'border-c-border'} ${props.onPick ? 'cursor-pointer hover:border-c-border-strong' : ''}`}
    >
      <div className="p-1.5">
        <div className="rounded-md overflow-hidden border border-c-border" data-scheme={props.schemeKey} style={{ ...(props.vars as React.CSSProperties), background: 'var(--c-base)' }}>
          <div className="flex items-center px-3 py-2" style={{ background: 'var(--c-header-footer)' }}>
            <span className="flex-1 font-bold text-[13px]" style={{ color: 'var(--c-text-strong)' }}>
              ニュー速
            </span>
            <span style={{ color: 'var(--c-text-muted)' }}>︙</span>
          </div>
          <div className="h-px" style={{ background: 'var(--c-border)' }} />
          <div className="flex">
            <span className="w-[3px]" style={{ background: 'var(--c-accent-self)' }} />
            <div className="flex-1 px-3 py-1.5">
              <div className="text-[12px]" style={{ color: 'var(--c-thread-read-title)' }}>
                読んだスレのスレタイ
              </div>
              <div className="flex items-center">
                <span className="flex-1 text-[10px]" style={{ color: 'var(--c-text-muted)' }}>
                  3 時間前
                </span>
                <span className="px-1.5 rounded-full text-[9px] font-bold" style={{ background: 'var(--c-accent-self)', color: 'var(--c-accent-self-text)' }}>
                  +12
                </span>
              </div>
            </div>
          </div>
          <div className="h-px" style={{ background: 'var(--c-border)' }} />
          <div className="px-3 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--c-text-strong)' }}>
            まだ開いていないスレ
          </div>
          <div className="h-px" style={{ background: 'var(--c-border)' }} />
          <div className="flex" style={{ background: 'var(--c-surface)' }}>
            <span className="w-[3px]" style={{ background: 'var(--c-own)' }} />
            <div className="flex-1 px-3 py-1.5">
              <div className="text-[10px]">
                <b style={{ color: 'var(--c-text-muted)' }}>12 </b>
                <b style={{ color: 'var(--c-poster-name)' }}> 名無し</b>
                <span className="font-mono" style={{ color: 'var(--c-text-muted)' }}>
                  {'  10/31 12:34  ID:AbCd'}
                </span>
              </div>
              <div className="text-[12px]" style={{ color: 'var(--c-link)' }}>
                {'>>10'}
              </div>
              <div className="text-[12px]" style={{ color: 'var(--c-text-body)' }}>
                本文はこの字の色で出ます。
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-1.5" style={{ background: 'var(--c-header-footer)' }}>
            <span className="flex-1 px-2 py-1 rounded-[8px] text-[11px]" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', color: 'var(--c-text-muted)' }}>
              書き込む
            </span>
            <span className="w-[26px] h-[26px] rounded-full flex items-center justify-center" style={{ background: 'var(--c-accent)', color: 'var(--c-accent-text)' }}>
              <span className="material-symbols-outlined text-[14px]">send</span>
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 pl-2.5 pr-1.5 pb-1.5 min-h-[36px]">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-c-text-strong truncate">{props.name}</div>
          {props.caption && <div className="text-[11px] text-c-text-muted truncate">{props.caption}</div>}
        </div>
        {props.on && <span className="material-symbols-outlined text-base text-c-accent">check</span>}
        {props.action && (
          <button
            type="button"
            disabled={props.action.busy}
            onClick={(e) => {
              e.stopPropagation()
              props.action!.onClick()
            }}
            className="h-7 px-2.5 text-xs font-bold rounded-md bg-c-accent text-[var(--c-accent-text)] disabled:opacity-50 whitespace-nowrap"
          >
            {props.action.busy ? '…' : props.action.label}
          </button>
        )}
        {props.menu && (
          <button
            type="button"
            title="メニュー"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
            className="material-symbols-outlined text-[18px] w-7 h-7 flex items-center justify-center rounded text-c-text-muted hover:text-c-text-strong"
          >
            more_vert
          </button>
        )}
      </div>
      {menuOpen && props.menu && (
        <>
          <div
            className="fixed inset-0 z-[20]"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(false)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenuOpen(false)
            }}
          />
          <div className="absolute right-1.5 bottom-9 z-[21] min-w-[11em] py-1 rounded-md border border-c-border bg-c-surface shadow-lg" onClick={(e) => e.stopPropagation()}>
            {props.menu.map((m) => (
              <button
                key={m.label}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(false)
                  m.onClick()
                }}
                className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-c-surface2 ${m.danger ? 'text-c-mark-danger' : 'text-c-text-body'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** スキンの一言(JSON の note)。なければ、レスの見た目などから作る */
function captionOf(t: LookTheme): string {
  if (typeof t.note === 'string' && t.note) return t.note
  const st = t.settings ?? {}
  const parts: string[] = []
  if (typeof st.postStyle === 'string') parts.push(`レスの見た目: ${POST_STYLES.find((p) => p.key === st.postStyle)?.name ?? st.postStyle}`)
  const n = Object.keys(st).length + Object.keys(t.pc ?? {}).length
  if (t.scheme) parts.push(n === 0 ? '色だけのスキン' : `色と見た目(${n} 項目)`)
  else if (n > 0) parts.push(`見た目(${n} 項目)`)
  return parts.join('・')
}

/** 札の見本の色(自分の配色が入っていれば CSS 変数、なければ同梱の配色のキー) */
function previewOf(scheme: Record<string, unknown> | undefined, settings: Record<string, unknown> | undefined): { schemeKey?: string; vars?: Record<string, string> } {
  const d = scheme && typeof scheme === 'object' ? parseCustom(JSON.stringify(scheme)) : null
  if (d) return { vars: { ...customVars(d), '--c-own': d.own } }
  const key = typeof settings?.scheme === 'string' && settings.scheme !== 'custom' ? (settings.scheme as string) : undefined
  return { schemeKey: key }
}

function Heading({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mt-5 mb-2 first:mt-0">
      <h4 className="text-xs font-bold text-c-accent tracking-wide flex-1">{children}</h4>
      {right}
    </div>
  )
}

const GRID = 'grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2'

/**
 * スキンの窓。配色(同梱)→ 入れたスキン → もっと探す(一覧)。下に、いまの見た目を保存・ファイルの出し入れ・配色を編集。
 * onEditColors: 「配色を編集…」を押したとき(設定の「表示」の配色を編集のページへ。渡さなければ出さない)
 */
export function SkinDialog(props: Props & { onClose: () => void; onEditColors?: () => void }) {
  const { settings: s, update } = props
  const [catalog, setCatalog] = useState<CatalogSkin[]>()
  const [catalogErr, setCatalogErr] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const saveRef = useRef<HTMLInputElement>(null)
  const latest = useRef({ s, update })
  latest.current = { s, update }

  const load = async () => {
    setLoading(true)
    setCatalogErr(undefined)
    const r = await fetchSkinCatalog()
    setLoading(false)
    if (typeof r === 'string') return setCatalogErr(r)
    setCatalog(r)
    // 入れたスキンが新しくなっていれば、ここで入れ替える(配る側を直せば、入れている人も新しくなる)
    const done = await updateInstalledSkins(latest.current.s, latest.current.update, r)
    if (done.length > 0) setNotice(`新しくなりました: ${done.join('・')}`)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (saving) saveRef.current?.focus()
  }, [saving])

  /** 編集しているスキン(undefined なら選ぶ画面。name が null なら、同梱のものを元にした新しいスキン) */
  const [editing, setEditing] = useState<{ name: string | null }>()
  const [editName, setEditName] = useState('')
  const pickScheme2 = (key: ColorScheme) => {
    for (const [k, v] of Object.entries(pickScheme(s, key))) update(k as keyof AppSettings, v as never)
    if (s.lookThemeKey) update('lookThemeKey', '')
  }
  const applyKey = (key: string) => {
    const b = pickBuiltinSkin(key)
    if (b) {
      for (const [k, v] of Object.entries(b)) update(k as keyof AppSettings, v as never)
      return
    }
    const text = lookThemeByKey(s, key)
    if (!text) return
    const r = lookThemePatch(text, DEFAULT_SETTINGS)
    if (typeof r === 'string') return
    for (const [k, v] of Object.entries(r.patch)) update(k as keyof AppSettings, v as never)
    update('lookThemeKey', key)
  }
  /**
   * スキンの編集を始める: そのスキン(か配色)を当て、配色を「自分の配色」に写して(同梱の配色なら 6 色を写す)、編集の画面にする。
   * 変えた所はすぐ映る。終わったら「このスキンに保存」で書き戻す(途中で戻っても、見た目は変えたまま)
   */
  const beginEdit = (key: string) => {
    let schemeKey = s.scheme
    let custom = s.customScheme
    if (key.startsWith('saved:')) {
      const text = lookThemeByKey(s, key)
      const r = text ? lookThemePatch(text, DEFAULT_SETTINGS) : undefined
      if (r && typeof r !== 'string') {
        for (const [k, v] of Object.entries(r.patch)) update(k as keyof AppSettings, v as never)
        if (typeof r.patch.scheme === 'string') schemeKey = r.patch.scheme
        if (typeof r.patch.customScheme === 'string') custom = r.patch.customScheme
      }
      update('lookThemeKey', key)
    } else if (key.startsWith('builtin:')) {
      const b = pickBuiltinSkin(key)!
      for (const [k, v] of Object.entries(b)) update(k as keyof AppSettings, v as never)
      schemeKey = b.scheme!
    } else {
      schemeKey = key.slice(7) as ColorScheme
      update('followOsTheme', false)
      update('scheme', schemeKey)
      update('lookThemeKey', '')
    }
    // 配色を「自分の配色」に(同梱の配色なら、その 6 色から)
    if (schemeKey !== 'custom' || !parseCustom(custom)) {
      const base = schemeKey !== 'custom' ? schemeKey : 'indigo'
      update('customScheme', customToJson(customOf(base, isDarkScheme(base))))
      update('scheme', 'custom')
      update('followOsTheme', false)
    }
    const name = key.startsWith('saved:') ? key.slice(6) : null
    setEditing({ name })
    setEditName(name ?? '')
  }
  /** 編集した見た目を、その名前のスキンに書き戻す(入れたスキンの出どころは外し、以後は自動で入れ替えない) */
  const saveEdited = (name: string) => {
    const n = name.trim()
    if (!n || !editing) return
    const old = s.lookThemes.find((t) => lookThemeName(t) === n)
    const theme = lookThemeOf(s, n)
    if (old?.note) theme.note = old.note
    let list = s.lookThemes
    if (editing.name && editing.name !== n) list = withoutSavedTheme(list, editing.name)
    update('lookThemes', withSavedTheme(list, theme))
    update('lookThemeKey', `saved:${n}`)
    setEditing({ name: n })
    setNotice(`スキン「${n}」に保存しました`)
  }
  /** 貼り付け・ファイルのスキンを当てる(保存して、そのスキンを選んだことにする) */
  const applyText = (text: string) => {
    const r = lookThemePatch(text, DEFAULT_SETTINGS)
    if (typeof r === 'string') return setNotice(r)
    for (const [k, v] of Object.entries(r.patch)) update(k as keyof AppSettings, v as never)
    if (r.theme) {
      update('lookThemes', withSavedTheme(s.lookThemes, r.theme))
      update('lookThemeKey', `saved:${r.name}`)
    }
    setNotice(`スキン「${r.name}」を入れました`)
  }
  const saveCurrent = () => {
    const name = saveName.trim()
    if (!name) return
    update('lookThemes', withSavedTheme(s.lookThemes, lookThemeOf(s, name)))
    update('lookThemeKey', `saved:${name}`)
    setSaveName('')
    setSaving(false)
    setNotice(`いまの見た目を「${name}」として保存しました`)
  }
  const install = async (e: CatalogSkin) => {
    setBusy(e.id)
    try {
      const name = await installSkin(latest.current.s, latest.current.update, e)
      setNotice(`スキン「${name}」を入れました`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(undefined)
    }
  }
  const remove = (t: LookTheme) => {
    update('lookThemes', withoutSavedTheme(s.lookThemes, lookThemeName(t)))
    if (s.lookThemeKey === skinKeyOf(t)) update('lookThemeKey', '')
  }
  const current = s.lookThemes.find((t) => skinKeyOf(t) === s.lookThemeKey)
  const exportCurrent = () => {
    const theme = current ?? lookThemeOf(s, '')
    void saveJson('skin', JSON.parse(lookThemeShareJson(theme))).then((ok) => ok && setNotice('書き出しました'))
  }

  // 配色だけのものと、スキン(見た目まで含む)に二分する。Discord 風・LINE 風の配色は同梱のスキンとして並べる
  const plain = COLOR_SCHEMES.filter((c) => !isBuiltinSkinScheme(c.key))
  const schemeCards = (list: typeof COLOR_SCHEMES, onOf: (k: ColorScheme) => boolean) =>
    list.map((c) => (
      <SkinCard
        key={c.key}
        name={c.name}
        caption={isDarkScheme(c.key) ? '暗い配色' : '明るい配色'}
        on={onOf(c.key)}
        schemeKey={c.key}
        onPick={() => pickScheme2(c.key)}
        menu={[{ label: 'この配色を元にスキンを作る…', onClick: () => beginEdit(`scheme:${c.key}`) }]}
      />
    ))
  const customDef = parseCustom(s.customScheme)

  if (editing) {
    const name = editing.name
    return (
      <ManagerDialog title={name ? `スキンを編集: ${name}` : 'スキンを作る'} onClose={props.onClose} wide>
        <div className="flex items-center gap-3 mb-3">
          <button type="button" className={BTN} onClick={() => setEditing(undefined)}>
            ← スキンの一覧へ
          </button>
          <p className="text-xs text-c-text-muted">
            {name ? `スキン「${name}」を編集しています。` : '同梱のものを元に、新しいスキンを作ります。'}変えるとすぐ映ります。終わったら下の保存で書き戻します
          </p>
        </div>
        <CustomSchemeEditor settings={s} update={update} />
        <Heading>差し色</Heading>
        <AccentDots settings={s} update={update} />
        <Heading>スタイル</Heading>
        <PostStyleChips settings={s} update={update} />
        <StyleOptionItems settings={s} update={update} />
        <Heading>細かい表示</Heading>
        <PostDisplayItems settings={s} update={update} />
        <div className="mt-5 pt-3 border-t border-c-border flex flex-wrap items-center gap-2">
          {name && (
            <button type="button" className={`${BTN} font-bold bg-c-accent text-[var(--c-accent-text)] border-transparent`} onClick={() => saveEdited(name)}>
              このスキンに保存
            </button>
          )}
          <input
            type="text"
            value={editName}
            placeholder="名前"
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveEdited(editName)
            }}
            className={`${INPUT} w-[14em]`}
          />
          <button type="button" className={BTN} disabled={!editName.trim()} onClick={() => saveEdited(editName)}>
            {name ? '別の名前で保存' : 'スキンとして保存'}
          </button>
          {name && <span className="text-[11px] text-c-text-muted">入れたスキンを編集して保存すると、配る側が新しくしても自動では入れ替わらなくなります</span>}
        </div>
        {notice && <p className="mt-2 text-xs text-c-text-muted">{notice}</p>}
      </ManagerDialog>
    )
  }

  return (
    <ManagerDialog title="スキン" onClose={props.onClose} wide>
      <p className="text-xs text-c-text-muted mb-3">
        配色は色だけ、スキンは配色とレスの見た目(と細かい表示・文字と余白)をまとめたものです。押すとその場で切り替わります。札の ⋯ から、編集・消す
      </p>
      {s.followOsTheme ? (
        <>
          <Heading>ダークのとき</Heading>
          <div className={GRID}>{schemeCards(plain.filter((c) => isDarkScheme(c.key)), (k) => s.darkScheme === k)}</div>
          <Heading>ライトのとき</Heading>
          <div className={GRID}>{schemeCards(plain.filter((c) => !isDarkScheme(c.key)), (k) => s.lightScheme === k)}</div>
          <p className="mt-1.5 text-[11px] text-c-text-muted">OS のダーク・ライトに合わせているので、暗い配色と明るい配色を 1 つずつ選びます(設定 → 表示 で切れます)</p>
        </>
      ) : (
        <>
          <Heading>配色</Heading>
          <div className={GRID}>
            {schemeCards(plain, (k) => !s.lookThemeKey && s.scheme === k)}
            {customDef && (
              <SkinCard name="自分の配色" caption="配色を編集… で作った色" on={!s.lookThemeKey && s.scheme === 'custom'} vars={{ ...customVars(customDef), '--c-own': customDef.own }} onPick={() => pickScheme2('custom')} />
            )}
          </div>
        </>
      )}

      <Heading>スキン</Heading>
      <div className={GRID}>
        {BUILTIN_SKINS.map((b) => {
          const key = `builtin:${b.scheme}`
          const c = COLOR_SCHEMES.find((x) => x.key === b.scheme)
          return (
            <SkinCard
              key={key}
              name={c?.name ?? b.scheme}
              caption={`レスの見た目: ${POST_STYLES.find((p) => p.key === b.style)?.name ?? b.style}`}
              on={s.lookThemeKey === key}
              schemeKey={b.scheme}
              onPick={() => applyKey(key)}
              menu={[{ label: 'このスキンを元に編集…', onClick: () => beginEdit(key) }]}
            />
          )
        })}
        {s.lookThemes.map((t) => (
          <SkinCard
            key={skinKeyOf(t)}
            name={lookThemeName(t)}
            caption={captionOf(t)}
            on={s.lookThemeKey === skinKeyOf(t)}
            {...previewOf(t.scheme, t.settings)}
            onPick={() => applyKey(skinKeyOf(t))}
            menu={[
              { label: '編集…', onClick: () => beginEdit(skinKeyOf(t)) },
              { label: '文字(JSON)でコピー', onClick: () => void navigator.clipboard.writeText(lookThemeShareJson(t)).then(() => setNotice('コピーしました。掲示板などに貼って配れます')) },
              { label: '消す', danger: true, onClick: () => remove(t) },
            ]}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-c-text-muted">前の方が同梱のスキン、後ろが入れた・保存したスキン。長い名前は札の下に出ます</p>

      <Heading
        right={
          <button type="button" title="一覧を取り直す" disabled={loading} onClick={() => void load()} className={`material-symbols-outlined text-[18px] w-7 h-7 flex items-center justify-center rounded text-c-text-muted hover:text-c-text-strong disabled:opacity-50 ${loading ? 'animate-spin' : ''}`}>
            refresh
          </button>
        }
      >
        もっと探す
      </Heading>
      {catalogErr ? (
        <p className="text-sm text-c-text-muted">{catalogErr}</p>
      ) : !catalog ? (
        <p className="text-sm text-c-text-muted">一覧を取っています…</p>
      ) : catalog.length === 0 ? (
        <p className="text-sm text-c-text-muted">配っているスキンはまだありません</p>
      ) : (
        <div className={GRID}>
          {catalog.map((e) => {
            const have = installedSkin(s.lookThemes, e.id)
            return (
              <SkinCard
                key={e.id}
                name={e.name}
                caption={e.note || (e.settings && typeof e.settings.postStyle === 'string' ? `レスの見た目: ${POST_STYLES.find((p) => p.key === e.settings!.postStyle)?.name ?? ''}` : '')}
                on={!!have && s.lookThemeKey === skinKeyOf(have)}
                {...previewOf(e.scheme, e.settings)}
                onPick={have ? () => applyKey(skinKeyOf(have)) : undefined}
                action={have ? undefined : { label: '入れる', busy: busy === e.id, onClick: () => void install(e) }}
              />
            )
          })}
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-c-text-muted">入れたスキンは、配っている側が新しくすると自動で入れ替わります</p>

      <div className="mt-5 pt-3 border-t border-c-border flex flex-wrap items-center gap-2">
        {saving ? (
          <>
            <input
              ref={saveRef}
              type="text"
              value={saveName}
              placeholder={lookThemeKeyName(s.lookThemeKey) || 'スキンの名前'}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveCurrent()
                if (e.key === 'Escape') setSaving(false)
              }}
              className={`${INPUT} w-[16em]`}
            />
            <button type="button" className={`${BTN} font-bold ${saveName.trim() ? 'bg-c-accent text-[var(--c-accent-text)] border-transparent' : ''}`} disabled={!saveName.trim()} onClick={saveCurrent}>
              保存
            </button>
            <button type="button" className={BTN} onClick={() => setSaving(false)}>
              やめる
            </button>
            <span className="text-[11px] text-c-text-muted">いまの配色・レスの見た目・細かい表示・文字と余白を、この名前で。同じ名前があれば入れ替えます</span>
          </>
        ) : (
          <button type="button" className={BTN} onClick={() => setSaving(true)}>
            いまの見た目を保存…
          </button>
        )}
        {!isMobile && !saving && (
          <>
            <button type="button" className={BTN} onClick={() => void openJson().then((t) => t && applyText(t))}>
              ファイルから入れる
            </button>
            <button type="button" className={BTN} onClick={exportCurrent} title={current ? `「${lookThemeName(current)}」をファイルに` : 'いまの見た目をファイルに'}>
              ファイルに書き出す
            </button>
          </>
        )}
        {s.showAdvanced && !saving && (
          <>
            <button type="button" className={BTN} onClick={() => void navigator.clipboard.readText().then((t) => (t.trim() ? applyText(t) : setNotice('クリップボードに文字がありません')), () => setNotice('クリップボードを読めませんでした'))}>
              文字(JSON)を貼り付けて入れる
            </button>
            <button type="button" className={BTN} onClick={() => void navigator.clipboard.writeText(lookThemeShareJson(current ?? lookThemeOf(s, ''))).then(() => setNotice('コピーしました。掲示板などに貼って配れます'))}>
              文字(JSON)でコピー
            </button>
          </>
        )}
        {props.onEditColors && !saving && (
          <button type="button" className={`${BTN} ml-auto text-c-accent`} onClick={props.onEditColors}>
            配色を編集…
          </button>
        )}
      </div>
      {notice && <p className="mt-2 text-xs text-c-text-muted">{notice}</p>}
    </ManagerDialog>
  )
}

/** 同梱の配色の代表の色(SkinSummaryRow で使う) */
export function schemeSwatch(key: string): string[] {
  const v = readSchemeVars(key, ['--c-base', '--c-surface', '--c-accent', '--c-accent-self', '--c-text-strong'])
  return [v['--c-base'], v['--c-surface'], v['--c-accent'], v['--c-accent-self'], v['--c-text-strong']]
}
