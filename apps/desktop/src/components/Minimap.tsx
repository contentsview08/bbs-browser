// ミニマップ。スレ全体を縦に縮めて、人気レス・画像・動画・リンク・自分のレス・自分への返信と「ここから未読」の位置を示す。
// つまみをドラッグしてスクロールでき、印を押すとそのレスへ、何もないところを押すとその割合の位置へ飛ぶ。
// 幅を 2 つの列に分ける(左: 中身=人気の横棒と画像・動画・リンク、右: 自分=自分のレスと返信)。寸法と色は bbs-suite の docs/minimap.md

import { isMobile } from '../utils/platform'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Post } from '@bbs-browser/connectors'
import { hasLink, hasVideo, imageUrlsIn } from '../utils/postBody'
import { currentMinimapThumbColor } from '../utils/minimapThumb'
import { framesIn } from '../hooks/useThreadScroll'

/** 位置がこれ(%)より動いていなければ、印を描き直さない(細い帯の上では 1px に満たない) */
const PCT_EPSILON = 0.1
/** 測った位置が前と同じとみなせるか */
function samePcts(a: Map<number, number>, b: Map<number, number>): boolean {
  if (a.size !== b.size) return false
  for (const [no, at] of a) {
    const other = b.get(no)
    if (other === undefined || Math.abs(other - at) >= PCT_EPSILON) return false
  }
  return true
}

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
  /** ツリー表示: この番号から後ろのレスに新着の印を付ける(「ここから未読」の帯は出さないので unreadFrom は 0 で渡す) */
  newFrom?: number
  /** ヘッダーの高さ。ミニマップはその下から始める */
  topOffset: number
  onJump: (no: number) => void
}

// utils/postBody の heatClass と同じ暖色の段階
function heatColor(count: number): string {
  if (count >= 7) return 'var(--c-heat-very-hot)'
  if (count >= 5) return 'var(--c-heat-hot)'
  return 'var(--c-heat-warm)'
}

// 寸法(px)。スマホはスマホ版の 18dp と同じ並びにする(枠の内側から測る)
const WIDTH = isMobile ? 18 : 24
const PAD = isMobile ? 0.5 : 2
const COL = WIDTH - 2 - PAD * 2
/** 左の列(中身)の幅。右の列(自分)と 6:4 */
const LEFT_W = COL * 0.6
/** 右の列の真ん中 */
const RIGHT_X = PAD + LEFT_W + (COL - LEFT_W) / 2
/** 自分のレス・返信の丸の直径 */
const DOT = 5
/** 画像・動画・リンクの印の大きさ。左の列の右の端に置く(人気の棒は左の端から) */
const MEDIA = 4
const MEDIA_X = PAD + LEFT_W - MEDIA / 2 - 0.5
/** 押せる広さ(印は小さいので、見た目より広く取る) */
const HIT = 9

/** 人気の棒の長さ(左の列に対する割合)。出し始め(3 件)で 40%、10 件でいっぱい */
function heatLength(count: number): number {
  return 0.4 + 0.6 * Math.min(1, Math.max(0, (count - 3) / 7))
}

/** つまみの色。配色・差し色を変えたら(<html> の属性が変わる)決め直す */
function useThumbColor(): string {
  const [color, setColor] = useState(currentMinimapThumbColor)
  useEffect(() => {
    const update = () => setColor(currentMinimapThumbColor())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-scheme'] })
    update()
    return () => observer.disconnect()
  }, [])
  return color
}

