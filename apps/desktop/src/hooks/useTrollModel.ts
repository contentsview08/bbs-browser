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
/** 起動してからログを読むまで待つ時間 */
const STARTUP_DELAY_MS = 4000
/** 覚えておく予測の数(残してあるタブの全レスぶんで足りる) */
const PREDICT_CACHE_MAX = 20000

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

  // 予測は本文ごとに覚える。スレを更新するたびに全レスを判定し直すが、新着のぶんだけ計算すれば済むように。
  // モデルか数え上げが替わったら(印を付けて学び直した)覚えたものは捨てる
  return useMemo(() => {
    if (!model || !corpus) return undefined
    const cache = new Map<string, Judgement>()
    return (body: string) => {
      let j = cache.get(body)
      if (!j) {
        j = predict(model, body, corpus)
        if (cache.size >= PREDICT_CACHE_MAX) cache.delete(cache.keys().next().value as string)
        cache.set(body, j)
      }
      return j
    }
  }, [model, corpus])
}
