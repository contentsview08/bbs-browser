// タブ 1 つぶんのスレ表示。中身(そのタブのログや状態)・設定・開いているかが変わったときだけ描き直す(memo)。
// アプリ側の処理は、関数そのものが変わらない ev(useEvent)で受け取り、ここでこのタブ向けに結びつける

import type { TrollMarks } from '../utils/autoNg'
import type { Judgement } from '../utils/trollModel'
import { memo, useCallback, useMemo } from 'react'
import type { AttachmentRules, Post, PostActionDef, ReactionDef, PostConfirm, PostInput, PostLimits, PostResult, ThreadSummary } from '@bbs-browser/connectors'
import type { ThreadLog } from '@bbs-browser/logstore'
import ThreadView, { type ScrollPosition } from './ThreadView'
import type { NgRule, NgTarget } from '../utils/ng'
import type { AppSettings, ReplyLayout, UpdateSetting } from '../ui/settings'
import type { NextThreadCandidate } from '../utils/nextThread'
import type { UploadedFile } from '../host/uploader'
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
  /** 読み込めなかった理由(取り直し始めたら消す) */
  error?: string
  /** 手で更新したあとのクールダウンが明ける時刻 */
  refreshReadyAt?: number
  /** 実況モードで、次に取りに行く時刻(取りに行っている間・実況モードでないときは持たない) */
  liveRefreshAt?: number
  /** レスへの反応の数(ふたばのそうだねなど)。キーはレスの画面の番号(ref があれば ref)、中は反応の id → 数 */
  reactions?: Map<number, Record<string, number>>
}

/** アプリ側の処理。どれも関数そのものは変わらない(描き直しても同じもの) */
export interface TabEvents {
  savePosition: (id: string, pos: ScrollPosition) => void
  markRead: (t: ThreadSummary, no: number) => void
  refresh: () => void
  openInBrowser: (t: ThreadSummary) => void
  openUrl: (url: string) => void
  addNg: (rule: NgRule) => void
  removeNg: (rules: NgRule[]) => void
  editNg: (rule: NgRule, values: Partial<Record<NgTarget, string>>) => void
  ngDraft: (target: NgTarget, text: string, values?: Partial<Record<NgTarget, string>>) => void
  /** 自動 NG の印を付ける(true: 荒らし、false: 荒らしじゃない、null: 外す) */
  markTroll: (t: ThreadSummary, p: Post, troll: boolean | null, reason?: string) => void
  /** 書き込める掲示板か */
  canPost: (t: ThreadSummary) => boolean
  submitPost: (input: PostInput) => Promise<PostResult>
  confirmPost: (confirm: PostConfirm, input: PostInput) => Promise<PostResult>
  changeReplyLayout: (layout: ReplyLayout) => void
  resizeReply: (key: 'replyHeight' | 'replyWidth', size: number) => void
  setReplyCollapsed: (collapsed: boolean) => void
  /** 1 画面のとき、スレ一覧に戻る */
  backToList: () => void
  /** スマホ: サイドバーの引き出しを開く(PC では undefined) */
  openDrawer?: () => void
  deleteLog: (id: string) => void
  uploaded: (u: UploadedFile) => void
  /** 次スレの候補を探す。スレタイはログのもの(URL から開いたスレは一覧のスレタイが空のため) */
  findNext: (t: ThreadSummary, title: string) => Promise<NextThreadCandidate[]>
  openThread: (t: ThreadSummary) => void
  /** いまのスレ一覧で、次に未読のあるスレを開く */
  openNextUnread: () => void
  /** スレの板のスレ一覧を開く(︙ の「板に戻る」) */
  openBoardOf: (t: ThreadSummary) => void
  /** 自分の書き込みを消す(確かめてから) */
  deletePost: (thread: ThreadSummary, post: Post) => void
  /** 自分のレスの印を手で付ける・外す */
  markOwn: (thread: ThreadSummary, nos: number[], own: boolean) => void
  /** レスへの反応を押す(ふたばの「そうだね」など)。新しい数をタブに写す */
  react: (thread: ThreadSummary, post: Post, reactionId: string) => void
  /** レスへの操作(通報など)を実行する(確かめる文があれば確かめてから) */
  postAction: (thread: ThreadSummary, post: Post, actionId: string) => void
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
  /** そのタブの実況モードを入れた・やめた */
  setLive: (id: string, on: boolean) => void
  /** 設定を変える(︙ の表示スタイル) */
  updateSetting: UpdateSetting
}

interface Props {
  tab: Tab & { log: ThreadLog }
  active: boolean
  /** キー操作を受け取るか(2 画面でスレ一覧を触っているときは false) */
  keyFocus: boolean
  settings: AppSettings
  /** レスの NG。boardUrl はそのスレの板(「この板だけ」の NG を当てる) */
  isNg: (p: Post, boardUrl?: string) => boolean
  /** 自動 NG にユーザーが付けた印 */
  trollMarks: TrollMarks
  /** 印から学んだ判定(印が少ないうちは undefined) */
  trollJudge?: (body: string) => Judgement | undefined
  nonameName?: string
  jumpTo?: { no: number; seq: number }
  /** お気に入りのスレか */
  favorite: boolean
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
  /** レスへの反応の種類(コネクタの reactions) */
  reactionDefs?: ReactionDef[]
  /** レスへの操作の種類(コネクタの postActions) */
  postActions?: PostActionDef[]
  /** 引用を文章で書く掲示板(コネクタの textQuotes) */
  textQuotes?: boolean
  /** 書き込みにファイルを付けられる掲示板の決まり(コネクタの attachments) */
  attachments?: AttachmentRules
  /** 反応を押せる掲示板か(コネクタの react) */
  canReact?: boolean
  /** 自分の書き込みを消せる掲示板か(コネクタの deletePost) */
  canDeletePost?: boolean
  /** 本文からアイコンを取り出す(コネクタのもの) */
  splitPostIcon?: (body: string) => { icon?: string; body: string }
  /** スレの最後の「次の未読スレへ」: 次のスレのスレタイ(なければ '')と未読の数、探した一覧の名前。開いていないタブ・一覧のないときは undefined */
  nextUnreadTitle?: string
  nextUnreadCount?: number
  nextListTitle?: string
  ev: TabEvents
}

