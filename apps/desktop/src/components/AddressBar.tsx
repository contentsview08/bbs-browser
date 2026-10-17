// 画面のいちばん上の帯。ブラウザのアドレスバーと、ウィンドウの最小化・最大化・閉じるボタンを並べる。
// OS のタイトルバーの代わりなので、空いているところ(data-tauri-drag-region)をつかむとウィンドウを動かせ、
// ダブルクリックで最大化する。
// アドレスバーはウィンドウの真ん中に置き、ふだん開いているスレ(なければ板)の URL を出す。書き換えて Enter を押すとその板やスレを開く。

import { useState } from 'react'
import WindowControls from './WindowControls'

interface Props {
  currentUrl: string
  onOpen: (url: string) => void
  /**
   * 1 画面でスレ一覧を出しているときだけ渡す。開いていたスレに戻るボタンを左に出す
   * (1 画面ではタブの帯もスレ表示と一緒に隠れるため。一覧へ戻るボタンはスレ表示のスレタイの左にある)
   */
  onBackToThread?: () => void
}

export default function AddressBar({ currentUrl, onOpen, onBackToThread }: Props) {
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
        {onBackToThread && (
          <button
            type="button"
            onClick={onBackToThread}
            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-sm text-c-text-muted hover:text-c-text-strong hover:bg-c-surface2 transition-colors"
            title="開いていたスレに戻る"
          >
            <span className="material-symbols-outlined text-xl">forum</span>
            <span className="hidden sm:inline">スレに戻る</span>
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
