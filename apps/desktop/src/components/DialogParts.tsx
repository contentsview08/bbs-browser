// ダイアログの共通の部品(PC)。頭(題と ×)とボタンの形を 1 か所に決め、画面ごとのばらつきをなくす
import type { ReactNode } from 'react'

/** 設定の入力欄 */
export const INPUT =
  'bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted py-1.5 focus:ring-c-accent focus:border-c-accent'
/** 設定の小さなアイコンのボタン */
export const ICON_BTN = 'p-1 text-c-text-muted hover:text-c-text-strong transition-colors rounded'
/** 主なボタン(差し色の塗り)・ふつうのボタン(線)・消すボタン(赤の塗り)。高さ 32px・角は --btn-radius */
export const BTN_PRIMARY =
  'h-8 px-3 text-sm font-bold rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover transition-colors disabled:opacity-50'
export const BTN_SECONDARY = 'h-8 px-3 text-sm rounded-[var(--btn-radius)] border border-c-border text-c-text-body hover:border-c-border-strong transition-colors disabled:opacity-50'
export const BTN_DANGER = 'h-8 px-3 text-sm font-bold rounded-[var(--btn-radius)] text-white hover:opacity-90 transition-colors disabled:opacity-50'
/** アイコンだけのボタン(× など) */
export const BTN_ICON = 'p-1.5 rounded-md text-c-text-muted hover:text-c-text-strong hover:bg-c-surface2 transition-colors'

export function Button(props: { variant?: 'primary' | 'secondary' | 'danger'; children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string; autoFocus?: boolean; className?: string }) {
  const cls = props.variant === 'primary' ? BTN_PRIMARY : props.variant === 'danger' ? BTN_DANGER : BTN_SECONDARY
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      autoFocus={props.autoFocus}
      className={`${cls} ${props.className ?? ''}`}
      style={props.variant === 'danger' ? { background: 'var(--c-error)' } : undefined}
    >
      {props.children}
    </button>
  )
}

/** ダイアログの頭: 題(左)と ×(右)。高さ 48px。sub は題の右の薄い文、extra は題と × の間に置くもの(検索の欄など) */
export function DialogHeader(props: { title: ReactNode; sub?: ReactNode; extra?: ReactNode; onClose: () => void; closeTitle?: string; closeAutoFocus?: boolean }) {
  return (
    <div className="flex-shrink-0 flex items-center gap-3 pl-5 pr-2 h-12 border-b border-c-border">
      <h2 className="min-w-0 truncate text-base font-bold text-c-text-strong whitespace-nowrap">
        {props.title}
        {props.sub && <span className="ml-2 text-sm font-normal text-c-text-muted">{props.sub}</span>}
      </h2>
      {props.extra && <div className="flex-1 min-w-0 flex items-center">{props.extra}</div>}
      {!props.extra && <span className="flex-1" />}
      <button type="button" autoFocus={props.closeAutoFocus} onClick={props.onClose} className={BTN_ICON} title={props.closeTitle ?? '閉じる'}>
        <span className="material-symbols-outlined text-lg leading-none">close</span>
      </button>
    </div>
  )
}
