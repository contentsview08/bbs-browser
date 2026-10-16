// 次スレの候補。スレの一番下(-END- の下)に出す。画面に見えたときに初めて探しに行く
// (スレを開いただけで板のスレ一覧を取りに行かないように)

import { useEffect, useRef, useState } from 'react'
import type { ThreadSummary } from '@bbs-browser/connectors'
import type { NextThreadCandidate } from '../utils/nextThread'

export default function NextThreadBox(props: {
  find: () => Promise<NextThreadCandidate[]>
  onOpen: (t: ThreadSummary) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'idle' | 'loading' | { list: NextThreadCandidate[] } | { error: string }>('idle')

  const search = () => {
    setState('loading')
    props.find().then(
      (list) => setState({ list }),
      (e: unknown) => setState({ error: e instanceof Error ? e.message : String(e) }),
    )
  }

  useEffect(() => {
    const el = ref.current
    if (!el || state !== 'idle') return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer.disconnect()
      search()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [state])

  return (
    <div ref={ref} className="mx-auto w-full max-w-2xl my-4 p-4 rounded-[var(--card-radius)] border border-c-border bg-c-surface">
      <div className="flex items-center gap-2 mb-2">
        <span className="material-symbols-outlined text-xl text-c-accent">skip_next</span>
        <h3 className="text-sm font-bold text-c-text-strong">次スレ候補</h3>
        <button
          type="button"
          onClick={search}
          disabled={state === 'loading'}
          className="ml-auto p-1 rounded text-c-text-muted hover:text-c-text-strong disabled:opacity-50"
          title="探し直す(板のスレ一覧を取り直す)"
        >
          <span className={`material-symbols-outlined text-lg leading-none ${state === 'loading' ? 'animate-spin' : ''}`}>
            {state === 'loading' ? 'progress_activity' : 'refresh'}
          </span>
        </button>
      </div>
      {state === 'idle' || state === 'loading' ? (
        <p className="text-sm text-c-text-muted">探しています…</p>
      ) : 'error' in state ? (
        <p className="text-sm text-c-heat-very-hot">{state.error}</p>
      ) : state.list.length === 0 ? (
        <p className="text-sm text-c-text-muted">似たスレタイのスレは、まだ立っていないようです</p>
      ) : (
        <ul className="divide-y divide-c-border">
          {state.list.map((c) => (
            <li key={c.thread.key}>
              <button
                type="button"
                onClick={() => props.onOpen(c.thread)}
                className="w-full flex items-center gap-2 py-2 text-left hover:text-c-accent transition-colors"
              >
                {c.isNextNumber && (
                  <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded bg-c-accent text-[var(--c-accent-text)]">次の番号</span>
                )}
                <span className="flex-1 min-w-0 truncate text-sm text-c-text-strong">{c.thread.title}</span>
                <span className="flex-shrink-0 text-xs text-c-text-muted tabular-nums">{c.thread.postCount}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
