// レス 1 件。web 版の PostArticle.tsx の見た目を移植。
// 画像・リンクプレビュー・NG・削除・返信など、web 版の API に依存する機能はまだ移していない。

import { memo } from 'react'
import type { Post } from '@bbs-browser/connectors'
import { heatClass, looksLikeAA, renderBody } from '../utils/postBody'

interface Props {
  post: Post
  anchorCount: number
  idCount: number
  showTopDivider: boolean
  onAnchor: (no: number) => void
  onUrl: (url: string) => void
}

function PostArticle({ post, anchorCount, idCount, showTopDivider, onAnchor, onUrl }: Props) {
  const numHeat = heatClass(anchorCount)
  const isAA = looksLikeAA(post.body)
  // 被アンカーが 3 つ以上のレスは本文も色付けする(人気レス)
  const bodyClass = anchorCount >= 3 ? numHeat : 'text-c-text-strong'

  return (
    <article
      id={`post-${post.no}`}
      data-no={post.no}
      className={`w-full ${showTopDivider ? 'border-t pt-2' : ''}`}
      style={{
        paddingLeft: 'var(--post-padding-x)',
        paddingRight: 'var(--post-padding-x)',
        paddingBottom: 'var(--post-padding-y)',
        paddingTop: showTopDivider ? undefined : 'var(--post-padding-y)',
        borderTopColor: showTopDivider ? 'var(--post-divider-color, var(--c-border))' : undefined,
      }}
    >
      <div className="flex items-center mb-2 flex-nowrap overflow-hidden gap-3">
        <span className={`font-bold text-sm flex items-center gap-1 ${numHeat || 'text-c-text-muted'}`}>
          <span>{post.no}</span>
          {anchorCount > 0 && <span className={`text-xs ${numHeat || 'text-c-text-muted'}`}>({anchorCount})</span>}
        </span>
        <span className="font-bold text-c-poster-name text-xs min-w-0 truncate">{post.name}</span>
        {post.mail && <span className="text-xs text-c-text-muted">[{post.mail}]</span>}
        <span className="text-xs text-c-text-muted whitespace-nowrap">{post.date}</span>
        {post.id && (
          <span className={`text-xs font-mono flex items-center gap-0.5 ${heatClass(idCount) || 'text-c-text-muted'}`}>
            <span>ID:{post.id}</span>
            {idCount >= 2 && <span className="text-xs">({idCount})</span>}
          </span>
        )}
      </div>

      <div
        style={{
          paddingLeft: 'var(--post-quote-padding)',
          borderLeftWidth: 'var(--post-quote-bar-width)',
          borderLeftStyle: 'solid',
          borderLeftColor: 'var(--c-border)',
        }}
      >
        <p
          className={`text-base ${bodyClass} ${isAA ? 'aa-font whitespace-pre overflow-x-auto' : 'whitespace-pre-wrap break-words leading-relaxed'}`}
        >
          {renderBody(post.body, { onAnchor, onUrl })}
        </p>
      </div>
    </article>
  )
}

export default memo(PostArticle)
