// スマホの設定などで使う、スマホ向けの部品(Android の設定画面と同じ考え方)。
// - Group: まとまりごとの、角の丸い面。中の行は線で区切る。上に題、下に補足
// - SwitchRow: 左に名前と説明、右にスイッチ。行のどこを押しても切り替わる
// - NavRow: 押すと次の画面へ(右に今の値と ›)
// - ChoiceRow: 押すと、下から選択肢のシートが出る(1 つ選ぶ)
// - TextRow: 名前・メールなどの入力欄
import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../../hooks/useFocusTrap'

export function Group(props: { title?: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-7">
      {props.title && <h3 className="px-4 mb-2.5 text-[14px] font-bold text-c-accent">{props.title}</h3>}
      <div className="mx-3 rounded-2xl bg-c-surface2 overflow-hidden divide-y divide-c-border">{props.children}</div>
      {props.note && <p className="px-4 mt-2 text-[13.5px] leading-relaxed text-c-text-muted">{props.note}</p>}
    </section>
  )
}

/** 行の中身(左に名前と説明、右に任意の部品) */
function RowBody(props: { label: string; desc?: ReactNode; right?: ReactNode; icon?: string; color?: string }) {
  return (
    <>
      {props.icon && (
        <span className="w-10 h-10 flex-shrink-0 rounded-xl flex items-center justify-center text-white" style={{ background: props.color ?? 'var(--c-accent)' }}>
          <span className="material-symbols-outlined text-[24px]">{props.icon}</span>
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className="block text-[17px] leading-snug text-c-text-strong">{props.label}</span>
        {props.desc && <span className="block mt-0.5 text-[14px] leading-relaxed text-c-text-muted">{props.desc}</span>}
      </span>
      {props.right}
    </>
  )
}

const ROW = 'w-full flex items-center gap-3.5 px-4 py-4 min-h-[64px] text-left active:bg-c-surface3 transition-colors'

export function Switch(props: { on: boolean }) {
  return (
    <span className={`relative w-12 h-7 rounded-full flex-shrink-0 transition-colors duration-200 ${props.on ? 'bg-c-accent' : 'bg-c-border-strong'}`}>
      <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-[left] duration-200 ${props.on ? 'left-6' : 'left-1'}`} />
    </span>
  )
}

export function SwitchRow(props: { label: string; desc?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className={`${ROW} disabled:opacity-40`}
    >
      <RowBody label={props.label} desc={props.desc} right={<Switch on={props.checked} />} />
    </button>
  )
}

export function NavRow(props: { label: string; desc?: ReactNode; value?: ReactNode; icon?: string; color?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={props.onClick} className={ROW}>
      <RowBody
        label={props.label}
        desc={props.desc}
        icon={props.icon}
        color={props.color}
        right={
          <span className="flex-shrink-0 flex items-center gap-1 text-[14px] text-c-text-muted">
            {props.value}
            <span className="material-symbols-outlined text-xl">chevron_right</span>
          </span>
        }
      />
    </button>
  )
}

/** 押すと何かをする行(今すぐ整理する、など) */
export function ActionRow(props: { label: string; desc?: ReactNode; icon?: string; onClick: () => void; danger?: boolean; busy?: boolean }) {
  return (
    <button type="button" onClick={props.onClick} disabled={props.busy} className={`${ROW} disabled:opacity-50`}>
      <span className={`flex-1 min-w-0 ${props.danger ? 'text-c-heat-very-hot' : 'text-c-accent'}`}>
        <span className="block text-[17px] leading-snug font-bold">{props.label}</span>
        {props.desc && <span className="block mt-0.5 text-[14px] leading-relaxed text-c-text-muted font-normal">{props.desc}</span>}
      </span>
      {props.icon && <span className={`material-symbols-outlined text-xl ${props.busy ? 'animate-spin' : ''}`}>{props.busy ? 'progress_activity' : props.icon}</span>}
    </button>
  )
}

export interface ChoiceOption<T> {
  key: T
  name: string
  desc?: string
}

export function ChoiceRow<T extends string | number>(props: { label: string; desc?: ReactNode; value: T; options: ChoiceOption<T>[]; onChange: (v: T) => void }) {
  const [open, setOpen] = useState(false)
  const current = props.options.find((o) => o.key === props.value)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={ROW}>
        <RowBody
          label={props.label}
          desc={props.desc}
          right={
            <span className="flex-shrink-0 max-w-[45%] flex items-center gap-1 text-[14px] text-c-accent">
              <span className="truncate">{current?.name ?? ''}</span>
              <span className="material-symbols-outlined text-lg">unfold_more</span>
            </span>
          }
        />
      </button>
      {open && (
        <OptionSheet
          title={props.label}
          options={props.options}
          value={props.value}
          onPick={(v) => {
            props.onChange(v)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** 下から出る、選択肢を 1 つ選ぶシート */
export function OptionSheet<T extends string | number>(props: { title: string; options: ChoiceOption<T>[]; value: T; onPick: (v: T) => void; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose)
  return createPortal(
    <div className="fixed inset-0 z-[9700] bg-black/40 flex items-end drawer-fade" onClick={props.onClose}>
      <div
        ref={boxRef}
        className="w-full max-h-[80vh] flex flex-col bg-c-surface rounded-t-3xl shadow-2xl sheet-rise"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <span className="w-10 h-1 rounded-full bg-c-border-strong" />
        </div>
        <p className="px-6 pt-2 pb-3 text-[17px] font-bold text-c-text-strong">{props.title}</p>
        <div className="flex-1 min-h-0 overflow-y-auto pb-2">
          {props.options.map((o) => {
            const on = o.key === props.value
            return (
              <button key={String(o.key)} type="button" onClick={() => props.onPick(o.key)} className="w-full flex items-center gap-4 px-6 py-4 text-left active:bg-c-surface2">
                <span className={`w-5 h-5 flex-shrink-0 rounded-full border-2 flex items-center justify-center ${on ? 'border-c-accent' : 'border-c-border-strong'}`}>
                  {on && <span className="w-2.5 h-2.5 rounded-full bg-c-accent" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-[17px] ${on ? 'font-bold text-c-text-strong' : 'text-c-text-body'}`}>{o.name}</span>
                  {o.desc && <span className="block mt-0.5 text-[14px] leading-relaxed text-c-text-muted">{o.desc}</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function TextRow(props: { label: string; value: string; placeholder?: string; onChange: (v: string) => void; type?: string }) {
  // 1 文字ごとに保存すると重いので、欄から抜けたときに保存する
  const [v, setV] = useState(props.value)
  return (
    <label className="w-full flex items-center gap-3 px-4 py-2.5 min-h-[56px]">
      <span className="flex-shrink-0 w-24 text-[17px] text-c-text-strong">{props.label}</span>
      <input
        type={props.type ?? 'text'}
        value={v}
        placeholder={props.placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== props.value && props.onChange(v)}
        className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-c-surface border border-c-border text-[17px] text-c-text-body placeholder-c-text-muted focus:outline-none focus:border-c-accent"
      />
    </label>
  )
}

/** 言葉の一覧(キーワード・定型文など)。並べて、× で外し、下の欄で足す */
export function WordList(props: { items: string[]; placeholder: string; onChange: (items: string[]) => void; empty?: string }) {
  const [text, setText] = useState('')
  const add = () => {
    const t = text.trim()
    if (!t || props.items.includes(t)) return
    props.onChange([...props.items, t])
    setText('')
  }
  return (
    <>
      {props.items.length === 0 && props.empty && <p className="px-4 py-3.5 text-[13px] text-c-text-muted">{props.empty}</p>}
      {props.items.map((w) => (
        <div key={w} className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
          <span className="flex-1 min-w-0 text-[17px] text-c-text-body break-words selectable">{w}</span>
          <button type="button" onClick={() => props.onChange(props.items.filter((x) => x !== w))} className="w-9 h-9 flex items-center justify-center rounded-full text-c-text-muted active:bg-c-surface3" title="外す">
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
          placeholder={props.placeholder}
          className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-c-surface border border-c-border text-[17px] text-c-text-body placeholder-c-text-muted focus:outline-none focus:border-c-accent"
        />
        <button type="button" onClick={add} disabled={!text.trim()} className="h-10 px-4 rounded-xl bg-c-accent text-[var(--c-accent-text)] text-[17px] font-bold disabled:opacity-40">
          足す
        </button>
      </div>
    </>
  )
}