export default function Minimap(props: Props) {
  const { posts, scrollRef, listRef } = props
  const thumbRef = useRef<HTMLDivElement>(null)
  const thumbColor = useThumbColor()
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
      for (const el of framesIn(listRef.current)) {
        if (el.hidden) continue // 絞り込みで隠しているレス
        // 番号は枠に持たせてある(NG で中身を描かないレスも数えるため)
        const no = Number(el.dataset.post)
        if (!no) continue
        const top = el.getBoundingClientRect().top - rootTop + root.scrollTop
        next.set(no, (top / root.scrollHeight) * 100)
      }
      setPcts((prev) => (samePcts(prev, next) ? prev : next))
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
          // ツリーで重ねて出した分(data-post がない)は飛ばす
          const el = document.elementFromPoint(x, from + dir * k * 20)?.closest<HTMLElement>('.post-cv[data-post]')
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
    const media: { no: number; at: number; type: 'image' | 'video' | 'link' }[] = []
    const fresh: { no: number; at: number }[] = []
    const newFrom = props.newFrom ?? 0
    posts.forEach((p, i) => {
      const at = pct(p.no, i)
      if (newFrom > 1 && p.no >= newFrom) fresh.push({ no: p.no, at })
      const count = props.anchorCounts.get(p.no) ?? 0
      if (count >= 3) heat.push({ no: p.no, at, count })
      if (props.ownNos.has(p.no)) own.push({ no: p.no, at })
      if (props.replyToOwn.has(p.no)) reply.push({ no: p.no, at })
      // 1 つのレスには 1 つだけ: 動画 > 画像 > リンク(リンクは絞り込みの「リンク」と同じ判定)
      if (hasVideo(p.body)) media.push({ no: p.no, at, type: 'video' })
      else if (imageUrlsIn(p.body).length > 0) media.push({ no: p.no, at, type: 'image' })
      else if (hasLink(p.body)) media.push({ no: p.no, at, type: 'link' })
    })
    return { heat, own, reply, media, fresh }
    // pct は pcts と posts から決まるので、依存はこれで足りる
  }, [posts, pcts, props.anchorCounts, props.ownNos, props.replyToOwn, props.newFrom])

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

  // 印は数が多いことがあるので、マウスを動かしただけ(hover)では作り直さない
  const onJump = props.onJump
  const markerButtons = useMemo(() => {
    const jump = (no: number) => (e: React.MouseEvent) => {
      e.stopPropagation()
      onJump(no)
    }
    /** 印を押せる箱。印そのものは小さいので、箱は広めにして真ん中に印を置く */
    const hit = (x: number, at: number, z: number) => ({
      left: x - HIT / 2,
      top: `calc(${at}% - ${HIT / 2}px)`,
      width: HIT,
      height: HIT,
      zIndex: z,
    })
    const MEDIA_COLOR = { image: 'var(--c-mark-new)', video: 'var(--c-mark-danger)', link: 'var(--c-mark-link)' } as const
    const MEDIA_TITLE = { image: '画像あり', video: '動画あり', link: 'リンクあり' } as const
    // 印の縁取り(地の色)。同じ高さの人気の棒に重なっても形が分かるように
    const shape = (type: keyof typeof MEDIA_COLOR): React.CSSProperties => ({
      fill: MEDIA_COLOR[type],
      stroke: 'var(--c-surface2)',
      strokeWidth: 1.2,
      paintOrder: 'stroke',
      strokeLinejoin: 'round',
    })
    return (
      <>
        {/* ツリーの新着: 左右いっぱいの細い線(未読の色)。押すとそのレスへ */}
        {markers.fresh.map((m) => (
          <button
            key={`new-${m.no}`}
            type="button"
            onClick={jump(m.no)}
            className="absolute left-0 right-0 h-[2px] -translate-y-1/2 z-[9]"
            style={{ top: `${m.at}%`, background: 'var(--c-unread)' }}
            title={`新着: >>${m.no}`}
          />
        ))}
        {/* 左の列: 人気レス(被アンカー 3 件以上)の横棒。多いほど暖かい色で長い。左の端から */}
        {markers.heat.map((m) => (
          <button
            key={`heat-${m.no}`}
            type="button"
            onClick={jump(m.no)}
            className="absolute h-[3px] -translate-y-1/2 rounded-full hover:scale-y-150 transition-transform z-[10]"
            style={{ top: `${m.at}%`, left: PAD, width: LEFT_W * heatLength(m.count), background: heatColor(m.count) }}
            title={`>>${m.no}: ${m.count} 件のアンカー`}
          />
        ))}
        {/* 左の列の右の端: 画像(四角)・動画(三角)・リンク(点) */}
        {markers.media.map((m) => (
          <button
            key={`media-${m.no}`}
            type="button"
            onClick={jump(m.no)}
            className="absolute flex items-center justify-center hover:scale-150 transition-transform"
            style={hit(MEDIA_X, m.at, 11)}
            title={`>>${m.no}: ${MEDIA_TITLE[m.type]}`}
          >
            <svg width={MEDIA + 2} height={MEDIA + 2} viewBox="-1 -1 6 6" className="pointer-events-none overflow-visible">
              {m.type === 'image' ? (
                <rect x="0" y="0" width="4" height="4" rx="0.6" style={shape(m.type)} />
              ) : m.type === 'video' ? (
                <polygon points="0,0 4,2 0,4" style={shape(m.type)} />
              ) : (
                <circle cx="2" cy="2" r="2" style={shape(m.type)} />
              )}
            </svg>
          </button>
        ))}

        {/* 右の列: 自分への返信(輪)と自分のレス(塗った丸)。同じ大きさ */}
        {markers.reply.map((m) => (
          <button
            key={`reply-${m.no}`}
            type="button"
            onClick={jump(m.no)}
            className="absolute flex items-center justify-center hover:scale-125 transition-transform"
            style={hit(RIGHT_X, m.at, 12)}
            title={`自分への返信: >>${m.no}`}
          >
            <span className="block rounded-full" style={{ width: DOT, height: DOT, border: '1.5px solid var(--c-own)' }} />
          </button>
        ))}
        {markers.own.map((m) => (
          <button
            key={`own-${m.no}`}
            type="button"
            onClick={jump(m.no)}
            className="absolute flex items-center justify-center hover:scale-125 transition-transform"
            style={hit(RIGHT_X, m.at, 13)}
            title={`自分のレス: >>${m.no}`}
          >
            <span className="block rounded-full" style={{ width: DOT, height: DOT, background: 'var(--c-own)' }} />
          </button>
        ))}
      </>
    )
  }, [markers, onJump])

  // マウスを乗せた高さ(%)と、そのあたりのレス番号。押すとどこへ飛ぶか分かるように出す
  const [hover, setHover] = useState<{ at: number; no?: number }>()
  const onTrackMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const at = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100))
    // その高さより上にある最後のレス
    let no: number | undefined
    for (let i = posts.length - 1; i >= 0; i--) {
      if (pct(posts[i].no, i) <= at) {
        no = posts[i].no
        break
      }
    }
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
        className="relative h-full cursor-pointer"
        style={{
          width: WIDTH,
          background: 'var(--c-surface2)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--minimap-radius)',
        }}
        onClick={onTrackClick}
        // スマホにはマウスを乗せる操作がない(たたくと、そのときのマウスの動きとして番号が出たまま残る)ので、乗せた所の番号は出さない
        onMouseMove={isMobile ? undefined : onTrackMove}
        onMouseLeave={isMobile ? undefined : () => setHover(undefined)}
      >
        {/* 「ここから未読」: 細い線 1 本(面は塗らない。つまみや印と紛れないように) */}
        {unreadAt !== undefined && (
          <div
            className="absolute left-0 right-0 h-[1.5px] -translate-y-1/2 pointer-events-none z-[9]"
            style={{ top: `${unreadAt}%`, background: 'var(--c-unread)' }}
            title="ここから未読"
          />
        )}

        {markerButtons}

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

        {/* いま見ている位置のつまみ。テーマの差し色(印と近ければ青灰色)の薄い面と縁。PC は少し横にはみ出させる。
            つかむ線は描かない(下の印に重なって見にくい。つかめることはカーソルで分かる) */}
        <div
          ref={thumbRef}
          className={`absolute ${isMobile ? 'left-0 right-0' : '-left-[3px] -right-[3px]'}`}
          // 決めた色は変数にも置く(bbs-suite の tools/colorshot.sh がスマホ版の値と比べる)
          data-minimap-thumb=""
          style={{
            ['--minimap-thumb' as string]: thumbColor,
            background: 'color-mix(in srgb, var(--minimap-thumb) 15%, transparent)',
            border: '1.5px solid color-mix(in srgb, var(--minimap-thumb) 50%, transparent)',
            borderRadius: isMobile ? 'var(--minimap-radius)' : 'calc(var(--minimap-radius) + 2px)',
            cursor: 'grab',
            zIndex: 20,
          }}
          onMouseDown={onThumbMouseDown}
          onClick={(e) => e.stopPropagation()}
          title="いま見ている位置(ドラッグで動かせます)"
        />
      </div>
    </div>
    </div>
  )
}
