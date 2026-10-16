// 裏の処理(お気に入りのスレの確認・キーワードの見張り)が使うスレ一覧の使い回し。
// 同じ板のスレ一覧を、裏の処理どうしや、手で開いた直後に何度も取りに行かないため。手で開く・更新するときは、いつも取り直す

import { useCallback, useRef } from 'react'
import { findConnector, type Board, type ThreadSummary } from '@bbs-browser/connectors'
import { tauriContext as ctx } from '../host/tauriContext'

/** 少し前に取ったスレ一覧を使い回す長さ */
const REUSE_MS = 60_000

export function useWatchLists() {
  const lists = useRef(new Map<string, { at: number; list: ThreadSummary[] }>())

  /** 取ったスレ一覧を覚える(手で開いたとき・まとめて更新したとき) */
  const remember = useCallback((boardUrl: string, list: ThreadSummary[]) => {
    lists.current.set(boardUrl, { at: Date.now(), list })
  }, [])

  /** 裏の処理用: 少し前に取った一覧があればそれを、なければ取りに行く */
  const listForWatch = useCallback(async (b: Board): Promise<ThreadSummary[]> => {
    const hit = lists.current.get(b.url)
    if (hit && Date.now() - hit.at < REUSE_MS) return hit.list
    const connector = findConnector(b.connectorId)
    if (!connector) throw new Error(`コネクタ ${b.connectorId} がありません`)
    const list = await connector.listThreads(b, ctx)
    lists.current.set(b.url, { at: Date.now(), list })
    return list
  }, [])

  return { remember, listForWatch }
}
