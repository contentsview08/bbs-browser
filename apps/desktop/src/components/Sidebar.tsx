// 左端のサイドバー: お気に入り板(開閉・並べ替えできる)、その下に閲覧履歴(開閉できる)、一番下に設定。
// しまっているときは、0.5 秒マウスを乗せると一時的に開き、離れると閉じる。
// 見た目は web 版の MenuBar.tsx に合わせている。
// しまったときも開いたときも、アイコン(板のファビコンも)は左の列(64px から右端の線 1px を除いた 63px)の真ん中に置き、名前はその右に足すだけにする。
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
  /** お気に入りのスレの一覧をスレ一覧に出しているか、新着の合計、開く */
  favThreadsActive: boolean
  favThreadsNew: number
  onOpenFavThreads: () => void
  /** 直近の閲覧履歴(10 件ほど) */
  recentHistory: ThreadSummary[]
  onOpenThread: (t: ThreadSummary) => void
  onDeleteHistory: (t: ThreadSummary) => void
  onOpenSettings: () => void
  /** 画像のアップロード履歴を開く。アップロードを使っていなければ undefined(行を出さない) */
  onOpenUploads?: () => void
  /** 書き込み履歴を開く */
  onOpenPostHistory: () => void
  /** 設定画面の板一覧を開く(板を足したいとき) */
  onManageBoards: () => void
  collapsed: boolean
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
  /** アイコンの右上に出す数(新着など)。しまっていても見える */
  badge?: number
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.label}
      className={`w-full h-14 flex items-center transition-colors hover:bg-c-surface2 ${
        props.active ? 'text-c-accent' : 'text-c-text-strong'
      }`}
    >
      <span className="w-[63px] flex-shrink-0 flex items-center justify-center">
        <span className="relative">
          <span className={`material-symbols-outlined text-[28px] ${props.filled ? 'fill' : ''}`}>{props.icon}</span>
          {props.badge !== undefined && props.badge > 0 && (
            <span
              className="absolute -top-1 -right-2 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-[18px] text-center"
              style={{ background: 'var(--c-accent-self)', color: 'var(--c-accent-self-text)' }}
            >
              {props.badge > 999 ? '999+' : props.badge}
            </span>
          )}
        </span>
      </span>
      <span className="flex-1 min-w-0 text-left text-lg font-medium truncate">{props.label}</span>
      {props.trailing}
    </button>
  )
}

/**
 * 小さめの行(板を追加・閲覧履歴のスレ・すべて見る)。開いても閉じても同じ高さで、アイコンは左の 64px の列に置く。
 * しまっているときはアイコンだけが見え、開くと名前が右に出る(行の数も高さも変わらないので、下のアイコンがずれない)
 */
