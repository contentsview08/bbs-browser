// 左端のサイドバー: お気に入り板(開閉・並べ替えできる)、その下に閲覧履歴(開閉できる)、一番下に設定。
// しまっているときは、0.5 秒マウスを乗せると一時的に開き、離れると閉じる。
// 見た目は web 版の MenuBar.tsx に合わせている。
// しまったときも開いたときも、アイコン(板のファビコンも)は左の 64px の列の同じ位置に置き、名前はその右に足すだけにする。
// 外枠の幅だけを動かして開閉するので、アイコンはそのままで、名前が右から現れるように見える。

import { useRef, useState, type ReactNode } from 'react'
import type { Board, ThreadSummary } from '@bbs-browser/connectors'
import BoardIcon from './BoardIcon'
import type { BoardMeta } from '../ui/settings'

interface Props {
  favorites: Board[]
  activeBoardUrl?: string
  onOpenBoard: (b: Board) => void
  onToggleFavorite: (b: Board) => void
  /** お気に入り板を、渡した URL の並びにする */
  onReorderFavorites: (urls: string[]) => void
  historyActive: boolean
  /** 閲覧履歴の一覧(スレ一覧のところ)を開く */
  onOpenHistory: () => void
  /** 直近の閲覧履歴(10 件ほど) */
  recentHistory: ThreadSummary[]
  onOpenThread: (t: ThreadSummary) => void
  onDeleteHistory: (t: ThreadSummary) => void
  onOpenSettings: () => void
  /** 設定画面の板一覧を開く(板を足したいとき) */
  onManageBoards: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 板ごとの別名・ファビコン */
  boardMeta: Record<string, BoardMeta>
  /** しまったときに、板のアイコンの下に板名を小さく出す */
  showStripNames: boolean
}

const COLLAPSED = 64
const EXPANDED = 256
/** これだけ動かしたらドラッグとみなす */
const DRAG_PX = 4

/** アイコン(左の列)と名前(右)の 1 行 */
function Row(props: {
  icon: string
  label: string
  active?: boolean
  filled?: boolean
  onClick: () => void
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.label}
      className={`w-full h-12 flex items-center transition-colors hover:bg-c-surface2 ${
        props.active ? 'text-c-accent' : 'text-c-text-strong'
      }`}
    >
      <span className="w-16 flex-shrink-0 flex items-center justify-center">
        <span className={`material-symbols-outlined text-2xl ${props.filled ? 'fill' : ''}`}>{props.icon}</span>
      </span>
      <span className="flex-1 min-w-0 text-left text-lg font-medium truncate">{props.label}</span>
      {props.trailing}
    </button>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      className="material-symbols-outlined text-base mr-3 transition-transform text-c-text-muted"
      style={{ transform: open ? 'rotate(180deg)' : undefined }}
    >
      expand_more
    </span>
  )
}

/** しまっているときに、これだけマウスを乗せたら一時的に開く */
const PEEK_DELAY_MS = 500

