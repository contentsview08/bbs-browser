// 設定の「お気に入り板」と「BBS メニュー」。

import { useState } from 'react'
import type { BoardMeta } from '../../ui/settings'
import { DragHandle, DragList } from '../DragSort'
import { BTN_PRIMARY, ICON_BTN, INPUT } from '../DialogParts'
import BoardIcon from '../BoardIcon'
import { type SettingsProps, Section, withBoardMeta, BoardMetaEditor } from './common'

export function BoardsTab(
  props: Pick<
    SettingsProps,
    'favorites' | 'sites' | 'onAddFavoriteUrl' | 'onRemoveFavorite' | 'onReorderFavorites' | 'onAddSite' | 'onRemoveSite' | 'settings' | 'update'
  > & { onShowBoardList: (menuUrl: string) => void; part?: 'favorites' | 'menus' },
) {
  const part = props.part
  const [editing, setEditing] = useState<string>()
  const metaOf = (url: string) => props.settings.boardMeta[url] ?? {}
  const setMeta = (url: string, m: BoardMeta) => props.update('boardMeta', withBoardMeta(props.settings.boardMeta, url, m))
  const [favUrl, setFavUrl] = useState('')
  const [siteName, setSiteName] = useState('')
  const [siteUrl, setSiteUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMessage(undefined)
    try {
      await fn()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {part !== 'menus' && <Section title="お気に入り板" note="サイドバーに並ぶ板です。右のつまみをつかんで並べ替えられます。足すのは「板一覧」で ☆ を押すか、板の URL を貼って">
        <div className="mb-3">
          <DragList
            items={props.favorites.map((b) => b.url)}
            onChange={props.onReorderFavorites}
            render={(url, handle, dragging) => {
              const b = props.favorites.find((f) => f.url === url)!
              return (
                <div className={`rounded-lg border border-c-border ${dragging ? 'bg-c-surface2' : 'bg-c-surface'}`}>
                  <div className="flex items-center gap-3 px-3 py-1.5 text-sm">
                    <BoardIcon boardUrl={b.url} override={metaOf(b.url).icon} />
                    <span className="text-c-text-strong">{metaOf(b.url).alias || b.name}</span>
                    {metaOf(b.url).alias && <span className="text-xs text-c-text-muted">({b.name})</span>}
                    <span className="flex-1 min-w-0 truncate text-xs text-c-text-muted">{b.url}</span>
                    <button
                      type="button"
                      onClick={() => setEditing((e) => (e === b.url ? undefined : b.url))}
                      className={`px-2 py-0.5 text-xs border rounded-[var(--btn-radius)] transition-colors ${
                        editing === b.url ? 'border-c-accent text-c-accent' : 'border-c-border text-c-text-body hover:border-c-accent hover:text-c-accent'
                      }`}
                    >
                      板の設定
                    </button>
                    <button type="button" className={ICON_BTN} title="外す" onClick={() => props.onRemoveFavorite(b.url)}>
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                    <DragHandle handle={handle} />
                  </div>
                  {editing === b.url && <BoardMetaEditor board={b} meta={metaOf(b.url)} onChange={(m) => setMeta(b.url, m)} />}
                </div>
              )
            }}
          />
          {props.favorites.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">まだありません</p>}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!favUrl.trim()) return
            void act(async () => {
              await props.onAddFavoriteUrl(favUrl.trim())
              setFavUrl('')
            })
          }}
        >
          <input
            type="text"
            value={favUrl}
            onChange={(e) => setFavUrl(e.target.value)}
            placeholder="板の URL(例: https://bbs.eddibb.cc/liveedge)"
            className={`${INPUT} flex-1`}
          />
          <button type="submit" className={BTN_PRIMARY} disabled={busy || !favUrl.trim()}>
            追加
          </button>
        </form>
      </Section>}

      {part !== 'favorites' && <Section title="BBS メニュー" note="掲示板の板一覧(bbsmenu.html か bbsmenu.json)です。hono-bbs は web の板の一覧の URL(https://〜/boards)を入れます。「板一覧を見る」から、お気に入りに登録する板を探せます">
        <div className="divide-y divide-c-border border border-c-border rounded-[var(--card-radius)] mb-3">
          {props.sites.map((s) => (
            <div key={s.menuUrl}>
              <div className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="text-c-text-strong">{s.name}</span>
                <span className="flex-1 min-w-0 truncate text-xs text-c-text-muted">{s.menuUrl}</span>
                <button
                  type="button"
                  onClick={() => props.onShowBoardList(s.menuUrl)}
                  className="px-2 py-0.5 text-xs border border-c-border rounded-[var(--btn-radius)] text-c-text-body hover:border-c-accent hover:text-c-accent transition-colors"
                >
                  板一覧を見る
                </button>
                <button type="button" className={ICON_BTN} title="削除" onClick={() => props.onRemoveSite(s.menuUrl)}>
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            </div>
          ))}
          {props.sites.length === 0 && <p className="px-3 py-2 text-sm text-c-text-muted">まだありません</p>}
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!siteUrl.trim()) return
            void act(async () => {
              await props.onAddSite(siteName.trim(), siteUrl.trim())
              setSiteName('')
              setSiteUrl('')
            })
          }}
        >
          <input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="名前(省略可)" className={`${INPUT} w-36`} />
          <input type="text" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="bbsmenu の URL" className={`${INPUT} flex-1 min-w-48`} />
          <button type="submit" className={BTN_PRIMARY} disabled={busy || !siteUrl.trim()}>
            追加
          </button>
        </form>
      </Section>}
      {message && <p className="text-sm text-c-heat-very-hot">{message}</p>}
    </>
  )
}
