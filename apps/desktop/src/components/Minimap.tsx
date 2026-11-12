// ミニマップ。スレ全体を縦に縮めて、人気レス・画像・動画・リンク・自分のレス・自分への返信と「ここから未読」の位置を示す。
// つまみをドラッグしてスクロールでき、印を押すとそのレスへ、何もないところを押すとその割合の位置へ飛ぶ。
// 幅を 2 つの列に分ける(左: 中身=人気の横棒と画像・動画・リンク、右: 自分=自分のレスと返信)。寸法と色は bbs-suite の docs/minimap.md
// 縦の座標は「レスの番目 ÷ レス数」(PC・スマホ・スマホ版で同じ)。印はスクロールの位置や高さの見積もりに依らず、飛んでも描き直しても動かない。
// つまみ(見えている範囲)も同じ番目の座標で出す。決まりは bbs-suite の docs/thread-scroll.md

import { isMobile } from '../utils/platform'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Post } from '@bbs-browser/connectors'
import { hasLink, hasVideo, imageUrlsIn, looksLikeAA, shortUrl } from '../utils/postBody'
import { currentMinimapThumbColor } from '../utils/minimapThumb'
import { framesIn } from '../hooks/useThreadScroll'
import { firstAfter } from '../utils/cursor'

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
  /** NG(あぼーん)のレスか。乗せたときの吹き出しに本文を出さない */
  isNg?: (p: Post) => boolean
  /** ヘッダーの高さ。ミニマップはその下から始める */
  topOffset: number
  /** レスへ飛ぶ(呼ぶ側がそのレスを見える範囲の真ん中に置く)。印を押したときは光らせ(flash)、印のない所を押したときは光らせない */
  onJump: (no: number, flash: boolean) => void
  /** つまみを離した(呼ぶ側が、見えている真ん中のレスを「飛んだ先」として光らせ、留める) */
  onDragEnd?: () => void
}

// utils/postBody の heatClass と同じ暖色の段階
function heatColor(count: number): string {
  if (count >= 7) return 'var(--c-heat-very-hot)'
  if (count >= 5) return 'var(--c-heat-hot)'
  return 'var(--c-heat-warm)'
}

// 寸法(px)。スマホはスマホ版の 23dp と同じ並びにする(枠の内側から測る)。
// 小さな印は目に入らないので、幅を広げて印を大きくしてある(人気の棒の最短が、作り直す前の帯と同じ。スマホ 8×4・PC 12×5)
const WIDTH = isMobile ? 23 : 30
const PAD = isMobile ? 0.5 : 1.5
const COL = WIDTH - 2 - PAD * 2
/** 左の列(中身)の幅。右の列(自分)とおよそ 6:4(右の列に丸が収まるよう、スマホ 12:8・PC 16:9) */
const LEFT_W = isMobile ? 12 : 16
/** 右の列の真ん中 */
const RIGHT_X = PAD + LEFT_W + (COL - LEFT_W) / 2
/** 自分のレス・返信の丸の直径。返信は線 1.5 の輪(PC で線を太くすると穴がつぶれて塗りと見分けにくい) */
const DOT = isMobile ? 7 : 8
/** 画像・動画・リンクの印の大きさ。左の列の右の端に置く(人気の棒は左の端から) */
const MEDIA = isMobile ? 5 : 6
const MEDIA_X = PAD + LEFT_W - MEDIA / 2 - 0.5
/** 人気の棒の高さ */
const HEAT_H = isMobile ? 4 : 5
/** 押せる広さ(見た目より広く取る) */
const HIT = isMobile ? 11 : 12

/** 人気の棒の長さ(左の列に対する割合)。出し始め(3 件)で最短、10 件でいっぱい。最短でも目に入るよう、スマホ 2/3(8px)・PC 75%(12px) */
const HEAT_MIN = isMobile ? 2 / 3 : 0.75
function heatLength(count: number): number {
  return HEAT_MIN + (1 - HEAT_MIN) * Math.min(1, Math.max(0, (count - 3) / 7))
}

