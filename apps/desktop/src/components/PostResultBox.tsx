// 書き込み・スレ立ての結果(エラーや認証待ち)の表示。書き込み欄とスレ立ての画面で共通。
// うまくいかなかったときは、サーバーが返したページをそのまま見られる(5ch の確認画面やエラーの中身を確かめるため)

import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { PostConfirm, PostResult } from '@bbs-browser/connectors'

/** サーバーが返したページを、そのまま表示する。スクリプトは動かさない(sandbox) */
function ServerResponse({ html, onClose }: { html: string; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[9900] bg-black/50 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="w-full max-w-3xl h-[80vh] flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pl-4 pr-2 py-2 border-b border-c-border">
          <span className="text-sm font-bold text-c-text-strong">サーバーの返答</span>
          <button type="button" onClick={onClose} className="p-1 rounded-full text-c-text-muted hover:text-c-text-strong" title="閉じる">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
        <iframe title="サーバーの返答" sandbox="" srcDoc={html} className="flex-1 w-full bg-white rounded-b-[var(--card-radius)]" />
      </div>
    </div>,
    document.body,
  )
}

/** エラーの文をここまでで切る(文字) */
const ERROR_MAX = 300

export default function PostResultBox({
  result,
  onOpenUrl,
  onConfirm,
}: {
  result: PostResult
  onOpenUrl: (url: string) => void
  /** 書き込み確認で「上記全てを承諾して書き込む」を押した */
  onConfirm?: (confirm: PostConfirm) => void
}) {
  const [showHtml, setShowHtml] = useState(false)
  if (result.status === 'ok') return <p className="mb-2 text-xs text-c-accent">{result.message}</p>
  const html = result.html
  // 返答のページがまるごと文になっているとき(スレの中身が返る掲示板など)は、頭だけ出して、全部は「サーバーの返答を見る」で
  const message = result.status !== 'confirm' && result.message.length > ERROR_MAX ? `${result.message.slice(0, ERROR_MAX).trimEnd()}…` : result.message
  // 失敗は赤、書き込み確認(Cookie の承諾など)は強調色の枠にする
  return (
    <div
      className="mb-2 px-3 py-2 text-sm rounded-[var(--card-radius)] border"
      style={
        result.status === 'confirm'
          ? { borderColor: 'var(--c-accent)', background: 'var(--c-accent-wash)' }
          : { borderColor: 'var(--c-error)', background: 'var(--c-error-wash)' }
      }
    >
      <div className="flex items-start gap-2">
        <p
          className={`flex-1 text-c-text-body whitespace-pre-wrap break-all ${result.status === 'confirm' ? 'max-h-40 overflow-y-auto custom-scrollbar text-xs' : ''}`}
        >
          {result.status === 'confirm' && <span className="block mb-1 text-sm font-bold text-c-text-strong">書き込み確認</span>}
          {message}
        </p>
        {html && (
          <button
            type="button"
            onClick={() => setShowHtml(true)}
            className="flex-shrink-0 text-xs text-c-text-muted hover:text-c-accent underline"
          >
            サーバーの返答を見る
          </button>
        )}
      </div>
      {showHtml && html && <ServerResponse html={html} onClose={() => setShowHtml(false)} />}
      {result.status === 'confirm' && onConfirm && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onConfirm(result.confirm)}
            className="px-3 py-1 text-sm font-bold rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover"
          >
            上記全てを承諾して書き込む
          </button>
          <span className="text-xs text-c-text-muted">初めて書き込むときに、利用規約などへの承諾を求められています</span>
        </div>
      )}
      {result.status === 'auth' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {result.code && (
            <>
              <span className="text-xs text-c-text-muted">認証コード</span>
              <span className="font-mono font-bold text-base text-c-text-strong tracking-widest">{result.code}</span>
              <button
                type="button"
                className="p-1 text-c-text-muted hover:text-c-text-strong"
                title="コピー"
                onClick={() => void navigator.clipboard.writeText(result.code!)}
              >
                <span className="material-symbols-outlined text-base">content_copy</span>
              </button>
            </>
          )}
          {result.url && (
            <button
              type="button"
              onClick={() => onOpenUrl(result.url!)}
              className="px-3 py-1 text-sm rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover"
            >
              認証ページを開く
            </button>
          )}
          <span className="text-xs text-c-text-muted">認証が済んだら、もう一度送ってください</span>
        </div>
      )}
    </div>
  )
}
