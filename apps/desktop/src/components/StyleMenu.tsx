// 表示スタイルのパレットメニュー。web 版の ThreadListStyleMenu.tsx を移植
// (設定の読み書きを settingsStore から props に置き換え、'panel' 表示を外した)

import { useEffect, useRef, useState } from 'react'
import { isMobile } from '../utils/platform'
import { PICKABLE_SCHEMES, ACCENTS, isDarkScheme, baseFontPx, MOBILE_POST_STYLES, POST_STYLES, effectivePostStyle, effectiveScheme, pickSchemeNow, type AppSettings, type UpdateSetting } from '../ui/settings'

const MENU_ITEM = 'w-full flex items-center gap-2.5 px-3 py-2 text-c-text-body hover:bg-c-surface2 transition-colors'
const GROUP_LABEL = 'px-3 pt-1.5 pb-1 text-[10px] font-bold text-c-text-muted tracking-wide'

/** メニューの中身(︙ の中でも使う) */
/**
 * 画面全体の文字サイズの画面を開く知らせ(App が受けて開く)。
 * メニューの中で開くと、画面を押した瞬間にメニューが閉じて一緒に消えるので、メニューの外(App)に置く
 */
export const OPEN_FONT_DIALOG = 'bbs:open-font-dialog'

export function StyleMenuItems({ settings, update }: { settings: AppSettings; update: UpdateSetting }) {
  const check = <span className="material-symbols-outlined text-base text-c-accent">check</span>
  return (
    <>
      <p className={GROUP_LABEL}>テーマ</p>
      {PICKABLE_SCHEMES.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => {
            for (const [k, v] of Object.entries(pickSchemeNow(settings, s.key))) update(k as keyof AppSettings, v as never)
          }}
          className={MENU_ITEM}
        >
          <span
            className="w-4 h-4 rounded-full flex-shrink-0"
            style={{ background: s.accent, boxShadow: `inset 0 0 0 1px ${s.border}` }}
          />
          <span className="flex-1 text-left truncate">{s.name}</span>
          {/* 印は、いま見えている配色だけに付ける(OS に合わせているとき、ダーク用とライト用の 2 つに付いていた) */}
          {effectiveScheme(settings) === s.key && check}
        </button>
      ))}
      <p className={GROUP_LABEL}>差し色</p>
      {/* 差し色(スマホのアプリ・hono-bbs の web と同じ 8 色)。左端の「テーマ」はテーマの色に戻す */}
      <div className="flex flex-wrap gap-2 px-3 pb-2">
        {[{ key: '', name: 'テーマ', color: '' }, ...ACCENTS.map((a) => ({ key: a.key, name: a.name, color: isDarkScheme(effectiveScheme(settings)) ? a.dark : a.light }))].map((a) => {
          const on = settings.accent === a.key
          return (
            <button key={a.key || 'theme'} type="button" onClick={() => update('accent', a.key)} title={a.name} className="flex flex-col items-center gap-0.5 w-9">
              <span
                data-scheme={a.key ? undefined : effectiveScheme(settings)}
                className="w-6 h-6 rounded-full"
                style={{ background: a.color || 'var(--c-accent)', border: on ? '2px solid var(--c-text-strong)' : '1px solid var(--c-border)' }}
              />
              <span className={`text-[10px] leading-none whitespace-nowrap ${on ? 'text-c-text-strong' : 'text-c-text-muted'}`}>{a.name}</span>
            </button>
          )
        })}
      </div>

      <div className="my-1 border-t border-c-border" />

      <p className={GROUP_LABEL}>レスの見た目</p>
      {(isMobile ? MOBILE_POST_STYLES : POST_STYLES).map((b) => (
        <button key={b.key} type="button" onClick={() => update('postStyle', b.key)} className={MENU_ITEM} title={b.note}>
          <span className="flex-1 text-left truncate">{b.name}</span>
          {effectivePostStyle(settings) === b.key && check}
        </button>
      ))}

      <div className="my-1 border-t border-c-border" />

      {/* 文字サイズのスライダーは、メニューの中ではなく真ん中の小さな画面で(動かすとメニューごと大きさが変わってずれるので) */}
      <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_FONT_DIALOG))} className={MENU_ITEM}>
        <span className="material-symbols-outlined text-base flex-shrink-0">format_size</span>
        <span className="flex-1 text-left truncate">文字サイズ(画面全体)</span>
        <span className="text-xs tabular-nums text-c-text-muted">{baseFontPx(settings)}px</span>
      </button>
    </>
  )
}

/** パレットのボタンと、押すと開くメニュー。up ならメニューを上に開く(フッターに置いたとき) */
export default function StyleMenu({ settings, update, up }: { settings: AppSettings; update: UpdateSetting; up?: boolean }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div className="relative flex-shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 text-c-text-muted hover:text-c-text-strong transition-colors rounded-lg flex-shrink-0"
        title="表示スタイル"
      >
        <span className="material-symbols-outlined text-lg">palette</span>
      </button>
      {open && (
        <div className={`absolute right-0 ${up ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} w-64 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl py-1 z-30 text-sm max-h-[80vh] overflow-y-auto`}>
          <StyleMenuItems settings={settings} update={update} />
        </div>
      )}
    </div>
  )
}
