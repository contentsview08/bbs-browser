// 裏の処理(お気に入りのスレの確認・キーワードの見張り)が使うスレ一覧の使い回し。
// 同じ板のスレ一覧を、裏の処理どうしや、手で開いた直後に何度も取りに行かないため。手で開く・更新するときは、いつも取り直す

import { useCallback, useRef } from 'react'
import { findConnector, type Board, type ThreadSummary } from '@bbs-browser/connectors'
import { tauriContext as ctx } from '../host/tauriContext'

/** 少し前に取ったスレ一覧を使い回す長さ */
const REUSE_MS = 60_000

export function useWatchLists() {
  const lists = useRef(new Map<string, { at: number; list: ThreadSummary[] }>())

  /** 使い回せなくなった一覧を手放す(開いた板の数だけ溜まるので) */
  const forgetOld = () => {
    const now = Date.now()
    for (const [url, e] of lists.current) if (now - e.at >= REUSE_MS) lists.current.delete(url)
  }

  /** 取ったスレ一覧を覚える(手で開いたとき・まとめて更新したとき)。at は取りに行く前の時刻 */
  const remember = useCallback((boardUrl: string, list: ThreadSummary[], at: number) => {
    forgetOld()
    lists.current.set(boardUrl, { at, list })
  }, [])

  /** 裏の処理用: 少し前に取った一覧があればそれを、なければ取りに行く。at はその一覧を取りに行く前の時刻(これより後に立ったスレは、一覧にないことがある) */
  const listForWatch = useCallback(async (b: Board): Promise<{ at: number; list: ThreadSummary[] }> => {
    const hit = lists.current.get(b.url)
    if (hit && Date.now() - hit.at < REUSE_MS) return hit
    const connector = findConnector(b.connectorId)
    if (!connector) throw new Error(`コネクタ ${b.connectorId} がありません`)
    const at = Date.now()
    const list = await connector.listThreads(b, ctx)
    const got = { at, list }
    forgetOld()
    lists.current.set(b.url, got)
    return got
  }, [])

  return { remember, listForWatch }
}
