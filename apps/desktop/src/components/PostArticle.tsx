// レス 1 件。web 版の PostArticle.tsx の見た目を移植。
// 返信・削除・通報など、web 版の API に依存する機能は外している。

import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Post } from '@bbs-browser/connectors'
import {
  anchorTargets,
  displayBody,
  displayName,
  heatClass,
  imageUrlsIn,
  linkUrlsIn,
  youtubeLinksIn,
  looksLikeAA,
  renderBody,
  videoFileUrlsIn,
  type BodyHandlers,
  type DisplayOptions,
} from '../utils/postBody'
import LinkPreview from './LinkPreview'
import LocalAddressMark from './LocalAddressMark'
import { isAutoLoadable } from '../utils/safeUrl'
import { newRule, todayDateString, type NgRule } from '../utils/ng'
import type { NgMode } from '../ui/settings'
import Identicon from './Identicon'
import { reasonLabel, type AutoNgReason } from '../utils/autoNg'

export interface PostHandlers extends BodyHandlers {
  /** レス番号を押した(このレスへの返信を出す) */
  onReplies: (no: number, el: HTMLElement) => void
  /** ID を押した(その ID の書き込みを出す) */
  onId: (id: string, el: HTMLElement) => void
  /** 名前を押した(同じ名前の書き込みを出す) */
  onName: (name: string, el: HTMLElement) => void
  /** 本文を押した(アンカーツリーを出す。つながりがなければ何もしない) */
  onBody: (no: number, el: HTMLElement) => void
  onImage: (urls: string[], index: number, post: Post) => void
  onAddNg: (rule: NgRule) => void
  /** 書き込み欄に >>番号 を入れる。書き込めないときは undefined */
  onReply?: (no: number) => void
  /** 自分の書き込みを消す。消せない掲示板は undefined */
  onDeletePost?: (post: Post) => void
  /** レスを評価する(ふたばの「そうだね」を押す)。評価のない掲示板は undefined */
  onVote?: (post: Post) => void
  /** NG の画面を、元の文字を入れた状態で開く */
  onNgDraft?: (target: 'content' | 'posterName' | 'posterId' | 'threadTitle', text: string) => void
  /** >>番号 を付けてすぐ書き込む(「草」ボタン)。書き込めないときは undefined */
  onQuickReply?: (no: number, text: string) => void
  /** 自動 NG の印を付ける(true: 荒らし、false: 荒らしじゃない、null: 外す)。reason は付けたときの自動 NG の理由 */
  onMarkTroll?: (post: Post, troll: boolean | null, reason?: string) => void
}

interface Props {
  post: Post
  anchorCount: number
  idCount: number
  showTopDivider: boolean
  ng: boolean
  /** 自動 NG で畳んだときの理由(ユーザーの NG に当たっていなくても ng は true になる) */
  autoNg?: AutoNgReason
  ngMode: NgMode
  showThumbnails: boolean
  aaAutoDetect: boolean
  showIdenticon?: boolean
  showLinkPreview?: boolean
  /** 名無しの省略・空行の扱い */
  display?: DisplayOptions
  /** スレ主(>>1 と同じ ID)の書き込み */
  isOp?: boolean
  /** 操作バーに並べるもの(設定の postToolbar)と、定型文 */
  toolbar?: string[]
  phrases?: string[]
  /** 自動更新などで新しく届いたレス。一瞬光らせる */
  flash?: boolean
  /** 自分の書き込み */
  isOwn?: boolean
  /** 自分の書き込みへのアンカーを含む */
  isReplyToOwn?: boolean
  handlers: PostHandlers
  /** 見た目のスタイル。card: いまの区切り線の並び / discord: 丸いアイコンと平らな並び / classic: 専ブラ風の 1 行の頭 */
  variant?: PostVariant
  /** Discord 風・LINE 風: 直前のレスと同じ ID(続けて書いた)。アイコンと頭を省く */
  continued?: boolean
  /** Discord 風・LINE 風: 本文の先頭のアンカーの引用元(番号と本文の頭) */
  replyPreview?: { no: number; text: string; id?: string }
  /** アンカーツリーの中のレス。LINE 風は自分の書き込みも左にそろえ、どのスタイルでも左端の縦の印(自分・自分宛て)を出さない
   *  (ツリーの線と重なって見にくいため。つながりはツリーの線で分かる) */
  alignLeft?: boolean
  /** ほかの人からの評価の数と呼び名(ふたばの「そうだね」)。0 や なしなら出さない */
  votes?: number
  voteLabel?: string
  /** 「グロ」などの返信が付いたレス。サムネイルをぼかし、「グロ注意」と出す */
  blurMedia?: boolean
  /** 文章で引用する掲示板(ふたば)の、このレスの引用の行 → 引用元のレス番号。あれば「>文章」の行を緑の引用にする */
  quotes?: Map<string, number>
}

export type PostVariant = 'card' | 'discord' | 'classic' | 'line'

