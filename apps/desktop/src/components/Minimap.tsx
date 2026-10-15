// ミニマップ。web 版の Minimap.tsx を移植(PC だけなのでタッチ操作は外した)。
// スレ全体を縦に縮めて、人気レス(横棒)・自分のレス(ひし形)・自分への返信(枠だけのひし形)・
// 画像(四角)・動画(三角)の位置と、「ここから未読」の位置を示す。つまみをドラッグしてスクロールでき、
// 印を押すとそのレスへ、何もないところを押すとその割合の位置へ飛ぶ。

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Post } from '@bbs-browser/connectors'
import { hasYoutube, imageUrlsIn } from '../utils/postBody'

interface Props {
  posts: Post[]
  /** スクロールする領域(ヘッダーも中に入っている) */
  scrollRef: RefObject<HTMLDivElement | null>
  /** レスが並ぶ領域。高さが変わったら印の位置を測り直す */
  listRef: RefObject<HTMLDivElement | null>
  anchorCounts: Map<number, number>
  ownNos: Set<number>
  replyToOwn: Set<number>
  unreadFrom: number
  /** ヘッダーの高さ。ミニマップはその下から始める */
  topOffset: number
  onJump: (no: number) => void
}

// PostArticle の heatClass と同じ暖色の段階
function heatColor(count: number): string {
  if (count >= 7) return 'var(--c-heat-very-hot)'
  if (count >= 5) return 'var(--c-heat-hot)'
  return 'var(--c-heat-warm)'
}

