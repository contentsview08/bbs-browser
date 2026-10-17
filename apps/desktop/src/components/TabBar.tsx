// スレのタブ。× か中クリックで閉じ、右クリックでまとめて閉じるメニューを出す。
// 幅は Chrome と同じ考え方: すべて同じ幅にし、× で閉じたあとはマウスがタブ列にある間だけ幅を固定する
// (右のタブが 1 つぶん詰まって、次のタブの × がマウスの下に来るので、× を続けて押せる)。
// Ctrl+クリックで選択に足し外し、Shift+クリックで範囲を選ぶ。つかんで左右に動かすと並べ替える。

import { useEffect, useRef, useState } from 'react'
import BoardIcon from './BoardIcon'

export interface TabItem {
  id: string
  title: string
  /** 未読のレス数 */
  unread: number
  loading: boolean
  /** 終わったスレ。archived: dat 落ち / full: 1000 まで行って書き込めない */
  ended?: 'archived' | 'full'
  boardUrl: string
  /** ファビコンの上書き(板の設定) */
  icon?: string
}

/** 終わったスレの印 */
const ENDED = {
  archived: { mark: '落', name: 'dat 落ちしたスレ(もう書き込めません)', color: 'var(--c-heat-very-hot)' },
  full: { mark: '満', name: '1000 まで埋まったスレ(もう書き込めません)', color: 'var(--c-heat-hot)' },
} as const

interface Props {
  tabs: TabItem[]
  activeId?: string
  onSelect: (id: string) => void
  onClose: (ids: string[]) => void
  onRefreshAll: () => void
  refreshingAll: boolean
  onDeleteLogs: (ids: string[]) => void
  /** Ctrl/Shift+クリックで選んだタブ(開いているタブは含めない) */
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  /** つかんで動かしたタブを、index の位置へ移す */
  onReorder: (id: string, index: number) => void
}

/** これだけ動かしたらドラッグとみなす */
const DRAG_PX = 4

const MAX_WIDTH = 220
const MIN_WIDTH = 72

