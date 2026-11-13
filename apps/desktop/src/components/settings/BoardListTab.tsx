import { useRef, useEffect, useMemo, useState } from 'react'
import type { Board, SiteConfig } from '@bbs-browser/connectors'
import { ICON_BTN, INPUT } from '../DialogParts'
import { type SettingsProps, Choice } from './common'
import { SearchInput } from '../ClearButton'
import { favoriteKey, favoriteKeys } from '../../utils/favoriteBoards'

export function BoardListTab(props: {
  sites: SiteConfig[]
  initialSite?: string
  favorites: Board[]
  loadBoards: SettingsProps['loadBoards']
  onToggleFavorite: SettingsProps['onToggleFavorite']
  onOpenBoard: SettingsProps['onOpenBoard']
}) {
  const [siteUrl, setSiteUrl] = useState(props.initialSite ?? props.sites[0]?.menuUrl)
  const site = props.sites.find((s) => s.menuUrl === siteUrl)
  const [boards, setBoards] = useState<Board[]>()
  const [query, setQuery] = useState('')
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  // 板一覧と同期で来た行は URL の書き方が違うことがあるので、同じ板の鍵で比べる
  const favorites = useMemo(() => favoriteKeys(props.favorites), [props.favorites])

  // 切り替えたあとに遅れて返った、前の BBS メニューの応答を捨てるための番号
  const loadSeq = useRef(0)
  const load = async (refresh: boolean) => {
    if (!site) return
    const seq = ++loadSeq.current
    setBusy(true)
    setMessage(undefined)
    try {
      const list = await props.loadBoards(site, refresh)
      if (seq === loadSeq.current) setBoards(list)
    } catch (e) {
      if (seq === loadSeq.current) setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      if (seq === loadSeq.current) setBusy(false)
    }
  }
  // BBS メニューを切り替えたら、保存してある板一覧を出す(なければ取りに行く)
  useEffect(() => {
    setBoards(undefined)
    void load(false)
  }, [siteUrl])

  const grouped = useMemo(() => {
    const q = query.trim()
    const map = new Map<string, Board[]>()
    for (const b of boards ?? []) {
      if (q && !b.name.includes(q) && !(b.category ?? '').includes(q)) continue
      const cat = b.category ?? '(未分類)'
      const list = map.get(cat)
      if (list) list.push(b)
      else map.set(cat, [b])
    }
    return [...map]
  }, [boards, query])

  const toggleCat = (cat: string) =>
    setOpenCats((s) => {
      const next = new Set(s)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })

  if (props.sites.length === 0) {
    return <p className="text-sm text-c-text-muted">BBS メニューがありません。設定の「BBS メニュー」で足してください</p>
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Choice
          value={siteUrl ?? ''}
          options={props.sites.map((s) => ({ key: s.menuUrl, name: s.name }))}
          onChange={setSiteUrl}
        />
        <button type="button" className={`${ICON_BTN} ml-auto`} title="板一覧を取り直す" onClick={() => void load(true)}>
          <span className={`material-symbols-outlined text-lg ${busy ? 'animate-spin' : ''}`}>refresh</span>
        </button>
      </div>
      <SearchInput value={query} onValue={setQuery} placeholder="板の名前やカテゴリで絞り込む" wrapClassName="w-full mb-1" className={`${INPUT} w-full`} />
      <p className="text-xs text-c-text-muted mb-2">☆ でお気に入りに登録・解除、板の名前を押すとその板を開きます</p>
      {message && <p className="text-sm text-c-heat-very-hot mb-2">{message}</p>}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar border border-c-border rounded-[var(--card-radius)]">
        {!boards && busy && <p className="px-3 py-2 text-sm text-c-text-muted">読み込み中…</p>}
        {grouped.map(([cat, list]) => {
          const open = query.trim() !== '' || openCats.has(cat)
          return (
            <div key={cat} className="border-b border-c-border last:border-b-0">
              <button
                type="button"
                onClick={() => toggleCat(cat)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm font-bold text-c-text-strong hover:bg-c-surface2"
              >
                <span
                  className="material-symbols-outlined text-base transition-transform"
                  style={{ transform: open ? 'rotate(90deg)' : undefined }}
                >
                  chevron_right
                </span>
                <span className="flex-1 text-left">{cat}</span>
                <span className="text-xs font-normal text-c-text-muted">{list.length}</span>
              </button>
              {open &&
                list.map((b) => {
                  const fav = favorites.has(favoriteKey(b.url))
                  // ☆ は押した後の状態を渡す(見えている印から決め、見た目と結果をずらさない)。☆ 以外を押すと板を開く
                  return (
                    <div key={b.url} className="flex items-center pl-6 text-sm select-none hover:bg-c-surface2">
                      <button
                        type="button"
                        onClick={() => props.onToggleFavorite(b, !fav)}
                        className={`shrink-0 w-9 h-9 flex items-center justify-center rounded ${fav ? 'text-mark-fav' : 'text-c-text-muted hover:text-mark-fav'}`}
                        title={fav ? 'お気に入りから外す' : 'お気に入りに追加'}
                      >
                        <span className={`material-symbols-outlined text-[22px] leading-none ${fav ? 'fill' : ''}`}>star</span>
                      </button>
                      <button type="button" onClick={() => props.onOpenBoard(b)} className="flex-1 min-w-0 self-stretch text-left pl-1 pr-3 truncate text-c-text-body" title="開く">
                        {b.name}
                      </button>
                    </div>
                  )
                })}
            </div>
          )
        })}
        {boards && grouped.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">見つかりません</p>}
      </div>
    </div>
  )
}
