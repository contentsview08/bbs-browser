// ミニマップ。web 版の Minimap.tsx を移植(PC だけなのでタッチ操作は外した)。
// スレ全体を縦に縮めて、人気レス(横棒)・自分のレス(ひし形)・自分への返信(枠だけのひし形)・
// 画像(四角)・動画(三角)の位置と、「ここから未読」の位置を示す。つまみをドラッグしてスクロールでき、
// 印を押すとそのレスへ、何もないところを押すとその割合の位置へ飛ぶ。
// 印は重ならないよう 3 つの列に分ける(左: 自分のレスと返信、真ん中: 人気レスの帯、右: 画像と動画)。
// いま見ている位置のつまみは強調色で目立たせ、未読の範囲はうっすら色を付け、乗せた高さのレス番号を出す。

import { isMobile } from '../utils/platform'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Post } from '@bbs-browser/connectors'
import { hasVideo, imageUrlsIn } from '../utils/postBody'

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
    // スマホは、印の位置をレスの番目で決める(測らない)。下の「つまみ」も番目で出す。
    // 測る作りだと、画像やレスが描かれて高さが変わるたびに印が動き、全部のレスを測り直すのも重い
    if (!root || isMobile) return
    const measure = () => {
      if (root.scrollHeight === 0) return
      const rootTop = root.getBoundingClientRect().top
      const next = new Map<number, number>()
      // レスの中身ではなく枠(.post-cv)を測る(画面の外で省いた計算をやり直させないように)
      for (const el of root.querySelectorAll<HTMLElement>(':scope .post-cv')) {
        if (el.hidden) continue // 絞り込みで隠しているレス
        // 番号は枠に持たせてある(NG で中身を描かないレスも数えるため)
        const no = Number(el.dataset.post)
        if (!no) continue
        const top = el.getBoundingClientRect().top - rootTop + root.scrollTop
        next.set(no, (top / root.scrollHeight) * 100)
      }
      setPcts(next)
    }
    // 描画が落ち着いてから測る
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(measure)
    })
    // 大きさが変わり続けているあいだ(サイドバーの開閉・ウィンドウの大きさを変えている途中)は測らず、
    // 落ち着いてから 1 回だけ測る(全部のレスの位置を測るので、毎コマやると重い)
    let timer: ReturnType<typeof setTimeout>
    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(measure, 150)
    })
    observer.observe(root)
    if (listRef.current) observer.observe(listRef.current)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [posts, scrollRef, listRef])

  // つまみをスクロールに合わせる
  useEffect(() => {
    const root = scrollRef.current
    const thumb = thumbRef.current
    if (!root || !thumb) return
    const byScroll = () => {
      const { scrollHeight, clientHeight, scrollTop } = root
      // 長いスレでもつかめるよう、つまみは 14px より小さくしない
      thumb.style.height = `max(14px, ${(clientHeight / scrollHeight) * 100}%)`
      thumb.style.top = `${(scrollTop / scrollHeight) * 100}%`
    }
    /** スマホ: 画面の上端と下端にあるレスの番目で、つまみを出す(印と同じ、番目の座標) */
    const byIndex = () => {
      const box = root.getBoundingClientRect()
      const x = box.left + Math.min(40, box.width / 2)
      // 上下の端にはヘッダー・フッターが重なっているので、レスに当たるまで少しずつ内側へずらして探す
      const at = (from: number, dir: 1 | -1) => {
        for (let k = 0; k < 24; k++) {
          const el = document.elementFromPoint(x, from + dir * k * 20)?.closest<HTMLElement>('.post-cv')
          if (el && root.contains(el)) return indexOf.current.get(Number(el.dataset.post))
        }
        return undefined
      }
      const n = Math.max(1, postsRef.current.length)
      const top = at(box.top + props.topOffset + 4, 1)
      const bottom = at(box.bottom - 4, -1)
      if (top === undefined && bottom === undefined) return byScroll()
      const a = top ?? 0
      const b = bottom ?? n - 1
      const jumped = lastTop >= 0 && Math.abs(a - lastTop) > Math.max(5, (b - a + 1) * 2)
      lastTop = a
      if (jumped) thumb.style.transition = 'none'
      thumb.style.top = `${(a / n) * 100}%`
      thumb.style.height = `max(14px, ${((b - a + 1) / n) * 100}%)`
      if (jumped) {
        // 動かさずに置いたことを先に確定させてから(位置を読むと、その場で描き直す)、なめらかさを戻す
        void thumb.offsetHeight
        thumb.style.transition = SMOOTH
      }
    }
    // スマホ: つまみの大きさ(画面に入っているレスの数)は、スクロールで 1 つずつ変わってカクカクするので、なめらかにつなぐ
    const SMOOTH = 'height 220ms ease-out, top 120ms ease-out'
    if (isMobile) thumb.style.transition = SMOOTH
    /** 前に出したつまみの上端(何番目か)。大きく飛んだ(一番下へ・先頭へ)ときは、なめらかにせずすぐ移す */
    let lastTop = -1
    let raf = 0
    const update = () => {
      if (!isMobile) return byScroll()
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(byIndex)
    }
    root.addEventListener('scroll', update)
    const observer = new ResizeObserver(update)
    observer.observe(root)
    if (listRef.current) observer.observe(listRef.current)
    update()
    return () => {
      cancelAnimationFrame(raf)
      root.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [scrollRef, listRef, props.topOffset])

  const total = Math.max(1, posts.length - 1)
  // つまみ(スマホ)を番目で出すための控え
  const postsRef = useRef(posts)
  postsRef.current = posts
  const indexOf = useRef(new Map<number, number>())
  indexOf.current = useMemo(() => new Map(posts.map((p, i) => [p.no, i])), [posts])
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
      else if (hasVideo(p.body)) media.push({ no: p.no, at, type: 'video' })
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
    // スマホは番目の座標なので、その割合の番目のレスへ飛ぶ
    if (isMobile) {
      const p = posts[Math.min(posts.length - 1, Math.max(0, Math.round(ratio * total)))]
      if (p) props.onJump(p.no)
      return
    }
    root.scrollTop = ratio * root.scrollHeight - root.clientHeight / 2
  }

  const jump = (no: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    props.onJump(no)
  }

  // マウスを乗せた高さ(%)と、そのあたりのレス番号。押すとどこへ飛ぶか分かるように出す
  const [hover, setHover] = useState<{ at: number; no?: number }>()
  const onTrackMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const at = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100))
    // その高さより上にある最後のレス
    let no: number | undefined
    posts.forEach((p, i) => {
      if (pct(p.no, i) <= at) no = p.no
    })
    setHover({ at, no })
  }

  return (
    <div className="flex-shrink-0 flex flex-col">
      {/* スレのヘッダーがスクロールの中にあるとき(すりガラス)、ヘッダーはスクロールする所の幅までしかない。
          ミニマップの上にも同じ見た目の帯を置いて、ヘッダーが右端まで続いて見えるようにする */}
      {props.topOffset > 0 && (
        <div className="flex-shrink-0 frosted-glass bg-panel-thread-header border-b border-c-border" style={{ height: props.topOffset }} />
      )}
    {/* スマホは画面の端にぴったり付ける(余白を削って、本文の幅を残す) */}
    <div className={`flex-1 min-h-0 ${isMobile ? 'py-1 pr-0.5 pl-0' : 'py-2 pr-2 pl-1'}`}>
      <div
        className="relative w-[24px] h-full cursor-pointer"
        style={{
          background: 'var(--c-surface2)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--minimap-radius)',
        }}
        onClick={onTrackClick}
        // スマホにはマウスを乗せる操作がない(たたくと、そのときのマウスの動きとして番号が出たまま残る)ので、乗せた所の番号は出さない
        onMouseMove={isMobile ? undefined : onTrackMove}
        onMouseLeave={isMobile ? undefined : () => setHover(undefined)}
      >
        {/* 未読の範囲(「ここから未読」から下)は、うっすら色を付ける */}
        {unreadAt !== undefined && (
          <>
            <div
              className="absolute left-0 right-0 bottom-0 pointer-events-none"
              style={{
                top: `${unreadAt}%`,
                background: 'color-mix(in srgb, var(--c-unread) 12%, transparent)',
                borderRadius: '0 0 var(--minimap-radius) var(--minimap-radius)',
              }}
            />
            <div
              className="absolute left-0 right-0 h-[2px] pointer-events-none z-[9]"
              style={{ top: `${unreadAt}%`, background: 'var(--c-unread)' }}
              title="ここから未読"
            />
            <div
              className="absolute -left-[5px] pointer-events-none z-[9]"
              style={{
                top: `calc(${unreadAt}% - 4px)`,
                width: 0,
                height: 0,
                borderTop: '5px solid transparent',
                borderBottom: '5px solid transparent',
                borderLeft: '5px solid var(--c-unread)',
              }}
            />
          </>
        )}

        {/* 真ん中: 人気レス(被アンカー 3 件以上)の帯。多いほど暖かい色 */}
        {markers.heat.map((m) => (
          <button
            key={`heat-${m.no}`}
            type="button"
            onClick={jump(m.no)}
            className="absolute left-[5px] right-[5px] h-[5px] -translate-y-1/2 rounded-full hover:scale-y-150 transition-transform z-[10]"
            style={{ top: `${m.at}%`, background: heatColor(m.count) }}
            title={`>>${m.no}: ${m.count} 件のアンカー`}
          />
        ))}

        {/* 左: 自分への返信(枠だけのひし形)と自分のレス(塗ったひし形) */}
        {markers.reply.map((m) => (
          <button
            key={`reply-${m.no}`}
            type="button"
            onClick={jump(m.no)}
            className="absolute left-[2px] w-2 h-2 hover:scale-125 transition-transform z-[11] rounded-[1px]"
            style={{
              top: `${m.at}%`,
              transform: 'translateY(-50%) rotate(45deg)',
              border: '1.5px solid var(--c-own)',
              background: 'var(--c-surface2)',
            }}
            title={`自分への返信: >>${m.no}`}
          />
        ))}
        {markers.own.map((m) => (
          <button
            key={`own-${m.no}`}
            type="button"
            onClick={jump(m.no)}
            className="absolute left-[2px] w-2 h-2 hover:scale-125 transition-transform z-[12] rounded-[1px]"
            style={{
              top: `${m.at}%`,
              transform: 'translateY(-50%) rotate(45deg)',
              background: 'var(--c-own)',
            }}
            title={`自分のレス: >>${m.no}`}
          />
        ))}

        {/* 右: 画像(四角)と動画(三角) */}
        {markers.media.map((m) =>
          m.type === 'image' ? (
            <button
              key={`media-${m.no}`}
              type="button"
              onClick={jump(m.no)}
              className="absolute right-[3px] w-[5px] h-[5px] -translate-y-1/2 rounded-[1px] hover:scale-150 transition-transform z-[10]"
              style={{ top: `${m.at}%`, background: 'var(--c-text-muted)' }}
              title={`>>${m.no}: 画像あり`}
            />
          ) : (
            <button
              key={`media-${m.no}`}
              type="button"
              onClick={jump(m.no)}
              className="absolute right-[2px] -translate-y-1/2 hover:scale-150 transition-transform z-[10]"
              style={{
                top: `${m.at}%`,
                width: 0,
                height: 0,
                borderTop: '3.5px solid transparent',
                borderBottom: '3.5px solid transparent',
                borderLeft: '6px solid var(--c-text-muted)',
              }}
              title={`>>${m.no}: 動画あり`}
            />
          ),
        )}

        {/* 乗せた高さの目安線と、そのあたりのレス番号 */}
        {hover && (
          <div className="absolute left-0 right-0 pointer-events-none z-[30]" style={{ top: `${hover.at}%` }}>
            <div className="h-px" style={{ background: 'var(--c-text-body)', opacity: 0.6 }} />
            {hover.no !== undefined && (
              <span
                className="absolute right-full mr-2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums whitespace-nowrap shadow"
                style={{ background: 'var(--c-surface)', color: 'var(--c-text-strong)', border: '1px solid var(--c-border)' }}
              >
                &gt;&gt;{hover.no}
              </span>
            )}
          </div>
        )}

        {/* いま見ている位置のつまみ。強調色の枠で目立たせ、少し横にはみ出させる。真ん中の線がつかむところ */}
        <div
          ref={thumbRef}
          className="absolute -left-[3px] -right-[3px] flex items-center justify-center"
          style={{
            background: 'color-mix(in srgb, var(--c-accent) 18%, transparent)',
            border: '2px solid var(--c-accent)',
            borderRadius: 'calc(var(--minimap-radius) + 2px)',
            boxShadow: '0 0 0 1px color-mix(in srgb, var(--c-accent) 25%, transparent), 0 2px 6px rgba(0, 0, 0, 0.25)',
            cursor: 'grab',
            zIndex: 20,
          }}
          onMouseDown={onThumbMouseDown}
          onClick={(e) => e.stopPropagation()}
          title="いま見ている位置(ドラッグで動かせます)"
        >
          <span className="flex flex-col gap-[2px] pointer-events-none">
            <span className="block w-2.5 h-px" style={{ background: 'var(--c-accent)' }} />
            <span className="block w-2.5 h-px" style={{ background: 'var(--c-accent)' }} />
          </span>
        </div>
      </div>
    </div>
    </div>
  )
}
