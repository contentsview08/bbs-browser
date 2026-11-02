// 設定画面の共通の部品(スマホのアプリの ui/SettingParts.kt と同じ形・同じ言葉)。
// 考え方: 少ない設定はその場で操作し、多いデータは件数だけを出して、専用の管理画面で一覧・検索・まとめて操作する。
// - SamplePosts: 見た目の設定を、見本のレスで見ながら変える(文字の大きさ・行間・レスの見た目などは CSS の変数なので、動かすとすぐ映る)
// - ListEditor: 言葉の一覧(定型文・キーワードなど)。足す・直す・消す・つかんで並べ替え・まとめて編集。多くなったら絞り込み
// - ManagerRow / ManagerDialog: 件数を出す行と、開くと出る管理画面の囲い
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Post } from '@bbs-browser/connectors'
import PostArticle, { type PostHandlers } from './PostArticle'
import { DragHandle, DragList } from './DragSort'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { effectivePostStyle, type AppSettings } from '../ui/settings'
import { normalizeForSearch } from '../utils/postBody'
import { isMobile } from '../utils/platform'

const INPUT =
  'bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted py-1.5 focus:ring-c-accent focus:border-c-accent'
const BTN =
  'px-3 py-1.5 text-sm rounded-[var(--btn-radius)] bg-c-accent text-[var(--c-accent-text)] hover:bg-c-accent-hover transition-colors disabled:opacity-50'
const SUB_BTN = 'px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border border-c-border text-c-text-body hover:border-c-border-strong disabled:opacity-50'
const ICON_BTN = 'p-1 text-c-text-muted hover:text-c-text-strong transition-colors rounded'

/** 見本のレス(どの掲示板にもありそうな形。画像は読みに行かない) */
const SAMPLE: Post[] = [
  { no: 1, name: '名無しさん', mail: '', date: '2026/11/02(月) 19:01:15.32', id: 'Ab3dE9fG0', body: '見本のスレです\n文字の大きさ・行間・レスの見た目は、ここで確かめられます' },
  { no: 2, name: '名無しさん', mail: 'sage', date: '2026/11/02(月) 19:02:40.11', id: 'xY7kLm2Q0', body: '>>1\n乙です\n長めの本文は、行間を変えると読みやすさが変わります。行の高さ・余白・文字の大きさを見ながら決めてください' },
  { no: 3, name: '名無しさん', mail: '', date: '2026/11/02(月) 19:03:05.87', id: 'Ab3dE9fG0', body: '>>2\nありがとう\nhttps://example.com/' },
]

const NOOP = () => {}
const SAMPLE_HANDLERS: PostHandlers = {
  onAnchor: NOOP,
  onUrl: NOOP,
  onReplies: NOOP,
  onId: NOOP,
  onName: NOOP,
  onBody: NOOP,
  onImage: NOOP,
  onAddNg: NOOP,
}

/** 見本のレス。設定の値をそのまま使って描くので、変えたものがすぐ映る(押しても何もしない) */
export function SamplePosts(props: { settings: AppSettings; title?: string; compact?: boolean; onHide?: () => void }) {
  const s = props.settings
  // compact: 2 つ目だけ(設定画面の上に置いたまま、下の設定を見られるように。アンカー・名前・ID・本文の行間が分かる)
  const posts = props.compact ? SAMPLE.slice(1, 2) : SAMPLE
  const variant = effectivePostStyle(s)
  const idCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of SAMPLE) if (p.id) m.set(p.id, (m.get(p.id) ?? 0) + 1)
    return m
  }, [])
  return (
    <div className="mb-4">
      <p className="flex items-center text-xs text-c-text-muted mb-1.5">
        <span className="flex-1">{props.title ?? '見本'}</span>
        {props.onHide && (
          <button type="button" onClick={props.onHide} className="px-1.5 hover:text-c-accent underline">
            見本を隠す
          </button>
        )}
      </p>
      <div
        className="pointer-events-none select-none rounded-[var(--card-radius)] border border-c-border bg-panel-view overflow-hidden flex flex-col"
        style={{ gap: 'var(--list-gap-post)' }}
        aria-hidden
      >
        {posts.map((p, i) => (
          <PostArticle
            key={p.no}
            post={p}
            anchorCount={p.no === 1 ? 1 : p.no === 2 ? 1 : 0}
            idCount={p.id ? (idCounts.get(p.id) ?? 1) : 0}
            showTopDivider={i > 0 && (variant === 'card' || variant === 'matome')}
            variant={variant}
            ng={false}
            ngMode="aborn"
            showThumbnails={false}
            aaAutoDetect={false}
            showIdenticon={s.showIdenticon}
            showLinkPreview={false}
            display={{ nonameName: '名無しさん', omitNoname: s.omitNoname, collapseBlankLines: s.collapseBlankLines, trimTrailingBlank: s.trimTrailingBlank }}
            isOp={p.id === SAMPLE[0].id}
            handlers={{
              ...SAMPLE_HANDLERS,
              idHeat: s.idHeat,
              heatStyle: s.heatStyle,
              dateStyle: s.dateStyle,
              idShort: s.idShort,
              urls: { shorten: s.urlShorten, omitImages: s.imageUrlOmit, collapseImageRuns: s.imageUrlCollapse },
            }}
          />
        ))}
      </div>
    </div>
  )
}

