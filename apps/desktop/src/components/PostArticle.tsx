// レス 1 件。web 版の PostArticle.tsx の見た目を移植。
// 返信・削除・通報など、web 版の API に依存する機能は外している。

import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Post } from '@bbs-browser/connectors'
import { anchorsIn, heatClass, imageUrlsIn, looksLikeAA, renderBody, type BodyHandlers } from '../utils/postBody'
import { newRule, todayDateString, type NgRule } from '../utils/ng'
import type { NgMode } from '../ui/settings'

export interface PostHandlers extends BodyHandlers {
  /** レス番号を押した(このレスへの返信を出す) */
  onReplies: (no: number, el: HTMLElement) => void
  /** ID を押した(その ID の書き込みを出す) */
  onId: (id: string, el: HTMLElement) => void
  /** 名前を押した(同じ名前の書き込みを出す) */
  onName: (name: string, el: HTMLElement) => void
  /** 本文を押した(アンカーツリーを出す。つながりがなければ何もしない) */
  onBody: (no: number, el: HTMLElement) => void
  onImage: (urls: string[], index: number) => void
  onAddNg: (rule: NgRule) => void
  /** 書き込み欄に >>番号 を入れる。書き込めないときは undefined */
  onReply?: (no: number) => void
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
  /** 自動更新などで新しく届いたレス。一瞬光らせる */
  flash?: boolean
  /** 自分の書き込み */
  isOwn?: boolean
  /** 自分の書き込みへのアンカーを含む */
  isReplyToOwn?: boolean
  handlers: PostHandlers
}

const HEAD_TEXT = 'text-xs'

/**
 * レスの ⋯ メニュー。レスのヘッダー行ははみ出しを隠す設定なので、メニューは body の直下に出し、
 * ボタンの位置から場所を決める(ポップアップの中のレスでも使えるよう、ポップアップより手前に出す)
 */
function ActionMenu({ items }: { items: { label: string; icon: string; onClick: () => void }[] }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number }>()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
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
    setPos(below < 260 ? { bottom: window.innerHeight - rect.top + 4, right } : { top: rect.bottom + 4, right })
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
        className={`flex-shrink-0 px-1 text-c-text-muted hover:text-c-text-strong transition-opacity ${pos ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        title="メニュー"
      >
        <span className="material-symbols-outlined text-base leading-none">more_horiz</span>
      </button>
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed w-52 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl py-1 z-[9800] text-sm"
            style={pos}
            onClick={(e) => e.stopPropagation()}
          >
            {items.map((it) => (
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

  const numHeat = heatClass(anchorCount)
  // アンカーを付けている・付けられているレスは、本文を押すとツリーを出せる
  const hasConnections = anchorCount > 0 || anchorsIn(post.body).some((n) => n !== post.no)
  const isAA = aaOverride ?? (props.aaAutoDetect && looksLikeAA(post.body))
  const bodyClass = anchorCount >= 3 ? numHeat : 'text-c-text-strong'
  const images = props.showThumbnails ? imageUrlsIn(post.body) : []

  const copy = (text: string) => void navigator.clipboard.writeText(text)
  const header = [post.no, post.name, post.mail && `[${post.mail}]`, post.date, post.id && `ID:${post.id}`]
    .filter(Boolean)
    .join(' ')

  const actions = [
    { label: 'ヘッダ含めてコピー', icon: 'content_copy', onClick: () => copy(`${header}\n${post.body}`) },
    { label: '本文のみコピー', icon: 'content_copy', onClick: () => copy(post.body) },
    {
      label: isAA ? '文字列として表示' : 'AAとして表示',
      icon: isAA ? 'notes' : 'grid_on',
      onClick: () => setAaOverride(!isAA),
    },
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
  ]

  return (
    <article id={`post-${post.no}`} data-no={post.no} className={frameClass} style={frame}>
      <div className="flex items-center mb-2 flex-nowrap overflow-hidden gap-3">
        <button
          type="button"
          className={`font-bold text-sm flex items-center gap-1 ${numHeat || 'text-c-text-muted'} ${anchorCount > 0 ? 'hover:opacity-80' : 'cursor-default'}`}
          onClick={anchorCount > 0 ? (e) => handlers.onReplies(post.no, e.currentTarget) : undefined}
          title={anchorCount > 0 ? 'このレスへの返信を表示' : undefined}
        >
          <span style={props.isOwn ? { color: 'var(--c-accent-self)' } : undefined}>{post.no}</span>
          {anchorCount > 0 && <span className={`text-xs ${numHeat || 'text-c-text-muted'}`}>({anchorCount})</span>}
        </button>
        <button
          type="button"
          className={`font-bold text-c-poster-name ${HEAD_TEXT} min-w-0 truncate hover:opacity-80`}
          onClick={(e) => handlers.onName(post.name, e.currentTarget)}
          title="同じ名前の書き込みを表示"
        >
          {post.name}
        </button>
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
        <div className="ml-auto flex items-center gap-1 flex-shrink-0">
        {handlers.onReply && (
          <button
            type="button"
            className="flex-shrink-0 text-xs text-c-text-muted bg-c-surface2 px-1.5 py-0.5 rounded hover:bg-c-surface3 hover:text-c-text-body transition-colors opacity-0 group-hover:opacity-100"
            onClick={() => handlers.onReply!(post.no)}
          >
            返信
          </button>
        )}
        <ActionMenu items={actions} />
        </div>
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
        <p
          className={`text-base ${bodyClass} ${isAA ? 'aa-font whitespace-pre overflow-x-auto' : 'whitespace-pre-wrap break-words leading-relaxed'}`}
        >
          {renderBody(post.body, handlers)}
        </p>

        {images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((url, i) => (
              <button
                key={url + i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handlers.onImage(images, i)
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
          </div>
        )}
      </div>
    </article>
  )
}

export default memo(PostArticle)
