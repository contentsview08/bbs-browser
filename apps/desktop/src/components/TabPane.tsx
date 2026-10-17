// タブ 1 つぶんのスレ表示。中身(そのタブのログや状態)・設定・開いているかが変わったときだけ描き直す(memo)。
// アプリ側の処理は、関数そのものが変わらない ev(useEvent)で受け取り、ここでこのタブ向けに結びつける

import { memo, useCallback, useMemo } from 'react'
import type { AttachmentRules, Post, PostConfirm, PostInput, PostLimits, PostResult, ThreadSummary } from '@bbs-browser/connectors'
import type { ThreadLog } from '@bbs-browser/logstore'
import ThreadView, { type ScrollPosition } from './ThreadView'
import type { NgRule, NgTarget } from '../utils/ng'
import type { AppSettings, ReplyLayout } from '../ui/settings'
import type { NextThreadCandidate } from '../utils/nextThread'
import type { PostAccountOption } from './PostAccountMenu'

/** 開いているスレ 1 つぶん */
export interface Tab {
  id: string
  thread: ThreadSummary
  /** まだ読み込んでいなければ undefined(起動時に戻したタブは、選ぶまで読み込まない) */
  log?: ThreadLog
  /** 開いた時点の「最初の未読」。「ここから未読」の線を引く位置 */
  unreadFrom: number
  readNo: number
  ownNos: Set<number>
  /** 別のタブへ移ったときに覚えておく、読んでいた位置 */
  scroll?: ScrollPosition
  loading: boolean
  /** 手で更新したあとのクールダウンが明ける時刻 */
  refreshReadyAt?: number
  /** レスの評価の数(ふたばのそうだね)。キーはレスの画面の番号(ref があれば ref) */
  votes?: Map<number, number>
}

/** アプリ側の処理。どれも関数そのものは変わらない(描き直しても同じもの) */
export interface TabEvents {
  savePosition: (id: string, pos: ScrollPosition) => void
  markRead: (t: ThreadSummary, no: number) => void
  refresh: () => void
  openInBrowser: (t: ThreadSummary) => void
  openUrl: (url: string) => void
  addNg: (rule: NgRule) => void
  ngDraft: (target: NgTarget, text: string) => void
  /** 書き込めない掲示板なら undefined を返す */
  canPost: (t: ThreadSummary) => boolean
  submitPost: (input: PostInput) => Promise<PostResult>
  confirmPost: (confirm: PostConfirm, input: PostInput) => Promise<PostResult>
  changeReplyLayout: (layout: ReplyLayout) => void
  resizeReply: (key: 'replyHeight' | 'replyWidth', size: number) => void
  setReplyCollapsed: (collapsed: boolean) => void
  /** 1 画面のとき、スレ一覧に戻る */
  backToList: () => void
  deleteLog: (id: string) => void
  uploaded: (u: { url: string; name: string; size: number; withAccount: boolean }) => void
  /** 次スレの候補を探す。スレタイはログのもの(URL から開いたスレは一覧のスレタイが空のため) */
  findNext: (t: ThreadSummary, title: string) => Promise<NextThreadCandidate[]>
  openThread: (t: ThreadSummary) => void
  /** スレの板のスレ一覧を開く(︙ の「板に戻る」) */
  openBoardOf: (t: ThreadSummary) => void
  /** レスを評価する(ふたばの「そうだね」)。新しい数をタブに写す */
  vote: (thread: ThreadSummary, post: Post) => void
  /** スレ表示のヘッダーの高さを保存する(0 なら既定) */
  setThreadHeaderHeight: (height: number) => void
  toggleFavoriteThread: (t: ThreadSummary) => void
  /** 書き込むときに使うアカウントのオン・オフ(どの板でも同じ) */
  togglePostAccount: (id: string, on: boolean) => void
  /** 書き込みの下書きを読む・保存する(空なら消す) */
  loadDraft: (t: ThreadSummary) => Promise<string | undefined>
  saveDraft: (t: ThreadSummary, body: string) => void
  openAccountSettings: () => void
  /** スレのブラウザ用の URL */
  threadUrl: (t: ThreadSummary) => string
  /** 開いているタブの「既読をすぐ知らせる」関数を預かる(更新の直前に呼ぶ) */
  registerReadFlush: (flush: (() => void) | undefined) => void
}

