// アンカーツリーの表示。カード・専ブラ風・まとめ風はツリー表示と同じ字下げと段の縦線、Discord 風・LINE 風は線でアイコン同士をつなぐ。
// 行の高さはレスごとに違うので、線は各行の高さいっぱいに伸ばし、分岐はレスの頭の高さで横に出す。

import { type CSSProperties, type ReactNode } from 'react'
import type { AnchorTreeRow } from '../utils/postTree'
import { isMobile } from '../utils/platform'
import { AVATAR } from './PostArticle'

type TreeRow = AnchorTreeRow

/** 字下げ 1 段の幅。ツリー表示(ThreadView.tsx の TREE_INDENT)と同じ */
const INDENT = isMobile ? 8 : 16
/** 段の縦線の色。ツリー表示と同じ(薄い字の色の 35%) */
const RULE = 'color-mix(in srgb, var(--c-text-muted) 35%, transparent)'
/** スマホ: 1 段ごとに右へずらす幅(罫線を引かず、レスの左の縦線を階段のように並べる) */
const MOBILE_STEP = 10
/** スマホ: 字下げした所(縦線より左)の色。明るい配色では薄い灰色、暗い配色では少し明るい灰色になる */
const GUTTER = 'color-mix(in srgb, var(--c-text-muted) 14%, transparent)'

// 線の色は薄い文字の色(枠線の色より濃い)。選んでいるレスの色(うっすら白・薄い強調色)の上でも見えるように
const LINE = 'color-mix(in srgb, var(--c-text-muted) 80%, transparent)'
/** 線の太さは Discord 風・LINE 風のツリーと同じ 2px。曲がり角の丸み */
const RADIUS = 6

/** Discord 風・LINE 風: アイコンの半分(アイコンの真ん中の位置) */
const D_HALF = AVATAR / 2

/** 2 回目以降の出現(dup)を押した・マウスを乗せたとき。アンカー(>>n)と同じポップアップを出す */
type DupHandlers = { onDup: (no: number, el: HTMLElement, via: 'click' | 'hover') => void; onDupLeave?: () => void }

/** 1 行の中身: レスと、2 回目以降の出現(dup)なら薄くして、押すとそのレスをアンカーと同じポップアップで出す覆い(中のボタンは押せない。ツリー表示と同じ) */
function RowBody(props: { row: TreeRow; index: number; renderPost: (no: number, index: number) => ReactNode } & DupHandlers) {
  const r = props.row
  if (!r.dup) return <>{props.renderPost(r.no, props.index)}</>
  return (
    <div className="relative">
      <div style={{ opacity: 0.5 }}>{props.renderPost(r.no, props.index)}</div>
      <button
        type="button"
        className="absolute inset-0 z-[3] cursor-pointer"
        onClick={(e) => {
          e.stopPropagation()
          props.onDup(r.no, e.currentTarget, 'click')
        }}
        onMouseEnter={(e) => props.onDup(r.no, e.currentTarget, 'hover')}
        onMouseLeave={props.onDupLeave}
        title={`>>${r.no} を出す`}
        aria-label={`>>${r.no} を出す`}
      />
    </div>
  )
}

export default function AnchorTree(props: {
  rows: TreeRow[]
  /** 押したレス(色を付ける) */
  focus: number
  /** index は行の位置(カード・まとめ風の区切りの線を 2 行目から付ける) */
  renderPost: (no: number, index: number) => ReactNode
  /** discord・line は、線でアイコン同士をつなぐ */
  variant?: 'card' | 'discord' | 'classic' | 'line'
} & DupHandlers) {
  return (
    <div>
      {props.variant === 'discord' || props.variant === 'line' ? (
        // スマホは画面の幅が狭く、線でつなぐと本文が窮屈になるので、レスの左に縦線を引いて段をずらすだけにする
        isMobile ? (
          <StepTree {...props} />
        ) : props.variant === 'discord' ? (
          // 1 段の幅はアイコンと隙間の分(Discord は隙間 12px、LINE は 8px)
          <IconTree {...props} step={AVATAR + 12} top="var(--post-pad, var(--post-padding-y))" />
        ) : (
          // LINE 風のレスの上の余白は、吹き出しの間の余白(app.css の --line-gap)
          <IconTree {...props} step={AVATAR + 8} top="var(--line-gap)" />
        )
      ) : (
        <IndentTree {...props} />
      )}
    </div>
  )
}

type InnerProps = { rows: TreeRow[]; focus: number; renderPost: (no: number, index: number) => ReactNode } & DupHandlers
/** 押したレスは、選んでいるレスと同じ色を敷く */
const focused = (p: InnerProps, r: TreeRow) => !r.dup && r.no === p.focus

/** カード・専ブラ風・まとめ風: ツリー表示と同じく、段の分だけ字下げし、字下げの左に段ごとの細い縦線(段の真ん中)を引く */
function IndentTree(props: InnerProps) {
  return (
    <div className="flex flex-col">
      {props.rows.map((r, i) => (
        <div
          key={`${i}:${r.no}`}
          className={`relative ${focused(props, r) ? 'tree-focus' : ''}`}
          style={r.depth > 0 ? { paddingLeft: r.depth * INDENT } : undefined}
        >
          {r.depth > 0 && (
            <span
              aria-hidden
              className="absolute left-0 top-0 bottom-0 pointer-events-none"
              style={{
                width: r.depth * INDENT,
                background: `repeating-linear-gradient(to right, transparent 0 ${INDENT / 2}px, ${RULE} ${INDENT / 2}px ${INDENT / 2 + 1}px, transparent ${INDENT / 2 + 1}px ${INDENT}px)`,
              }}
            />
          )}
          <RowBody row={r} index={i} renderPost={props.renderPost} onDup={props.onDup} onDupLeave={props.onDupLeave} />
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
          <div key={`${i}:${r.no}`} className="relative flex">
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
              <RowBody row={r} index={i} renderPost={props.renderPost} onDup={props.onDup} onDupLeave={props.onDupLeave} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * スマホ(Web)の Discord 風・LINE 風のアンカーツリー。罫線(├ └)を引かず、返信のレスの左に縦線を引いて、段ごとに少しずつ右へずらす。
 * 縦線が階段のように並ぶので、どのレスへの返信かが分かる(Reddit などのスマホのコメント欄と同じ)
 */
function StepTree(props: InnerProps) {
  const rows = props.rows
  return (
    <div className="flex flex-col">
      {rows.map((r, i) => (
        <div
          key={`${i}:${r.no}`}
          className="flex min-w-0"
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
            <RowBody row={r} index={i} renderPost={props.renderPost} onDup={props.onDup} onDupLeave={props.onDupLeave} />
          </div>
        </div>
      ))}
    </div>
  )
}
