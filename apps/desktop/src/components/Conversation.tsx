// スマホ: アンカーでつながったレスを、「1 つのレスとそのまわり」で見る画面(X で投稿を開いたときと同じ見え方)。
// アンカーツリーを木の形で 1 画面に広げると、段の字下げで本文が狭くなって読みにくいので、代わりにこうする:
// - 上に、たどってきた元のレス(親・その親…)を小さく 1 行ずつ
// - 真ん中に、見ているレスを大きく
// - 下に、そのレスへの返信を並べる
// 元のレス・返信を押すと、そのレスを真ん中にして移る。戻る(ボタン・ジェスチャー・左上の ←)で 1 つ前に戻り、最初のレスで戻ると閉じる
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Post } from '@bbs-browser/connectors'
import { useFocusTrap } from '../hooks/useFocusTrap'

/** 元のレスをたどる深さの上限(アンカーが輪になっていても止まるように) */
const MAX_PARENTS = 30

export default function Conversation(props: {
  /** 見てきたレスの番号(最後が、いま真ん中に出しているレス) */
  stack: number[]
  byNo: Map<number, Post>
  /** そのレスが返信している元のレス(本文の最初のアンカーの先) */
  parentOf: (no: number) => number | undefined
  /** そのレスへの返信 */
  repliesOf: (no: number) => number[]
  /** レスを、スレ表示と同じ見た目で描く(本文を押すと、そのレスへ移る) */
  renderPosts: (nos: number[]) => ReactNode
  /** レスの番号の見せ方(>>12 の 12。掲示板によっては番号ではない) */
  refOf: (no: number) => string | number
  onOpen: (no: number) => void
  /** 戻る(1 つ前へ。最初のレスなら閉じる) */
  onBack: () => void
  onClose: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const focusRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onBack)
  const no = props.stack[props.stack.length - 1]

  // 元のレスを、古い方から並べる
  const parents: number[] = []
  const seen = new Set([no])
  for (let p = props.parentOf(no); p !== undefined && !seen.has(p) && parents.length < MAX_PARENTS; p = props.parentOf(p)) {
    seen.add(p)
    parents.unshift(p)
  }
  const replies = props.repliesOf(no)

  // 移ったら、見ているレスを画面の上に合わせる(元のレスは、上へスクロールすると見える)
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'start' })
  }, [no])

  return createPortal(
    <div
      ref={boxRef}
      className="fixed inset-0 z-[8800] flex flex-col bg-panel-view reply-slide"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex-shrink-0 flex items-center gap-1 px-1 border-b border-c-border bg-panel-thread-header" style={{ height: 'var(--header-height, 56px)' }}>
        <button type="button" onClick={props.onBack} className="p-2.5 rounded-xl text-c-text-muted active:bg-c-surface2" title="戻る">
          <span className="material-symbols-outlined text-2xl">arrow_back</span>
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-c-text-strong truncate">&gt;&gt;{props.refOf(no)} の会話</p>
          <p className="text-[11px] text-c-text-muted">
            元のレス {parents.length} ・ 返信 {replies.length}
          </p>
        </div>
        <button type="button" onClick={props.onClose} className="p-2.5 rounded-xl text-c-text-muted active:bg-c-surface2" title="閉じる">
          <span className="material-symbols-outlined text-2xl">close</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        {/* 元のレス: 1 行ずつ。押すとそのレスへ */}
        {parents.length > 0 && (
          <div className="pt-1">
            {parents.map((p) => {
              const post = props.byNo.get(p)
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => props.onOpen(p)}
                  className="relative w-full flex items-baseline gap-2 pl-6 pr-3 py-1.5 text-left active:bg-c-surface2"
                >
                  {/* 元のレスから見ているレスへ続く線 */}
                  <span aria-hidden className="absolute left-3 top-0 bottom-0 border-l-2 border-c-border-strong" />
                  <span className="flex-shrink-0 text-xs font-bold tabular-nums text-c-text-muted">&gt;&gt;{props.refOf(p)}</span>
                  <span className="flex-shrink-0 max-w-[30%] truncate text-xs text-c-poster-name">{post?.name}</span>
                  <span className="flex-1 min-w-0 truncate text-[13px] text-c-text-body">{post?.body.replace(/\s+/g, ' ')}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* 見ているレス */}
        <div ref={focusRef} className="border-y-2 border-c-accent/40 bg-c-surface" style={{ scrollMarginTop: 0 }}>
          {props.renderPosts([no])}
        </div>

        {/* 返信 */}
        <p className="px-3 pt-3 pb-1 text-xs font-bold text-c-text-muted">{replies.length > 0 ? `返信 ${replies.length} 件` : '返信はありません'}</p>
        {replies.length > 0 && props.renderPosts(replies)}
        {/* 最後の返信も画面の上の方まで送れるように、下に余白 */}
        <div className="h-[40vh]" />
      </div>
    </div>,
    document.body,
  )
}
