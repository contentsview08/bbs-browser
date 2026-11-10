// キーワードの見張り。お気に入り板のスレ一覧を決めた間隔で見に行き、キーワードに合うスレ(スレタイ・立てた人)が新しく立っていたら知らせる。
// 板ごとに前回確かめた時刻を覚え、それより後に立ったスレだけを見る(初めての板は、境目を覚えるだけ)。
// アプリが見えていないあいだは休む

import { useEffect, useRef } from 'react'
import type { Board, ThreadSummary } from '@bbs-browser/connectors'
import type { AppNotification } from '../components/Notifications'
import type { AppSettings, UpdateSetting } from '../ui/settings'
import { keywordHits } from '../utils/watch'
import { isAppVisible } from '../utils/visibility'

/** スレタイのキーワードか、立てた人のキーワードが 1 つでもある */
const hasAnyKeyword = (s: AppSettings) => s.keywords.some((k) => k.trim()) || s.keywordAuthors.some((k) => k.trim())

export function useKeywordWatch(o: {
  enabled: boolean
  settings: AppSettings
  updateSetting: UpdateSetting
  favorites: Board[] | undefined
  listForWatch: (b: Board) => Promise<{ at: number; list: ThreadSummary[] }>
  isNgThread: (t: ThreadSummary) => boolean
  notify: (n: Omit<AppNotification, 'id'>) => void
  openThread: (t: ThreadSummary) => void
}) {
  // 見張りは作り置きの関数から呼ぶので、いつもいまの値を見る
  const latest = useRef(o)
  latest.current = o

  const check = async () => {
    const { settings, favorites, listForWatch, isNgThread, notify, updateSetting } = latest.current
    const keywords = settings.keywords
    const authors = settings.keywordAuthors
    if (!hasAnyKeyword(settings)) return
    const since = { ...settings.keywordWatchSince }
    for (const b of favorites ?? []) {
      let got: { at: number; list: ThreadSummary[] }
      try {
        got = await listForWatch(b)
      } catch {
        continue
      }
      const { at, list } = got
      const prev = since[b.url]
      // 境目は一覧を取った時刻まで(使い回しの一覧を見たとき、取ったあとに立ったスレを次の確認で拾うため)。戻しはしない
      since[b.url] = Math.max(prev ?? 0, at)
      if (prev === undefined) continue
      const hits = keywordHits(list, keywords, prev, authors).filter((h) => !isNgThread(h.thread))
      const boardName = settings.boardMeta[b.url]?.alias || b.name
      for (const h of hits.slice(0, 3))
        notify({
          icon: 'sell',
          title: `${boardName} に「${h.keyword}」のスレが立ちました`,
          body: h.thread.title,
          onClick: () => latest.current.openThread(h.thread),
        })
      if (hits.length > 3) notify({ icon: 'sell', title: `${boardName} にキーワードのスレがほかに ${hits.length - 3} 件立ちました` })
    }
    updateSetting('keywordWatchSince', since)
  }
  const checkRef = useRef(check)
  checkRef.current = check

  const minutes = o.settings.keywordWatchMin
  const hasKeywords = hasAnyKeyword(o.settings)
  const hasBoards = (o.favorites?.length ?? 0) > 0
  useEffect(() => {
    if (!o.enabled || minutes <= 0 || !hasKeywords || !hasBoards) return
    const run = () => {
      if (isAppVisible()) void checkRef.current().catch(() => undefined)
    }
    const first = setTimeout(run, 15_000)
    const timer = setInterval(run, minutes * 60_000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [o.enabled, minutes, hasKeywords, hasBoards])
}
