// 書き込み・スレ立ての結果(エラーや認証待ち)の表示。書き込み欄とスレ立ての画面で共通

import type { PostResult } from '@bbs-browser/connectors'

export default function PostResultBox({ result, onOpenUrl }: { result: PostResult; onOpenUrl: (url: string) => void }) {
  if (result.status === 'ok') return <p className="mb-2 text-xs text-c-accent">{result.message}</p>
  return (
    <div
      className="mb-2 px-3 py-2 text-sm rounded-[var(--card-radius)] border"
      style={{ borderColor: 'var(--c-accent-self)', background: 'var(--c-accent-self-wash)' }}
    >
      <p className="text-c-text-body whitespace-pre-wrap break-all">{result.message}</p>
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
