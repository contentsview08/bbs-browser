// 読み込めなかったときの表示: 理由と「もう一度読み込む」ボタン(スマホのアプリの LoadError と同じ)。
// スレ一覧・スレ表示の、中身が空のところに出す。引っぱって更新・更新ボタンでも取り直せる

/** 読み込めなかった理由を、人に分かる言葉にする(ブラウザの通信の失敗は英語の決まり文句なので言い換える) */
export function loadErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/Failed to fetch|NetworkError|Load failed|network|ERR_INTERNET_DISCONNECTED|dns|error sending request/i.test(msg))
    return 'ネットにつながっていないか、掲示板のサーバーにつながりませんでした'
  if (/timed? ?out|timeout/i.test(msg)) return '掲示板のサーバーから時間内に返事がありませんでした'
  return msg
}

export default function LoadFailed(props: { message: string; loading?: boolean; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-8 py-16 text-center">
      <p className="text-[15px] font-bold text-c-text-strong">読み込めませんでした</p>
      <p className="text-[13px] text-c-text-muted break-all">{props.message}</p>
      {props.onRetry && (
        <button
          type="button"
          disabled={props.loading}
          onClick={props.onRetry}
          className="mt-3 flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-sm disabled:opacity-70"
          style={{ background: 'var(--c-accent)', color: 'var(--c-accent-text)' }}
        >
          <span className={`material-symbols-outlined text-lg ${props.loading ? 'animate-spin' : ''}`}>{props.loading ? 'progress_activity' : 'refresh'}</span>
          {props.loading ? '読み込んでいます…' : 'もう一度読み込む'}
        </button>
      )}
      {props.onRetry && <p className="text-xs text-c-text-muted">引っぱって更新・更新ボタンでも読み込み直せます</p>}
    </div>
  )
}
