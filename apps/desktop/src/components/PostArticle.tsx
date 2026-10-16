// レス 1 件。web 版の PostArticle.tsx の見た目を移植。
// 返信・削除・通報など、web 版の API に依存する機能は外している。

import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Post } from '@bbs-browser/connectors'
import {
  anchorsIn,
  displayBody,
  displayName,
  heatClass,
  imageUrlsIn,
  linkUrlsIn,
  youtubeLinksIn,
  looksLikeAA,
  renderBody,
  splitBeIcon,
  videoFileUrlsIn,
  type BodyHandlers,
  type DisplayOptions,
} from '../utils/postBody'
import LinkPreview from './LinkPreview'
import { newRule, todayDateString, type NgRule } from '../utils/ng'
import type { NgMode } from '../ui/settings'
import Identicon from './Identicon'

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
  /** NG の画面を、元の文字を入れた状態で開く */
  onNgDraft?: (target: 'content' | 'posterName' | 'posterId' | 'threadTitle', text: string) => void
  /** >>番号 を付けてすぐ書き込む(「草」ボタン)。書き込めないときは undefined */
  onQuickReply?: (no: number, text: string) => void
}

interface Props {
  post: Post
  anchorCount: number
  idCount: number
  showTopDivider: boolean
  ng: boolean
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
}

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
function MenuButton(props: { icon: string; title: string; items: MenuItem[]; onOpenChange: (open: boolean) => void }) {
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
        className={`${TOOL_BTN} ${pos ? 'text-c-text-strong bg-c-surface3' : ''}`}
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
  const [aaOverride, setAaOverride] = useState<boolean | null>(null)

  const frame = {
    paddingLeft: 'var(--post-padding-x)',
    paddingRight: 'var(--post-padding-x)',
    paddingBottom: 'var(--post-padding-y)',
    paddingTop: props.showTopDivider ? undefined : 'var(--post-padding-y)',
    borderTopColor: props.showTopDivider ? 'var(--post-divider-color, var(--c-border))' : undefined,
  }
  const frameClass = `group w-full ${props.showTopDivider ? 'border-t pt-2' : ''} ${props.flash ? 'flash-new' : ''}`

  // NG: 番号だけ残して「あぼーん」と出す。押すとその場で中身を見られる
  if (props.ng && !revealed) {
    if (props.ngMode === 'hide') return null
    return (
      <article id={`post-${post.no}`} data-no={post.no} className={frameClass} style={frame}>
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="flex items-center gap-3 text-xs text-c-text-muted hover:text-c-text-body"
          title="押すと中身を表示"
        >
          <span className="font-bold text-sm">{post.no}</span>
          <span>あぼーん</span>
        </button>
      </article>
    )
  }

  // BE のアイコン(本文の 1 行目の sssp://)は絵にして、本文からは除く
  const { icon: beIcon, body: rawBody } = splitBeIcon(post.body)
  const body = props.display ? displayBody(rawBody, props.display) : rawBody
  const name = props.display ? displayName(post.name, props.display) : post.name
  const numHeat = heatClass(anchorCount)
  // アンカーを付けている・付けられているレスは、本文を押すとツリーを出せる
  const hasConnections = anchorCount > 0 || anchorsIn(post.body).some((n) => n !== post.no)
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
  const header = [post.no, post.name, post.mail && `[${post.mail}]`, post.date, post.id && `ID:${post.id}`]
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
  ]

  return (
    <article ref={articleRef} id={`post-${post.no}`} data-no={post.no} className={`relative ${frameClass}`} style={frame}>
      {/* 自分の書き込み(濃い線)と、自分へのアンカーを含むレス(薄い線)の目印。
          高密度表示では web 版の設定で本文の縦線が 0 になるので、表示の密度に関係なく見えるよう別に引く */}
      {(props.isOwn || props.isReplyToOwn) && (
        <span
          className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full pointer-events-none"
          style={{ background: 'var(--c-accent-self)', opacity: props.isOwn ? 1 : 0.45 }}
          title={props.isOwn ? '自分の書き込み' : '自分へのレス'}
        />
      )}
      {/* マウスを乗せたレスの右上に浮かぶ操作バー(Discord 風)。メニューを開いている間は出したままにする */}
      <div
        className={`absolute top-0.5 right-3 z-10 flex items-center gap-0.5 p-0.5 bg-c-surface border border-c-border rounded-lg shadow-md transition-opacity ${
          menuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {toolbarItems.map((item) => {
          if (item === 'reply' && reply)
            return (
              <button key={item} type="button" className={TOOL_BTN} title="返信" onClick={() => reply(post.no)}>
                <span className="material-symbols-outlined text-lg leading-none">reply</span>
              </button>
            )
          if (item === 'copy')
            return (
              <button key={item} type="button" className={TOOL_BTN} title="本文をコピー" onClick={() => copy(post.body)}>
                <span className="material-symbols-outlined text-lg leading-none">content_copy</span>
              </button>
            )
          if (item === 'ng' && ngActions.length > 0)
            return <MenuButton key={item} icon="block" title="NG に追加" items={ngActions} onOpenChange={setNgOpen} />
          if (item === 'tree' && hasConnections)
            return (
              <button key={item} type="button" className={TOOL_BTN} title="アンカーツリー" onClick={() => handlers.onBody(post.no, articleRef.current!)}>
                <span className="material-symbols-outlined text-lg leading-none">account_tree</span>
              </button>
            )
          if (item.startsWith('phrase:') && quick) {
            const text = item.slice('phrase:'.length)
            return (
              <button
                key={item}
                type="button"
                className={`${TOOL_BTN} text-sm font-bold max-w-[6rem]`}
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
      <div className="flex items-center mb-2 flex-nowrap overflow-hidden gap-3">
        {/* ID のアイコン(web 版と同じく、右下にその ID の書き込み数を重ねる) */}
        {props.showIdenticon && post.id && (
          <button
            type="button"
            className="relative flex-shrink-0 hover:opacity-80 mr-1"
            onClick={(e) => handlers.onId(post.id!, e.currentTarget)}
            title={`ID:${post.id} (${idCount})`}
          >
            <Identicon seed={post.id} size={22} />
            {idCount >= 2 && (
              <span
                className={`absolute -bottom-1 -right-1 min-w-[15px] h-[15px] px-0.5 rounded-full bg-c-surface border border-c-border text-[9px] font-bold leading-none flex items-center justify-center ${heatClass(idCount) || 'text-c-text-muted'}`}
              >
                {idCount}
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          className={`font-bold text-sm flex items-center gap-1 ${numHeat || 'text-c-text-muted'} ${anchorCount > 0 ? 'hover:opacity-80' : 'cursor-default'}`}
          onClick={anchorCount > 0 ? (e) => handlers.onReplies(post.no, e.currentTarget) : undefined}
          title={anchorCount > 0 ? 'このレスへの返信を表示' : undefined}
        >
          <span style={props.isOwn ? { color: 'var(--c-accent-self)' } : undefined}>{post.no}</span>
          {anchorCount > 0 && <span className={`text-xs ${numHeat || 'text-c-text-muted'}`}>({anchorCount})</span>}
        </button>
        {name && (
          <button
            type="button"
            className={`font-bold text-c-poster-name ${HEAD_TEXT} min-w-0 truncate hover:opacity-80`}
            onClick={(e) => handlers.onName(post.name, e.currentTarget)}
            title="同じ名前の書き込みを表示"
          >
            {name}
          </button>
        )}
        {props.isOp && (
          <span
            className="flex-shrink-0 text-[10px] font-bold px-1.5 py-px rounded"
            style={{ color: 'var(--c-accent)', background: 'var(--c-accent-wash)', border: '1px solid var(--c-accent)' }}
            title="スレ主(>>1 と同じ ID)"
          >
            主
          </span>
        )}
        {post.mail && <span className={`${HEAD_TEXT} text-c-text-muted`}>[{post.mail}]</span>}
        <span className={`${HEAD_TEXT} text-c-text-muted whitespace-nowrap`}>{post.date}</span>
        {post.id && (
          <button
            type="button"
            className={`${HEAD_TEXT} font-mono flex items-center gap-0.5 hover:opacity-80 ${heatClass(idCount) || 'text-c-text-muted'}`}
            onClick={(e) => handlers.onId(post.id!, e.currentTarget)}
            title="この ID の書き込みを表示"
          >
            <span>ID:{post.id}</span>
            {idCount >= 2 && <span className="text-xs">({idCount})</span>}
          </button>
        )}
        {props.isReplyToOwn && (
          <span
            className="text-[10px] font-medium px-2 py-0.5 flex-shrink-0"
            style={{
              color: 'var(--c-accent-self)',
              background: 'var(--c-accent-self-wash)',
              border: '1px solid var(--c-accent-self)',
              borderRadius: 'var(--chip-radius)',
            }}
          >
            →あなた宛
          </span>
        )}
      </div>

      <div
        className={hasConnections ? 'cursor-pointer' : ''}
        onClick={(e) => {
          // 文字を選んでいるとき(コピーしようとしているとき)は開かない
          if (!hasConnections || window.getSelection()?.toString().trim()) return
          handlers.onBody(post.no, e.currentTarget)
        }}
        style={{
          paddingLeft: props.isOwn ? 'var(--post-quote-padding-own)' : 'var(--post-quote-padding)',
          borderLeftWidth: props.isOwn ? 'var(--post-quote-bar-width-own)' : 'var(--post-quote-bar-width)',
          borderLeftStyle: 'solid',
          borderLeftColor: props.isOwn ? 'var(--c-accent-self)' : 'var(--c-border)',
        }}
      >
        {/* BE のアイコンは、画像のサムネイルの設定に関係なく出す(5ch の書き込みの一部なので) */}
        {beIcon && (
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
          {renderBody(body, handlers)}
        </p>

        {links.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {links.slice(0, 3).map((url, i) => (
              <LinkPreview key={url} url={url} onOpen={handlers.onUrl} more={i === 2 ? links.length - 3 : undefined} />
            ))}
          </div>
        )}
        {images.length + videos.length + videoFiles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((url, i) => (
              <button
                key={url + i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handlers.onImage(media, i, post)
                }}
                className="w-20 h-20 bg-c-surface2 border border-c-border rounded overflow-hidden flex-shrink-0 flex items-center justify-center hover:border-c-border-strong transition-colors"
              >
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
                className="relative w-20 h-20 bg-black border border-c-border rounded overflow-hidden flex-shrink-0 hover:border-c-border-strong transition-colors"
                title="動画を再生する"
              >
                <video src={`${url}#t=0.1`} preload="metadata" muted playsInline className="w-full h-full object-cover pointer-events-none" />
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
                className="relative w-20 h-20 rounded overflow-hidden flex-shrink-0 hover:opacity-90 transition-opacity"
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
    </article>
  )
}

export default memo(PostArticle)
