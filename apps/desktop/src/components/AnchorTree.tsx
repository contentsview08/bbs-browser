// アンカーツリーの表示。どのレスがどのレスに付いているかを、ファイルのツリーのような線(├ └ │)でつなぐ。
// 行の高さはレスごとに違うので、線は各行の高さいっぱいに伸ばし、分岐はレスの頭の高さで横に出す。

import { useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { AnchorTreeRow } from '../utils/postTree'
import { isMobile } from '../utils/platform'
import { AVATAR } from './PostArticle'

type TreeRow = AnchorTreeRow

/** 1 段の幅。段は組み立て(utils/postTree.ts)で深さの上限に止めてある */
const STEP = 18
/** スマホ: 1 段ごとに右へずらす幅(罫線を引かず、レスの左の縦線を階段のように並べる) */
const MOBILE_STEP = 10
/** スマホ: 字下げした所(縦線より左)の色。明るい配色では薄い灰色、暗い配色では少し明るい灰色になる */
const GUTTER = 'color-mix(in srgb, var(--c-text-muted) 14%, transparent)'
/** 分岐の横線を出す高さ(レスのヘッダーの真ん中あたり) */
const ELBOW_Y = 14

// 線の色は薄い文字の色(枠線の色より濃い)。選んでいるレスの色(うっすら白・薄い強調色)の上でも見えるように
const LINE = 'color-mix(in srgb, var(--c-text-muted) 80%, transparent)'
/** 線の太さは Discord 風・LINE 風のツリーと同じ 2px。曲がり角の丸み */
const RADIUS = 6
/** 番号の真下に線を通す位置(レスの枠の左の余白から、番号の 1 文字目の真ん中あたりまで) */
const NUMBER_X = 7
/** 段 depth のレスの、番号の真下の横位置(行の左端から) */
const lineX = (depth: number) => `calc(${depth * STEP + NUMBER_X}px + var(--post-padding-x))`

/** Discord 風・LINE 風: アイコンの半分(アイコンの真ん中の位置) */
const D_HALF = AVATAR / 2

/** 1 行の中身: レスと、2 回目以降の出現(dup)なら薄くして、押すと 1 回目の出現へ飛ぶ覆い(中のボタンは押せない。ツリー表示と同じ) */
function RowBody(props: { row: TreeRow; renderPost: (no: number) => ReactNode; onDup: (no: number, el: HTMLElement) => void }) {
  const r = props.row
  if (!r.dup) return <>{props.renderPost(r.no)}</>
  return (
    <div className="relative">
      <div style={{ opacity: 0.5 }}>{props.renderPost(r.no)}</div>
      <button
        type="button"
        className="absolute inset-0 z-[3] cursor-pointer"
        onClick={(e) => {
          e.stopPropagation()
          props.onDup(r.no, e.currentTarget)
        }}
        title={`>>${r.no} の本来の位置へ`}
        aria-label={`>>${r.no} の本来の位置へ`}
      />
    </div>
  )
}

/** 2 回目以降の出現を押したとき: 1 回目の出現がこのツリーにあれば、そこへ送って少しのあいだ色を付ける。なければ onElsewhere */
function useDupJump(box: RefObject<HTMLDivElement | null>, onElsewhere?: (no: number, el: HTMLElement) => void) {
  const [flash, setFlash] = useState<number>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onDup = (no: number, el: HTMLElement) => {
    const target = box.current?.querySelector<HTMLElement>(`[data-tree-no="${no}"]`)
    if (!target) return onElsewhere?.(no, el)
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    setFlash(no)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setFlash(undefined), 1500)
  }
  return { flash, onDup }
}

