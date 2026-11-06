// 印から育つ判定を、画面の外(workers/trollWorker.ts)で作り、1 レスごとの判定の関数を返す。
// ログの数え上げは起動時に 1 回、学び直しは印が変わるたびに(続けて付けたときは少し待ってから)。
// 判定そのものも画面の外で行う: 判定の関数は、覚えてある結果を返し、まだない本文は少し待ってまとめて頼む。
// 結果が届いたら関数を作り直す(スレ表示が判定し直す)。荒らしの印が少ないうちは undefined(決まりだけで判定する)
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogStore, TrollMarkRecord } from '@bbs-browser/logstore'
import { MIN_TROLL_MARKS, type Judgement } from '../utils/trollModel'
import type { TrollWorkerRequest, TrollWorkerResponse } from '../workers/trollWorker'
import { backgroundError } from '../utils/backgroundError'

/** 判断軸のために読むログの数(新しく取ったスレから) */
const CORPUS_POSTS = 40000
/** 起動してからログを読むまで待つ時間 */
const STARTUP_DELAY_MS = 4000
/** 覚えておく判定の数(残してあるタブの全レスぶんで足りる) */
const PREDICT_CACHE_MAX = 20000
/** 頼む本文を集めてから送るまで待つ時間 */
const BATCH_DELAY_MS = 50

export function useTrollModel(store: LogStore | undefined, enabled: boolean, marks: TrollMarkRecord[]): ((body: string) => Judgement | undefined) | undefined {
  const worker = useRef<Worker>(undefined)
  const [corpusReady, setCorpusReady] = useState(false)
  /** 学んだモデルがあるか(印の数)。undefined ならまだ */
  const [modelMarks, setModelMarks] = useState<number>()
  /** 最後に頼んだ学び直しの番号(古い返事を捨てる) */
  const requested = useRef(0)
  const predictSeq = useRef(0)
  /** 本文 → 判定(届いたもの)。学び直したら捨てる */
  const cache = useRef(new Map<string, Judgement>())
  /** 頼んで、まだ返っていない本文 */
  const asked = useRef(new Set<string>())
  const toAsk = useRef(new Set<string>())
  const askTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  /** 判定が届くたびに増える(判定の関数を作り直すきっかけ) */
  const [version, setVersion] = useState(0)

  const post = (msg: TrollWorkerRequest) => worker.current?.postMessage(msg)

  useEffect(() => {
    if (!store || !enabled) return
    const w = new Worker(new URL('../workers/trollWorker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e: MessageEvent<TrollWorkerResponse>) => {
      const m = e.data
      if (m.type === 'corpus') setCorpusReady(true)
      else if (m.type === 'model' && m.id === requested.current) {
        cache.current.clear()
        asked.current.clear()
        setModelMarks(m.trollMarks)
        setVersion((v) => v + 1)
      } else if (m.type === 'predictions') {
        const c = cache.current
        m.bodies.forEach((b, i) => {
          asked.current.delete(b)
          if (c.size >= PREDICT_CACHE_MAX) c.delete(c.keys().next().value as string)
          c.set(b, m.results[i])
        })
        setVersion((v) => v + 1)
      } else if (m.type === 'error') backgroundError('自動 NG の学習')(new Error(m.message))
    }
    // 起動の邪魔をしないよう、少し待ってからログを読む(数万件あり、スマホでは起動が目に見えて遅くなる)
    const timer = setTimeout(
      () =>
        void store
          .corpusPosts(CORPUS_POSTS)
          .then((rows) => w.postMessage({ type: 'corpus', rows } satisfies TrollWorkerRequest))
          .catch(backgroundError('自動 NG のログの読み込み')),
      STARTUP_DELAY_MS,
    )
    return () => {
      clearTimeout(timer)
      clearTimeout(askTimer.current)
      askTimer.current = undefined
      w.terminate()
      worker.current = undefined
      setCorpusReady(false)
      setModelMarks(undefined)
      cache.current.clear()
      asked.current.clear()
      toAsk.current.clear()
    }
  }, [store, enabled])

  useEffect(() => {
    if (!corpusReady || marks.filter((m) => m.troll).length < MIN_TROLL_MARKS) {
      requested.current++
      setModelMarks(undefined)
      return
    }
    // 印を続けて付けたときに毎回学び直さないよう、少し待ってから
    const timer = setTimeout(() => {
      const id = ++requested.current
      post({ type: 'train', id, marks: marks.map((m) => ({ body: m.body, troll: m.troll })) })
    }, 300)
    return () => clearTimeout(timer)
  }, [corpusReady, marks])

  /** 判定の関数。覚えてある結果を返し、まだない本文は集めて頼む(届いたら version が変わり、関数が作り直される) */
  return useMemo(() => {
    if (modelMarks === undefined) return undefined
    return (body: string) => {
      const j = cache.current.get(body)
      if (j) return j
      if (!asked.current.has(body)) {
        toAsk.current.add(body)
        if (!askTimer.current)
          askTimer.current = setTimeout(() => {
            askTimer.current = undefined
            const bodies = [...toAsk.current]
            toAsk.current.clear()
            for (const b of bodies) asked.current.add(b)
            post({ type: 'predict', id: ++predictSeq.current, bodies })
          }, BATCH_DELAY_MS)
      }
      return undefined
    }
    // version: 判定が届いたら作り直す
  }, [modelMarks, version])
}
