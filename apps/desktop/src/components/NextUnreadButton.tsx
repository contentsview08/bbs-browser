// スレの最後(-END- の下)に出す、横長の「次の未読スレへ」(PC)。
// いまのスレ一覧(板・閲覧履歴・お気に入りのスレ)に見えている並びで、いまのスレの次に未読のあるスレを開く

export default function NextUnreadButton(props: {
  /** 次のスレのスレタイ。未読のあるスレがなければ '' */
  title: string
  count: number
  /** 探した一覧の名前(板の名前・閲覧履歴・お気に入りのスレ) */
  listTitle: string
  onOpen: () => void
}) {
  const none = props.title === ''
  return (
    <button
      type="button"
      onClick={props.onOpen}
      disabled={none}
      className="group w-full mt-3 mb-1 px-4 py-3 flex items-center gap-3 text-left rounded-[var(--card-radius)] border border-c-border bg-c-surface transition-colors hover:bg-c-surface2 hover:border-c-accent disabled:opacity-60 disabled:hover:bg-c-surface disabled:hover:border-c-border disabled:cursor-default"
      title={none ? undefined : `「${props.listTitle}」で次に未読のあるスレを開く`}
    >
      <span className={`material-symbols-outlined text-2xl leading-none ${none ? 'text-c-text-muted' : 'text-c-accent'}`}>
        {none ? 'done_all' : 'arrow_forward'}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-c-text-muted truncate">
          {none ? `「${props.listTitle}」に未読のあるスレはありません` : `次の未読スレへ(${props.listTitle})`}
        </span>
        {!none && <span className="block text-sm font-bold text-c-text-strong truncate">{props.title}</span>}
      </span>
      {!none && (
        <span
          className="flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded-full tabular-nums"
          style={{ background: 'var(--c-unread)', color: 'var(--c-unread-text)' }}
        >
          +{props.count > 999 ? '999+' : props.count}
        </span>
      )}
    </button>
  )
}
