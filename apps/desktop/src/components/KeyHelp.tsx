// キー操作の一覧(? キーで開く)。割り当ては設定のいまの値を出す。決め打ちのキーも並べる

import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose } from '../hooks/useDialogClose'
import { FIXED_KEYS, KEY_ACTIONS, keyLabel, type Keymap } from '../utils/keymap'

export default function KeyHelp(props: { keymap: Keymap; onClose: () => void }) {
  const group = (where: 'view' | 'app') =>
    KEY_ACTIONS.filter((a) => a.where === where && props.keymap[a.key].length > 0).map((a) => ({ keys: props.keymap[a.key], name: a.name }))
  const sections: { title: string; rows: { keys: string[]; name: string }[] }[] = [
    { title: 'スレ表示・スレ一覧(キーを受け取っている方)', rows: group('view') },
    { title: 'アプリ全体', rows: group('app') },
    { title: '決まっているキー', rows: FIXED_KEYS.map((f) => ({ keys: [f.keys], name: f.name })) },
  ]
  // Tab・矢印はこの中だけで回し、Esc で閉じる。開いている間は後ろの画面のキー操作を止める
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose)
  const backdrop = useBackdropClose(props.onClose)
  return createPortal(
    <div
      className="fixed inset-0 z-[9900] bg-black/50 flex items-center justify-center p-6"
      {...backdrop}
      onKeyDown={(e) => {
        if (e.key === '?') {
          e.preventDefault()
          props.onClose()
        }
      }}
    >
      <div
        ref={boxRef}
        className="w-full max-w-4xl max-h-[85vh] flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-2xl rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pl-5 pr-2 py-2.5 border-b border-c-border">
          <h2 className="text-base font-bold text-c-text-strong">キー操作</h2>
          {/* 開いたらここに入って、Esc・? を受け取る */}
          <button type="button" autoFocus onClick={props.onClose} className="p-1 rounded-full text-c-text-muted hover:text-c-text-strong" title="閉じる(Esc)">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
          {sections.map((sec) => (
            <section key={sec.title} className={sec.title === '決まっているキー' ? 'md:col-span-2' : ''}>
              <h3 className="mb-2 text-xs font-bold text-c-text-muted">{sec.title}</h3>
              <ul className="space-y-1">
                {sec.rows.map((r) => (
                  <li key={r.name} className="flex items-baseline gap-3 text-sm">
                    <span className="w-36 flex-shrink-0 flex flex-wrap gap-1">
                      {r.keys.map((k) => (
                        <kbd key={k} className="px-1.5 py-0.5 text-[11px] font-mono rounded border border-c-border bg-c-surface2 text-c-text-strong">
                          {keyLabel(k)}
                        </kbd>
                      ))}
                    </span>
                    <span className="text-c-text-body">{r.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="px-5 py-2 border-t border-c-border text-xs text-c-text-muted">割り当ては 設定 → キー操作 で変えられます</p>
      </div>
    </div>,
    document.body,
  )
}
