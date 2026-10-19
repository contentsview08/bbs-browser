// 画面のいちばん上の帯。ブラウザのアドレスバーと、ウィンドウの最小化・最大化・閉じるボタンを並べる。
// OS のタイトルバーの代わりなので、空いているところ(data-tauri-drag-region)をつかむとウィンドウを動かせ、
// ダブルクリックで最大化する。
// アドレスバーはウィンドウの真ん中に置き、ふだん開いているスレ(なければ板)の URL を出す。書き換えて Enter を押すとその板やスレを開く。

import { useState } from 'react'
import WindowControls from './WindowControls'

interface Props {
  currentUrl: string
  onOpen: (url: string) => void
  /** 戻る・進む(見たスレ一覧・スレを行き来する) */
  onBack: () => void
  onForward: () => void
  canBack: boolean
  canForward: boolean
  /** スマホ: 左に出すメニュー(サイドバーの引き出し)のボタン。あればウィンドウのボタンは出さない */
  onMenu?: () => void
}

const NAV_BTN =
  'flex-shrink-0 p-1.5 rounded-lg text-c-text-muted hover:text-c-text-strong hover:bg-c-surface2 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-c-text-muted'

export default function AddressBar({ currentUrl, onOpen, onBack, onForward, canBack, canForward, onMenu }: Props) {
  // 書き換えている間だけ自分で値を持つ。確定するか、外へ出たら現在の URL に戻す
  const [draft, setDraft] = useState<string>()

  // 3 つの列に分け、真ん中の列にアドレスバーを置く(ウィンドウの真ん中にそろう)。
  // 左右の列は同じ幅なので、右にウィンドウのボタンがあっても真ん中はずれない。空いているところはつかめる
  return (
    <div
      data-tauri-drag-region
      className={`flex-shrink-0 h-10 grid items-center gap-2 bg-panel-addressbar border-b border-c-border select-none ${
        // スマホ: ウィンドウのボタンがないので、右の列はなくし、URL 欄を右端まで広げる
        onMenu ? 'grid-cols-[max-content_minmax(0,1fr)] pr-2' : 'grid-cols-[minmax(max-content,1fr)_minmax(0,48rem)_minmax(max-content,1fr)]'
      }`}
    >
      {/* 左右の列は、中身(ボタン)の幅より狭くしない(縮むと、はみ出したボタンに URL 欄が重なって押せなくなる) */}
      <div data-tauri-drag-region className="h-full flex items-center gap-0.5 px-2">
        {onMenu && (
          <button type="button" onClick={onMenu} className={NAV_BTN} title="メニュー">
            <span className="material-symbols-outlined text-xl">menu</span>
          </button>
        )}
        {/* 戻る・進む(マウスの戻る/進むボタン、Alt+← → でも) */}
        <button type="button" onClick={onBack} disabled={!canBack} className={NAV_BTN} title="戻る (Alt+←)">
          <span className="material-symbols-outlined text-xl">arrow_back</span>
        </button>
        <button type="button" onClick={onForward} disabled={!canForward} className={NAV_BTN} title="進む (Alt+→)">
          <span className="material-symbols-outlined text-xl">arrow_forward</span>
        </button>
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
          id="address-input"
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
      {!onMenu && (
        <div data-tauri-drag-region className="h-full flex items-center justify-end">
          <WindowControls />
        </div>
      )}
    </div>
  )
}
