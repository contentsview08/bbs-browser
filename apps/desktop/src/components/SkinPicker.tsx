// スキンを選ぶ札の並び: 同梱の配色のあとに、保存した・取り込んだスキン(色だけのものも、見た目まで含むものも)。
// 設定の「配色とスキン」の節と、表示スタイルの窓の「ほかのスキンも見る…」で開く窓(SkinDialog)で使う。スマホのアプリの SkinPanel と同じ考え方
import { DEFAULT_SETTINGS, COLOR_SCHEMES, POST_STYLES, isDarkScheme, pickScheme, type AppSettings, type ColorScheme, type UpdateSetting } from '../ui/settings'
import { customVars, isCustomDark, parseCustom } from '../ui/customScheme'
import { lookThemeByKey, lookThemeName, lookThemePatch, lookThemeSwatch, type LookTheme } from '../ui/lookTheme'
import { ManagerDialog } from './SettingParts'
import { OPEN_SETTINGS_EVENT } from './StyleMenu'

type Props = { settings: AppSettings; update: UpdateSetting }

/** 保存したスキンの札(配色の札と同じ形。地の上に 面・強調・未読・字の代表の色)。押すと当てる。親の grid の中に並べる */
export function SkinCards({ settings: s, update }: Props) {
  const applyKey = (key: string) => {
    const text = lookThemeByKey(s, key)
    if (!text) return
    const r = lookThemePatch(text, DEFAULT_SETTINGS)
    if (typeof r === 'string') return
    for (const [k, v] of Object.entries(r.patch)) update(k as keyof AppSettings, v as never)
    update('lookThemeKey', key)
  }
  return (
    <>
      {s.lookThemes.map((t) => {
        const key = `saved:${lookThemeName(t)}`
        const on = s.lookThemeKey === key
        const sw = lookThemeSwatch(t) ?? ['var(--c-base)', 'var(--c-surface)', 'var(--c-accent)', 'var(--c-accent-self)', 'var(--c-text-strong)']
        return (
          <button
            key={key}
            type="button"
            onClick={() => applyKey(key)}
            className={`flex items-center gap-2.5 px-3 py-2 text-sm border rounded-[var(--card-radius)] transition-colors ${on ? 'border-c-accent text-c-text-strong' : 'border-c-border text-c-text-body hover:border-c-border-strong'}`}
          >
            <span className="flex items-center gap-1 px-1.5 py-1 rounded flex-shrink-0" style={{ background: sw[0], boxShadow: 'inset 0 0 0 1px var(--c-border)' }}>
              {sw.slice(1).map((c, i) => (
                <span key={i} className="w-3 h-3 rounded-[3px]" style={{ background: c, boxShadow: 'inset 0 0 0 1px rgba(128,128,128,0.4)' }} />
              ))}
            </span>
            <span className="flex-1 text-left truncate">{lookThemeName(t)}</span>
            {on && <span className="material-symbols-outlined text-base text-c-accent">check</span>}
          </button>
        )
      })}
    </>
  )
}

/** 同梱の配色と保存したスキンの札の並び(OS に合わせているときは配色だけ。スキンは呼ぶ側が別に並べる) */
export function SkinPicker({ settings: s, update }: Props) {
  return (
<div className="grid grid-cols-2 gap-2">
      {[...COLOR_SCHEMES, ...(parseCustom(s.customScheme) ? [{ key: 'custom' as const, name: '自分の配色', accent: parseCustom(s.customScheme)!.accent, border: 'var(--c-border)' }] : [])].map((c) => {
        const chosen = s.followOsTheme ? c.key === s.darkScheme || c.key === s.lightScheme : s.scheme === c.key
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              for (const [k, v] of Object.entries(pickScheme(s, c.key))) update(k as keyof AppSettings, v as never)
              if (s.lookThemeKey) update('lookThemeKey', '')
            }}
            className={`flex items-center gap-2.5 px-3 py-2 text-sm border rounded-[var(--card-radius)] transition-colors ${
              chosen && !s.lookThemeKey ? 'border-c-accent text-c-text-strong' : 'border-c-border text-c-text-body hover:border-c-border-strong'
            }`}
          >
            <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: c.accent, boxShadow: `inset 0 0 0 1px ${c.border}` }} />
            <span className="flex-1 text-left">{c.name}</span>
            {s.followOsTheme && (
              <span className="text-[10px] text-c-text-muted">
                {(c.key === 'custom' ? isCustomDark(parseCustom(s.customScheme)!) : isDarkScheme(c.key)) ? 'ダーク' : 'ライト'}
                {chosen && 'で使う'}
              </span>
            )}
          </button>
        )
      })}
      {/* 保存したスキンは同じ族として同じ並びに(色だけのものも、見た目まで含むものも)。OS に合わせているときは下の「スキン」の節に */}
      {!s.followOsTheme && <SkinCards settings={s} update={update} />}
