// スレ一覧の 1 行。web 版の ThreadCard.tsx(compact 表示)を移植。
// サムネイルと作成者 ID は 2ch 互換の subject.txt からは取れないので外し、
// 既読情報は localStorage の履歴ではなく LogStore の ThreadState から受け取る。

import type { ThreadSummary } from '@bbs-browser/connectors'
import type { ThreadState } from '@bbs-browser/logstore'
import { formatMomentum, relativeTime } from '../utils/thread'

interface Props {
  thread: ThreadSummary
  state?: ThreadState
  isActive: boolean
  /** 勢い(スレ一覧を取ったときの時刻で計算したもの) */
  momentum: number
  /** 板の中での勢いの相対順位(0〜1)。rankMomentum 参照 */
  momentumRank: number
  onClick: () => void
  /** マウスを乗せたときに右上に出す NG ボタン。押すとスレタイを入れた NG の画面を開く */
  onNg?: () => void
}

export default function ThreadCard({ thread, state, isActive, momentum: m, momentumRank, onClick, onNg }: Props) {
  // 勢いの色は板の中での順位で決める(過疎板でも一番勢いのあるスレは赤くなる)
  const momentumColorClass =
    momentumRank >= 0.9
      ? 'text-c-heat-very-hot'
      : momentumRank >= 0.6
        ? 'text-c-heat-hot'
        : momentumRank >= 0.3
          ? 'text-c-heat-warm'
          : 'text-c-text-muted'

  const unreadCount = state ? Math.max(0, thread.postCount - state.readNo) : 0
  // 一度でも開いたスレ(ログがある)は、左に線を引き、スレタイに色を付ける。太字は使わない(目が疲れるので)
  const visited = state !== undefined
  const archived = state?.status === 'archived'

  return (
    <div
      onClick={onClick}
      className={`group cursor-pointer transition-colors relative rounded-[var(--thread-card-radius,var(--card-radius))] ${archived ? 'opacity-60' : ''} ${
        isActive
          ? 'bg-[var(--card-selected-bg)] border-[var(--card-selected-border-color)]'
          : 'bg-[var(--card-bg)] border-[var(--card-border-color)] hover:bg-c-surface2'
      }`}
      style={{
        borderStyle: 'solid',
        borderWidth: 'var(--card-border-width, 1px)',
        paddingLeft: 'var(--thread-card-padding-left)',
        paddingRight: 'var(--thread-card-padding-right)',
        paddingTop: 'var(--thread-card-padding-y)',
        paddingBottom: 'var(--thread-card-padding-y)',
      }}
    >
      {visited && (
        <span
          className="absolute left-0 top-0 bottom-0 w-[3px]"
          style={{ background: unreadCount > 0 ? 'var(--c-accent-self)' : 'var(--c-thread-read-title, var(--c-accent))' }}
          title={unreadCount > 0 ? '既読(新着あり)' : '既読'}
        />
      )}
      {onNg && (
        <div className="absolute top-1 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onNg()
            }}
            className="flex items-center gap-0.5 h-6 px-1.5 text-[11px] bg-c-surface border border-c-border rounded-md shadow-sm text-c-text-muted hover:text-c-text-strong"
            title="スレタイを NG に追加"
          >
            <span className="material-symbols-outlined text-sm leading-none">block</span>
            NG
          </button>
        </div>
      )}
      {/* メタ行: 立った時間 →(右端)勢い・レス数 */}
      <div className="flex items-center gap-3 text-[10px] text-c-text-muted">
        {thread.createdAt && <span className="select-none whitespace-nowrap">{relativeTime(thread.createdAt)}</span>}
        {archived && <span className="whitespace-nowrap">dat落ち</span>}
        <div className="flex items-center gap-5 ml-auto">
          <span
            className={`font-mono font-bold tabular-nums text-right min-w-[5ch] ${momentumColorClass}`}
            title={`勢い：${formatMomentum(m)}`}
          >
            {formatMomentum(m)}
          </span>
          <span className="font-mono tabular-nums text-right min-w-[4ch]">{thread.postCount}</span>
        </div>
      </div>

      {/* タイトル行 */}
      <div className="flex items-center gap-2.5 min-w-0" style={{ marginTop: 'var(--thread-card-title-gap)' }}>
        <h3
          className="flex-1 min-w-0 text-base leading-tight line-clamp-2 font-normal"
          style={{
            color: visited
              ? 'var(--c-thread-read-title, var(--c-text-body))'
              : 'var(--thread-list-title-color, var(--c-text-strong))',
            textDecoration: 'var(--thread-list-title-decoration, none)',
          }}
        >
          {thread.title}
        </h3>
        {unreadCount > 0 && (
          <span
            className="flex-shrink-0 font-bold text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap"
            style={{ background: 'var(--c-accent-self)', color: 'var(--c-accent-self-text)' }}
          >
            +{unreadCount}
          </span>
        )}
      </div>
    </div>
  )
}
