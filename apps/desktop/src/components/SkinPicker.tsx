// スキンを選ぶ札の並び: 同梱の配色のあとに、保存した・取り込んだスキン(色だけのものも、見た目まで含むものも)。
// 設定の「配色とスキン」の節と、表示スタイルの窓の「ほかのスキンも見る…」で開く窓(SkinDialog)で使う。スマホのアプリの SkinPanel と同じ考え方
import { DEFAULT_SETTINGS, COLOR_SCHEMES, isDarkScheme, pickScheme, type AppSettings, type UpdateSetting } from '../ui/settings'
import { isCustomDark, parseCustom } from '../ui/customScheme'
import { lookThemeByKey, lookThemeName, lookThemePatch, lookThemeSwatch } from '../ui/lookTheme'
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

/** 表示スタイルの窓の「ほかのスキンも見る…」で開く窓。選ぶだけ。保存・色の編集は設定の「表示」で */
export function SkinDialog(props: Props & { onClose: () => void }) {
  const { settings: s } = props
  return (
    <ManagerDialog title="スキン" onClose={props.onClose}>
      <p className="text-xs text-c-text-muted mb-2">
        {s.lookThemes.length && !s.followOsTheme ? '前の方が同梱の配色、後ろが保存したスキン(色だけのものも、見た目まで含むものも)。押すとその場で切り替わります' : '同梱の配色です。保存した・取り込んだスキンもここに並びます'}
      </p>
      <SkinPicker settings={s} update={props.update} />
      {s.followOsTheme && s.lookThemes.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <SkinCards settings={s} update={props.update} />
        </div>
      )}
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