interface Props {
  tab: Tab & { log: ThreadLog }
  active: boolean
  /** キー操作を受け取るか(2 画面でスレ一覧を触っているときは false) */
  keyFocus: boolean
  settings: AppSettings
  isNg: (p: Post) => boolean
  nonameName?: string
  jumpTo?: { no: number; seq: number }
  /** お気に入りのスレか */
  favorite: boolean
  /** 書き込んだあとのクールダウンが明ける時刻(どのタブでも同じ) */
  postReadyAt?: number
  postCooldownMs: number
  /** この板で使えるアカウント */
  postAccounts?: PostAccountOption[]
  /** 1 画面のとき: スレタイの左に、スレ一覧へ戻るボタンを出す */
  showBackToList?: boolean
  /** 板の書き込みの上限と、その掲示板での数え方 */
  postLimits?: PostLimits
  postByteLength?: (text: string) => number
  /** 1 つのスレのレスの上限(コネクタの maxPosts) */
  maxPosts?: number
  /** 本文の >>番号 が指すもの(コネクタの anchorTarget) */
  anchorTarget?: 'no' | 'ref'
  /** レスの評価の呼び名(コネクタの voteLabel) */
  voteLabel?: string
  /** 引用を文章で書く掲示板(コネクタの textQuotes) */
  textQuotes?: boolean
  /** 書き込みにファイルを付けられる掲示板の決まり(コネクタの attachments) */
  attachments?: AttachmentRules
  /** レスを評価できる掲示板か(コネクタの vote) */
  canVote?: boolean
  /** 本文からアイコンを取り出す(コネクタのもの) */
  splitPostIcon?: (body: string) => { icon?: string; body: string }
  ev: TabEvents
}

function TabPane({
  tab,
  active,
  keyFocus,
  settings,
  isNg,
  nonameName,
  jumpTo,
  favorite,
  postReadyAt,
  postCooldownMs,
  postAccounts,
  showBackToList,
  postLimits,
  postByteLength,
  maxPosts,
  anchorTarget,
  voteLabel,
  textQuotes,
  attachments,
  canVote,
  splitPostIcon,
  ev,
}: Props) {
  const { id, thread } = tab
  const onSavePosition = useCallback((pos: ScrollPosition) => ev.savePosition(id, pos), [ev, id])
  const onRead = useCallback((no: number) => ev.markRead(thread, no), [ev, thread])
  const onOpenInBrowser = useCallback(() => ev.openInBrowser(thread), [ev, thread])
  const onDeleteLog = useCallback(() => ev.deleteLog(id), [ev, id])
  const title = tab.log.title || thread.title
  const draft = useMemo(() => ({ load: () => ev.loadDraft(thread), save: (body: string) => ev.saveDraft(thread, body) }), [ev, thread])
  const onFindNext = useCallback(() => ev.findNext(thread, title), [ev, thread, title])
  const onOpenBoard = useCallback(() => ev.openBoardOf(thread), [ev, thread])
  const onVote = useCallback((p: Post) => ev.vote(thread, p), [ev, thread])
  // URL から開いたスレは一覧のスレタイが空なので、ログのスレタイを付けて足す
  const onToggleFavorite = useCallback(() => ev.toggleFavoriteThread({ ...thread, title }), [ev, thread, title])
  const meta = settings.boardMeta[thread.boardUrl]

  return (
    <ThreadView
      threadKey={id}
      log={tab.log}
      active={active}
      keyFocus={keyFocus}
      initialPosition={tab.scroll}
      onSavePosition={onSavePosition}
      unreadFrom={tab.unreadFrom}
      loading={tab.loading}
      settings={settings}
      isNg={isNg}
      onRead={onRead}
      onRefresh={ev.refresh}
      onOpenInBrowser={onOpenInBrowser}
      onUrl={ev.openUrl}
      onAddNg={ev.addNg}
      onNgDraft={ev.ngDraft}
      ownNos={tab.ownNos}
      onSubmitPost={ev.canPost(thread) ? ev.submitPost : undefined}
      onConfirmPost={ev.confirmPost}
      postName={meta?.defaultName ?? settings.postName}
      postMail={meta?.defaultMail ?? settings.postMail}
      onChangeReplyLayout={ev.changeReplyLayout}
      onResizeReply={ev.resizeReply}
      onSetReplyCollapsed={ev.setReplyCollapsed}
      onBackToList={showBackToList ? ev.backToList : undefined}
      onDeleteLog={onDeleteLog}
      nonameName={nonameName}
      jumpTo={jumpTo}
      onUploaded={ev.uploaded}
      onFindNext={onFindNext}
      onOpenBoard={onOpenBoard}
      onHeaderHeight={ev.setThreadHeaderHeight}
      onOpenThread={ev.openThread}
      isFavorite={favorite}
      refreshReadyAt={tab.refreshReadyAt}
      postReadyAt={postReadyAt}
      postCooldownMs={postCooldownMs}
      postAccounts={postAccounts}
      draft={draft}
      threadUrl={ev.threadUrl(thread)}
      registerReadFlush={ev.registerReadFlush}
      postLimits={postLimits}
      postByteLength={postByteLength}
      maxPosts={maxPosts}
      anchorTarget={anchorTarget}
      votes={tab.votes}
      voteLabel={voteLabel}
      textQuotes={textQuotes}
      attachments={attachments}
      onVote={canVote ? onVote : undefined}
      splitPostIcon={splitPostIcon}
      onTogglePostAccount={ev.togglePostAccount}
      onOpenAccountSettings={ev.openAccountSettings}
      onToggleFavorite={onToggleFavorite}
    />
  )
}

export default memo(TabPane)
