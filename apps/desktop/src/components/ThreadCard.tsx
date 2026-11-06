// スレ一覧の 1 行。形はレスの見た目の設定(variant)に合わせる。
// サムネイルと立てた人の ID は、取れる掲示板だけ出す(2ch の subject.txt からは取れない)。既読は LogStore の ThreadState から受け取る。

import BadgeChip from './BadgeChip'
import ActionSheet from './ActionSheet'
import { useLongPress } from '../hooks/useLongPress'
import { isMobile } from '../utils/platform'
import { memo, useCallback, useState } from 'react'
import { FloatingMenu, MenuButton, menuPosAt, wantsNativeMenu, type MenuPos } from './PostMenu'
import type { ThreadSummary } from '@bbs-browser/connectors'
import type { ThreadState } from '@bbs-browser/logstore'
import { formatMomentum, relativeTime } from '../utils/thread'
import { threadUnread } from '../utils/unread'
import Identicon from './Identicon'
import { isAutoLoadable } from '../utils/safeUrl'
import BoardIcon from './BoardIcon'
import { mediaSrc } from '../utils/httpsFirst'

interface Props {
  thread: ThreadSummary
  state?: ThreadState
  isActive: boolean
  /** 勢い(スレ一覧を取ったときの時刻で計算したもの) */
  momentum: number
  /** 板の中での勢いの相対順位(0〜1)。rankMomentum 参照 */
  momentumRank: number
  /** 開く。newTab: Ctrl を押しながら押した(設定によらず新しいタブで開く)。memo が効くよう、どのカードにも同じ関数を渡す */
  onOpen: (t: ThreadSummary, newTab?: boolean) => void
  /** タブを使っているか(右クリックの「新しいタブで開く」を出す) */
  newTabEnabled?: boolean
  /** マウスを乗せたときに、パネルの上辺に出す操作バーのボタン */
  onNg?: (t: ThreadSummary) => void
  /** 立てた人を NG に。today なら今日だけ(立てた人が分かるスレだけ出す) */
  onNgAuthor?: (t: ThreadSummary, today?: boolean) => void
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
  /** 見た目のスタイル(レスの見た目の設定に合わせる)。card: カード / discord: チャンネル一覧のような行 /
   *  classic: 専ブラのスレ一覧のような表 / line: トーク一覧のような行 */
  variant?: 'card' | 'discord' | 'classic' | 'line'
  /** 立てた人の ID(エッジ)を模様で出す。切っていれば、右下に ID を小さく出す */
  authorIcon?: boolean
  /** 行の形がコンパクト: スレタイ 1 行と、右端にレス数と未読だけ(スマホのアプリの listDensity = compact と同じ)。専ブラ風の表は元から 1 行なので変えない */
  compact?: boolean
  /** 閲覧履歴の行(板の名前・いつ見たか)。渡すと、見た目によらず履歴用の形で描く(スマホのアプリの過去のスレの行と同じ並び) */
  historyMeta?: { boardName: string; readAt?: number; icon?: string }
}

const TOOL = 'h-7 w-7 flex items-center justify-center rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface3 transition-colors'

/** 操作バーをカードの枠の上へはみ出させられるか。WebKit は overflow-clip-margin がなく、content-visibility の枠で切り取られる */
const CAN_OVERHANG = typeof CSS !== 'undefined' && CSS.supports('overflow-clip-margin', '1.5rem')