// 乗せたときの吹き出しの本文の頭。アンカー・タグを除くのはスマホ版のドラッグ中の札(ui/Minimap.kt の LABEL_ANCHOR・LABEL_TAG)と同じ
const DIGEST_ANCHOR = /(&gt;|>|＞){1,2}[0-9]+(-[0-9]+)?/g
const DIGEST_TAG = /<[^>]+>/g
const DIGEST_URL = /h?ttps?:\/\/[^\s<>"'）)」]+/gi
/** 長い本文を全部整えない(吹き出しは 3 行で切るので、これだけあれば足りる) */
const DIGEST_MAX = 140
/** 整えた本文は本文ごとに覚える(カーソルを動かすたびに整え直さない) */
const digestCache = new Map<string, string>()
function digestOf(body: string): string {
  let v = digestCache.get(body)
  if (v === undefined) {
    if (digestCache.size > 5_000) digestCache.clear()
    if (looksLikeAA(body)) v = '(AA)'
    else {
      const flat = body
        .replace(DIGEST_TAG, '')
        .replace(DIGEST_ANCHOR, '')
        .replace(DIGEST_URL, (u) => shortUrl(u, 24))
        .replace(/\s+/g, ' ')
        .trim()
      v = flat.length > DIGEST_MAX ? `${flat.slice(0, DIGEST_MAX - 1)}…` : flat
    }
    digestCache.set(body, v)
  }
  return v
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

  const total = Math.max(1, posts.length - 1)
  // つまみを番目で出すための控え
  const postsRef = useRef(posts)
  postsRef.current = posts
  const indexOf = useRef(new Map<number, number>())
  indexOf.current = useMemo(() => new Map(posts.map((p, i) => [p.no, i])), [posts])
  /** 印の縦の位置(%)。番目 ÷ (レス数 − 1)。測らないので、飛んでも・描き直しても・高さの見積もりが変わっても動かない */
  const pct = (_no: number, index: number) => (index / total) * 100

  /**
   * 見えている範囲(ヘッダーの下からフッターの上まで)の上端と下端にあるレスの番目(小数つき。レスの中のどこまで見えているか)。
   * 枠(.post-cv)を上から半分ずつ探す(全部は測らない)。絞り込みで隠れた枠・ツリーで重ねた分(data-post なし)は数えない
   */
  const visibleRange = (root: HTMLElement): { a: number; b: number } | undefined => {
    const frames = framesIn(listRef.current)
    const n = frames.length
    if (n === 0) return undefined
    const box = root.getBoundingClientRect()
    const footer = isMobile ? parseFloat(getComputedStyle(root).getPropertyValue('--footer-offset')) || 0 : 0
    const top = box.top + props.topOffset
    const bottom = box.bottom - footer
    const rect = (k: number) => (frames[k].hidden ? undefined : frames[k].getBoundingClientRect())
    const i = firstAfter(n, (k) => rect(k)?.bottom, top)
    if (i >= n) return undefined
    const idx = (k: number) => indexOf.current.get(Number(frames[k].dataset.post)) ?? k
    const ri = rect(i)!
    const a = idx(i) + Math.min(1, Math.max(0, (top - ri.top) / Math.max(1, ri.height)))
    let j = i
    for (let k = i; k < n; k++) {
      const r = rect(k)
      if (!r) continue
      if (r.top >= bottom) break
      j = k
    }
    const rj = rect(j)!
    const b = idx(j) + Math.min(1, Math.max(0, (bottom - rj.top) / Math.max(1, rj.height)))
    return { a, b }
  }

  // つまみを、見えている範囲の番目に合わせる(印と同じ座標)
  useEffect(() => {
    const root = scrollRef.current
    const thumb = thumbRef.current
    if (!root || !thumb) return
    // つまみの大きさ(画面に入っているレスの数)は、スクロールで 1 つずつ変わってカクカクするので、なめらかにつなぐ
    const SMOOTH = 'height 220ms ease-out, top 120ms ease-out'
    thumb.style.transition = SMOOTH
    /** 前に出したつまみの上端(何番目か)。大きく飛んだ(一番下へ・先頭へ・ミニマップから)ときは、なめらかにせずすぐ移す */
    let lastTop = -1
    const byIndex = () => {
      const n = Math.max(1, postsRef.current.length)
      const range = visibleRange(root)
      if (!range) return
      const { a, b } = range
      const jumped = lastTop >= 0 && Math.abs(a - lastTop) > Math.max(5, (b - a) * 2)
      lastTop = a
      if (jumped) thumb.style.transition = 'none'
      thumb.style.top = `${(a / n) * 100}%`
      // 長いスレでもつかめるよう、つまみは 14px より小さくしない
      thumb.style.height = `max(14px, ${((b - a) / n) * 100}%)`
      if (jumped) {
        // 動かさずに置いたことを先に確定させてから(位置を読むと、その場で描き直す)、なめらかさを戻す
        void thumb.offsetHeight
        thumb.style.transition = SMOOTH
      }
    }
    let raf = 0
    const update = () => {
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
    // visibleRange は listRef と topOffset から決まる
  }, [scrollRef, listRef, props.topOffset])

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
    // pct は posts(の数)から決まるので、依存はこれで足りる
  }, [posts, props.anchorCounts, props.ownNos, props.replyToOwn, props.newFrom])

  const unreadIndex = props.unreadFrom > 1 ? posts.findIndex((p) => p.no === props.unreadFrom) : -1
  const unreadAt = unreadIndex >= 0 ? pct(props.unreadFrom, unreadIndex) : undefined

  /** 番目のレスの頭を、見える範囲の上端(ヘッダーの下)に置く(つまみをドラッグしている間。スマホ版の dragTo と同じ) */
  const scrollToIndex = (root: HTMLElement, index: number) => {
    const frames = framesIn(listRef.current)
    const p = postsRef.current[Math.min(postsRef.current.length - 1, Math.max(0, Math.round(index)))]
    const el = p && frames.find((f) => Number(f.dataset.post) === p.no && !f.hidden)
    if (!el) return
    root.scrollTop += el.getBoundingClientRect().top - root.getBoundingClientRect().top - props.topOffset
  }

  // つまみのドラッグ。つまみは番目の座標なので、動かした分を番目に直してそのレスへ(見積もりの高さに依らない)
  const onThumbMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const root = scrollRef.current
    if (!root) return
    const startY = e.clientY
    const startIndex = visibleRange(root)?.a ?? 0
    const trackH = e.currentTarget.parentElement?.clientHeight ?? root.clientHeight
    const n = Math.max(1, postsRef.current.length)
    let lastIndex = -1
    const onMove = (ev: MouseEvent) => {
      const index = Math.min(n - 1, Math.max(0, Math.round(startIndex + ((ev.clientY - startY) / trackH) * n)))
      if (index === lastIndex) return
      lastIndex = index
      scrollToIndex(root, index)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      props.onDragEnd?.()
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // 何もないところを押したら、その割合の番目のレスへ(真ん中に置く。光らせない。スマホ版と同じ)
  const onTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / rect.height
    const p = posts[Math.min(posts.length - 1, Math.max(0, Math.round(ratio * total)))]
    if (p) props.onJump(p.no, false)
  }

  // 印は数が多いことがあるので、マウスを動かしただけ(hover)では作り直さない
  const onJump = props.onJump
  const markerButtons = useMemo(() => {
    const jump = (no: number) => (e: React.MouseEvent) => {
      e.stopPropagation()
      onJump(no, true)
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
            className="absolute -translate-y-1/2 rounded-full hover:scale-y-150 transition-transform z-[10]"
            style={{ top: `${m.at}%`, left: PAD, width: LEFT_W * heatLength(m.count), height: HEAT_H, background: heatColor(m.count) }}
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
            {/* 形は 4 の升目で描き、MEDIA の大きさに伸ばす(縁も同じ割合で太る) */}
            <svg width={(MEDIA * 6) / 4} height={(MEDIA * 6) / 4} viewBox="-1 -1 6 6" className="pointer-events-none overflow-visible">
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
  const [hover, setHover] = useState<{ at: number; no?: number; digest?: string }>()
  const onTrackMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const at = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100))
    // その高さより上にある最後のレス
    let post: Post | undefined
    for (let i = posts.length - 1; i >= 0; i--) {
      if (pct(posts[i].no, i) <= at) {
        post = posts[i]
        break
      }
    }
    const digest = post && (props.isNg?.(post) ? 'あぼーん' : digestOf(post.body))
    setHover({ at, no: post?.no, digest })
  }

  return (
    <div className="flex-shrink-0 flex flex-col">
      {/* スレのヘッダーがスクロールの中にあるとき(すりガラス)、ヘッダーはスクロールする所の幅までしかない。
          ミニマップの上にも同じ見た目の帯を置いて、ヘッダーが右端まで続いて見えるようにする */}
      {props.topOffset > 0 && (
        <div className="flex-shrink-0 frosted-glass bg-panel-thread-header border-b border-c-border" style={{ height: props.topOffset }} />
      )}
    {/* スマホは画面の端にぴったり付ける(余白を削って、本文の幅を残す)。
        PC は帯を広げた分だけ外の余白を詰め、全体の幅をあまり変えない(「いちばん下へ」のボタンが右から 44px に置いてある) */}
    <div className={`flex-1 min-h-0 ${isMobile ? 'py-1 pr-0.5 pl-0' : 'py-2 pr-1.5 pl-0.5'}`}>
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
                className="absolute right-full mr-2 px-1.5 py-0.5 rounded text-[10px] shadow w-max max-w-[260px]"
                // 上の端では下へ、下の端では上へ寄せる(ミニマップの端で吹き出しが画面の外へ出ないように)
                style={{ transform: `translateY(-${hover.at}%)`, background: 'var(--c-surface)', color: 'var(--c-text-strong)', border: '1px solid var(--c-border)' }}
              >
                <span className="block font-bold tabular-nums whitespace-nowrap">&gt;&gt;{hover.no}</span>
                {hover.digest && (
                  <span className="block break-words line-clamp-3 leading-snug text-[11px]" style={{ color: 'var(--c-text-body)' }}>
                    {hover.digest}
                  </span>
                )}
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
