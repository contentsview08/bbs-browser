// アンカーツリーの表示。どのレスがどのレスに付いているかを、ファイルのツリーのような線(├ └ │)でつなぐ。
// 行の高さはレスごとに違うので、線は各行の高さいっぱいに伸ばし、分岐はレスの頭の高さで横に出す。

import type { CSSProperties, ReactNode } from 'react'
import type { TreeRow } from '../utils/postBody'
import { isMobile } from '../utils/platform'
import { AVATAR } from './PostArticle'

/** 1 段の幅(スマホは画面が狭いので詰める) */
const STEP = isMobile ? 12 : 18
/**
 * スマホ: これより深い段は、この段にそろえる(右へずれ続けて、本文の幅がなくなるのを防ぐ)。
 * 線のつながりは少し崩れるが、どのレスへの返信かは本文のアンカーで分かる
 */
const MAX_DEPTH = isMobile ? 4 : Infinity
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

export default function AnchorTree(props: {
  rows: TreeRow[]
  /** 押したレス(色を付ける) */
  focus: number
  renderPost: (no: number) => ReactNode
  /** Discord 風: 線をアイコン同士をつなぐ形にする */
  variant?: 'card' | 'discord' | 'classic' | 'line'
}) {
  // スマホでは深い段を MAX_DEPTH にそろえる
  if (MAX_DEPTH !== Infinity) props = { ...props, rows: props.rows.map((row) => (row.depth > MAX_DEPTH ? { ...row, depth: MAX_DEPTH } : row)) }
  // Discord 風・LINE 風は、線でアイコン同士をつなぐ。1 段の幅はアイコンと隙間の分(Discord は隙間 12px、LINE は 8px)
  if (props.variant === 'discord') return <IconTree {...props} step={AVATAR + 12} />
  if (props.variant === 'line') return <IconTree {...props} step={AVATAR + 8} />
  return (
    <div className="flex flex-col">
      {props.rows.map((r, i) => (
        <div key={r.no} className="relative flex">
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
          {/* 押したレスは、選んでいるレスと同じ色を敷く(強調色の面と縦線は、ツリーの線と重なって見にくいのでやめた) */}
          <div
            className="tree-post relative flex-1 min-w-0 rounded-[var(--card-radius)]"
            style={r.no === props.focus ? { background: 'var(--c-cursor-tint)' } : undefined}
          >
            {props.renderPost(r.no)}
            {r.alsoTo.length > 0 && (
              <p className="px-2 pb-1 text-[10px] text-c-text-muted">{r.alsoTo.map((n) => `>>${n}`).join(' ')} にも</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Discord 風・LINE 風のアンカーツリー。親のアイコンの下から縦線を下ろし、子のアイコンの真ん中の高さで右へ曲げて、子のアイコンにつなぐ。
 * 段の幅をアイコン 1 つ分にして、子のアイコンが親の本文の始まりにそろうようにする
 */
function IconTree(props: { rows: TreeRow[]; focus: number; renderPost: (no: number) => ReactNode; step: number }) {
  const D_STEP = props.step
  const line = (key: string, style: CSSProperties) => (
    <span key={key} aria-hidden className="absolute pointer-events-none" style={{ borderColor: LINE, borderStyle: 'solid', borderWidth: 0, ...style }} />
  )
  /** 段 depth のレスの、アイコンの真ん中の横位置(行の左端から) */
  const x = (depth: number) => `calc(${depth * D_STEP}px + var(--post-padding-x) + ${D_HALF}px)`
  /** レスの枠の上端から、アイコンの真ん中・アイコンの下端までの高さ */
  const midY = `calc(var(--post-padding-y) + ${D_HALF}px)`
  const bottomY = `calc(var(--post-padding-y) + ${D_HALF * 2 + 2}px)`
  return (
    <div className="flex flex-col">
      {props.rows.map((r, i) => {
        const hasChildren = (props.rows[i + 1]?.depth ?? -1) > r.depth
        return (
          <div key={r.no} className="relative flex">
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
              className="relative flex-1 min-w-0 rounded-[var(--card-radius)]"
              // 押したレスは、選んでいるレスと同じ色(強調色の面は字が読みにくい)
              style={r.no === props.focus ? { background: 'var(--c-cursor-tint)' } : undefined}
            >
              {props.renderPost(r.no)}
              {/* 「>>n にも」は本文の始まり(アイコンの右)にそろえる(アイコンの列に置くと線と重なるため) */}
              {r.alsoTo.length > 0 && (
                <p className="pb-1 text-[10px] text-c-text-muted" style={{ paddingLeft: `calc(var(--post-padding-x) + ${D_STEP}px)` }}>
                  {r.alsoTo.map((n) => `>>${n}`).join(' ')} にも
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
