// AI NG の判定モデルを動かす所(workers/aiNgWorker.ts)と、出た当たり具合を覚えておく所。アプリ全体で 1 つ。
// - スレ表示は useAiNgScores でレスを渡す。まだ当たり具合のないもの(本文と条件の組)だけを、見えている順にモデルへ頼む
// - 当たり具合は、出るたびに少しずつ届き、届くと描き直す
// - モデルは本人が「使う」にしたときだけ取る(約 125MB)。取ったものは Cache Storage に残る
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Post } from '@bbs-browser/connectors'
import { aiTextOf, hypothesisOf, scoreKey } from '../utils/aiNg'
import { bodyKey } from '../utils/autoNg'
import { fetchModelFile } from '../host/modelFetch'
import type { AiWorkerRequest, AiWorkerResponse } from '../workers/aiNgWorker'

export type AiModelStatus =
  | { kind: 'off' }
  | { kind: 'loading'; loaded: number; total: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

/** 1 回に頼む本文の数(多いと、ほかのスレの頼みが待たされる) */
const BATCH = 8
/** 覚えておく当たり具合の数(古いものから忘れる) */
const SCORE_MAX = 50000

let worker: Worker | undefined
let status: AiModelStatus = { kind: 'off' }
const scores = new Map<string, number>()
/** 頼んであって、まだ返っていない組 */
const pending = new Set<string>()
/** 頼む順に並べた本文(鍵 → 本文と、まだ当たり具合のない仮説) */
const queue = new Map<string, { text: string; body: string; prompts: Set<string> }>()
let busy = false
let reqSeq = 0
let version = 0
const listeners = new Set<() => void>()
const progress = new Map<string, { loaded: number; total: number }>()

function emit() {
  version++
  for (const l of listeners) l()
}
function setStatus(s: AiModelStatus) {
  status = s
  emit()
}

function ensureWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('../workers/aiNgWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = async (e: MessageEvent<AiWorkerResponse>) => {
    const m = e.data
    if (m.type === 'fetch') {
      try {
        const r = await fetchModelFile(m.url)
        w.postMessage({ type: 'fetched', reqId: m.reqId, ...r } satisfies AiWorkerRequest, [r.body])
      } catch (err) {
        w.postMessage({ type: 'fetched', reqId: m.reqId, ok: false, status: 0, headers: [], error: err instanceof Error ? err.message : String(err) } satisfies AiWorkerRequest)
      }
    } else if (m.type === 'progress') {
      progress.set(m.file, { loaded: m.loaded, total: m.total })
      let loaded = 0
      let total = 0
      for (const p of progress.values()) {
        loaded += p.loaded
        total += p.total
      }
      setStatus({ kind: 'loading', loaded, total })
    } else if (m.type === 'ready') {
      setStatus({ kind: 'ready' })
      pump()
    } else if (m.type === 'scores') {
      busy = false
      for (let i = 0; i < m.keys.length; i++) {
        const item = inFlight.get(m.keys[i])
        if (!item) continue
        item.prompts.forEach((prompt, j) => {
          const k = scoreKey(item.body, prompt)
          scores.set(k, m.scores[i][j])
          pending.delete(k)
        })
        inFlight.delete(m.keys[i])
      }
      if (scores.size > SCORE_MAX) for (const k of [...scores.keys()].slice(0, scores.size - SCORE_MAX)) scores.delete(k)
      emit()
      pump()
    } else if (m.type === 'error') {
      busy = false
      for (const it of inFlight.values()) for (const p of it.prompts) pending.delete(scoreKey(it.body, p))
      inFlight.clear()
      setStatus({ kind: 'error', message: m.message })
    }
  }
  worker = w
  return w
}

/** いまモデルに頼んでいる本文(鍵 → 本文と仮説の並び) */
const inFlight = new Map<string, { body: string; prompts: string[] }>()

/** 待っている本文を、まとめてモデルに頼む */
function pump() {
  if (busy || status.kind !== 'ready' || queue.size === 0) return
  // 同じ仮説の組のものから BATCH 件ずつ
  const first = [...queue.entries()][0]
  const prompts = [...first[1].prompts]
  const sig = prompts.join('\n')
  const batch = [...queue.entries()].filter(([, v]) => [...v.prompts].join('\n') === sig).slice(0, BATCH)
  for (const [k, v] of batch) {
    queue.delete(k)
    inFlight.set(k, { body: v.body, prompts })
  }
  busy = true
  ensureWorker().postMessage({
    type: 'judge',
    id: ++reqSeq,
    items: batch.map(([k, v]) => ({ key: k, text: v.text })),
    hypotheses: prompts.map(hypothesisOf),
  } satisfies AiWorkerRequest)
}