function ThreadCard({
  thread,
  state,
  isActive,
  momentum: m,
  momentumRank,
  onOpen,
  newTabEnabled,
  onNg,
  onNgAuthor,
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
  authorIcon = false,
  compact = false,
  historyMeta,
}: Props) {
  /** 立てた人の ID を模様で出すか(出さないときは、右下に ID の文字を出す) */
  const authorIconId = authorIcon ? thread.authorId : undefined
  // スマホ: 長押しで操作の一覧を出す(選べる一覧(閲覧履歴)では、選び始める)
  const [sheet, setSheet] = useState(false)
  /** 操作バーの NG のメニューを開いているか(開いている間はバーを出したままにする) */
  const [ngMenu, setNgMenu] = useState(false)
  /** 右クリックのメニューを開いている位置 */
  const [ctxMenu, setCtxMenu] = useState<MenuPos>()
  const closeCtxMenu = useCallback(() => setCtxMenu(undefined), [])
  const longPress = useLongPress(isMobile ? (onSelectStart ? () => onSelectStart(thread) : () => setSheet(true)) : undefined)
  // 勢いの色は板の中での順位で決める(過疎板でも一番勢いのあるスレは赤くなる)。
  // 色は「とても多い」の 1 段だけ(塗り分けると、行の中の色が増えて読みにくい)
  const momentumColorClass = momentumRank >= 0.9 ? 'text-c-heat-very-hot' : 'text-c-text-muted'

  const unreadCount = threadUnread(state, thread.postCount)
  // 一度でも開いたスレ(ログがある)
  const visited = state !== undefined
  const archived = state?.status === 'archived'

  // ── スタイルごとに並べ替える部品 ──
  // スマホはチェックボックスを出さない(長押しで選ぶ)
  const checkbox = onSelect && !isMobile && (
    <label className="flex items-center self-stretch -my-1 py-1 cursor-pointer" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={selected ?? false} onChange={(e) => onSelect(thread, e.target.checked)} className="rounded" />
    </label>
  )
  // 「新」は小さな点(塗りの札だと、並びすぎて読みにくい)
  const newBadge = isNew && (
    <span className="inline-block w-1.5 h-1.5 mr-1.5 rounded-full align-[0.1875rem]" style={{ background: 'var(--c-mark-new)' }} title="前回この板を見たあとに立ったスレ" />
  )
  /** 掲示板がスレに付けた印(「固定」「ロック」など)。スレタイの前に出す */
  const threadBadges = thread.badges?.length ? (
    <span className="inline-flex gap-1 mr-1 align-[0.0625rem]">
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
  const unreadBadge = (cls = 'text-[0.5625rem] px-1.5 py-0.5 rounded') =>
    unreadCount > 0 && (
      <span className={`flex-shrink-0 font-bold whitespace-nowrap ${cls}`} style={{ background: 'var(--c-unread)', color: 'var(--c-unread-text)' }}>
        {unreadCount > 999 ? '+999+' : `+${unreadCount}`}
      </span>
    )
  const momentumEl = (cls = '') => (
    <span className={`font-mono tabular-nums text-right ${momentumColorClass} ${cls}`} title={`勢い：${formatMomentum(m)}`}>
      {formatMomentum(m)}
    </span>
  )
  /** スレタイの色: 開いたことのあるスレは既読の色、新着があれば強く、まだ開いていないスレはふつうの強さ */
  const titleColor = visited ? (unreadCount > 0 ? 'var(--c-text-strong)' : 'var(--c-thread-read-title, var(--c-text-body))') : 'var(--thread-list-title-color, var(--c-text-strong))'

  const [thumbFailed, setThumbFailed] = useState(false)
  /** スレの画像のサムネイル(ふたば・4chan のカタログ)。size は一辺(px) */
  const thumbImg = (size: number, cls = 'rounded-md') =>
    thread.thumb &&
    !thumbFailed &&
    isAutoLoadable(thread.thumb) && (
      <img
        src={mediaSrc(thread.thumb)}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className={`flex-shrink-0 object-cover bg-c-surface2 ${cls}`}
        style={{ width: `calc(${size}px * var(--list-thumb-scale, 1))`, height: `calc(${size}px * var(--list-thumb-scale, 1))` }}
        // 取れなかった画像は枠ごと消す(空いたすき間が残らないように)
        onError={() => setThumbFailed(true)}
      />
    )

  /** スレタイの後ろの、立てた人の BE 番号(「… [123456789]」の形の板だけ) */
  const beNo = variant === 'line' ? /[[［](\d{6,12})[\]］]\s*$/.exec(thread.title)?.[1] : undefined

  /**
   * スマホ: カード・Discord 風・LINE 風を同じ形にそろえる。
   * 左に見た目ごとのアイコン、1 段目にスレタイ(3 行まで)、2 段目の左に 立った時間・立てた人の ID・dat落ち、右に 勢い・レス数・未読
   */
  const unified = () => {
    const leading =
      variant === 'discord'
        ? thumbImg(28, 'rounded') ||
          (authorIconId ? (
            <span className="block overflow-hidden rounded-full" title={`立てた人の ID:${authorIconId}`}>
              <Identicon seed={authorIconId} size={22} />
            </span>
          ) : (
            <span className="thread-row-hash text-c-text-muted select-none">#</span>
          ))
        : variant === 'line'
          ? thumbImg(40, 'rounded-xl') ||
            ((authorIconId || beNo) && (
              <span className="block overflow-hidden rounded-full">
                <Identicon seed={authorIconId ?? `be:${beNo}`} size={40} />
              </span>
            ))
          : thumbImg(48)
    /** 1 レス目の頭(URL とアンカーは除いて 1 行に) */
    const previewText = thread.preview?.[0]?.body
      .replace(/<[^>]+>/g, ' ')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/(>>|&gt;&gt;|＞＞)\d+/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
    return (
    <div className="flex items-start gap-2.5 min-w-0">
      {leading && <span className="flex-shrink-0 flex items-center justify-center min-w-[1rem] pt-0.5">{leading}</span>}
      {unreadCount > 0 && variant === 'discord' && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2 rounded-r-full bg-c-text-strong" />}
      <div className="flex-1 min-w-0">
        <div
          className="text-[0.9375rem] leading-snug break-words line-clamp-3"
          style={{ color: titleColor, fontWeight: variant === 'line' || unreadCount > 0 ? 600 : 400 }}
        >
          {newBadge}
          {favStar}
          {threadBadges}
          {thread.title}
        </div>
        {/* 1 レス目ののぞき見(スレ一覧の時点で本文が分かる掲示板だけ。hono-bbs など) */}
        {previewText && <div className="mt-0.5 text-[0.78125rem] leading-snug line-clamp-2 break-words text-c-text-muted">{previewText}</div>}
        <div className="mt-1 flex items-center gap-2 text-[0.6875rem] text-c-text-muted min-w-0">
          {thread.createdAt && <span className="flex-shrink-0 whitespace-nowrap">{relativeTime(thread.createdAt)}</span>}
          {thread.authorId && (
            <span className="min-w-0 truncate font-mono" title="立てた人の ID">
              {thread.authorId}
            </span>
          )}
          {archived && <span className="flex-shrink-0">dat落ち</span>}
          <span className="ml-auto flex-shrink-0 flex items-center gap-3">
            {momentumEl('min-w-[3ch]')}
            <span className="tabular-nums" title="レス数">
              {thread.postCount}
              <span className="ml-0.5 text-[0.625rem]">レス</span>
            </span>
            {unreadBadge('text-[0.625rem] min-w-[1.75rem] px-1.5 py-px rounded text-center leading-tight')}
          </span>
        </div>
      </div>
    </div>
    )
  }

  // コンパクト: スレタイ 1 行と、右端にレス数(勢いの色)と未読だけ。まだ開いていないスレだけ太字(アプリと同じ)
  const compactRow = () => (
    <div className="flex items-center gap-2 min-w-0">
      {checkbox}
      <span
        className="flex-1 min-w-0 truncate text-[0.875rem]"
        style={{ color: visited ? 'var(--c-thread-read-title, var(--c-text-body))' : 'var(--c-text-strong)', fontWeight: visited ? 400 : 600 }}
      >
        {newBadge}
        {favStar}
        {threadBadges}
        {thread.title}
      </span>
      <span className={`flex-shrink-0 min-w-[2.25rem] text-right text-[0.6875rem] tabular-nums ${momentumColorClass}`} title={`レス数(勢い：${formatMomentum(m)})`}>
        {thread.postCount}
      </span>
      {unreadBadge('text-[0.625rem] min-w-[1.875rem] px-1.5 py-px rounded text-center leading-tight')}
    </div>
  )

  /**
   * 閲覧履歴の行: 左に未読の帯、スレタイ、下に 板・いつ見たか・dat落ち、右に レス数と未読。
   * チェックの列は幅を決めて置く(チェックを入れても行がずれないように)
   */
  const historyRow = (meta: NonNullable<typeof historyMeta>) => (
    <div className="flex items-center gap-2 min-w-0">
      {onSelect && !isMobile && (
        <label className="w-5 flex-shrink-0 flex items-center justify-center self-stretch cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected ?? false} onChange={(e) => onSelect(thread, e.target.checked)} className="rounded" />
        </label>
      )}
      <span
        className="w-[0.1875rem] self-stretch flex-shrink-0 rounded-full"
        style={{ background: unreadCount > 0 ? 'var(--c-unread)' : 'transparent', opacity: unreadCount > 0 ? 0.35 + 0.65 * Math.min(1, Math.log10(unreadCount + 1) / 2.5) : 1 }}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[0.875rem] leading-snug truncate" style={{ color: titleColor, fontWeight: unreadCount > 0 ? 600 : 400 }}>
          {favStar}
          {threadBadges}
          {thread.title || thread.key}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[0.6875rem] text-c-text-muted min-w-0">
          <BoardIcon boardUrl={thread.boardUrl} override={meta.icon} size={14} />
          <span className="truncate">{meta.boardName}</span>
          {meta.readAt && <span className="flex-shrink-0 whitespace-nowrap">・{relativeTime(new Date(meta.readAt))}に見た</span>}
          {archived && <span className="flex-shrink-0">・dat落ち</span>}
        </div>
      </div>
      <span className="flex-shrink-0 flex flex-col items-end gap-0.5">
        <span className="text-[0.75rem] tabular-nums text-c-text-muted" title="レス数">
          {thread.postCount}
          <span className="ml-0.5 text-[0.625rem]">レス</span>
        </span>
        {unreadBadge('text-[0.625rem] min-w-[1.75rem] px-1.5 py-px rounded text-center leading-tight')}
      </span>
    </div>
  )

  /** メニューの項目: お気に入りとコピー(右クリックのメニューと長押しの一覧で共通) */
  const favCopyItems = () => [
    ...(onToggleFavorite
      ? [{ label: isFavorite ? 'お気に入りのスレから外す' : 'お気に入りのスレに足す', icon: 'star', onClick: () => onToggleFavorite(thread) }]
      : []),
    ...(onCopy ? [{ label: 'スレタイと URL をコピー', icon: 'content_copy', onClick: () => onCopy(thread) }] : []),
  ]
  /** NG のメニュー: スレタイで・立てた人で(右クリックのメニューと操作バーで共通) */
  const ngChoices = (ng: NonNullable<typeof onNg>, ngAuthor: NonNullable<typeof onNgAuthor>, authorId: string) => [
    { label: 'スレタイで NG', icon: 'title', onClick: () => ng(thread) },
    { label: `立てた人で NG(${authorId})`, icon: 'person_off', onClick: () => ngAuthor(thread) },
    { label: '立てた人で NG(今日だけ)', icon: 'schedule', onClick: () => ngAuthor(thread, true) },
  ]

  const content =
    historyMeta ? (
      historyRow(historyMeta)
    ) : compact && variant !== 'classic' ? (
      compactRow()
    ) : isMobile && variant !== 'classic' ? (
      unified()
    ) : variant === 'discord' ? (
      // Discord 風: チャンネル一覧のような 1 行。新着のあるスレは左に白い点、スレタイを明るく太く
      <div className="thread-row flex gap-2 min-w-0">
        {checkbox}
        {unreadCount > 0 && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-2 rounded-r-full bg-c-text-strong" />}
        {/* 立てた人の ID が分かれば(エッジ)、# の代わりにその ID の模様を出す */}
        {thumbImg(28, 'rounded') ||
          (authorIconId ? (
            <span className="thread-row-hash flex-shrink-0 flex justify-center" title={`立てた人の ID:${thread.authorId}`}>
              <span className="block overflow-hidden rounded-full self-center">
                <Identicon seed={authorIconId} size={18} />
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
          {/* dat落ち・立てた人の ID・レス数・勢い・未読は、スレタイの続きに並べる(右に列で置くと、長いスレタイが 3 行にもなる) */}
          <span className="inline-flex items-center gap-1.5 ml-1.5 align-[0.0625rem] whitespace-nowrap font-normal">
            {archived && <span className="text-[0.625rem] text-c-text-muted">dat落ち</span>}
            {thread.authorId && !authorIcon && (
              <span className="font-mono text-[0.625rem] text-c-text-muted" title="立てた人の ID">
                {thread.authorId}
              </span>
            )}
            <span className="thread-row-count text-[0.625rem] text-c-text-muted tabular-nums" title="レス数">
              {thread.postCount}
            </span>
            {momentumEl('text-[0.625rem] opacity-80')}
            {unreadBadge('text-[0.625rem] min-w-[1.5rem] px-1.5 py-px rounded text-center leading-tight')}
          </span>
        </span>
      </div>
    ) : variant === 'classic' ? (
      // 専ブラ風: 印・スレタイ・レス数・新着・勢い・立った時間を 1 行の表に
      <div className="grid items-center gap-x-2 text-[0.8125rem] leading-snug" style={{ gridTemplateColumns: `${onSelect ? 'auto ' : ''}1.5em minmax(0,1fr) 4ch 4ch 6ch 5.5em` }}>
        {checkbox}
        <span className="text-center text-[0.6875rem] font-bold select-none" title={archived ? 'dat落ち' : isNew ? '新しいスレ' : unreadCount > 0 ? '新着あり' : visited ? '既読' : ''}>
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
        <span className="text-right text-[0.6875rem] text-c-text-muted whitespace-nowrap">{thread.createdAt ? relativeTime(thread.createdAt) : ''}</span>
      </div>
    ) : variant === 'line' ? (
      // LINE 風: トーク一覧のような行。スレタイと「レス数・勢い」、右に時間と新着の数。
      // subject.txt からは誰が立てたか分からないので、アイコンは立てた人の ID か、
      // スレタイの後ろの BE 番号(嫌儲など。「… [123456789]」)が分かるスレだけ
      <div className="flex items-center gap-3 min-w-0">
        {checkbox}
        {thumbImg(40, 'rounded-xl') ||
          (authorIconId && (
            <span className="flex-shrink-0 block overflow-hidden rounded-full" title={`立てた人の ID:${authorIconId}`}>
              <Identicon seed={authorIconId} size={40} />
            </span>
          )) ||
          (beNo && (
          <span className="flex-shrink-0 block overflow-hidden rounded-full" title={`立てた人の BE:${beNo}`}>
            <Identicon seed={`be:${beNo}`} size={40} />
          </span>
          ))}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold break-words" style={{ color: titleColor }}>
            {newBadge}
            {favStar}
          {threadBadges}
            {thread.title}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[0.6875rem] text-c-text-muted">
            <span className="tabular-nums">{thread.postCount} レス</span>
            <span>·</span>
            {momentumEl()}
            {archived && <span>· dat落ち</span>}
            {thread.authorId && !authorIcon && <span className="font-mono truncate" title="立てた人の ID">· {thread.authorId}</span>}
          </div>
        </div>
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          <span className="text-[0.625rem] text-c-text-muted whitespace-nowrap">{thread.createdAt ? relativeTime(thread.createdAt) : ''}</span>
          {unreadCount > 0 && (
            <span className="min-w-[1.25rem] px-1.5 py-px rounded-full text-[0.625rem] font-bold text-center text-white" style={{ background: 'var(--c-line-green)' }}>
              {unreadCount}
            </span>
          )}
        </div>
      </div>
    ) : (
        <div className="flex items-center gap-3">
          {/* スレの画像(ふたば・4chan のカタログ)があれば左に出す */}
          {thumbImg(48)}
          {checkbox}
          <div className="flex-1 min-w-0">
            {/* メタ行: 立った時間 →(右端)勢い・レス数 */}
            <div className="flex items-center gap-3 text-[0.625rem] text-c-text-muted">
              {thread.createdAt && <span className="select-none whitespace-nowrap">{relativeTime(thread.createdAt)}</span>}
              {/* 立てた人の ID(エッジ)。模様は設定でオンのときだけ */}
              {thread.authorId && (
                <span className="flex items-center gap-1 min-w-0 font-mono" title="立てた人の ID">
                  {authorIconId && (
                    <span className="flex-shrink-0 block overflow-hidden rounded-full">
                      <Identicon seed={authorIconId} size={12} />
                    </span>
                  )}
                  <span className="truncate">{thread.authorId}</span>
                </span>
              )}
              {archived && <span className="whitespace-nowrap">dat落ち</span>}
              <div className="flex items-center gap-5 ml-auto">
                {momentumEl('font-bold min-w-[5ch]')}
                <span className="font-mono tabular-nums text-right min-w-[4ch]">{thread.postCount}</span>
              </div>
            </div>
  
            <div className="flex items-center gap-2.5 min-w-0" style={{ marginTop: 'var(--thread-card-title-gap)' }}>
              <h3
                className="flex-1 min-w-0 text-base leading-tight break-words font-normal"
                style={{
                  color: visited
                    ? 'var(--c-thread-read-title, var(--c-text-body))'
                    : 'var(--thread-list-title-color, var(--c-text-strong))',
                  textDecoration: 'var(--thread-list-title-decoration, none)',
                }}
              >
                {threadBadges}
                {isNew && (
                  <span
                    className="inline-block px-1 mr-1 rounded text-[0.625rem] font-bold leading-[0.9375rem] align-[0.125rem]"
                    style={{ background: 'var(--c-new-badge-bg)', color: 'var(--c-new-badge-text)' }}
                    title="前回この板を見たあとに立ったスレ"
                  >
                    新
                  </span>
                )}
                {favStar}
                {thread.title}
              </h3>
              {unreadBadge()}
            </div>
          </div>
        </div>
    )

  return (
    <div
      {...longPress}
      onClick={(e) => (isMobile && selecting && onSelect ? onSelect(thread, !selected) : onOpen(thread, e.ctrlKey || e.metaKey))}
      // PC: 右クリックで、操作バーと同じ操作に「新しいタブで開く」を足して出す
      onContextMenu={
        !isMobile
          ? (e) => {
              if (wantsNativeMenu(e)) return
              e.preventDefault()
              setCtxMenu(menuPosAt(e.clientX, e.clientY))
            }
          : undefined
      }
      data-cursor={isCursor || undefined}
      data-thread-id={`${thread.boardUrl}${thread.key}`}
      data-variant={variant}
      data-compact={(compact && variant !== 'classic') || undefined}
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
      {/* スマホ: 選んでいるスレは、強調色を薄く敷いて右にチェック */}
      {isMobile && selected && (
        <>
          <span className="absolute inset-0 pointer-events-none rounded-[inherit]" style={{ background: 'var(--c-accent-wash)' }} />
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none material-symbols-outlined fill text-xl text-c-accent">check_circle</span>
        </>
      )}
      {/* キー操作(J・K)で選んでいるスレの印。スレ表示の選んでいるレスと同じく、うっすらした色と、下辺のまっすぐな線
          (角の丸みにかからないよう、両端を角の丸みの分だけ空ける) */}
      {isCursor && (
        <>
          <span className="absolute inset-0 pointer-events-none rounded-[inherit]" style={{ background: 'var(--c-cursor-tint)' }} />
          <span
            className="absolute bottom-0 h-[0.125rem] bg-c-accent pointer-events-none"
            style={{ left: 'var(--thread-card-radius, var(--card-radius))', right: 'var(--thread-card-radius, var(--card-radius))' }}
          />
        </>
      )}
      {visited && variant === 'card' && (
        <span
          className="absolute left-0 top-0 bottom-0 w-[0.1875rem]"
          style={{ background: unreadCount > 0 ? 'var(--c-unread)' : 'var(--c-thread-read-title, var(--c-accent))' }}
          title={unreadCount > 0 ? '既読(新着あり)' : '既読'}
        />
      )}
      {ctxMenu && (
        <FloatingMenu
          pos={ctxMenu}
          onClose={closeCtxMenu}
          items={[
            ...(newTabEnabled ? [{ label: '新しいタブで開く', icon: 'open_in_new', onClick: () => onOpen(thread, true) }] : []),
            ...favCopyItems(),
            ...(onNg && onNgAuthor && thread.authorId
              ? [
                  {
                    label: 'NG',
                    icon: 'block',
                    children: ngChoices(onNg, onNgAuthor, thread.authorId),
                  },
                ]
              : onNg
                ? [{ label: 'スレタイを NG に追加', icon: 'block', onClick: () => onNg(thread) }]
                : []),
            ...(onDeleteLog && state ? [{ label: 'ログを削除', icon: 'delete', onClick: () => onDeleteLog(thread) }] : []),
          ]}
        />
      )}
      {/* スマホ: 長押しで出す操作の一覧(マウスを乗せて出す操作バーの代わり) */}
      {sheet && (
        <ActionSheet
          title={thread.title}
          onClose={() => setSheet(false)}
          items={[
            { label: '開く', icon: 'open_in_new', onClick: () => onOpen(thread) },
            ...favCopyItems(),
            ...(onNg || (onNgAuthor && thread.authorId)
              ? [
                  {
                    label: 'NG',
                    icon: 'block',
                    children: [
                      ...(onNgAuthor && thread.authorId ? [{ label: `立てた人を NG に追加(${thread.authorId})`, icon: 'person_off', onClick: () => onNgAuthor(thread) }] : []),
                      ...(onNgAuthor && thread.authorId ? [{ label: '立てた人を NG に追加(今日だけ)', icon: 'schedule', onClick: () => onNgAuthor(thread, true) }] : []),
                      ...(onNg ? [{ label: 'スレタイを NG に追加', icon: 'block', onClick: () => onNg(thread) }] : []),
                    ],
                  },
                ]
              : []),
            ...(onDeleteLog && state ? [{ label: 'ログを削除', icon: 'delete', onClick: () => onDeleteLog(thread), danger: true }] : []),
          ]}
        />
      )}
      {/* 操作バー。スレタイに重ならないよう、パネルの上辺に半分かかる位置に出す(スマホは長押しの一覧) */}
      {!isMobile && (onNg || onCopy || onToggleFavorite || (onDeleteLog && state)) && (
        <div
          className={`absolute ${CAN_OVERHANG ? '-top-3.5' : 'top-0.5'} right-2 z-20 flex items-center gap-0.5 p-0.5 bg-c-surface border border-c-border rounded-lg shadow-md opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity ${ngMenu ? '!opacity-100 !pointer-events-auto' : ''}`}
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
          {/* NG: まず「スレタイで」か「立てた人で」を選ぶ。立てた人が分からないスレは、スレタイの NG の画面へすぐ */}
          {onNg && onNgAuthor && thread.authorId ? (
            <MenuButton
              icon="block"
              title="NG に追加"
              hoverClass="hover:!text-mark-danger"
              onOpenChange={setNgMenu}
              items={ngChoices(onNg, onNgAuthor, thread.authorId)}
            />
          ) : onNg ? (
            <button type="button" onClick={() => onNg(thread)} className={`${TOOL} hover:!text-mark-danger`} title="スレタイを NG に追加">
              <span className="material-symbols-outlined text-base leading-none">block</span>
            </button>
          ) : null}
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