export default function Sidebar(props: Props) {
  const [favoritesOpen, setFavoritesOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  // しまっているときに、マウスを乗せて一時的に開いているか。開いている間は画面の上に重ねる(ほかを押しのけない)
  const [peek, setPeek] = useState(false)
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const collapsed = props.collapsed && !peek
  const nameOf = (b: Board) => props.boardMeta[b.url]?.alias || b.name
  // しまったときに板名を出すなら、アイコンの下に名前が入るぶん行を高くする
  const stripNames = collapsed && props.showStripNames
  const rowH = stripNames ? 52 : 36

  // ── お気に入り板の並べ替え(つかんで上下に動かす) ──
  const [drag, setDrag] = useState<{ url: string; from: number; dy: number; over: number }>()
  const justDragged = useRef(false)
  const onRowMouseDown = (e: React.MouseEvent, url: string, index: number) => {
    if (e.button !== 0) return
    const startY = e.clientY
    let moved = false
    let latest = { url, from: index, dy: 0, over: index }
    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY
      if (!moved && Math.abs(dy) < DRAG_PX) return
      moved = true
      const over = Math.max(0, Math.min(props.favorites.length - 1, index + Math.round(dy / rowH)))
      latest = { url, from: index, dy, over }
      setDrag(latest)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDrag(undefined)
      if (!moved) return
      justDragged.current = true
      if (latest.over === latest.from) return
      const urls = props.favorites.map((f) => f.url)
      urls.splice(latest.from, 1)
      urls.splice(latest.over, 0, url)
      props.onReorderFavorites(urls)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  /** ドラッグ中に、ほかの行をどれだけずらすか(つかんだ行の行き先を空ける) */
  const shiftOf = (i: number): number => {
    if (!drag) return 0
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -rowH
    if (drag.from > drag.over && i >= drag.over && i < drag.from) return rowH
    return 0
  }

  return (
    // 外枠は、しまっているあいだ帯の幅のまま。一時的に開いた中身は、その上に重ねて広げる
    <div className="relative flex-shrink-0 transition-[width] duration-200 ease-out" style={{ width: props.collapsed ? COLLAPSED : EXPANDED }}>
    <aside
      className={`absolute inset-y-0 left-0 overflow-hidden bg-panel-sidebar transition-[width] duration-200 ease-out ${
        peek ? 'z-40 shadow-2xl' : ''
      }`}
      style={{ width: collapsed ? COLLAPSED : EXPANDED }}
      onMouseEnter={() => {
        if (!props.collapsed) return
        clearTimeout(peekTimer.current)
        peekTimer.current = setTimeout(() => setPeek(true), PEEK_DELAY_MS)
      }}
      onMouseLeave={() => {
        clearTimeout(peekTimer.current)
        setPeek(false)
      }}
    >
      <span className="absolute right-0 top-0 bottom-0 w-px bg-c-border pointer-events-none" />
      <div className="h-full flex flex-col" style={{ width: EXPANDED }}>
        {/* 一番上の行。アドレスバーと同じ高さで、つかむとウィンドウを動かせる */}
        <div data-tauri-drag-region className="h-10 flex-shrink-0 flex items-center select-none">
          <span data-tauri-drag-region className="w-16 flex-shrink-0 flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                // 一時的に開いているときに押したら、開いたままにする
                setPeek(false)
                props.onToggleCollapsed()
              }}
              className="p-1.5 text-c-text-muted hover:text-c-text-strong rounded-lg"
              title={collapsed ? 'サイドバーを広げる' : 'サイドバーをしまう'}
            >
              <span className="material-symbols-outlined text-xl">{collapsed ? 'left_panel_open' : 'left_panel_close'}</span>
            </button>
          </span>
          <span data-tauri-drag-region className="text-base font-bold text-c-text-strong">
            bbs-browser
          </span>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar">
          <Row
            icon="star"
            label="お気に入り板"
            filled={favoritesOpen}
            onClick={() => setFavoritesOpen((v) => !v)}
            trailing={<Chevron open={favoritesOpen} />}
          />
          {favoritesOpen && (
            <div className="menu-reveal pb-1">
              {props.favorites.map((b, i) => {
                const active = b.url === props.activeBoardUrl && !props.historyActive
                const dragging = drag?.url === b.url
                return (
                  <div
                    key={b.url}
                    onMouseDown={(e) => onRowMouseDown(e, b.url, i)}
                    onClick={() => {
                      if (justDragged.current) {
                        justDragged.current = false
                        return
                      }
                      props.onOpenBoard(b)
                    }}
                    title={nameOf(b)}
                    style={{
                      height: rowH,
                      transform: `translateY(${dragging ? drag.dy : shiftOf(i)}px)`,
                      transition: dragging ? 'none' : 'transform 150ms ease-out',
                    }}
                    className={`group relative flex items-center cursor-pointer select-none transition-colors hover:bg-c-surface2 ${
                      active ? 'active-board' : ''
                    } ${dragging ? 'z-10 bg-c-surface2 shadow-lg' : ''}`}
                  >
                    {/* ファビコンは、しまったときのアイコンと同じ列に置く */}
                    <span className="w-16 flex-shrink-0 flex flex-col items-center justify-center gap-0.5 overflow-hidden">
                      <BoardIcon boardUrl={b.url} override={props.boardMeta[b.url]?.icon} size={stripNames ? 20 : 18} />
                      {stripNames && <span className="w-14 text-center text-[9px] leading-tight text-c-text-muted truncate">{nameOf(b)}</span>}
                    </span>
                    <span className={`flex-1 min-w-0 text-[1.0625rem] truncate ${active ? 'text-c-text-strong' : 'text-c-text-body'}`}>
                      {nameOf(b)}
                    </span>
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onToggleFavorite(b)
                      }}
                      className="mr-2 p-0.5 flex-shrink-0 text-c-text-muted opacity-0 group-hover:opacity-100 hover:text-c-text-strong"
                      title="お気に入りから外す"
                    >
                      <span className="material-symbols-outlined text-base leading-none">close</span>
                    </button>
                  </div>
                )
              })}
              {!collapsed && (
                <button
                  type="button"
                  onClick={props.onManageBoards}
                  className="w-full flex items-center gap-1.5 pl-16 pr-2 py-1.5 text-sm text-c-text-muted hover:text-c-accent transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  板を追加
                </button>
              )}
            </div>
          )}
          <Row
            icon="schedule"
            label="閲覧履歴"
            active={props.historyActive}
            filled={props.historyActive || historyOpen}
            // しまっているときは、履歴の一覧(スレ一覧のところ)を開く
            onClick={() => (collapsed ? props.onOpenHistory() : setHistoryOpen((v) => !v))}
            trailing={<Chevron open={historyOpen} />}
          />
          {historyOpen && !collapsed && (
            <div className="menu-reveal max-h-[40vh] overflow-y-auto custom-scrollbar pb-1">
              {props.recentHistory.length === 0 && <p className="pl-16 pr-2 py-1.5 text-sm text-c-text-muted">閲覧履歴はありません</p>}
              {props.recentHistory.map((t) => (
                <div key={`${t.boardUrl}${t.key}`} className="group flex items-center pl-4 pr-2 hover:bg-c-surface2 transition-colors">
                  <button
                    type="button"
                    onClick={() => props.onOpenThread(t)}
                    className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left"
                    title={t.title}
                  >
                    <BoardIcon boardUrl={t.boardUrl} override={props.boardMeta[t.boardUrl]?.icon} size={14} />
                    <span className="flex-1 min-w-0 text-sm text-c-text-body truncate">{t.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onDeleteHistory(t)}
                    className="p-0.5 flex-shrink-0 text-c-text-muted opacity-0 group-hover:opacity-100 hover:text-c-heat-very-hot"
                    title="この閲覧履歴(ログ)を削除"
                  >
                    <span className="material-symbols-outlined text-base leading-none">delete</span>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={props.onOpenHistory}
                className="w-full flex items-center gap-1.5 pl-16 pr-2 py-1.5 text-sm text-c-text-muted hover:text-c-accent transition-colors"
              >
                <span className="material-symbols-outlined text-sm">list</span>
                すべて見る
              </button>
            </div>
          )}
        </nav>

        <div className="py-1 border-t border-c-border">
          <Row icon="settings" label="設定" onClick={props.onOpenSettings} />
        </div>
      </div>
    </aside>
    </div>
  )
}