/** モデルを取って使えるようにする(本人が「使う」にしたとき) */
export function startAiModel() {
  if (status.kind === 'ready' || status.kind === 'loading') return
  setStatus({ kind: 'loading', loaded: 0, total: 0 })
  ensureWorker().postMessage({ type: 'load' } satisfies AiWorkerRequest)
}

/** モデルを止める(使わないにしたとき。覚えた当たり具合は残す) */
export function stopAiModel() {
  worker?.terminate()
  worker = undefined
  busy = false
  queue.clear()
  inFlight.clear()
  pending.clear()
  progress.clear()
  setStatus({ kind: 'off' })
}

/** 取ったモデルのファイルを消す(Cache Storage から) */
export async function deleteAiModelFiles(): Promise<void> {
  stopAiModel()
  await caches.delete('transformers-cache')
}

/** レスの当たり具合を頼む(まだのものだけ。前に頼んだものより先に回す) */
export function requestScores(posts: Post[], prompts: string[]) {
  if (prompts.length === 0) return
  const fresh = new Map<string, { text: string; body: string; prompts: Set<string> }>()
  for (const p of posts) {
    const text = aiTextOf(p.body)
    if (!text) continue
    const need = prompts.filter((pr) => {
      const k = scoreKey(p.body, pr)
      return !scores.has(k) && !pending.has(k)
    })
    if (need.length === 0) continue
    const key = bodyKey(p.body)
    const cur = fresh.get(key) ?? queue.get(key) ?? { text, body: p.body, prompts: new Set<string>() }
    for (const pr of need) {
      cur.prompts.add(pr)
      pending.add(scoreKey(p.body, pr))
    }
    fresh.set(key, cur)
    queue.delete(key)
  }
  if (fresh.size === 0) return
  // 新しく頼んだもの(いま開いているスレ)を前に
  const rest = [...queue.entries()]
  queue.clear()
  for (const [k, v] of fresh) queue.set(k, v)
  for (const [k, v] of rest) queue.set(k, v)
  pump()
}

/** 1 つの文を試す(設定の「試す」欄)。モデルが使えるときだけ */
export function testScore(text: string, prompt: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (status.kind !== 'ready') return reject(new Error('モデルがまだ使えません'))
    const body = text
    const k = scoreKey(body, prompt)
    if (scores.has(k)) return resolve(scores.get(k)!)
    const off = subscribe(() => {
      if (scores.has(k)) {
        off()
        resolve(scores.get(k)!)
      } else if (status.kind === 'error') {
        off()
        reject(new Error(status.message))
      }
    })
    pending.delete(k)
    requestScores([{ no: 0, name: '', mail: '', date: '', body }], [prompt])
  })
}

export function scoreOf(body: string, prompt: string): number | undefined {
  return scores.get(scoreKey(body, prompt))
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** モデルの状態(取っている途中・使える・うまくいかない) */
export function useAiModelStatus(): AiModelStatus {
  return useSyncExternalStore(subscribe, () => status)
}

/** 当たり具合が増えるたびに変わる数(描き直しのきっかけ) */
export function useAiScoresVersion(): number {
  return useSyncExternalStore(subscribe, () => version)
}

/** スレのレスの当たり具合を頼み、当たり具合が届いたら描き直す。enabled でなければ何もしない */
export function useAiNgScores(posts: Post[], prompts: string[], enabled: boolean): number {
  const v = useAiScoresVersion()
  const st = useAiModelStatus()
  const sig = prompts.join('\n')
  // 新しいレスから(下にあるほど新しく、いま読んでいる所に近い)
  const ordered = useMemo(() => [...posts].reverse(), [posts])
  useEffect(() => {
    if (!enabled || st.kind !== 'ready') return
    requestScores(ordered, prompts)
    // prompts は sig で見る
  }, [enabled, st.kind, ordered, sig])
  return v
}