export default function Minimap(props: Props) {
  const { posts, scrollRef, listRef } = props
  const thumbRef = useRef<HTMLDivElement>(null)
  // レス番号 → スクロール全体に対する位置(%)。つまみと同じ scrollTop / scrollHeight の座標で揃える
  const [pcts, setPcts] = useState(new Map<number, number>())

  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const measure = () => {
      if (root.scrollHeight === 0) return
      const rootTop = root.getBoundingClientRect().top
      const next = new Map<number, number>()
      for (const el of root.querySelectorAll<HTMLElement>(':scope [data-no]')) {
        if (el.offsetParent === null) continue // 絞り込みで隠しているレス
        const top = el.getBoundingClientRect().top - rootTop + root.scrollTop
        next.set(Number(el.dataset.no), (top / root.scrollHeight) * 100)
      }
      setPcts(next)
    }
    // 描画が落ち着いてから測る
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(measure)
    })
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    if (listRef.current) observer.observe(listRef.current)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [posts, scrollRef, listRef])

  // つまみをスクロールに合わせる
  useEffect(() => {
    const root = scrollRef.current
    const thumb = thumbRef.current
    if (!root || !thumb) return
    const update = () => {
      const { scrollHeight, clientHeight, scrollTop } = root
      thumb.style.height = `${(clientHeight / scrollHeight) * 100}%`
      thumb.style.top = `${(scrollTop / scrollHeight) * 100}%`
    }
    root.addEventListener('scroll', update)
    const observer = new ResizeObserver(update)
    observer.observe(root)
    if (listRef.current) observer.observe(listRef.current)
    update()
    return () => {
      root.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [scrollRef, listRef])

  const total = Math.max(1, posts.length - 1)
  // 測れていないレスは、並び順からおおよその位置を出す
  const pct = (no: number, index: number) => pcts.get(no) ?? (index / total) * 100

  const markers = useMemo(() => {
    const heat: { no: number; at: number; count: number }[] = []
    const own: { no: number; at: number }[] = []
    const reply: { no: number; at: number }[] = []
    const media: { no: number; at: number; type: 'image' | 'video' }[] = []
    posts.forEach((p, i) => {
      const at = pct(p.no, i)
      const count = props.anchorCounts.get(p.no) ?? 0
      if (count >= 3) heat.push({ no: p.no, at, count })
      if (props.ownNos.has(p.no)) own.push({ no: p.no, at })
      if (props.replyToOwn.has(p.no)) reply.push({ no: p.no, at })
      if (imageUrlsIn(p.body).length > 0) media.push({ no: p.no, at, type: 'image' })
      else if (hasYoutube(p.body)) media.push({ no: p.no, at, type: 'video' })
    })
    return { heat, own, reply, media }
    // pct は pcts と posts から決まるので、依存はこれで足りる
  }, [posts, pcts, props.anchorCounts, props.ownNos, props.replyToOwn])

  const unreadIndex = props.unreadFrom > 1 ? posts.findIndex((p) => p.no === props.unreadFrom) : -1
  const unreadAt = unreadIndex >= 0 ? pct(props.unreadFrom, unreadIndex) : undefined

  const onThumbMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const root = scrollRef.current
    if (!root) return
    const startY = e.clientY
    const startTop = root.scrollTop
    const ratio = root.scrollHeight / (e.currentTarget.parentElement?.clientHeight ?? root.clientHeight)
    const onMove = (ev: MouseEvent) => {
      root.scrollTop = startTop + (ev.clientY - startY) * ratio
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // 何もないところを押したら、その割合の位置が画面の真ん中に来るように飛ぶ
  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const root = scrollRef.current
    if (!root) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / rect.height
    root.scrollTop = ratio * root.scrollHeight - root.clientHeight / 2
  }

  const jump = (no: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    props.onJump(no)
  }

  return (
    <div className="flex-shrink-0 py-2 pr-1.5 pl-0.5" style={{ paddingTop: props.topOffset + 8 }}>
      <div
        className="relative w-[21px] h-full cursor-pointer"
        style={{
          background: 'var(--c-surface2)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--minimap-radius)',
        }}
        onClick={onTrackClick}
      >
        {unreadAt !== undefined && (
          <div
            className="absolute left-0 right-0 h-[2px] pointer-events-none z-[9]"
            style={{ top: `${unreadAt}%`, background: 'var(--c-accent-self)', opacity: 0.7 }}
            title="ここから未読"
          />
        )}

        {markers.reply.map((m) => (
          <button
            key={`reply-${m.no}`}
            type="button"
            onClick={jump(m.no)}
            className="absolute left-1/2 w-2.5 h-2.5 hover:opacity-80 transition-opacity z-[11] rounded-[1px]"
            style={{
              top: `${m.at}%`,
              transform: 'translateX(-50%) translateY(-50%) rotate(45deg)',
              border: '1.5px solid var(--c-accent-self)',
            }}
            title={`自分への返信: ${m.no}`}
          />
        ))}

        {markers.own.map((m) => (
          <button
            key={`own-${m.no}`}
            type="button"
            onClick={jump(m.no)}
            className="absolute left-1/2 w-2.5 h-2.5 hover:opacity-80 transition-opacity z-[12] rounded-[1px]"
            style={{
              top: `${m.at}%`,
              transform: 'translateX(-50%) translateY(-50%) rotate(45deg)',
              background: 'var(--c-accent-self)',
            }}
            title={`自分のレス: ${m.no}`}
          />
        ))}

        {markers.heat.map((m) => (
          <button
            key={`heat-${m.no}`}
            type="button"
            onClick={jump(m.no)}
            className="absolute left-0 right-0 h-1.5 hover:h-2 transition-all z-[10]"
            style={{ top: `${m.at}%`, background: heatColor(m.count) }}
            title={`${m.no}: ${m.count}件のアンカー`}
          />
        ))}

        {markers.media.map((m) =>
          m.type === 'image' ? (
            <button
              key={`media-${m.no}`}
              type="button"
              onClick={jump(m.no)}
              className="absolute left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-[1px] hover:scale-150 transition-transform z-[10]"
              style={{ top: `${m.at}%`, background: 'var(--c-text-muted)' }}
              title={`${m.no}: 画像あり`}
            />
          ) : (
            <button
              key={`media-${m.no}`}
              type="button"
              onClick={jump(m.no)}
              className="absolute left-1/2 -translate-x-1/2 hover:scale-150 transition-transform z-[10]"
              style={{
                top: `${m.at}%`,
                width: 0,
                height: 0,
                borderLeft: '3px solid transparent',
                borderRight: '3px solid transparent',
                borderBottom: '5px solid var(--c-text-muted)',
              }}
              title={`${m.no}: 動画あり`}
            />
          ),
        )}

        <div
          ref={thumbRef}
          className="absolute left-0 right-0 rounded"
          style={{
            background: 'color-mix(in srgb, var(--c-text-muted) 25%, transparent)',
            border: '1px solid color-mix(in srgb, var(--c-text-muted) 45%, transparent)',
            cursor: 'ns-resize',
            zIndex: 20,
          }}
          onMouseDown={onThumbMouseDown}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  )
}
