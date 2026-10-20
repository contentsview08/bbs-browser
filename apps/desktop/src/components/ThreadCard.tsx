// スレ一覧の 1 行。web 版の ThreadCard.tsx(compact 表示)を移植。
// サムネイルと作成者 ID は 2ch 互換の subject.txt からは取れないので外し、
// 既読情報は localStorage の履歴ではなく LogStore の ThreadState から受け取る。

import BadgeChip from './BadgeChip'
import ActionSheet from './ActionSheet'
import { useLongPress } from '../hooks/useLongPress'
import { isMobile } from '../utils/platform'
import { memo, useState } from 'react'
import type { ThreadSummary } from '@bbs-browser/connectors'
import type { ThreadState } from '@bbs-browser/logstore'
import { formatMomentum, relativeTime } from '../utils/thread'
import Identicon from './Identicon'
import { isAutoLoadable } from '../utils/safeUrl'

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
  /** スマホ: 選んでいる途中(何か選んでいる)。押すと開く代わりに、選ぶ・外すを切り替える */
  selecting?: boolean
  /** スマホ: 長押しで選び始める(チェックボックスの代わり)。長押しのまま上下になぞると続けて選ぶ(一覧の方で受ける) */
  onSelectStart?: (t: ThreadSummary) => void
  /** キー操作(J・K)で選んでいるカード。枠を強調色にする */
  isCursor?: boolean
  /** 見た目のスタイル(レスの見た目の設定に合わせる)。card: いまのカード / discord: チャンネル一覧のような行 /
   *  classic: 専ブラのスレ一覧のような表 / line: トーク一覧のような行 */
  variant?: 'card' | 'discord' | 'classic' | 'line'
}

const TOOL = 'h-7 w-7 flex items-center justify-center rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface3 transition-colors'

