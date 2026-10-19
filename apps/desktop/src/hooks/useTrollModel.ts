// 印から育つ判定を、画面の外(workers/trollWorker.ts)で作り、1 レスごとの判定の関数を返す。
// ログの数え上げは起動時に 1 回、学び直しは印が変わるたびに(続けて付けたときは少し待ってから)。
// 荒らしの印が少ないうちは undefined(決まりだけで判定する)
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogStore, TrollMarkRecord } from '@bbs-browser/logstore'
import { MIN_TROLL_MARKS, predict, type Corpus, type Judgement, type TrollModel } from '../utils/trollModel'
import type { TrollWorkerRequest, TrollWorkerResponse } from '../workers/trollWorker'
import { backgroundError } from '../utils/backgroundError'

/** 判断軸のために読むログの数(新しく取ったスレから) */
const CORPUS_POSTS = 40000

export function useTrollModel(store: LogStore | undefined, enabled: boolean, marks: TrollMarkRecord[]): ((body: string) => Judgement) | undefined {
  const worker = useRef<Worker>(undefined)
  const [corpus, setCorpus] = useState<Corpus>()
  const [model, setModel] = useState<TrollModel>()
  /** 最後に頼んだ学び直しの番号(古い返事を捨てる) */
  const requested = useRef(0)

  const post = (msg: TrollWorkerRequest) => worker.current?.postMessage(msg)

  useEffect(() => {
    if (!store || !enabled) return
    const w = new Worker(new URL('../workers/trollWorker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e: MessageEvent<TrollWorkerResponse>) => {
      const m = e.data
      if (m.type === 'corpus') setCorpus(m.corpus)
      else if (m.type === 'model' && m.id === requested.current) setModel({ w: m.w, b: m.b, trollMarks: m.trollMarks })
      else if (m.type === 'error') backgroundError('自動 NG の学習')(new Error(m.message))
    }
    void store
      .corpusPosts(CORPUS_POSTS)
      .then((rows) => w.postMessage({ type: 'corpus', rows } satisfies TrollWorkerRequest))
      .catch(backgroundError('自動 NG のログの読み込み'))
    return () => {
      w.terminate()
      worker.current = undefined
      setCorpus(undefined)
      setModel(undefined)
    }
  }, [store, enabled])

  useEffect(() => {
    if (!corpus || marks.filter((m) => m.troll).length < MIN_TROLL_MARKS) {
      requested.current++
      setModel(undefined)
      return
    }
    // 印を続けて付けたときに毎回学び直さないよう、少し待ってから
    const timer = setTimeout(() => {
      const id = ++requested.current
      post({ type: 'train', id, marks: marks.map((m) => ({ body: m.body, troll: m.troll })) })
    }, 300)
    return () => clearTimeout(timer)
  }, [corpus, marks])

  return useMemo(() => (model && corpus ? (body: string) => predict(model, body, corpus) : undefined), [model, corpus])
}
