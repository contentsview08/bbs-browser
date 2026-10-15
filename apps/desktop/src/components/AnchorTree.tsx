// アンカーツリーの表示。どのレスがどのレスに付いているかを、ファイルのツリーのような線(├ └ │)でつなぐ。
// 行の高さはレスごとに違うので、線は各行の高さいっぱいに伸ばし、分岐はレスの頭の高さで横に出す。

import type { ReactNode } from 'react'
import type { TreeRow } from '../utils/postBody'

/** 1 段の幅 */
const STEP = 18
/** 分岐の横線を出す高さ(レスのヘッダーの真ん中あたり) */
const ELBOW_Y = 14

const LINE = 'var(--c-border-strong)'

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
              {/* 親からの線: 最後の子なら途中まで(└)、まだ兄弟がいれば下まで(├) */}
              <span
                className="absolute top-0"
                style={{
                  left: (r.depth - 1) * STEP + STEP / 2,
                  height: r.last ? ELBOW_Y : '100%',
                  borderLeft: `1px solid ${LINE}`,
                }}
              />
              <span
                className="absolute"
                style={{ left: (r.depth - 1) * STEP + STEP / 2, top: ELBOW_Y, width: STEP / 2, borderTop: `1px solid ${LINE}` }}
              />
            </div>
          )}
          <div
            className="flex-1 min-w-0 rounded-[var(--card-radius)]"
            style={r.no === props.focus ? { background: 'var(--c-accent-wash)', boxShadow: 'inset 2px 0 0 var(--c-accent)' } : undefined}
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