function ThreadCard({
  thread,
  state,
  isActive,
  momentum: m,
  momentumRank,
  onOpen,
  onNg,
  onCopy,
  onDeleteLog,
  isFavorite,
  onToggleFavorite,
  isNew,
  selected,
  onSelect,
  selecting,
  onSelectStart,
  isCursor,
  variant = 'card',
}: Props) {
  // スマホ: 長押しで操作の一覧を出す(選べる一覧(閲覧履歴)では、選び始める)
  const [sheet, setSheet] = useState(false)
  const longPress = useLongPress(isMobile ? (onSelectStart ? () => onSelectStart(thread) : () => setSheet(true)) : undefined)
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

  // ── スタイルごとに並べ替える部品 ──
  // スマホはチェックボックスを出さない(長押しで選ぶ)
  const checkbox = onSelect && !isMobile && (
    <label className="flex items-center self-stretch -my-1 py-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={selected ?? false} onChange={(e) => onSelect(thread, e.target.checked)} className="rounded" />
    </label>
  )
  const newBadge = isNew && (
    <span
      className="inline-block px-1 mr-1 rounded text-[10px] font-bold leading-[15px] align-[2px]"
      style={{ background: 'var(--c-new-badge-bg)', color: 'var(--c-new-badge-text)' }}
      title="前回この板を見たあとに立ったスレ"
    >
      新
    </span>
  )
  /** 掲示板がスレに付けた印(「固定」「ロック」など)。スレタイの前に出す */
  const threadBadges = thread.badges?.length ? (
    <span className="inline-flex gap-1 mr-1 align-[1px]">
      {thread.badges.map((b, i) => (
        <BadgeChip key={i} badge={b} />
      ))}
    </span>
  ) : null
  const favStar = isFavorite && (
    <span className="material-symbols-outlined fill text-sm leading-none align-[-2px] mr-1 text-mark-fav" title="お気に入りのスレ">
      star
    </span>
  )
  const unreadBadge = (cls = 'text-[9px] px-1.5 py-0.5 rounded') =>
    unreadCount > 0 && (
      <span className={`flex-shrink-0 font-bold whitespace-nowrap ${cls}`} style={{ background: 'var(--c-unread)', color: 'var(--c-unread-text)' }}>
        +{unreadCount}
      </span>
    )
  const momentumEl = (cls = '') => (
    <span className={`font-mono tabular-nums text-right ${momentumColorClass} ${cls}`} title={`勢い：${formatMomentum(m)}`}>
      {formatMomentum(m)}
    </span>
  )
  /** スレタイの色: 開いたことのあるスレは既読の色、新着があれば強く、まだ開いていないスレはふつうの強さ */
  const titleColor = visited ? (unreadCount > 0 ? 'var(--c-text-strong)' : 'var(--c-thread-read-title, var(--c-text-body))') : 'var(--thread-list-title-color, var(--c-text-strong))'

  /** スレの画像のサムネイル(ふたば・4chan のカタログ)。size は一辺(px) */
  const thumbImg = (size: number, cls = 'rounded-md') =>
    thread.thumb &&
    isAutoLoadable(thread.thumb) && (
      <img
        src={thread.thumb}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className={`flex-shrink-0 object-cover bg-c-surface2 ${cls}`}
        style={{ width: `calc(${size}px * var(--list-thumb-scale, 1))`, height: `calc(${size}px * var(--list-thumb-scale, 1))` }}
        onError={(e) => {
          e.currentTarget.style.visibility = 'hidden'
        }}
      />
    )

  /** スレタイの後ろの、立てた人の BE 番号(「… [123456789]」の形の板だけ) */
  const beNo = variant === 'line' ? /[[［](\d{6,12})[\]］]\s*$/.exec(thread.title)?.[1] : undefined

  const content =
    variant === 'discord' ? (
      // Discord 風: チャンネル一覧のような 1 行。新着のあるスレは左に白い点、スレタイを明るく太く
      <div className="thread-row flex gap-2 min-w-0">
        {checkbox}
        {unreadCount > 0 && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2 rounded-r-full bg-c-text-strong" />}
        {/* 立てた人の ID が分かれば(エッジ)、# の代わりにその ID の模様を出す */}
        {thumbImg(28, 'rounded') ||
          (thread.authorId ? (
            <span className="thread-row-hash flex-shrink-0 flex justify-center" title={`立てた人の ID:${thread.authorId}`}>
              <span className="block overflow-hidden rounded-full self-center">
                <Identicon seed={thread.authorId} size={18} />
              </span>
            </span>
          ) : (
            <span className="thread-row-hash flex-shrink-0 text-c-text-muted select-none">#</span>
          ))}
        {/* 太字は新着のあるスレだけ(本家の未読のチャンネルと同じ)。開いたことのないスレは、太字にせず色の明るさで分ける */}
        <span className="thread-row-title flex-1 min-w-0" style={{ color: titleColor, fontWeight: unreadCount > 0 ? 600 : 400 }}>
          {newBadge}
          {favStar}
          {threadBadges}
          {thread.title}
        </span>
        {archived && <span className="flex-shrink-0 text-[10px] text-c-text-muted">dat落ち</span>}
        <span className="thread-row-count flex-shrink-0 text-[10px] text-c-text-muted tabular-nums" title="レス数">
          {thread.postCount}
        </span>
        {momentumEl('flex-shrink-0 text-[10px] opacity-80')}
        {unreadBadge('text-[10px] min-w-[1.5rem] px-1.5 py-px rounded-full text-center')}
      </div>
    ) : variant === 'classic' ? (
      // 専ブラ風: 印・スレタイ・レス数・新着・勢い・立った時間を 1 行の表に
      <div className="grid items-center gap-x-2 text-[13px] leading-snug" style={{ gridTemplateColumns: `${onSelect ? 'auto ' : ''}1.5em minmax(0,1fr) 4ch 4ch 6ch 5.5em` }}>
        {checkbox}
        <span className="text-center text-[11px] font-bold select-none" title={archived ? 'dat落ち' : isNew ? '新しいスレ' : unreadCount > 0 ? '新着あり' : visited ? '既読' : ''}>
          {archived ? <span className="text-c-text-muted">落</span> : isNew ? <span style={{ color: 'var(--c-new-badge-bg)' }}>新</span> : unreadCount > 0 ? <span style={{ color: 'var(--c-unread)' }}>●</span> : visited ? <span className="text-c-text-muted">○</span> : null}
        </span>
        <span className="thread-row-title min-w-0" style={{ color: titleColor }}>
          {favStar}
          {threadBadges}
          {thread.title}
        </span>
        <span className="font-mono tabular-nums text-right text-c-text-muted">{thread.postCount}</span>
        <span className="font-mono tabular-nums text-right font-bold" style={{ color: 'var(--c-unread)' }}>{unreadCount > 0 ? unreadCount : ''}</span>
        {momentumEl()}
        <span className="text-right text-[11px] text-c-text-muted whitespace-nowrap">{thread.createdAt ? relativeTime(thread.createdAt) : ''}</span>
      </div>
    ) : variant === 'line' ? (
      // LINE 風: トーク一覧のような行。スレタイと「レス数・勢い」、右に時間と新着の数。
      // スレ一覧(subject.txt)からは誰が立てたか分からないので、ふつうはアイコンを出さない。
      // スレタイの後ろに立てた人の BE 番号が付く板(嫌儲など。「… [123456789]」)だけ、その番号の模様を出す
      <div className="flex items-center gap-3 min-w-0">
        {checkbox}
        {thumbImg(40, 'rounded-xl') ||
          (thread.authorId && (
            <span className="flex-shrink-0 block overflow-hidden rounded-full" title={`立てた人の ID:${thread.authorId}`}>
              <Identicon seed={thread.authorId} size={40} />
            </span>
          )) ||
          (beNo && (
          <span className="flex-shrink-0 block overflow-hidden rounded-full" title={`立てた人の BE:${beNo}`}>
            <Identicon seed={`be:${beNo}`} size={40} />
          </span>
          ))}
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-bold" style={{ color: titleColor }}>
            {newBadge}
            {favStar}
          {threadBadges}
            {thread.title}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-c-text-muted">
            <span className="tabular-nums">{thread.postCount} レス</span>
            <span>·</span>
            {momentumEl()}
            {archived && <span>· dat落ち</span>}
          </div>
        </div>
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          <span className="text-[10px] text-c-text-muted whitespace-nowrap">{thread.createdAt ? relativeTime(thread.createdAt) : ''}</span>
          {unreadCount > 0 && (
            <span className="min-w-[1.25rem] px-1.5 py-px rounded-full text-[10px] font-bold text-center text-white" style={{ background: '#06c755' }}>
              {unreadCount}
            </span>
          )}
        </div>
      </div>
    ) : (
        <div className="flex items-center gap-3">
          {/* スレの画像(ふたば・4chan のカタログ)があれば左に出す */}
          {thumbImg(48)}
          {onSelect && (
            <label className="flex items-center self-stretch -my-1 py-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={selected ?? false} onChange={(e) => onSelect(thread, e.target.checked)} className="rounded" />
            </label>
          )}
          <div className="flex-1 min-w-0">
            {/* メタ行: 立った時間 →(右端)勢い・レス数 */}
            <div className="flex items-center gap-3 text-[10px] text-c-text-muted">
              {thread.createdAt && <span className="select-none whitespace-nowrap">{relativeTime(thread.createdAt)}</span>}
              {/* 立てた人の ID(エッジ)。模様と ID で、同じ人の立てたスレが分かる */}
              {thread.authorId && (
                <span className="flex items-center gap-1 min-w-0 font-mono" title="立てた人の ID">
                  <span className="flex-shrink-0 block overflow-hidden rounded-full">
                    <Identicon seed={thread.authorId} size={12} />
                  </span>
                  <span className="truncate">{thread.authorId}</span>
                </span>
              )}
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
                {threadBadges}
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
    )

  return (
    <div
      {...longPress}
      onClick={() => (isMobile && selecting && onSelect ? onSelect(thread, !selected) : onOpen(thread))}
      data-cursor={isCursor || undefined}
      data-thread-id={`${thread.boardUrl}${thread.key}`}
      data-variant={variant}
      className={`group card-thread cursor-pointer transition-colors relative rounded-[var(--thread-card-radius,var(--card-radius))] ${archived ? 'opacity-60' : ''} ${
        isActive ? 'card-selected border-[var(--card-selected-border-color)]' : 'border-[var(--card-border-color)]'
      }`}
      style={
        variant === 'card'
          ? {
              borderStyle: 'solid',
              borderWidth: 'var(--card-border-width, 1px)',
              paddingLeft: 'var(--thread-card-padding-left)',
              paddingRight: 'var(--thread-card-padding-right)',
              paddingTop: 'var(--thread-card-padding-y)',
              paddingBottom: 'var(--thread-card-padding-y)',
            }
          : variant === 'classic'
            ? { padding: '3px 10px' }
            : variant === 'line'
              ? { padding: '8px 12px' }
              : undefined // Discord 風の余白は表示の密度で変える(app.css)
      }
    >
      {/* キー操作(J・K)で選んでいるスレの印。スレ表示の選んでいるレスと同じく、うっすらした色と、下辺のまっすぐな線
          (角の丸みにかからないよう、両端を角の丸みの分だけ空ける) */}
      {/* スマホ: 選んでいるスレは、強調色を薄く敷いて右にチェック */}
      {isMobile && selected && (
        <>
          <span className="absolute inset-0 pointer-events-none rounded-[inherit]" style={{ background: 'var(--c-accent-wash)' }} />
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none material-symbols-outlined fill text-xl text-c-accent">check_circle</span>
        </>
      )}
      {isCursor && (
        <>
          <span className="absolute inset-0 pointer-events-none rounded-[inherit]" style={{ background: 'var(--c-cursor-tint)' }} />
          <span
            className="absolute bottom-0 h-[2px] bg-c-accent pointer-events-none"
            style={{ left: 'var(--thread-card-radius, var(--card-radius))', right: 'var(--thread-card-radius, var(--card-radius))' }}
          />
        </>
      )}
      {visited && variant === 'card' && (
        <span
          className="absolute left-0 top-0 bottom-0 w-[3px]"
          style={{ background: unreadCount > 0 ? 'var(--c-unread)' : 'var(--c-thread-read-title, var(--c-accent))' }}
          title={unreadCount > 0 ? '既読(新着あり)' : '既読'}
        />
      )}
      {/* スマホ: 長押しで出す操作の一覧(マウスを乗せて出す操作バーの代わり) */}
      {sheet && (
        <ActionSheet
          title={thread.title}
          onClose={() => setSheet(false)}
          items={[
            { label: '開く', icon: 'open_in_new', onClick: () => onOpen(thread) },
            ...(onToggleFavorite
              ? [{ label: isFavorite ? 'お気に入りのスレから外す' : 'お気に入りのスレに足す', icon: 'star', onClick: () => onToggleFavorite(thread) }]
              : []),
            ...(onCopy ? [{ label: 'スレタイと URL をコピー', icon: 'content_copy', onClick: () => onCopy(thread) }] : []),
            ...(onNg ? [{ label: 'スレタイを NG に追加', icon: 'block', onClick: () => onNg(thread), danger: true }] : []),
            ...(onDeleteLog && state ? [{ label: 'ログを削除', icon: 'delete', onClick: () => onDeleteLog(thread), danger: true }] : []),
          ]}
        />
      )}
      {/* 操作バー。スレタイに重ならないよう、パネルの上辺に半分かかる位置に出す(スマホは長押しの一覧) */}
      {!isMobile && (onNg || onCopy || onToggleFavorite || (onDeleteLog && state)) && (
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
      {content}
    </div>
  )
}

export default memo(ThreadCard)