function TabPane({
  tab,
  active,
  keyFocus,
  settings,
  isNg,
  trollMarks,
  trollJudge,
  nonameName,
  jumpTo,
  favorite,
  postAccounts,
  showBackToList,
  postLimits,
  postByteLength,
  maxPosts,
  anchorTarget,
  reactionDefs,
  postActions,
  textQuotes,
  attachments,
  canReact,
  canDeletePost,
  splitPostIcon,
  nextUnreadTitle,
  nextUnreadCount,
  nextListTitle,
  ev,
}: Props) {
  const { id, thread } = tab
  const onSavePosition = useCallback((pos: ScrollPosition) => ev.savePosition(id, pos), [ev, id])
  const onRead = useCallback((no: number) => ev.markRead(thread, no), [ev, thread])
  // NG は、このスレの板を添えて当てる(「この板だけ」の NG)
  const isNgHere = useCallback((p: Post) => isNg(p, thread.boardUrl), [isNg, thread.boardUrl])
  const onOpenInBrowser = useCallback(() => ev.openInBrowser(thread), [ev, thread])
  const onDeleteLog = useCallback(() => ev.deleteLog(id), [ev, id])
  const onLiveChange = useCallback((on: boolean) => ev.setLive(id, on), [ev, id])
  const title = tab.log.title || thread.title
  const draft = useMemo(() => ({ load: () => ev.loadDraft(thread), save: (body: string) => ev.saveDraft(thread, body), key: `reply:${thread.boardUrl}${thread.key}` }), [ev, thread])
  const onFindNext = useCallback(() => ev.findNext(thread, title), [ev, thread, title])
  const onOpenBoard = useCallback(() => ev.openBoardOf(thread), [ev, thread])
  const onReact = useCallback((p: Post, id: string) => ev.react(thread, p, id), [ev, thread])
  const onPostAction = useCallback((p: Post, id: string) => ev.postAction(thread, p, id), [ev, thread])
  const onDeletePost = useCallback((p: Post) => ev.deletePost(thread, p), [ev, thread])
  const onMarkOwn = useCallback((nos: number[], own: boolean) => ev.markOwn(thread, nos, own), [ev, thread])
  const onMarkTroll = useCallback((p: Post, troll: boolean | null, reason?: string) => ev.markTroll(thread, p, troll, reason), [ev, thread])
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
      errorText={tab.error}
      settings={settings}
      isNg={isNgHere}
      trollMarks={trollMarks}
      trollJudge={trollJudge}
      onMarkTroll={onMarkTroll}
      onRead={onRead}
      onRefresh={ev.refresh}
      onOpenInBrowser={onOpenInBrowser}
      onUrl={ev.openUrl}
      onAddNg={ev.addNg}
      onRemoveNg={ev.removeNg}
      onEditNg={ev.editNg}
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
      onOpenDrawer={ev.openDrawer}
      onDeleteLog={onDeleteLog}
      nonameName={nonameName}
      boardUrl={thread.boardUrl}
      omitNoname={meta?.omitNoname}
      extraNonames={meta?.nonames}
      jumpTo={jumpTo}
      onUploaded={ev.uploaded}
      onFindNext={onFindNext}
      onOpenBoard={onOpenBoard}
      onHeaderHeight={ev.setThreadHeaderHeight}
      onOpenThread={ev.openThread}
      nextUnread={
        nextUnreadTitle === undefined || nextListTitle === undefined
          ? undefined
          : { title: nextUnreadTitle, count: nextUnreadCount ?? 0, listTitle: nextListTitle }
      }
      onOpenNextUnread={ev.openNextUnread}
      isFavorite={favorite}
      refreshReadyAt={tab.refreshReadyAt}
      liveRefreshAt={tab.liveRefreshAt}
      postAccounts={postAccounts}
      draft={draft}
      threadUrl={ev.threadUrl(thread)}
      registerReadFlush={ev.registerReadFlush}
      onLiveChange={onLiveChange}
      postLimits={postLimits}
      postByteLength={postByteLength}
      maxPosts={maxPosts}
      anchorTarget={anchorTarget}
      reactions={tab.reactions}
      reactionDefs={reactionDefs}
      postActions={postActions}
      textQuotes={textQuotes}
      attachments={attachments}
      onReact={canReact ? onReact : undefined}
      onPostAction={postActions?.length ? onPostAction : undefined}
      onDeletePost={canDeletePost ? onDeletePost : undefined}
      onMarkOwn={onMarkOwn}
      splitPostIcon={splitPostIcon}
      onTogglePostAccount={ev.togglePostAccount}
      onOpenAccountSettings={ev.openAccountSettings}
      onToggleFavorite={onToggleFavorite}
      onUpdateSetting={ev.updateSetting}
    />
  )
}

export default memo(TabPane)