</div>
  )
}

/** スキン(配色)1 つの大きな札: 見本(上の帯・スレ一覧の行・レス・書き込み欄)と、名前・一言。押すと当てる。
 * 見本の色は、同梱の配色なら data-scheme で、スキンの自分の配色なら CSS の変数を直に入れて描く */
function SkinCard(props: { name: string; caption: string; on: boolean; schemeKey?: string; vars?: Record<string, string>; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onPick}
      className={`text-left rounded-[var(--card-radius)] border bg-c-surface overflow-hidden transition-colors ${props.on ? 'border-c-accent' : 'border-c-border hover:border-c-border-strong'}`}
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
      <div className="flex items-center gap-2 px-2.5 pb-2">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-c-text-strong truncate">{props.name}</div>
          {props.caption && <div className="text-[11px] text-c-text-muted truncate">{props.caption}</div>}
        </div>
        {props.on && <span className="material-symbols-outlined text-base text-c-accent">check</span>}
      </div>
    </button>
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

/**
 * 表示スタイルの窓の「ほかのスキンも見る…」で開く窓。配色もスキンも同じ族として、大きな見本の札で並べて眺めて選ぶ(拡張機能の一覧のように)。
 * 前の方が同梱の配色、後ろが保存した・取り込んだスキン。選ぶだけ。保存・色の編集は設定の「表示」で
 */
export function SkinDialog(props: Props & { onClose: () => void }) {
  const { settings: s, update } = props
  const pickScheme2 = (key: ColorScheme) => {
    for (const [k, v] of Object.entries(pickScheme(s, key))) update(k as keyof AppSettings, v as never)
    if (s.lookThemeKey) update('lookThemeKey', '')
  }
  const applyKey = (key: string) => {
    const text = lookThemeByKey(s, key)
    if (!text) return
    const r = lookThemePatch(text, DEFAULT_SETTINGS)
    if (typeof r === 'string') return
    for (const [k, v] of Object.entries(r.patch)) update(k as keyof AppSettings, v as never)
    update('lookThemeKey', key)
  }
  const schemes = s.followOsTheme ? COLOR_SCHEMES : COLOR_SCHEMES
  return (
    <ManagerDialog title="スキン" onClose={props.onClose} wide>
      <p className="text-xs text-c-text-muted mb-2">前の方が同梱の配色、後ろが保存した・取り込んだスキン(色だけのものも、見た目まで含むものも)。押すとその場で切り替わります</p>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {schemes.map((c) => {
          const dark = isDarkScheme(c.key)
          const on = s.followOsTheme ? (dark ? s.darkScheme === c.key : s.lightScheme === c.key) : !s.lookThemeKey && s.scheme === c.key
          return <SkinCard key={c.key} name={c.name} caption={dark ? '暗い配色' : '明るい配色'} on={on} schemeKey={c.key} onPick={() => pickScheme2(c.key)} />
        })}
        {s.lookThemes.map((t) => {
          const key = `saved:${lookThemeName(t)}`
          const d = t.scheme && typeof t.scheme === 'object' ? parseCustom(JSON.stringify(t.scheme)) : null
          const schemeKey = typeof t.settings?.scheme === 'string' && t.settings.scheme !== 'custom' ? (t.settings.scheme as string) : undefined
          return (
            <SkinCard
              key={key}
              name={lookThemeName(t)}
              caption={captionOf(t)}
              on={s.lookThemeKey === key}
              schemeKey={d ? undefined : schemeKey}
              vars={d ? { ...customVars(d), '--c-own': d.own } : undefined}
              onPick={() => applyKey(key)}
            />
          )
        })}
      </div>
      <button
        type="button"
        className="mt-3 text-sm text-c-accent hover:underline"
        onClick={() => {
          props.onClose()
          window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: 'display' }))
        }}
      >
        スキンの保存・色の編集は 設定 → 表示 で…
      </button>
    </ManagerDialog>
  )
}