const HEAD_TEXT = 'text-xs'

interface MenuItem {
  label: string
  icon: string
  onClick: () => void
}

const TOOL_BTN =
  'h-7 min-w-7 px-1.5 flex items-center justify-center rounded text-c-text-muted hover:text-c-text-strong hover:bg-c-surface3 transition-colors'

/**
 * 押すとメニューを出すボタン。レスのヘッダー行などははみ出しを隠す設定なので、メニューは body の直下に出し、
 * ボタンの位置から場所を決める(ポップアップの中のレスでも使えるよう、ポップアップより手前に出す)
 */
function MenuButton(props: { icon: string; title: string; items: MenuItem[]; onOpenChange: (open: boolean) => void; hoverClass?: string }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number }>()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const { onOpenChange } = props
  useEffect(() => onOpenChange(pos !== undefined), [pos, onOpenChange])
  useEffect(() => {
    if (!pos) return
    const close = (e: PointerEvent) => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setPos(undefined)
    }
    const closeOnScroll = () => setPos(undefined)
    document.addEventListener('pointerdown', close)
    window.addEventListener('wheel', closeOnScroll, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('wheel', closeOnScroll)
    }
  }, [pos])

  const toggle = () => {
    if (pos) return setPos(undefined)
    const rect = buttonRef.current!.getBoundingClientRect()
    const right = window.innerWidth - rect.right
    // 下に入りきらなければ上に開く
    const below = window.innerHeight - rect.bottom
    setPos(below < 300 ? { bottom: window.innerHeight - rect.top + 4, right } : { top: rect.bottom + 4, right })
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        className={`${TOOL_BTN} ${props.hoverClass ?? ''} ${pos ? 'text-c-text-strong bg-c-surface3' : ''}`}
        title={props.title}
      >
        <span className="material-symbols-outlined text-lg leading-none">{props.icon}</span>
      </button>
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed w-56 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl py-1 z-[9800] text-sm"
            style={pos}
            onClick={(e) => e.stopPropagation()}
          >
            {props.items.map((it) => (
              <button
                key={it.label}
                type="button"
                onClick={() => {
                  it.onClick()
                  setPos(undefined)
                }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-c-text-body hover:bg-c-surface2 transition-colors"
              >
                <span className="material-symbols-outlined text-base">{it.icon}</span>
                <span className="flex-1 text-left">{it.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

function PostArticle(props: Props) {
  const { post, anchorCount, idCount, handlers } = props
  const [revealed, setRevealed] = useState(false)
  const articleRef = useRef<HTMLElement>(null)
  const [ngOpen, setNgOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const menuOpen = ngOpen || moreOpen
  /** マウスが乗っているか(乗っている間だけ操作バーを作る) */
  const [hovered, setHovered] = useState(false)
  const [aaOverride, setAaOverride] = useState<boolean | null>(null)

  const frame = {
    paddingLeft: 'var(--post-padding-x)',
    paddingRight: 'var(--post-padding-x)',
    paddingBottom: 'var(--post-padding-y)',
    // Discord 風で続けて書いたレスは、前のレスに寄せる
    paddingTop: props.continued ? '2px' : props.showTopDivider ? undefined : 'var(--post-padding-y)',
    borderTopColor: props.showTopDivider ? 'var(--post-divider-color, var(--c-border))' : undefined,
  }
  const frameClass = `group w-full ${props.showTopDivider ? 'border-t pt-2' : ''} ${props.flash ? 'flash-new' : ''}`

  // NG: 番号だけ残して「あぼーん」と出す。押すとその場で中身を見られる
  // 自動 NG は、透明あぼーんの設定でも畳んだ形で出す(誤判定に気づいて「荒らしじゃない」で直せるように)
  if (props.ng && !revealed) {
    if (props.ngMode === 'hide' && !props.autoNg) return null
    const auto = props.autoNg
    return (
      <article id={`post-${post.no}`} data-no={post.no} className={frameClass} style={frame}>
        <div className="flex items-center gap-3 text-xs text-c-text-muted">
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="flex items-center gap-3 hover:text-c-text-body"
            title="押すと中身を表示"
          >
            <span className="font-bold text-sm">{post.ref ?? post.no}</span>
            <span>あぼーん</span>
            {auto && (
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm leading-none">smart_toy</span>
                自動 NG・{reasonLabel(auto)}
              </span>
            )}
          </button>
          {auto && handlers.onMarkTroll && (
            <button
              type="button"
              onClick={() => handlers.onMarkTroll!(post, auto.kind === 'marked' ? null : false, auto.kind)}
              className="px-1.5 py-0.5 rounded border border-c-border hover:text-c-accent hover:border-c-accent"
              title={auto.kind === 'marked' ? '付けた荒らしの印を外す' : '誤判定として印を付け、同じ本文を今後は畳まない'}
            >
              {auto.kind === 'marked' ? '印を外す' : '荒らしじゃない'}
            </button>
          )}
        </div>
      </article>
    )
  }

  // BE のアイコン(本文の 1 行目の sssp://)は絵にして、本文からは除く
  const { icon: beIcon, body: rawBody } = props.display?.splitIcon?.(post.body) ?? { body: post.body }
  const body = props.display ? displayBody(rawBody, props.display) : rawBody
  const name = props.display ? displayName(post.name, props.display) : post.name
  const numHeat = heatClass(anchorCount)
  // アンカーを付けている・付けられているレスは、本文を押すとツリーを出せる
  const hasConnections = anchorCount > 0 || (props.quotes?.size ?? 0) > 0 || anchorTargets(post.body, handlers.toNo).some((n) => n !== post.no)
  const isAA = aaOverride ?? (props.aaAutoDetect && looksLikeAA(body))
  // 本文は一番明るい文字色だと背景との差が強すぎてチカチカするので、一段落とした色にする
  const bodyClass = anchorCount >= 3 ? numHeat : 'text-c-text-body'
  const images = props.showThumbnails ? imageUrlsIn(post.body) : []
  const videos = props.showThumbnails ? youtubeLinksIn(post.body) : []
  // 動画のファイル(mp4 など)は、画像と一緒にビューアーで順に見られるよう、画像の後ろにつなげて渡す
  const videoFiles = props.showThumbnails ? videoFileUrlsIn(post.body) : []
  // YouTube もビューアーの中で再生するので、いちばん後ろにつなげる
  const media = videoFiles.length + videos.length > 0 ? [...images, ...videoFiles, ...videos.map((v) => v.url)] : images
  // 埋め込みのカードは 3 件まで(それ以上はカードの右下に件数だけ出す。web 版と同じ)
  const links = props.showLinkPreview ? linkUrlsIn(post.body) : []

  const copy = (text: string) => void navigator.clipboard.writeText(text)
  const header = [post.ref ?? post.no, post.name, post.mail && `[${post.mail}]`, post.date, post.id && `ID:${post.id}`]
    .filter(Boolean)
    .join(' ')

  const ngActions: MenuItem[] = [
    ...(post.id
      ? [
          {
            label: 'NGIDに追加(今日だけ)',
            icon: 'schedule',
            onClick: () => handlers.onAddNg(newRule('posterId', post.id!, { expiresOnDate: todayDateString() })),
          },
          { label: 'NGIDに追加', icon: 'person_off', onClick: () => handlers.onAddNg(newRule('posterId', post.id!)) },
        ]
      : []),
    ...(post.name ? [{ label: 'NGNameに追加', icon: 'block', onClick: () => handlers.onAddNg(newRule('posterName', post.name)) }] : []),
    ...(handlers.onMarkTroll
      ? props.autoNg?.kind === 'marked'
        ? [{ label: '荒らしの印を外す', icon: 'undo', onClick: () => handlers.onMarkTroll!(post, null) }]
        : [
            {
              label: '荒らしとして NG(同じ本文も)',
              icon: 'smart_toy',
              onClick: () => handlers.onMarkTroll!(post, true, props.autoNg?.kind),
            },
            ...(props.autoNg
              ? [{ label: '荒らし判定を外す(誤判定)', icon: 'undo', onClick: () => handlers.onMarkTroll!(post, false, props.autoNg?.kind) }]
              : []),
          ]
      : []),
    ...(handlers.onNgDraft
      ? [{ label: 'NG ワードを編集して追加', icon: 'edit_note', onClick: () => handlers.onNgDraft!('content', post.body) }]
      : []),
  ]
  const toolbarItems = props.toolbar ?? ['reply', 'copy', 'ng']
  const reply = handlers.onReply
  const quick = handlers.onQuickReply
  const actions: MenuItem[] = [
    ...(reply ? [{ label: '返信', icon: 'reply', onClick: () => reply(post.no) }] : []),
    ...(quick
      ? (props.phrases ?? []).map((text) => ({ label: `「${text}」とすぐ書き込む`, icon: 'bolt', onClick: () => quick(post.no, text) }))
      : []),
    ...(hasConnections
      ? [{ label: 'アンカーツリーを表示', icon: 'account_tree', onClick: () => handlers.onBody(post.no, articleRef.current!) }]
      : []),
    { label: 'ヘッダ含めてコピー', icon: 'content_copy', onClick: () => copy(`${header}\n${post.body}`) },
    { label: '本文のみコピー', icon: 'content_copy', onClick: () => copy(post.body) },
    {
      label: isAA ? '文字列として表示' : 'AAとして表示',
      icon: isAA ? 'notes' : 'grid_on',
      onClick: () => setAaOverride(!isAA),
    },
    ...ngActions,
    // 自分の書き込みは、掲示板から消せる(消せる掲示板だけ)
    ...(props.isOwn && handlers.onDeletePost
      ? [{ label: 'この書き込みを削除', icon: 'delete_forever', onClick: () => handlers.onDeletePost!(post) }]
      : []),
  ]

  const variant = props.variant ?? 'card'

  // ── レスの頭の部品(スタイルごとに並べ方を変える) ──
  /** レス番号(返信があれば数も。押すと返信を出す) */
  const numBtn = (prefix = '') => (
    <button
      type="button"
      className={`font-bold text-sm flex items-center gap-1 ${numHeat || 'text-c-text-muted'} ${anchorCount > 0 ? 'hover:opacity-80' : 'cursor-default'}`}
      onClick={anchorCount > 0 ? (e) => handlers.onReplies(post.no, e.currentTarget) : undefined}
      title={anchorCount > 0 ? 'このレスへの返信を表示' : undefined}
    >
      <span style={props.isOwn ? { color: 'var(--c-own)' } : undefined}>
        {prefix}
        {/* 板の本当の番号があればそれを出す(ふたば・4chan は板全体の通し番号) */}
        {post.ref ?? post.no}
      </span>
      {/* 返信の数。Discord 風・LINE 風は吹き出しのアイコンと数、ほかは (数) */}
      {anchorCount > 0 &&
        (variant === 'discord' || variant === 'line' ? (
          <span className={`inline-flex items-center gap-0.5 text-xs ${numHeat || 'text-c-text-muted'}`}>
            <span className="material-symbols-outlined text-[13px] leading-none">chat_bubble</span>
            {anchorCount}
          </span>
        ) : (
          <span className={`text-xs ${numHeat || 'text-c-text-muted'}`}>({anchorCount})</span>
        ))}
    </button>
  )
  const nameBtn = (cls: string) =>
    name && (
      <button
        type="button"
        className={`font-bold text-c-poster-name min-w-0 truncate hover:opacity-80 ${cls}`}
        onClick={(e) => handlers.onName(post.name, e.currentTarget)}
        title="同じ名前の書き込みを表示"
      >
        {name}
      </button>
    )
  /** NG のレスを押して中身を出しているときの札。押すとあぼーんに戻す */
  const ngChip = props.ng && revealed && (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setRevealed(false)
      }}
      className="flex-shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-px rounded hover:opacity-80 transition-opacity"
      style={{ color: 'var(--c-heat-very-hot)', border: '1px solid var(--c-heat-very-hot)' }}
      title="NG のレスです。押すとあぼーんに戻します"
    >
      <span className="material-symbols-outlined text-xs leading-none">block</span>
      NG
    </button>
  )
  const opChip = props.isOp && (
    <span
      className="flex-shrink-0 text-[10px] font-bold px-1.5 py-px rounded"
      style={{ color: 'var(--c-accent)', background: 'var(--c-accent-wash)', border: '1px solid var(--c-accent)' }}
      title="スレ主(>>1 と同じ ID)"
    >
      主
    </span>
  )
  const idBtn =
    post.id &&
    (
      <button
        type="button"
        className={`${HEAD_TEXT} font-mono flex items-center gap-0.5 hover:opacity-80 ${heatClass(idCount) || 'text-c-text-muted'}`}
        onClick={(e) => handlers.onId(post.id!, e.currentTarget)}
        title="この ID の書き込みを表示"
      >
        <span>ID:{post.id}</span>
        {idCount >= 2 && <span className="text-xs">({idCount})</span>}
      </button>
    )
  /** 評価の数(ふたばの「そうだね×18」)。多いほど目立つ色に。押せる掲示板では、押すと評価する(まだなければ「+」) */
  const votes = props.votes ?? 0
  const voteChip = handlers.onVote ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        handlers.onVote?.(post)
      }}
      className={`flex-shrink-0 text-[11px] font-bold tabular-nums hover:underline ${votes > 0 ? heatClass(votes) || 'text-mark-hot' : 'text-c-text-muted'}`}
      title={`${props.voteLabel ?? '評価'}を押す`}
    >
      {votes > 0 ? `${props.voteLabel ?? '+'}×${votes}` : '+'}
    </button>
  ) : (
    votes > 0 && (
      <span className={`flex-shrink-0 text-[11px] font-bold tabular-nums ${heatClass(votes) || 'text-mark-hot'}`} title={`${props.voteLabel ?? '評価'} ${votes}`}>
        {props.voteLabel ?? '+'}×{votes}
      </span>
    )
  )
  const toOwnChip = props.isReplyToOwn && (
    <span
      className="text-[10px] font-medium px-2 py-0.5 flex-shrink-0"
      style={{ color: 'var(--c-own)', background: 'var(--c-own-wash)', border: '1px solid var(--c-own)', borderRadius: 'var(--chip-radius)' }}
    >
      →あなた宛
    </span>
  )
  /** ID のアイコン。round なら丸く大きく(Discord 風)。書き込み数を右下に重ねる */
  const identiconBtn = (size: number, round = false) =>
    post.id && (
      <button
        type="button"
        className={`relative flex-shrink-0 hover:opacity-80 ${round ? '' : 'mr-1'}`}
        onClick={(e) => handlers.onId(post.id!, e.currentTarget)}
        title={`ID:${post.id} (${idCount})`}
      >
        <span className={`block overflow-hidden ${round ? 'rounded-full' : ''}`}>
          <Identicon seed={post.id} size={size} />
        </span>
        {idCount >= 2 && (
          <span
            className={`absolute -bottom-1 -right-1 min-w-[15px] h-[15px] px-0.5 rounded-full bg-c-surface border border-c-border text-[9px] font-bold leading-none flex items-center justify-center ${heatClass(idCount) || 'text-c-text-muted'}`}
          >
            {idCount}
          </span>
        )}
      </button>
    )

  /** ID のないレス(板の設定や書き方で ID が付かないもの)のアイコン。何もない丸だと壊れて見えるので、人の形を出す */
  const noIdAvatar = (
    <span className="flex w-9 h-9 rounded-full bg-c-surface3 items-center justify-center text-c-text-muted" title="ID のないレス">
      <span className="material-symbols-outlined fill text-xl leading-none">person</span>
    </span>
  )

  // ── レスの頭 ──
  const headerBlock =
    variant === 'classic' ? (
      // 専ブラ風: 「12 ：名前 [sage]：日付 ID:xxx」を 1 行に。色の面も枠もなし
      <div data-post-header className="flex items-baseline flex-wrap gap-x-1.5 gap-y-0.5 mb-1 text-sm">
        {numBtn()}
        <span className="text-c-text-muted">：</span>
        {nameBtn('text-sm')}
        {post.mail && <span className="text-c-text-muted text-xs">[{post.mail}]</span>}
        <span className="text-c-text-muted">：</span>
        <span className="text-c-text-muted text-xs whitespace-nowrap">{post.date}</span>
        {idBtn}
        {voteChip}
        {opChip}
        {ngChip}
        {toOwnChip}
      </div>
    ) : variant === 'discord' ? (
      // Discord 風: 名前を大きめに、番号・日付・ID は小さく横に
      props.continued ? null : (
        <div data-post-header className="flex items-baseline flex-nowrap overflow-hidden gap-2 mb-0.5">
          {nameBtn('text-sm') || <span className="font-bold text-sm text-c-poster-name">名無し</span>}
          {opChip}
          {ngChip}
          {/* 番号は名前のすぐ後ろに(右端はマウスを乗せたときの操作バーと重なるため) */}
          <span className="flex-shrink-0 text-xs">{numBtn('#')}</span>
          <span className={`${HEAD_TEXT} text-c-text-muted whitespace-nowrap`}>{post.date}</span>
          {idBtn}
          {voteChip}
          {post.mail && <span className={`${HEAD_TEXT} text-c-text-muted`}>[{post.mail}]</span>}
          {toOwnChip}
        </div>
      )
    ) : (
      <div data-post-header className="flex items-center mb-2 flex-nowrap overflow-hidden gap-3">
        {/* ID のアイコン(web 版と同じく、右下にその ID の書き込み数を重ねる) */}
        {props.showIdenticon && identiconBtn(22)}
        {numBtn()}
        {nameBtn(HEAD_TEXT)}
        {ngChip}
        {opChip}
        {post.mail && <span className={`${HEAD_TEXT} text-c-text-muted`}>[{post.mail}]</span>}
        <span className={`${HEAD_TEXT} text-c-text-muted whitespace-nowrap`}>{post.date}</span>
        {idBtn}
        {voteChip}
        {toOwnChip}
      </div>
    )

  /**
   * Discord 風: 本文の先頭のアンカーを「返信」として、頭の上に返信元の 1 行を出す。
   * 返信元の小さいアイコンは本文の始まりの位置に置き、そこから左下へ、書いた人の大きいアイコンまで線でつなぐ
   * (番号は線とアイコンで分かるので出さない)
   */
  const replyLine = variant === 'discord' && props.replyPreview && (
    <div className="relative h-5 mb-0.5 pl-12 flex items-center">
      {/* 大きいアイコン(幅 36px の真ん中)の上から立ち上がり、右へ曲がって小さいアイコンの手前まで */}
      <span
        aria-hidden
        className="absolute left-[18px] top-1/2 -bottom-0.5 w-[26px] border-l-2 border-t-2 rounded-tl-md pointer-events-none"
        style={{ borderColor: 'var(--c-border-strong)' }}
      />
      <button
        type="button"
        className="flex items-center gap-1.5 min-w-0 max-w-full text-xs text-c-text-muted hover:text-c-text-body"
        onClick={(e) => {
          e.stopPropagation()
          handlers.onAnchor([props.replyPreview!.no], e.currentTarget, 'click')
        }}
        title={`>>${props.replyPreview.no} を表示`}
      >
        {props.replyPreview.id ? (
          <span className="flex-shrink-0 block overflow-hidden rounded-full">
            <Identicon seed={props.replyPreview.id} size={16} />
          </span>
        ) : (
          <span className="flex-shrink-0 flex w-4 h-4 rounded-full bg-c-surface3 items-center justify-center text-c-text-muted" title="ID のないレス">
            <span className="material-symbols-outlined fill text-[12px] leading-none">person</span>
          </span>
        )}
        <span className="truncate">{props.replyPreview.text}</span>
      </button>
    </div>
  )

  /** 本文(LINE 風はレスの行)を押したら、アンカーツリーを出す。文字を選んでいるとき(コピーしようとしているとき)は開かない */
  const openTree = (e: React.MouseEvent<HTMLElement>) => {
    if (!hasConnections || window.getSelection()?.toString().trim()) return
    // 名前・ID・リンクなどのボタンを押したときは、そちらだけ(LINE 風は頭もレスの行の中にあるため)
    if ((e.target as HTMLElement).closest('button, a, [role="button"]')) return
    handlers.onBody(post.no, e.currentTarget)
  }

  const bodyBlock = (
        <div
          data-post-body
          className={hasConnections ? 'cursor-pointer' : ''}
          // LINE 風は、吹き出しの外(レスの行全体)を押しても開けるよう、行の方で受ける(lineLayout)
          onClick={variant === 'line' ? undefined : openTree}
          style={{
            // 専ブラ風は本文を字下げし、Discord 風は頭の位置から。どちらも本文の左の縦線は引かない(自分の印は別に出る)
            paddingLeft:
              variant === 'classic' ? '2em' : variant === 'discord' || variant === 'line' ? 0 : props.isOwn ? 'var(--post-quote-padding-own)' : 'var(--post-quote-padding)',
            borderLeftWidth: variant !== 'card' ? 0 : props.isOwn ? 'var(--post-quote-bar-width-own)' : 'var(--post-quote-bar-width)',
            borderLeftStyle: 'solid',
            borderLeftColor: props.isOwn ? 'var(--c-own)' : 'var(--c-border)',
          }}
        >
          {/* BE のアイコンは、画像のサムネイルの設定に関係なく出す(5ch の書き込みの一部なので)。LINE 風ではアイコンの場所に出す */}
          {beIcon && variant !== 'line' && (
            <img
              src={beIcon}
              alt=""
              referrerPolicy="no-referrer"
              className="block mb-1 max-h-12 max-w-[96px] object-contain"
              title="BE のアイコン"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
          <p
            className={`text-base ${bodyClass} ${isAA ? 'aa-font whitespace-pre overflow-x-auto' : 'whitespace-pre-wrap break-words leading-relaxed'}`}
          >
            {renderBody(body, handlers, props.quotes)}
          </p>

          {links.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              {links.slice(0, 3).map((url, i) => (
                <LinkPreview key={url} url={url} onOpen={handlers.onUrl} more={i === 2 ? links.length - 3 : undefined} />
              ))}
            </div>
          )}
          {images.length + videos.length + videoFiles.length > 0 && props.blurMedia && (
            <p className="mt-2 flex items-center gap-1 text-[11px] font-bold" style={{ color: 'var(--c-error)' }}>
              <span className="material-symbols-outlined text-sm leading-none">warning</span>
              グロ注意(押すと開きます)
            </p>
          )}
          {images.length + videos.length + videoFiles.length > 0 && (
            <div className={`mt-2 flex flex-wrap gap-2 ${props.blurMedia ? 'gross-blur' : ''}`}>
              {images.map((url, i) => (
                <button
                  key={url + i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handlers.onImage(media, i, post)
                  }}
                  className="post-thumb bg-c-surface2 border border-c-border rounded overflow-hidden flex-shrink-0 flex items-center justify-center hover:border-c-border-strong transition-colors"
                >
                  {/* 家の中のアドレスは、表示しただけでは読みに行かない(押せば開く) */}
                  {isAutoLoadable(url) ? (
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : (
                    <LocalAddressMark />
                  )}
                </button>
              ))}
              {/* 動画のファイルは、最初のコマをサムネイルにして ▶ を付ける。押すとビューアーで再生する。
                  最初のコマに要る分(metadata)だけ読み、本体は押すまで取りに行かない */}
              {videoFiles.map((url, j) => (
                <button
                  key={url}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handlers.onImage(media, images.length + j, post)
                  }}
                  className="post-thumb relative bg-black border border-c-border rounded overflow-hidden flex-shrink-0 hover:border-c-border-strong transition-colors"
                  title="動画を再生する"
                >
                  {isAutoLoadable(url) ? (
                    <video src={`${url}#t=0.1`} preload="metadata" muted playsInline className="w-full h-full object-cover pointer-events-none" />
                  ) : (
                    <LocalAddressMark />
                  )}
                  <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="material-symbols-outlined fill text-3xl text-white/90 drop-shadow">play_circle</span>
                  </span>
                </button>
              ))}
              {/* YouTube は赤い枠と ▶ で見分ける(web 版と同じ)。押すとビューアーの中で再生する */}
              {videos.map((v, k) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handlers.onImage(media, images.length + videoFiles.length + k, post)
                  }}
                  className="post-thumb relative rounded overflow-hidden flex-shrink-0 hover:opacity-90 transition-opacity"
                  style={{ border: '2px solid #ff0000', background: '#000' }}
                  title="YouTube を再生する"
                >
                  <img
                    src={`https://img.youtube.com/vi/${v.id}/mqdefault.jpg`}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] px-1 rounded leading-none pointer-events-none">▶</span>
                </button>
              ))}
            </div>
          )}
        </div>
  )

  /**
   * マウスを乗せたレスに出す操作バー(返信・定型文・コピー・NG・︙)。at は置き場所の class。
   * ふつうはレスの右上、LINE 風は吹き出しのすぐ下(相手の吹き出しは左寄せなので、右上だと吹き出しから遠い)
   */
  const toolbarAt = (at: string) => (
      <div
        data-post-toolbar
        className={`absolute ${at} z-20 flex items-center gap-0.5 p-0.5 bg-c-surface border border-c-border rounded-lg shadow-md transition-opacity ${
          menuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {toolbarItems.map((item) => {
          if (item === 'reply' && reply)
            return (
              <button key={item} type="button" className={`${TOOL_BTN} hover:!text-mark-link`} title="返信" onClick={() => reply(post.no)}>
                <span className="material-symbols-outlined text-lg leading-none">reply</span>
              </button>
            )
          if (item === 'copy')
            return (
              <button key={item} type="button" className={`${TOOL_BTN} hover:!text-mark-link`} title="本文をコピー" onClick={() => copy(post.body)}>
                <span className="material-symbols-outlined text-lg leading-none">content_copy</span>
              </button>
            )
          if (item === 'ng' && ngActions.length > 0)
            return <MenuButton key={item} icon="block" title="NG に追加" items={ngActions} onOpenChange={setNgOpen} hoverClass="hover:!text-mark-danger" />
          if (item === 'tree' && hasConnections)
            return (
              <button key={item} type="button" className={`${TOOL_BTN} hover:!text-mark-hot`} title="アンカーツリー" onClick={() => handlers.onBody(post.no, articleRef.current!)}>
                <span className="material-symbols-outlined text-lg leading-none">account_tree</span>
              </button>
            )
          if (item.startsWith('phrase:') && quick) {
            const text = item.slice('phrase:'.length)
            return (
              <button
                key={item}
                type="button"
                className={`${TOOL_BTN} hover:!text-mark-new text-sm font-bold max-w-[6rem]`}
                title={`「${text}」とすぐ書き込む`}
                onClick={() => quick(post.no, text)}
              >
                <span className="truncate">{text}</span>
              </button>
            )
          }
          return null
        })}
        <MenuButton icon="more_horiz" title="その他" items={actions} onOpenChange={setMoreOpen} />
      </div>
  )

  // ── LINE 風 ──
  // 吹き出しで並べる。ほかの人は左にアイコンと名前、自分の書き込みは右に緑の吹き出し(アイコンなし)。
  // 番号と時刻は吹き出しの横に小さく。返信は吹き出しの中の上に、返信元を引用の形で出す
  const time = /(\d{1,2}:\d{2})(?::\d{2})?/.exec(post.date)?.[1] ?? post.date
  // 自分の書き込みは右に寄せる。ただしアンカーツリーの中では、線でアイコンをつなぐため左にそろえる(緑の吹き出しはそのまま)
  const right = props.isOwn && !props.alignLeft
  const lineSide = (
    <div className={`flex-shrink-0 flex flex-col gap-0.5 pb-0.5 text-[10px] text-c-text-muted leading-tight ${right ? 'items-end' : 'items-start'}`}>
      <span className="text-[11px]">{numBtn('#')}</span>
      <span title={post.date}>{time}</span>
    </div>
  )
  const lineQuote = props.replyPreview && (
    <button
      type="button"
      className="flex items-center gap-1.5 min-w-0 max-w-full mb-1.5 pl-2 border-l-2 text-xs text-c-text-muted hover:text-c-text-body text-left"
      style={{ borderColor: 'currentColor' }}
      onClick={(e) => {
        e.stopPropagation()
        handlers.onAnchor([props.replyPreview!.no], e.currentTarget, 'click')
      }}
      title={`>>${props.replyPreview.no} を表示`}
    >
      {props.replyPreview.id && (
        <span className="flex-shrink-0 block overflow-hidden rounded-full">
          <Identicon seed={props.replyPreview.id} size={16} />
        </span>
      )}
      <span className="truncate">{props.replyPreview.text}</span>
    </button>
  )
  // LINE 風のときだけ組み立てる
  const lineLayout = () => (
    <div className={`flex gap-2 items-start ${right ? 'flex-row-reverse' : ''} ${hasConnections ? 'cursor-pointer' : ''}`} onClick={openTree}>
      {!right && (
        <div className="w-9 flex-shrink-0">
          {props.continued ? null : beIcon ? (
            // BE のアイコンがあれば、ID の模様の代わりに出す。大きさは絵ごとに違うので、36px の枠に収まるよう縮め・広げる(縦横の比は保つ)
            <button
              type="button"
              className="block w-9 h-9 rounded-xl overflow-hidden bg-c-surface hover:opacity-80"
              onClick={(e) => post.id && handlers.onId(post.id, e.currentTarget)}
              title={post.id ? `BE のアイコン(ID:${post.id} のレスを出す)` : 'BE のアイコン'}
            >
              <img
                src={beIcon}
                alt=""
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
                onError={(e) => {
                  e.currentTarget.style.visibility = 'hidden'
                }}
              />
            </button>
          ) : (
            identiconBtn(36, true) || noIdAvatar
          )}
        </div>
      )}
      <div className={`flex-1 min-w-0 flex flex-col ${right ? 'items-end' : 'items-start'}`}>
        {!props.continued && (
          <div data-post-header className={`flex items-center gap-1.5 mb-1 max-w-full text-xs ${right ? 'flex-row-reverse' : ''}`}>
            {!right && nameBtn('text-xs')}
            {opChip}
            {ngChip}
            {idBtn}
            {voteChip}
            {post.mail && <span className="text-c-text-muted">[{post.mail}]</span>}
            {toOwnChip}
          </div>
        )}
        <div className={`flex items-end gap-1.5 max-w-full ${right ? 'flex-row-reverse' : ''}`}>
          <div className={`line-bubble relative min-w-0 ${props.isOwn ? 'line-bubble-own' : ''} ${isAA ? 'max-w-full' : 'max-w-[min(85%,42rem)]'}`}>
            {/* 操作バーは吹き出しのすぐ下に(自分の吹き出しは右端、相手の吹き出しは左端にそろえる) */}
            {(hovered || menuOpen) && toolbarAt(`top-full mt-1 ${right ? 'right-0' : 'left-0'}`)}
            {lineQuote}
            {bodyBlock}
          </div>
          {lineSide}
        </div>
      </div>
    </div>
  )

  return (
    <article
      ref={articleRef}
      id={`post-${post.no}`}
      data-no={post.no}
      data-variant={variant}
      className={`relative ${frameClass} ${variant === 'discord' ? 'post-discord' : ''}`}
      style={frame}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 自分の書き込み(濃い線)と、自分へのアンカーを含むレス(薄い線)の目印。
          高密度表示では web 版の設定で本文の縦線が 0 になるので、表示の密度に関係なく見えるよう別に引く */}
      {/* LINE 風の自分の書き込みは、右に寄せた緑の吹き出しで分かるので、縦の印は出さない(自分宛てのレスには出す) */}
      {((props.isOwn && variant !== 'line') || props.isReplyToOwn) && !props.alignLeft && (
        <span
          className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full pointer-events-none"
          style={{ background: 'var(--c-own)', opacity: props.isOwn && variant !== 'line' ? 1 : 0.45 }}
          title={props.isOwn && variant !== 'line' ? '自分の書き込み' : '自分へのレス'}
        />
      )}
      {/* マウスを乗せたレスの右上に浮かぶ操作バー(Discord 風)。メニューを開いている間は出したままにする。
          マウスを乗せている間だけ作る(全部のレスに最初から作ると、要素がレスの 4 割ほど増えてスレを開くのが遅くなる) */}
      {variant !== 'line' && (hovered || menuOpen) && toolbarAt('top-0.5 right-3')}
      {variant === 'line' ? (
        lineLayout()
      ) : variant === 'discord' ? (
        // Discord 風: 左に丸い ID のアイコン、右に頭・返信・本文。続けて書いたレス(同じ ID)はアイコンと頭を省く
        <div>
        {replyLine}
        <div className="flex gap-3 items-start">
          {/* アイコンはレスの頭の高さにそろえる(レスの縦の真ん中に来ないように) */}
          <div className="w-9 flex-shrink-0 flex justify-center items-start">
            {props.continued ? (
              <span className="pt-0.5 text-[10px] tabular-nums text-c-text-muted opacity-0 group-hover:opacity-100">{numBtn('#')}</span>
            ) : (
              identiconBtn(36, true) || noIdAvatar
            )}
          </div>
          <div className="flex-1 min-w-0">
            {headerBlock}
            {bodyBlock}
          </div>
        </div>
        </div>
      ) : (
        <>
          {headerBlock}
          {bodyBlock}
        </>
      )}
    </article>
  )
}

export default memo(PostArticle)
