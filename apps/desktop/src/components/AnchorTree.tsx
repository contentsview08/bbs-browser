// アンカーツリーの表示。どのレスがどのレスに付いているかを、ファイルのツリーのような線(├ └ │)でつなぐ。
// 行の高さはレスごとに違うので、線は各行の高さいっぱいに伸ばし、分岐はレスの頭の高さで横に出す。

import type { ReactNode } from 'react'
import type { TreeRow } from '../utils/postBody'

/** 1 段の幅 */
const STEP = 18
/** 分岐の横線を出す高さ(レスのヘッダーの真ん中あたり) */
const ELBOW_Y = 14

const LINE = 'var(--c-border-strong)'
/** 曲がり角の丸み */
const RADIUS = 6

export default function AnchorTree(props: {
  rows: TreeRow[]
  /** 押したレス(色を付ける) */
  focus: number
  renderPost: (no: number) => ReactNode
}) {
  return (
    <div className="flex flex-col">
      {props.rows.map((r) => (
        <div key={r.no} className="flex">
          {r.depth > 0 && (
            <div className="relative flex-shrink-0" style={{ width: r.depth * STEP }}>
              {/* 上の段から続く縦線 */}
              {r.rails.map((on, i) =>
                on ? (
                  <span key={i} className="absolute top-0 bottom-0" style={{ left: i * STEP + STEP / 2, borderLeft: `1px solid ${LINE}` }} />
                ) : null,
              )}
              {/* まだ兄弟がいれば、縦線を下まで伸ばす(├) */}
              {!r.last && (
                <span
                  className="absolute top-0 bottom-0"
                  style={{ left: (r.depth - 1) * STEP + STEP / 2, borderLeft: `1px solid ${LINE}` }}
                />
              )}
              {/* 親からの線を、角を丸めて横に曲げる(└) */}
              <span
                className="absolute top-0"
                style={{
                  left: (r.depth - 1) * STEP + STEP / 2,
                  width: STEP / 2,
                  height: ELBOW_Y + 1,
                  borderLeft: `1px solid ${LINE}`,
                  borderBottom: `1px solid ${LINE}`,
                  borderBottomLeftRadius: RADIUS,
                }}
              />
            </div>
          )}
          <div
            className="relative flex-1 min-w-0 rounded-[var(--card-radius)]"
            style={r.no === props.focus ? { background: 'var(--c-accent-wash)' } : undefined}
          >
            {/* 押したレスの目印。枠の角丸に沿って曲がらないよう、独立したまっすぐな線にする */}
            {r.no === props.focus && <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-c-accent" />}
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