/** サムネイルの大きさの見本(枠だけ。CSS の変数で大きさが決まるので、スライダーを動かすとすぐ映る) */
export function ThumbSample(props: { kind: 'post' | 'list' }) {
  const size = props.kind === 'post' ? 'var(--post-thumb-size)' : 'calc(48px * var(--list-thumb-scale))'
  return (
    <div className="flex items-end gap-2 mb-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="rounded-md bg-c-surface3 border border-c-border flex items-center justify-center text-c-text-muted"
          style={{ width: size, height: size }}
        >
          <span className="material-symbols-outlined text-base">image</span>
        </span>
      ))}
    </div>
  )
}

/** これより多いと、絞り込みの欄を出す */
const FILTER_FROM = 8

/**
 * 言葉の一覧の編集。足す・直す(押すと入力欄になる)・消す・つかんで並べ替え・まとめて編集(1 行に 1 つ)。
 * 同じ言葉は重ねない。onRename は直したとき(ほかの設定がその言葉を覚えているなら、いっしょに直すため)
 */
export function ListEditor(props: {
  items: string[]
  onChange: (items: string[]) => void
  onRename?: (from: string, to: string) => void
  placeholder: string
  /** 並びに意味があるか(並べ替えのつまみを出す) */
  sortable?: boolean
  /** 1 つの言葉の見出し(「定型文」など。まとめて編集の説明に使う) */
  noun: string
  /** 言葉の横に出すもの(定型文の「バーに出す」など) */
  extra?: (item: string) => ReactNode
}) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string>()
  const [editText, setEditText] = useState('')
  const [query, setQuery] = useState('')
  const [bulk, setBulk] = useState<string>()
  const [message, setMessage] = useState<string>()
  const items = props.items
  const q = normalizeForSearch(query.trim())
  const shown = q ? items.filter((x) => normalizeForSearch(x).includes(q)) : items

  const add = () => {
    const v = draft.trim()
    if (!v) return
    if (items.includes(v)) return setMessage(`「${v}」はもうあります`)
    props.onChange([...items, v])
    setDraft('')
    setMessage(undefined)
  }
  const commitEdit = () => {
    const from = editing
    setEditing(undefined)
    if (from === undefined) return
    const to = editText.trim()
    if (!to || to === from) return
    if (items.includes(to)) return setMessage(`「${to}」はもうあります`)
    props.onChange(items.map((x) => (x === from ? to : x)))
    props.onRename?.(from, to)
  }
  const remove = (v: string) => props.onChange(items.filter((x) => x !== v))

  const row = (v: string, handle?: Parameters<typeof DragHandle>[0]['handle'], dragging?: boolean) => (
    <div
      className={`group flex items-center gap-2 px-3 ${isMobile ? 'py-2.5 rounded-xl' : 'py-1.5 rounded-lg'} border border-c-border ${dragging ? 'bg-c-surface2 shadow-lg' : 'bg-c-surface'}`}
    >
      {editing === v ? (
        <input
          autoFocus
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setEditing(undefined)
            }
          }}
          className={`${INPUT} flex-1 min-w-0`}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditing(v)
            setEditText(v)
          }}
          className={`flex-1 min-w-0 truncate text-left ${isMobile ? 'text-[15px]' : 'text-sm'} text-c-text-body`}
          title="押すと直せます"
        >
          {v}
        </button>
      )}
      {props.extra?.(v)}
      <button type="button" className={ICON_BTN} title="消す" onClick={() => remove(v)}>
        <span className="material-symbols-outlined text-base">delete</span>
      </button>
      {handle && <DragHandle handle={handle} />}
    </div>
  )

  return (
    <div>
      <form
        className="flex gap-2 mb-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={props.placeholder} className={`${INPUT} flex-1 min-w-0`} />
        <button type="submit" className={BTN} disabled={!draft.trim()}>
          追加
        </button>
      </form>
      {message && <p className="text-xs text-c-heat-very-hot mb-2">{message}</p>}
      {items.length > FILTER_FROM && (
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`${items.length} 件から絞り込む`} className={`${INPUT} w-full mb-2`} />
      )}
      {items.length === 0 ? (
        <p className="text-sm text-c-text-muted">まだありません</p>
      ) : props.sortable && !q && editing === undefined ? (
        <DragList items={items} onChange={props.onChange} render={(v, handle, dragging) => row(v, handle, dragging)} />
      ) : (
        <div className="flex flex-col gap-1.5">
          {shown.map((v) => (
            <div key={v}>{row(v)}</div>
          ))}
          {shown.length === 0 && <p className="text-sm text-c-text-muted">見つかりません</p>}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 text-xs text-c-text-muted">
        <span>{items.length} 件{props.sortable ? '・右のつまみで並べ替え' : ''}</span>
        <button type="button" className="ml-auto hover:text-c-accent underline" onClick={() => setBulk(items.join('\n'))}>
          まとめて編集
        </button>
        {items.length > 0 && (
          <button type="button" className="hover:text-c-heat-very-hot underline" onClick={() => confirm(`${props.noun}を ${items.length} 件すべて消しますか`) && props.onChange([])}>
            すべて消す
          </button>
        )}
      </div>
      {bulk !== undefined && (
        <ManagerDialog title={`${props.noun}をまとめて編集`} onClose={() => setBulk(undefined)}>
          <p className="text-xs text-c-text-muted mb-2">1 行に 1 つ。ほかのアプリから貼り付けたり、ここからコピーして写したりできます(空の行と、同じものは除きます)</p>
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={12} className={`${INPUT} w-full font-mono`} spellCheck={false} />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className={SUB_BTN} onClick={() => setBulk(undefined)}>
              やめる
            </button>
            <button
              type="button"
              className={BTN}
              onClick={() => {
                props.onChange([...new Set(bulk.split('\n').map((x) => x.trim()).filter(Boolean))])
                setBulk(undefined)
              }}
            >
              これにする
            </button>
          </div>
        </ManagerDialog>
      )}
    </div>
  )
}