export default function AnchorTree(props: {
  rows: TreeRow[]
  /** 押したレス(色を付ける) */
  focus: number
  renderPost: (no: number) => ReactNode
  /** discord・line は、線でアイコン同士をつなぐ */
  variant?: 'card' | 'discord' | 'classic' | 'line'
  /** 2 回目以降の出現を押して、1 回目の出現がこのツリーにないとき */
  onElsewhere?: (no: number, el: HTMLElement) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const { flash, onDup } = useDupJump(box, props.onElsewhere)
  const inner = { ...props, flash, onDup }
  return (
    <div ref={box}>
      {/* スマホは画面の幅が狭く、罫線でつなぐと本文が窮屈になるので、レスの左に縦線を引いて段をずらすだけにする */}
      {isMobile ? (
        <StepTree {...inner} />
      ) : props.variant === 'discord' ? (
        // Discord 風・LINE 風は、線でアイコン同士をつなぐ。1 段の幅はアイコンと隙間の分(Discord は隙間 12px、LINE は 8px)
        <IconTree {...inner} step={AVATAR + 12} top="var(--post-pad, var(--post-padding-y))" />
      ) : props.variant === 'line' ? (
        // LINE 風のレスの上の余白は、吹き出しの間の余白(app.css の --line-gap)
        <IconTree {...inner} step={AVATAR + 8} top="var(--line-gap)" />
      ) : (
        <LineTree {...inner} />
      )}
    </div>
  )
}

type InnerProps = { rows: TreeRow[]; focus: number; renderPost: (no: number) => ReactNode; flash?: number; onDup: (no: number, el: HTMLElement) => void }
/** 押したレス・飛んだ先は、選んでいるレスと同じ色を敷く */
const focused = (p: InnerProps, r: TreeRow) => !r.dup && (r.no === p.focus || r.no === p.flash)

/** カード・専ブラ風・まとめ風(PC): ファイルのツリーのような罫線でつなぐ */
function LineTree(props: InnerProps) {
  return (
    <div className="flex flex-col">
      {props.rows.map((r, i) => (
        <div key={`${i}:${r.no}`} data-tree-no={r.dup ? undefined : r.no} className="relative flex">
          {/* 子のレスがあれば、このレスの番号の真下から縦線を下ろす(番号から線が出ているように)。
              本文は右へずらしてある(app.css の .tree-post)ので、線は番号の下の、本文の左を通る */}
          {(props.rows[i + 1]?.depth ?? -1) > r.depth && (
            <span className="absolute bottom-0 pointer-events-none z-[2]" style={{ left: lineX(r.depth), top: ELBOW_Y + 10, borderLeft: `2px solid ${LINE}` }} />
          )}
          {r.depth > 0 && (
            <div className="relative flex-shrink-0" style={{ width: r.depth * STEP }}>
              {/* 上の段から続く縦線 */}
              {r.rails.map((on, k) => (on ? <span key={k} className="absolute top-0 bottom-0" style={{ left: lineX(k), borderLeft: `2px solid ${LINE}` }} /> : null))}
              {/* まだ兄弟がいれば、縦線を下まで伸ばす(├) */}
              {!r.last && <span className="absolute top-0 bottom-0" style={{ left: lineX(r.depth - 1), borderLeft: `2px solid ${LINE}` }} />}
              {/* 親の番号の下から来た線を、角を丸めて、このレスの番号の手前まで横に曲げる(└) */}
              <span
                className="absolute top-0 z-[2]"
                style={{
                  left: lineX(r.depth - 1),
                  width: STEP - NUMBER_X - 2,
                  height: ELBOW_Y + 1,
                  borderLeft: `2px solid ${LINE}`,
                  borderBottom: `2px solid ${LINE}`,
                  borderBottomLeftRadius: RADIUS,
                }}
              />
            </div>
          )}
          {/* 押したレスは、選んでいるレスと同じ色を敷く(強調色の面と縦線は、ツリーの線と重なって見にくい) */}
          <div
            className={`tree-post relative flex-1 min-w-0 rounded-[var(--card-radius)] ${focused(props, r) ? 'tree-focus' : ''}`}
          >
            <RowBody row={r} renderPost={props.renderPost} onDup={props.onDup} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Discord 風・LINE 風のアンカーツリー。親のアイコンの下から縦線を下ろし、子のアイコンの真ん中の高さで右へ曲げて、子のアイコンにつなぐ。
 * 段の幅をアイコンと隙間の分にして、子のアイコンが親の本文の始まりにそろうようにする
 */
function IconTree(props: InnerProps & { step: number; top: string }) {
  const D_STEP = props.step
  const line = (key: string, style: CSSProperties) => (
    <span key={key} aria-hidden className="absolute pointer-events-none" style={{ borderColor: LINE, borderStyle: 'solid', borderWidth: 0, ...style }} />
  )
  /** 段 depth のレスの、アイコンの真ん中の横位置(行の左端から) */
  const x = (depth: number) => `calc(${depth * D_STEP}px + var(--post-padding-x) + ${D_HALF}px)`
  /** レスの枠の上端から、アイコンの真ん中・アイコンの下端までの高さ(top はレスの枠の上端からアイコンの上端まで) */
  const midY = `calc(${props.top} + ${D_HALF}px)`
  const bottomY = `calc(${props.top} + ${D_HALF * 2 + 2}px)`
  return (
    <div className="flex flex-col">
      {props.rows.map((r, i) => {
        const hasChildren = (props.rows[i + 1]?.depth ?? -1) > r.depth
        return (
          <div key={`${i}:${r.no}`} data-tree-no={r.dup ? undefined : r.no} className="relative flex">
            {/* 上の段から続く縦線(まだ下に兄弟がいる先祖の線) */}
            {r.rails.map((on, k) => (on ? line(`rail${k}`, { left: x(k), top: 0, bottom: 0, borderLeftWidth: 2 }) : null))}
            {r.depth > 0 &&
              // 親のアイコンからの線を、このレスのアイコンの真ん中の高さで右へ曲げて、アイコンの左まで
              line('elbow', {
                left: x(r.depth - 1),
                top: 0,
                height: midY,
                width: D_STEP - D_HALF,
                borderLeftWidth: 2,
                borderBottomWidth: 2,
                borderBottomLeftRadius: RADIUS,
              })}
            {/* まだ兄弟がいれば、親からの縦線を下まで伸ばす */}
            {r.depth > 0 && !r.last && line('sibling', { left: x(r.depth - 1), top: 0, bottom: 0, borderLeftWidth: 2 })}
            {/* 子があれば、このレスのアイコンの下から縦線を下ろす */}
            {hasChildren && line('down', { left: x(r.depth), top: bottomY, bottom: 0, borderLeftWidth: 2 })}
            <div className="flex-shrink-0" style={{ width: r.depth * D_STEP }} />
            <div
              // 押したレスは、選んでいるレスと同じ色(強調色の面は字が読みにくい)
              className={`relative flex-1 min-w-0 rounded-[var(--card-radius)] ${focused(props, r) ? 'tree-focus' : ''}`}
            >
              <RowBody row={r} renderPost={props.renderPost} onDup={props.onDup} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * スマホのアンカーツリー。罫線(├ └)を引かず、返信のレスの左に縦線を引いて、段ごとに少しずつ右へずらす。
 * 縦線が階段のように並ぶので、どのレスへの返信かが分かる(Reddit などのスマホのコメント欄と同じ)
 */
function StepTree(props: InnerProps) {
  const rows = props.rows
  return (
    <div className="flex flex-col">
      {rows.map((r, i) => (
        <div
          key={`${i}:${r.no}`}
          data-tree-no={r.dup ? undefined : r.no}
          className={`flex min-w-0 ${r.no === props.flash && !r.dup ? 'tree-focus' : ''}`}
          // 段が変わる所にだけ、背景になじむ薄い線を引く(同じ段が続く所は引かない)
          style={i > 0 && rows[i - 1].depth !== r.depth ? { borderTop: '1.5px solid var(--c-border-strong, var(--c-border))' } : undefined}
        >
          {/* 段の分だけ、縦線より左を薄い灰色で塗る(どこまでが字下げか、ひと目で分かるように)。いちばん上の元のレスにも線を引く */}
          <div
            aria-hidden
            className="flex-shrink-0"
            style={{ width: 4 + r.depth * MOBILE_STEP, background: GUTTER, borderRight: `2px solid ${LINE}` }}
          />
          <div className="tree-post-step flex-1 min-w-0 pl-0.5">
            <RowBody row={r} renderPost={props.renderPost} onDup={props.onDup} />
          </div>
        </div>
      ))}
    </div>
  )
}
