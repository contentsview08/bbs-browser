// 画像のアップロード履歴。サムネイル・URL のコピー・開く・履歴から消す。
// 匿名で上げた catbox のファイルはサーバー上では消せないので、「消す」はアプリの履歴から消すだけ

import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { UploadRecord } from '@bbs-browser/logstore'

const TOOL = 'p-1.5 rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface3 transition-colors'

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export default function UploadHistoryDialog(props: {
  uploads: UploadRecord[]
  onRemove: (url: string) => void
  onOpen: (url: string) => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState<string>()

  return createPortal(
    <div className="fixed inset-0 z-[9900] bg-black/50 flex items-center justify-center p-6" onClick={props.onClose}>
      <div
        className="w-full max-w-3xl h-[80vh] flex flex-col bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-2xl rise-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pl-5 pr-2 py-2.5 border-b border-c-border">
          <h2 className="text-base font-bold text-c-text-strong">
            アップロード履歴 <span className="ml-1 text-sm font-normal text-c-text-muted">{props.uploads.length}</span>
          </h2>
          <button type="button" onClick={props.onClose} className="p-1 rounded-full text-c-text-muted hover:text-c-text-strong" title="閉じる">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
        <p className="px-5 py-2 text-xs text-c-text-muted border-b border-c-border">
          ここから消しても、アプリの履歴から消えるだけです。匿名で上げた catbox のファイルは、サーバー上では消せません。
        </p>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          {props.uploads.length === 0 ? (
            <p className="text-sm text-c-text-muted">まだありません</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              {props.uploads.map((u) => (
                <div key={u.url} className="group flex flex-col bg-c-surface2 border border-c-border rounded-[var(--card-radius)] overflow-hidden">
                  <button type="button" onClick={() => props.onOpen(u.url)} className="h-28 bg-c-surface3" title="ブラウザで開く">
                    <img src={u.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  </button>
                  <div className="px-2 pt-1.5">
                    <p className="text-xs text-c-text-body truncate" title={u.name}>
                      {u.name}
                    </p>
                    <p className="text-[10px] text-c-text-muted">
                      {new Date(u.uploadedAt).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })} ・ {formatSize(u.size)}
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-0.5 px-1 pb-1">
                    <button
                      type="button"
                      className={TOOL}
                      title="URL をコピー"
                      onClick={() => {
                        void navigator.clipboard.writeText(u.url)
                        setCopied(u.url)
                      }}
                    >
                      <span className="material-symbols-outlined text-base leading-none">{copied === u.url ? 'check' : 'content_copy'}</span>
                    </button>
                    <button type="button" className={TOOL} title="ブラウザで開く" onClick={() => props.onOpen(u.url)}>
                      <span className="material-symbols-outlined text-base leading-none">open_in_new</span>
                    </button>
                    <button type="button" className={`${TOOL} hover:text-c-heat-very-hot`} title="履歴から消す" onClick={() => props.onRemove(u.url)}>
                      <span className="material-symbols-outlined text-base leading-none">delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