/** 多いデータの設定の行: 件数と、管理画面を開くボタン */
export function ManagerRow(props: { label: string; count: number; unit?: string; note?: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className={`w-full flex items-center gap-3 px-3 ${isMobile ? 'py-3.5 rounded-xl' : 'py-2.5 rounded-lg'} border border-c-border bg-c-surface hover:border-c-border-strong text-left`}
    >
      <span className="flex-1 min-w-0">
        <span className={`block ${isMobile ? 'text-[15px]' : 'text-sm'} text-c-text-strong`}>{props.label}</span>
        {props.note && <span className="block text-xs text-c-text-muted mt-0.5">{props.note}</span>}
      </span>
      <span className="tabular-nums text-sm font-bold text-c-accent">
        {props.count} {props.unit ?? '件'}
      </span>
      <span className="material-symbols-outlined text-lg text-c-text-muted">chevron_right</span>
    </button>
  )
}

/** 管理画面の囲い。PC は真ん中の大きな枠、スマホは画面いっぱい。Esc・外を押して閉じる */
export function ManagerDialog(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, props.onClose)
  return createPortal(
    <div className={`fixed inset-0 z-[9700] bg-black/50 flex ${isMobile ? '' : 'items-center justify-center p-6'}`} onClick={props.onClose}>
      <div
        ref={boxRef}
        className={`flex flex-col bg-c-surface ${isMobile ? 'w-full h-full' : `w-full ${props.wide ? 'max-w-5xl' : 'max-w-2xl'} max-h-full border border-c-border rounded-[var(--card-radius)] shadow-2xl rise-in`}`}
        style={isMobile ? { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 flex items-center gap-2 px-5 py-3 border-b border-c-border">
          <h3 className="flex-1 min-w-0 truncate text-base font-bold text-c-text-strong">{props.title}</h3>
          <button type="button" onClick={props.onClose} className={ICON_BTN} title="閉じる">
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-4">{props.children}</div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * 数を入れる欄(日数・件数など)。よく使う値はボタンでも選べる。zeroLabel があれば 0 はその意味(「消さない」など)。
 * 入れている途中は保存せず、欄から離れたとき・Enter で保存する(範囲の外は端に寄せる)
 */
export function NumberField(props: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  unit: string
  presets?: number[]
  zeroLabel?: string
}) {
  const [text, setText] = useState(String(props.value))
  const [last, setLast] = useState(props.value)
  if (last !== props.value) {
    setLast(props.value)
    setText(String(props.value))
  }
  const commit = () => {
    const n = Math.round(Number(text))
    if (!Number.isFinite(n)) return setText(String(props.value))
    const v = Math.min(props.max, Math.max(props.min, n))
    setText(String(v))
    if (v !== props.value) props.onChange(v)
  }
  const label = (n: number) => (n === 0 && props.zeroLabel ? props.zeroLabel : `${n} ${props.unit}`)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        min={props.min}
        max={props.max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={`${INPUT} w-24 text-right tabular-nums`}
      />
      <span className="text-sm text-c-text-body">{props.unit}</span>
      {props.value === 0 && props.zeroLabel && <span className="text-xs text-c-text-muted">({props.zeroLabel})</span>}
      {props.presets && (
        <span className="flex flex-wrap gap-1.5 ml-2">
          {props.presets.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => props.onChange(n)}
              className={`px-2 py-0.5 text-xs rounded-[var(--chip-radius)] border ${props.value === n ? 'border-c-accent text-c-accent' : 'border-c-border text-c-text-muted hover:text-c-text-body'}`}
            >
              {label(n)}
            </button>
          ))}
        </span>
      )}
    </div>
  )
}
