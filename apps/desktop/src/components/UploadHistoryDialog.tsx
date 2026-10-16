// 画像のアップロード履歴。サムネイル・URL のコピー・開く・削除。
// 削除できるのは、catbox のアカウント(userhash)で上げたものだけ(サーバー上のファイルを消してから履歴からも外す)。
// 匿名で上げたものはサーバー上では消せないので、削除ボタンを出さない

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
  /** アカウント(userhash)を登録しているか。していなければ、どれも消せない */
  canDelete: boolean
  /** サーバー上のファイルを消して、履歴からも外す */
  onDelete: (url: string) => Promise<void>
  onOpen: (url: string) => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState<string>()
  const [deleting, setDeleting] = useState<string>()
  const [error, setError] = useState<string>()

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
          {props.canDelete
            ? '削除すると、catbox 上のファイルも消えます。消せるのは、アカウント(userhash)で上げたものだけです(匿名で上げたものは消せません)。'
            : '削除するには、設定 → 書き込み で catbox のアカウント(userhash)を登録してください。匿名で上げたファイルは消せません。'}
        </p>
        {error && <p className="px-5 py-2 text-xs text-c-heat-very-hot border-b border-c-border">{error}</p>}
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
                    {props.canDelete && u.withAccount ? (
                      <button
                        type="button"
                        className={`${TOOL} hover:text-c-heat-very-hot`}
                        title="catbox から削除"
                        disabled={deleting === u.url}
                        onClick={async () => {
                          setDeleting(u.url)
                          setError(undefined)
                          try {
                            await props.onDelete(u.url)
                          } catch (e) {
                            setError(e instanceof Error ? e.message : String(e))
                          } finally {
                            setDeleting(undefined)
                          }
                        }}
                      >
                        <span className={`material-symbols-outlined text-base leading-none ${deleting === u.url ? 'animate-spin' : ''}`}>
                          {deleting === u.url ? 'progress_activity' : 'delete'}
                        </span>
                      </button>
                    ) : (
                      <span className="px-1 text-[10px] text-c-text-muted" title="匿名で上げたファイルは消せません">
                        {u.withAccount ? '' : '匿名'}
                      </span>
                    )}
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
