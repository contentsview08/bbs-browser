// 画面のいちばん上の帯。ブラウザのアドレスバーと、ウィンドウの最小化・最大化・閉じるボタンを並べる。
// OS のタイトルバーの代わりなので、空いているところ(data-tauri-drag-region)をつかむとウィンドウを動かせ、
// ダブルクリックで最大化する。
// アドレスバーはウィンドウの真ん中に置き、ふだん開いているスレ(なければ板)の URL を出す。書き換えて Enter を押すとその板やスレを開く。

import { useState } from 'react'
import WindowControls from './WindowControls'

interface Props {
  currentUrl: string
  onOpen: (url: string) => void
  /** 縦長のときだけ渡す。スレ一覧を引き出すボタンを左に出す */
  onToggleList?: () => void
  listOpen?: boolean
}

export default function AddressBar({ currentUrl, onOpen, onToggleList, listOpen }: Props) {
  // 書き換えている間だけ自分で値を持つ。確定するか、外へ出たら現在の URL に戻す
  const [draft, setDraft] = useState<string>()

  // 3 つの列に分け、真ん中の列にアドレスバーを置く(ウィンドウの真ん中にそろう)。
  // 左右の列は同じ幅なので、右にウィンドウのボタンがあっても真ん中はずれない。空いているところはつかめる
  return (
    <div
      data-tauri-drag-region
      className="flex-shrink-0 h-10 grid grid-cols-[1fr_minmax(0,48rem)_1fr] items-center gap-2 bg-panel-addressbar border-b border-c-border select-none"
    >
      <div data-tauri-drag-region className="min-w-0 h-full flex items-center px-3">
        {onToggleList && (
          <button
            type="button"
            onClick={onToggleList}
            className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${listOpen ? 'text-c-accent bg-c-surface2' : 'text-c-text-muted hover:text-c-text-strong'}`}
            title="スレ一覧"
          >
            <span className="material-symbols-outlined text-xl">view_list</span>
          </button>
        )}
      </div>
      <form
        className="min-w-0 flex items-center gap-2 px-3 bg-c-surface2 border border-c-border rounded-full focus-within:border-c-accent transition-colors"
        onSubmit={(e) => {
          e.preventDefault()
          const url = (draft ?? '').trim()
          setDraft(undefined)
          ;(document.activeElement as HTMLElement | null)?.blur()
          if (url && url !== currentUrl) onOpen(url)
        }}
      >
        <span className="material-symbols-outlined text-base text-c-text-muted">link</span>
        <input
          type="text"
          value={draft ?? currentUrl}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => {
            setDraft(currentUrl)
            e.currentTarget.select()
          }}
          onBlur={() => setDraft(undefined)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(undefined)
              e.currentTarget.blur()
            }
          }}
          placeholder="板やスレの URL を入れて Enter"
          spellCheck={false}
          className="flex-1 min-w-0 bg-transparent border-0 p-0 py-1 text-sm text-c-text-body placeholder-c-text-muted focus:ring-0"
        />
      </form>
      <div data-tauri-drag-region className="h-full flex items-center justify-end">
        <WindowControls />
      </div>
    </div>
  )
}
