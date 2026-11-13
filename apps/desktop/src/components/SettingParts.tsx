// 設定画面の共通の部品(スマホのアプリの ui/SettingParts.kt と同じ形・同じ言葉)。
// 考え方: 少ない設定はその場で操作し、多いデータは件数だけを出して、専用の管理画面で一覧・検索・まとめて操作する。
// - SamplePosts: 見た目の設定を、見本のレスで見ながら変える(文字の大きさ・行間・レスの見た目などは CSS の変数なので、動かすとすぐ映る)
// - ListEditor: 言葉の一覧(定型文・キーワードなど)。足す・直す・消す・つかんで並べ替え・まとめて編集。多くなったら絞り込み
// - ManagerRow / ManagerDialog: 件数を出す行と、開くと出る管理画面の囲い
import ConfirmDialog from './ConfirmDialog'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Post } from '@bbs-browser/connectors'
import PostArticle, { type PostHandlers } from './PostArticle'
import { DragHandle, DragList } from './DragSort'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropClose, useGuardedClose } from '../hooks/useDialogClose'
import { BTN_PRIMARY, BTN_SECONDARY, DialogHeader, ICON_BTN, INPUT } from './DialogParts'
import { effectivePostStyle, effectiveScheme, isDarkScheme, type AppSettings } from '../ui/settings'
import { normalizeForSearch } from '../utils/postBody'
import { isMobile } from '../utils/platform'
import { SearchInput } from './ClearButton'


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
            showIdenticon={s.idStyle === 'icon'}
            showLinkPreview={false}
            display={{ nonameName: '名無しさん', omitNoname: s.omitNoname, tidyBlankLines: s.tidyBlankLines }}
            isOp={p.id === SAMPLE[0].id}
            handlers={{
              ...SAMPLE_HANDLERS,
              idColor: s.idStyle === 'color' ? { dark: isDarkScheme(effectiveScheme(s)), sky: false } : undefined,
              heatStyle: s.heatStyle,
              dateStyle: s.dateStyle,
              idShort: s.idShort,
              urls: { shorten: s.urlShorten, omitImages: s.urlShorten, collapseImageRuns: s.urlShorten },
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
  const [clearOpen, setClearOpen] = useState(false)
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
        <button type="submit" className={BTN_PRIMARY} disabled={!draft.trim()}>
          追加
        </button>
      </form>
      {message && <p className="text-xs text-c-heat-very-hot mb-2">{message}</p>}
      {items.length > FILTER_FROM && (
        <SearchInput type="search" value={query} onValue={setQuery} placeholder={`${items.length} 件から絞り込む`} wrapClassName="w-full mb-2" className={`${INPUT} w-full`} />
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
          <button type="button" className="hover:text-c-heat-very-hot underline" onClick={() => setClearOpen(true)}>
            すべて消す
          </button>
        )}
      </div>
      {clearOpen && (
        <ConfirmDialog
          title={`${props.noun}をすべて消す`}
          message={`${props.noun}を ${items.length} 件すべて消します。元に戻せません。`}
          okLabel="消す"
          onClose={(ok) => {
            setClearOpen(false)
            if (ok) props.onChange([])
          }}
        />
      )}
      {bulk !== undefined && (
        <ManagerDialog title={`${props.noun}をまとめて編集`} onClose={() => setBulk(undefined)} dirty={bulk !== items.join('\n')}>
          <p className="text-xs text-c-text-muted mb-2">1 行に 1 つ。ほかのアプリから貼り付けたり、ここからコピーして写したりできます(空の行と、同じものは除きます)</p>
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={12} className={`${INPUT} w-full font-mono`} spellCheck={false} />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => setBulk(undefined)}>
              やめる
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
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

/** スイッチだけ(行の中で使う) */
export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      title={props.title}
      onClick={() => props.onChange(!props.checked)}
      className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-all shadow-inner ${props.checked ? 'bg-c-accent' : 'bg-c-border-strong'}`}
    >
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm ${props.checked ? 'right-1' : 'left-1'}`} />
    </button>
  )
}