function SmallRow(props: {
  icon: ReactNode
  label: string
  title?: string
  muted?: boolean
  onClick: () => void
  trailing?: ReactNode
}) {
  return (
    <div className="group flex items-center h-9 pr-2 hover:bg-c-surface2 transition-colors">
      <button type="button" onClick={props.onClick} className="flex-1 min-w-0 h-full flex items-center text-left" title={props.title ?? props.label}>
        <span className="w-[63px] flex-shrink-0 flex items-center justify-center">{props.icon}</span>
        <span className={`flex-1 min-w-0 text-sm truncate ${props.muted ? 'text-c-text-muted group-hover:text-c-accent' : 'text-c-text-body'}`}>
          {props.label}
        </span>
      </button>
      {props.trailing}
    </div>
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
  // 板名を出す設定なら、アイコンの下に名前が入るぶん行を高くする。
  // 開いたときも高さを変えない(変えるとファビコンの縦の位置がずれる)。小さな板名は、開いたら薄く消すだけ
  const stripNames = collapsed && props.showStripNames
  const rowH = props.showStripNames ? 56 : 42
  /** ファビコンの大きさ。開閉で変えない */
  const ICON = 24

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
                const active = b.url === props.activeBoardUrl && !props.historyActive && !props.favThreadsActive
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
                      dragging ? 'z-10 bg-c-surface2 shadow-lg' : ''
                    }`}
                  >
                    {/* 選んでいる板の印。中身を押さないよう、重ねて描く(ファビコンが右へずれないように) */}
                    {active && (
                      <span
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          background: 'color-mix(in srgb, var(--c-accent) 10%, transparent)',
                          boxShadow: 'inset 4px 0 0 var(--c-accent)',
                        }}
                      />
                    )}
                    {/* ファビコンは、しまったときのアイコンと同じ列に置く */}
                    <span className="w-[63px] flex-shrink-0 flex flex-col items-center justify-center gap-0.5 overflow-hidden">
                      <BoardIcon boardUrl={b.url} override={props.boardMeta[b.url]?.icon} size={ICON} />
                      {/* 板名は列の真ん中に置き、入りきらなければ末尾を「…」で略す。
                          幅いっぱいの箱で中央寄せにすると、長い名前は左右両側へはみ出して切れるので、
                          文字の幅に縮む箱を列の幅までに抑えて真ん中に置く */}
                      {props.showStripNames && (
                        <span
                          className={`w-full px-1 flex justify-center transition-opacity duration-200 ${
                            stripNames ? 'opacity-100' : 'opacity-0'
                          }`}
                        >
                          <span className="max-w-full truncate text-[9px] leading-tight text-c-text-muted">{nameOf(b)}</span>
                        </span>
                      )}
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
              <SmallRow
                icon={<span className="material-symbols-outlined text-xl text-c-text-muted group-hover:text-c-accent">add</span>}
                label="板を追加"
                muted
                onClick={props.onManageBoards}
              />
            </div>
          )}
          <Row
            icon="bookmark"
            label="お気に入りのスレ"
            active={props.favThreadsActive}
            filled={props.favThreadsActive}
            badge={props.favThreadsNew}
            onClick={props.onOpenFavThreads}
          />
          <Row
            icon="schedule"
            label="閲覧履歴"
            active={props.historyActive}
            filled={props.historyActive || historyOpen}
            onClick={() => setHistoryOpen((v) => !v)}
            trailing={<Chevron open={historyOpen} />}
          />
          {historyOpen && (
            <div className="menu-reveal pb-1">
              {props.recentHistory.map((t) => (
                <SmallRow
                  key={`${t.boardUrl}${t.key}`}
                  // しまっているときは、スレの板のファビコンが並ぶ
                  icon={<BoardIcon boardUrl={t.boardUrl} override={props.boardMeta[t.boardUrl]?.icon} size={20} />}
                  label={t.title}
                  onClick={() => props.onOpenThread(t)}
                  trailing={
                    !collapsed && (
                      <button
                        type="button"
                        onClick={() => props.onDeleteHistory(t)}
                        className="p-0.5 flex-shrink-0 text-c-text-muted opacity-0 group-hover:opacity-100 hover:text-c-heat-very-hot"
                        title="この閲覧履歴(ログ)を削除"
                      >
                        <span className="material-symbols-outlined text-base leading-none">delete</span>
                      </button>
                    )
                  }
                />
              ))}
              <SmallRow
                icon={<span className="material-symbols-outlined text-xl text-c-text-muted group-hover:text-c-accent">list</span>}
                label={props.recentHistory.length === 0 ? '閲覧履歴はありません(一覧を開く)' : 'すべて見る'}
                muted
                onClick={props.onOpenHistory}
              />
            </div>
          )}
          <Row icon="edit_note" label="書き込み履歴" onClick={props.onOpenPostHistory} />
          {props.onOpenUploads && <Row icon="photo_library" label="アップロード履歴" onClick={props.onOpenUploads} />}
        </nav>

        <div className="py-1 border-t border-c-border">
          <Row icon="settings" label="設定" onClick={props.onOpenSettings} />
        </div>
      </div>
    </aside>
    </div>
  )
}
