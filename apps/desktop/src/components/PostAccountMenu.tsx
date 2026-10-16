// 書き込むときに使うアカウント(5ch の BE など)を選ぶ。書き込み欄とスレ立ての画面の「sage」の右に置く。
// 使うアカウントは札で見せ(BE 付きで書き込むことが分かるように)、︙ を押すとオン・オフを選べる。
// その板で使えるアカウントがないときは何も出さない

import { useEffect, useRef, useState } from 'react'

export interface PostAccountOption {
  id: string
  name: string
  /** 登録してあるか(していなければ選べない) */
  registered: boolean
  /** この書き込みで使うか */
  on: boolean
}

export default function PostAccountMenu(props: {
  options: PostAccountOption[]
  onToggle: (id: string, on: boolean) => void
  /** 登録していないとき、設定のアカウントの画面を開く */
  onOpenSettings: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  if (props.options.length === 0) return null
  const using = props.options.filter((o) => o.registered && o.on)

  return (
    <div className="relative flex items-center gap-1" ref={ref}>
      {using.map((o) => (
        <span
          key={o.id}
          className="text-[10px] font-bold px-1.5 py-px rounded"
          style={{ color: 'var(--c-accent)', border: '1px solid var(--c-accent)' }}
          title={`${o.name} で書き込みます`}
        >
          {o.name}
        </span>
      ))}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="p-0.5 rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface2"
        style={open ? { color: 'var(--c-accent)' } : undefined}
        title="書き込むときに使うアカウント"
      >
        <span className="material-symbols-outlined text-lg leading-none">more_vert</span>
      </button>
      {open && (
        <div className="absolute left-0 bottom-full mb-1.5 w-64 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl py-1 z-40 text-sm">
          <p className="px-3 pt-1.5 pb-1 text-[10px] font-bold text-c-text-muted tracking-wide">書き込むときに使うアカウント</p>
          {props.options.map((o) =>
            o.registered ? (
              <label key={o.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-c-surface2 select-none">
                <input type="checkbox" checked={o.on} onChange={(e) => props.onToggle(o.id, e.target.checked)} className="rounded" />
                <span className="flex-1 text-c-text-body">{o.name} でログインして書き込む</span>
              </label>
            ) : (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  props.onOpenSettings()
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-c-surface2"
              >
                <span className="material-symbols-outlined text-base text-c-text-muted">badge</span>
                <span className="flex-1 text-c-text-muted">
                  {o.name} は未登録です
                  <span className="block text-[10px]">押すと設定のアカウントを開きます</span>
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