/** オン・オフの設定(説明は左、スイッチは右) */
export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; note?: string }) {
  // スマホ: 説明を左、スイッチを右に。行の上下を広く取り、指で押しやすくする(行のどこを押しても切り替わる)
  if (isMobile)
    return (
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        onClick={() => props.onChange(!props.checked)}
        className="settings-row w-full flex items-center gap-4 py-3.5 text-left"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] leading-snug text-c-text-strong">{props.label}</span>
          {props.note && <span className="block mt-1 text-[13px] leading-relaxed text-c-text-muted">{props.note}</span>}
        </span>
        <span className={`relative w-12 h-7 rounded-full flex-shrink-0 transition-colors ${props.checked ? 'bg-c-accent' : 'bg-c-border-strong'}`}>
          <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${props.checked ? 'left-6' : 'left-1'}`} />
        </span>
      </button>
    )
  return (
    <label className="flex items-start gap-3 py-1.5 cursor-pointer">
      <span className="mt-0.5">
        <Switch checked={props.checked} onChange={props.onChange} />
      </span>
      <span>
        <span className="text-sm text-c-text-body">{props.label}</span>
        {props.note && <span className="block text-xs text-c-text-muted">{props.note}</span>}
      </span>
    </label>
  )
}

/** 小画面を開く行: 名前と今の値、右に > (背景画像・上げ先の登録など、いくつかの設定をまとめて直す小画面へ) */
export function OpenRow(props: { label: string; value?: string; note?: string; onOpen: () => void }) {
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
      {props.value && <span className="text-sm text-c-text-muted truncate max-w-[40%]">{props.value}</span>}
      <span className="material-symbols-outlined text-lg text-c-text-muted">chevron_right</span>
    </button>
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
export function ManagerDialog(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; dirty?: boolean; closeOnBackdrop?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const { requestClose, guard } = useGuardedClose(!!props.dirty, props.onClose)
  useFocusTrap(boxRef, requestClose, { escBlursInputs: true })
  // 直す画面(dirty を渡すもの)は、外を押しても閉じない(× と Esc だけ)
  const backdrop = useBackdropClose(requestClose, props.closeOnBackdrop ?? props.dirty === undefined)
  return createPortal(
    <div className={`fixed inset-0 z-[9700] bg-black/50 flex ${isMobile ? '' : 'items-center justify-center p-6'}`} {...backdrop}>
      <div
        ref={boxRef}
        className={`flex flex-col bg-c-surface ${isMobile ? 'w-full h-full' : `w-full ${props.wide ? 'max-w-5xl' : 'max-w-2xl'} max-h-full border border-c-border rounded-[var(--card-radius)] shadow-xl rise-in`}`}
        style={isMobile ? { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader title={props.title} onClose={requestClose} />
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-4">{props.children}</div>
        {guard}
      </div>
    </div>,
    document.body,
  )
}

/** 文字の欄の設定を、打ち終えてから書くまで待つ時間 */
const TEXT_COMMIT_MS = 500

/**
 * 文字の欄の設定(保存先・API キーなど)。1 文字打つたびに設定へ書くと、そのたびにアプリ全体の描き直し(別ウィンドウなら知らせ)が走るので、
 * 欄の中はここで持ち、打ち終えて少し経ったとき・欄を抜けたとき・Enter で書く
 */
export function TextSetting(props: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; trim?: boolean; className?: string; type?: 'text' | 'password'; autoComplete?: string }) {
  const [text, setText] = useState(props.value)
  const [last, setLast] = useState(props.value)
  if (last !== props.value) {
    setLast(props.value)
    setText(props.value)
  }
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const commit = (raw: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = undefined
    const v = props.trim ? raw.trim() : raw
    if (v !== props.value) props.onChange(v)
  }
  return (
    <input
      type={props.type ?? 'text'}
      autoComplete={props.autoComplete}
      value={text}
      onChange={(e) => {
        const v = e.target.value
        setText(v)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => commit(v), TEXT_COMMIT_MS)
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit(e.currentTarget.value)
      }}
      placeholder={props.placeholder}
      spellCheck={false}
      className={`${INPUT} ${props.mono ? 'font-mono' : ''} ${props.className ?? ''}`}
    />
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
  /** 0(しない)のほかに選べる最小の値 */
  minNonZero?: number
  max: number
  unit: string
  presets?: number[]
  zeroLabel?: string
  /** 効かないとき(背景画像がないときのパネルの不透明度など)。値は出すが変えられない */
  disabled?: boolean
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
    const clamped = Math.min(props.max, Math.max(props.min, n))
    const v = clamped !== 0 && props.minNonZero !== undefined ? Math.max(props.minNonZero, clamped) : clamped
    setText(String(v))
    if (v !== props.value) props.onChange(v)
  }
  const label = (n: number) => (n === 0 && props.zeroLabel ? props.zeroLabel : `${n} ${props.unit}`)
  return (
    <div className={`flex flex-wrap items-center gap-2 ${props.disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <input
        type="number"
        inputMode="numeric"
        min={props.min}
        max={props.max}
        disabled={props.disabled}
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