export default function TabBar(props: Props) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>()
  const menuRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [stripWidth, setStripWidth] = useState(0)
  /** × で閉じている間の固定幅。マウスがタブ列から出たら undefined に戻して整え直す */
  const [frozenWidth, setFrozenWidth] = useState<number>()
  const hasTabs = props.tabs.length > 0
  /** Shift+クリックの起点(最後に押したタブ) */
  const anchorRef = useRef<string>(undefined)
  /** つかんで動かしているタブ。dx は動かした量、over は落とす位置 */
  const [drag, setDrag] = useState<{ id: string; from: number; dx: number; over: number }>()
  /** ドラッグを終えた直後のクリックは無視する */
  const justDragged = useRef(false)

  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setStripWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasTabs])

  const fitWidth =
    stripWidth > 0 ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(stripWidth / props.tabs.length))) : MAX_WIDTH
  const tabWidth = frozenWidth ?? fitWidth

  /** マウスで閉じるときは、いまの幅のまま固定する */
  const closeByPointer = (id: string) => {
    setFrozenWidth(tabWidth)
    props.onClose([id])
  }

  /** タブを押したとき: Ctrl は選択に足し外し、Shift は範囲、ふつうは選択を解いて開く */
  const onTabClick = (e: React.MouseEvent, id: string) => {
    if (justDragged.current) {
      justDragged.current = false
      return
    }
    const ids = props.tabs.map((t) => t.id)
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(props.selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      anchorRef.current = id
      props.onSelectionChange(next)
      return
    }
    if (e.shiftKey) {
      const from = ids.indexOf(anchorRef.current ?? props.activeId ?? id)
      const to = ids.indexOf(id)
      const [a, b] = from < 0 ? [to, to] : [Math.min(from, to), Math.max(from, to)]
      props.onSelectionChange(new Set(ids.slice(a, b + 1)))
      return
    }
    anchorRef.current = id
    props.onSelectionChange(new Set())
    props.onSelect(id)
  }

  /** つかんで動かす。同じ幅のタブなので、何個ぶん動いたかは幅で割って決める */
  const onTabMouseDown = (e: React.MouseEvent, id: string, index: number) => {
    if (e.button !== 0) return
    const startX = e.clientX
    let moved = false
    let latest = { id, from: index, dx: 0, over: index }
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      if (!moved && Math.abs(dx) < DRAG_PX) return
      moved = true
      const over = Math.max(0, Math.min(props.tabs.length - 1, index + Math.round(dx / tabWidth)))
      latest = { id, from: index, dx, over }
      setDrag(latest)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDrag(undefined)
      if (!moved) return
      justDragged.current = true
      if (latest.over !== latest.from) props.onReorder(id, latest.over)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /** ドラッグ中に、ほかのタブをどれだけずらすか(つかんだタブの行き先を空ける) */
  const shiftOf = (i: number): number => {
    if (!drag) return 0
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -tabWidth
    if (drag.from > drag.over && i >= drag.over && i < drag.from) return tabWidth
    return 0
  }

  // 選んだタブが見えるように横にスクロールする
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [props.activeId])

  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(undefined)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  if (props.tabs.length === 0) return null

  const ids = props.tabs.map((t) => t.id)
  // 右クリックしたタブが選択の中にあれば、選んだタブ(と開いているタブ)にまとめて効かせる
  const group =
    menu && props.selectedIds.has(menu.id)
      ? ids.filter((id) => props.selectedIds.has(id) || id === props.activeId)
      : undefined
  const menuItems = menu
    ? group && group.length > 1
      ? [
          { label: `選んだ ${group.length} 個のタブを閉じる (Ctrl+W)`, ids: group },
          { label: `選んだ ${group.length} 個のタブのログを削除 (Shift+Delete)`, ids: group, deleteLog: true },
          { label: 'すべて閉じる', ids },
        ]
      : [
          { label: '閉じる', ids: [menu.id] },
          { label: '他のタブを閉じる', ids: ids.filter((id) => id !== menu.id) },
          { label: '右側のタブを閉じる', ids: ids.slice(ids.indexOf(menu.id) + 1) },
          { label: 'すべて閉じる', ids },
          { label: 'ログを削除して閉じる (Shift+Delete)', ids: [menu.id], deleteLog: true },
        ]
    : []

  return (
    <div className="flex-shrink-0 flex items-end pt-1.5 bg-panel-tabbar">
      <div
        ref={stripRef}
        className="flex-1 min-w-0 flex items-end overflow-x-auto no-scrollbar px-2"
        onMouseLeave={() => setFrozenWidth(undefined)}
      >
        {props.tabs.map((t, i) => {
          const active = t.id === props.activeId
          // 区切り線は、自分と右隣のどちらも開いていないときだけ出す(Chrome と同じ)
          const next = props.tabs[i + 1]
          const separator = !active && next !== undefined && next.id !== props.activeId
          const selected = !active && props.selectedIds.has(t.id)
          const dragging = drag?.id === t.id
          return (
            <div
              key={t.id}
              ref={active ? activeRef : undefined}
              onClick={(e) => onTabClick(e, t.id)}
              onMouseDown={(e) => onTabMouseDown(e, t.id, i)}
              onAuxClick={(e) => {
                if (e.button === 1) closeByPointer(t.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ id: t.id, x: e.clientX, y: e.clientY })
              }}
              title={t.ended ? `${t.title}(${ENDED[t.ended].name})` : t.title}
              style={{
                width: tabWidth,
                background: active
                  ? 'var(--tab-active-fill)'
                  : selected
                    ? 'color-mix(in srgb, var(--tab-active-fill) 70%, transparent)'
                    : undefined,
                // つかんだタブはマウスについて動かし、ほかのタブはなめらかにずらして場所を空ける
                transform: `translateX(${dragging ? drag.dx : shiftOf(i)}px)`,
                transition: dragging ? 'none' : 'transform 150ms ease-out, background-color 150ms',
              }}
              className={`group relative flex-shrink-0 h-8 flex items-center gap-1.5 pl-3 pr-1.5 rounded-t-lg cursor-pointer select-none text-xs ${
                active || selected ? 'text-c-text-strong' : 'text-c-text-muted hover:text-c-text-body hover:bg-[color-mix(in_srgb,var(--tab-active-fill)_50%,transparent)]'
              } ${active ? 'z-10' : ''} ${dragging ? 'z-30 shadow-lg' : ''}`}
            >
              {/* 開いているタブは、上の端に強調色の線を引く(暗い配色では、開いているタブと、ほかのタブの面の色の差が小さいため)。
                  終わったスレ(dat 落ち・満)は、ファビコンの場所の「落」「満」の印と薄い字だけで示す(下の線は、開いているタブの印と見間違えるのでやめた) */}
              {active && (
                <>
                  <span className="absolute left-2 right-2 top-0 h-[2px] rounded-b-full bg-c-accent pointer-events-none" />
                  {/* タブの下の両端の、スレ表示へ流れ込む内側の曲線 */}
                  <span
                    className="absolute bottom-0 -left-2 w-2 h-2 pointer-events-none"
                    style={{ background: 'radial-gradient(circle at 0 0, transparent 8px, var(--tab-active-fill) 8.5px)' }}
                  />
                  <span
                    className="absolute bottom-0 -right-2 w-2 h-2 pointer-events-none"
                    style={{ background: 'radial-gradient(circle at 100% 0, transparent 8px, var(--tab-active-fill) 8.5px)' }}
                  />
                </>
              )}
              {separator && (
                <span
                  className="absolute right-0 top-2 bottom-2 w-px pointer-events-none"
                  style={{ background: 'color-mix(in srgb, var(--c-text-muted) 45%, transparent)' }}
                />
              )}
              {t.loading ? (
                <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              ) : t.ended ? (
                // ファビコンの場所に「落」「満」の印を出し、ひと目で分かるようにする
                <span
                  className="flex-shrink-0 w-[14px] h-[14px] rounded-sm flex items-center justify-center text-[10px] font-bold leading-none text-white"
                  style={{ background: ENDED[t.ended].color }}
                  title={ENDED[t.ended].name}
                >
                  {ENDED[t.ended].mark}
                </span>
              ) : (
                <BoardIcon boardUrl={t.boardUrl} override={t.icon} size={14} />
              )}
              <span className={`flex-1 min-w-0 truncate ${t.ended ? 'opacity-60' : ''}`}>{t.title || '(読み込み中)'}</span>
              {t.unread > 0 && (
                <span
                  className="flex-shrink-0 font-bold text-[9px] px-1 rounded"
                  style={{ background: 'var(--c-unread)', color: 'var(--c-unread-text)' }}
                >
                  +{t.unread}
                </span>
              )}
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  closeByPointer(t.id)
                }}
                className={`flex-shrink-0 p-0.5 rounded-full hover:bg-c-surface3 ${active ? '' : 'opacity-0 group-hover:opacity-100'}`}
                title="閉じる (Ctrl+W)"
              >
                <span className="material-symbols-outlined text-sm leading-none">close</span>
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={props.onRefreshAll}
        disabled={props.refreshingAll}
        className="flex-shrink-0 h-8 px-2.5 mr-1 rounded-t-lg text-c-text-muted hover:text-c-text-strong"
        title="すべてのタブを更新"
      >
        <span className={`material-symbols-outlined text-lg ${props.refreshingAll ? 'animate-spin' : ''}`}>sync</span>
      </button>

      {menu && (
        <div
          ref={menuRef}
          className="fixed z-[9600] w-48 bg-c-surface border border-c-border rounded-[var(--card-radius)] shadow-xl py-1 text-sm"
          style={{ left: menu.x, top: menu.y }}
        >
          {menuItems.map((m) => (
            <button
              key={m.label}
              type="button"
              disabled={m.ids.length === 0}
              onClick={() => {
                if ('deleteLog' in m) props.onDeleteLogs(m.ids)
                else props.onClose(m.ids)
                setMenu(undefined)
              }}
              className="w-full text-left px-3 py-1.5 text-c-text-body hover:bg-c-surface2 disabled:opacity-40"
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
