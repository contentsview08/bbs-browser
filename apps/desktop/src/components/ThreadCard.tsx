// スレ一覧の 1 行。web 版の ThreadCard.tsx(compact 表示)を移植。
// サムネイルと作成者 ID は 2ch 互換の subject.txt からは取れないので外し、
// 既読情報は localStorage の履歴ではなく LogStore の ThreadState から受け取る。

import { memo } from 'react'
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
  /** どのカードにも同じ関数を渡し、押されたスレを引数で受け取る(カードを memo で描き直さずに済むように) */
  onOpen: (t: ThreadSummary) => void
  /** マウスを乗せたときに、パネルの上辺に出す操作バーのボタン */
  onNg?: (t: ThreadSummary) => void
  onCopy?: (t: ThreadSummary) => void
  /** ログ(閲覧履歴)を消す。ログがあるスレだけ */
  onDeleteLog?: (t: ThreadSummary) => void
  /** 前回この板の一覧を見たあとに立ったスレ(「新」の印を出す) */
  isNew?: boolean
  /** お気に入りのスレか(スレタイの頭に ★ を出す) */
  isFavorite?: boolean
  /** お気に入りのスレに足す・外す */
  onToggleFavorite?: (t: ThreadSummary) => void
  /** 選べる一覧(閲覧履歴)のとき、既読の線とスレタイの間にチェックボックスを出す。selected はその状態 */
  selected?: boolean
  onSelect?: (t: ThreadSummary, selected: boolean) => void
}

const TOOL = 'h-7 w-7 flex items-center justify-center rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface3 transition-colors'

function ThreadCard({ thread, state, isActive, momentum: m, momentumRank, onOpen, onNg, onCopy, onDeleteLog, isFavorite, onToggleFavorite, isNew, selected, onSelect }: Props) {
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
      onClick={() => onOpen(thread)}
      className={`group card-thread cursor-pointer transition-colors relative rounded-[var(--thread-card-radius,var(--card-radius))] ${archived ? 'opacity-60' : ''} ${
        isActive ? 'card-selected border-[var(--card-selected-border-color)]' : 'border-[var(--card-border-color)]'
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
          style={{ background: unreadCount > 0 ? 'var(--c-unread)' : 'var(--c-thread-read-title, var(--c-accent))' }}
          title={unreadCount > 0 ? '既読(新着あり)' : '既読'}
        />
      )}
      {/* 操作バー。スレタイに重ならないよう、パネルの上辺に半分かかる位置に出す */}
      {(onNg || onCopy || onToggleFavorite || (onDeleteLog && state)) && (
        <div
          className="absolute -top-3.5 right-2 z-20 flex items-center gap-0.5 p-0.5 bg-c-surface border border-c-border rounded-lg shadow-md opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {onToggleFavorite && (
            <button
              type="button"
              onClick={() => onToggleFavorite(thread)}
              className={`${TOOL} ${isFavorite ? 'text-mark-fav' : 'hover:!text-mark-fav'}`}
              title={isFavorite ? 'お気に入りのスレから外す' : 'お気に入りのスレに足す'}
            >
              <span className={`material-symbols-outlined text-base leading-none ${isFavorite ? 'fill' : ''}`}>star</span>
            </button>
          )}
          {onCopy && (
            <button type="button" onClick={() => onCopy(thread)} className={`${TOOL} hover:!text-mark-link`} title="スレタイと URL をコピー">
              <span className="material-symbols-outlined text-base leading-none">content_copy</span>
            </button>
          )}
          {onNg && (
            <button type="button" onClick={() => onNg(thread)} className={`${TOOL} hover:!text-mark-danger`} title="スレタイを NG に追加">
              <span className="material-symbols-outlined text-base leading-none">block</span>
            </button>
          )}
          {onDeleteLog && state && (
            <button type="button" onClick={() => onDeleteLog(thread)} className={`${TOOL} hover:!text-mark-danger`} title="このスレのログ(閲覧履歴)を削除">
              <span className="material-symbols-outlined text-base leading-none">delete</span>
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        {onSelect && (
          <label className="flex items-center self-stretch -my-1 py-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={selected ?? false} onChange={(e) => onSelect(thread, e.target.checked)} className="rounded" />
          </label>
        )}
        <div className="flex-1 min-w-0">
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
              {/* 前回この板を見たあとに立ったスレは、スレタイの頭に「新」を付ける */}
              {isNew && (
                <span
                  className="inline-block px-1 mr-1 rounded text-[10px] font-bold leading-[15px] align-[2px]"
                  style={{ background: 'var(--c-new-badge-bg)', color: 'var(--c-new-badge-text)' }}
                  title="前回この板を見たあとに立ったスレ"
                >
                  新
                </span>
              )}
              {isFavorite && (
                <span className="material-symbols-outlined fill text-sm leading-none align-[-2px] mr-1 text-mark-fav" title="お気に入りのスレ">
                  star
                </span>
              )}
              {thread.title}
            </h3>
            {unreadCount > 0 && (
              <span
                className="flex-shrink-0 font-bold text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap"
                style={{ background: 'var(--c-unread)', color: 'var(--c-unread-text)' }}
              >
                +{unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(ThreadCard)
