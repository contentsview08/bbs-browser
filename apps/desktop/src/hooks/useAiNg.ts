// AI NG の判定モデルを動かす所(workers/aiNgWorker.ts)と、出た当たり具合を覚えておく所。アプリ全体で 1 つ。
// - スレ表示は useAiNgScores でレスを渡す。まだ当たり具合のないもの(本文と条件の組)だけを、見えている順にモデルへ頼む
// - 当たり具合は、出るたびに少しずつ届き、届くと描き直す
// - モデルは利用者が「使う」にしたときだけ取る(約 125MB)。取ったものは Cache Storage に残る
// - モデルを動かすのはメインのウィンドウだけ。PC の設定ウィンドウには状態を写し、試す・消すはメインに頼む
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Post } from '@bbs-browser/connectors'
import { aiInputOf, aiTextOf, hypothesisOf, scoreKey } from '../utils/aiNg'
import { bodyKey } from '../utils/autoNg'
import { broadcast, callMain, onBroadcast, toolKindOfThisWindow } from '../host/crossWindow'
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

const STATUS_EVENT = 'ai-model-status'
const isToolWindow = () => toolKindOfThisWindow() !== undefined

let worker: Worker | undefined
/** 取っている途中のファイルを止めるもの(worker と同じ間だけ生きる) */
let fetchAbort: AbortController | undefined
let status: AiModelStatus = { kind: 'off' }
const scores = new Map<string, number>()
/** 頼んであって、まだ返っていない組 */
const pending = new Set<string>()
/** 頼む順に並べた本文(鍵 → 本文と、まだ当たり具合のない仮説) */
const queue = new Map<string, { text: string; body: string; prompts: Set<string>; ctx: string }>()
/** いまモデルに頼んでいる本文(鍵 → 本文と仮説の並び) */
const inFlight = new Map<string, { body: string; prompts: string[]; ctx: string }>()
let busy = false
let reqSeq = 0
let version = 0
const listeners = new Set<() => void>()
const progress = new Map<string, { loaded: number; total: number }>()

/** 取っている途中の量を、ファイルをまとめて出す(取り終えたあとは止めない: 読み込みの途中でも出す) */
let lastShown = 0
function showProgress() {
  const now = Date.now()
  if (now - lastShown < 200) return
  lastShown = now
  let loaded = 0
  let total = 0
  for (const p of progress.values()) {
    loaded += p.loaded
    total += p.total
  }
  if (status.kind === 'loading') setStatus({ kind: 'loading', loaded, total })
}

/** 知らせは少し待ってまとめる(当たり具合は 8 件ずつ届く。届くたびに全タブのレスを判定し直して描き直すと重い) */
const EMIT_DELAY_MS = 250
let emitTimer: ReturnType<typeof setTimeout> | undefined
function emit() {
  version++
  if (emitTimer) return
  emitTimer = setTimeout(() => {
    emitTimer = undefined
    for (const l of listeners) l()
  }, EMIT_DELAY_MS)
}
/** 知らせをすぐ出す(状態が変わったとき) */
function emitNow() {
  version++
  if (emitTimer) clearTimeout(emitTimer)
  emitTimer = undefined
  for (const l of listeners) l()
}
function applyStatus(s: AiModelStatus) {
  status = s
  emitNow()
}
function setStatus(s: AiModelStatus) {
  applyStatus(s)
  if (!isToolWindow()) void broadcast(STATUS_EVENT, s)
}

/** 設定ウィンドウで、メインのモデルの状態を写す(開いた時点の状態ももらう) */
export function mirrorAiModelStatus(): Promise<() => void> {
  const off = onBroadcast<AiModelStatus>(STATUS_EVENT, applyStatus)
  void off.then(() => callMain<AiModelStatus>('aiModelStatus')).then(applyStatus, () => {})
  return off
}

/** いまのモデルの状態(設定ウィンドウからの問い合わせ用) */
export function aiModelStatus(): AiModelStatus {
  return status
}

function ensureWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('../workers/aiNgWorker.ts', import.meta.url), { type: 'module' })
  const abort = new AbortController()
  fetchAbort = abort
  w.onmessage = async (e: MessageEvent<AiWorkerResponse>) => {
    if (worker !== w) return
    const m = e.data
    if (m.type === 'fetch') {
      try {
        const r = await fetchModelFile(
          m.url,
          (loaded, total) => {
            if (worker !== w) return
            progress.set(m.url, { loaded, total })
            showProgress()
          },
          abort.signal,
        )
        w.postMessage({ type: 'fetched', reqId: m.reqId, ...r } satisfies AiWorkerRequest, [r.body])
      } catch (err) {
        w.postMessage({ type: 'fetched', reqId: m.reqId, ok: false, status: 0, headers: [], error: err instanceof Error ? err.message : String(err) } satisfies AiWorkerRequest)
      }
    } else if (m.type === 'progress') {
      // 取ったファイルは、上で URL ごとに数えている。ここ(読み込みの知らせ)は、数えていないときだけ使う
      if (![...progress.keys()].some((k) => k.endsWith(m.file))) {
        progress.set(m.file, { loaded: m.loaded, total: m.total })
        showProgress()
      }
    } else if (m.type === 'ready') {
      setStatus({ kind: 'ready' })
      pump()
    } else if (m.type === 'scores') {
      busy = false
      for (let i = 0; i < m.keys.length; i++) {
        const item = inFlight.get(m.keys[i])
        if (!item) continue
        item.prompts.forEach((prompt, j) => {
          const k = scoreKey(item.body, prompt, item.ctx)
          scores.set(k, m.scores[i][j])
          pending.delete(k)
        })
        inFlight.delete(m.keys[i])
      }
      for (const k of scores.keys()) {
        if (scores.size <= SCORE_MAX) break
        scores.delete(k)
      }
      emit()
      pump()
    } else if (m.type === 'error') {
      busy = false
      for (const it of inFlight.values()) for (const p of it.prompts) pending.delete(scoreKey(it.body, p, it.ctx))
      inFlight.clear()
      setStatus({ kind: 'error', message: m.message })
    }
  }
  worker = w
  return w
}

/** 待っている本文を、まとめてモデルに頼む */
function pump() {
  if (busy || status.kind !== 'ready' || queue.size === 0) return
  // 同じ仮説の組のものから BATCH 件ずつ
  let prompts: string[] | undefined
  let sig = ''
  const batch: [string, { text: string; body: string; ctx: string }][] = []
  for (const [k, v] of queue) {
    const list = [...v.prompts]
    const s = list.join('\n')
    if (!prompts) {
      prompts = list
      sig = s
    }
    if (s !== sig) continue
    batch.push([k, v])
    if (batch.length === BATCH) break
  }
  if (!prompts) return
  for (const [k, v] of batch) {
    queue.delete(k)
    inFlight.set(k, { body: v.body, prompts, ctx: v.ctx })
  }
  busy = true
  ensureWorker().postMessage({
    type: 'judge',
    id: ++reqSeq,
    items: batch.map(([k, v]) => ({ key: k, text: v.text })),
    hypotheses: prompts.map(hypothesisOf),
  } satisfies AiWorkerRequest)
}

/** モデルを取って使えるようにする */
export function startAiModel() {
  if (status.kind === 'ready' || status.kind === 'loading') return
  setStatus({ kind: 'loading', loaded: 0, total: 0 })
  ensureWorker().postMessage({ type: 'load' } satisfies AiWorkerRequest)
}

/** モデルを止める(使わないにしたとき。覚えた当たり具合は残す) */
export function stopAiModel() {
  fetchAbort?.abort()
  fetchAbort = undefined
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
  if (isToolWindow()) return callMain('aiDeleteModel')
  stopAiModel()
  await caches.delete('transformers-cache')
}

/** レスの当たり具合を頼む(まだのものだけ。前に頼んだものより先に回す) */
function requestScores(posts: Post[], prompts: string[], contexts: (string | undefined)[] = []) {
  if (prompts.length === 0) return
  const fresh = new Map<string, { text: string; body: string; prompts: Set<string>; ctx: string }>()
  const ctxs = new Set(prompts.map((_, i) => contexts[i] ?? ''))
  for (const p of posts) {
    if (!aiTextOf(p.body)) continue
    // 文脈つきの条件は、文脈を添えた文で別に頼む(鍵も別)
    for (const ctx of ctxs) {
      const need = prompts.filter((pr, i) => {
        if ((contexts[i] ?? '') !== ctx) return false
        const k = scoreKey(p.body, pr, ctx)
        return !scores.has(k) && !pending.has(k)
      })
      if (need.length === 0) continue
      const key = `${bodyKey(p.body)}|${ctx ? bodyKey(ctx) : ''}`
      const cur = fresh.get(key) ?? queue.get(key) ?? { text: aiInputOf(p.body, ctx || undefined), body: p.body, prompts: new Set<string>(), ctx }
      for (const pr of need) {
        cur.prompts.add(pr)
        pending.add(scoreKey(p.body, pr, ctx))
      }
      fresh.set(key, cur)
      queue.delete(key)
    }
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
  if (isToolWindow()) return callMain<number>('aiTestScore', { text, prompt })
  return new Promise((resolve, reject) => {
    if (status.kind !== 'ready') return reject(new Error('モデルがまだ使えません'))
    const body = text
    // アンカーと URL だけの文は判定に回らない
    if (!aiTextOf(body)) return reject(new Error('判定できる文がありません(アンカーと URL は除いて判定します)'))
    const k = scoreKey(body, prompt)
    if (scores.has(k)) return resolve(scores.get(k)!)
    const off = subscribe(() => {
      if (scores.has(k)) {
        off()
        resolve(scores.get(k)!)
      } else if (status.kind === 'error') {
        off()
        reject(new Error(status.message))
      } else if (status.kind === 'off') {
        off()
        reject(new Error('モデルが止まりました'))
      }
    })
    pending.delete(k)
    requestScores([{ no: 0, name: '', mail: '', date: '', body }], [prompt])
  })
}

export function scoreOf(body: string, prompt: string, context?: string): number | undefined {
  return scores.get(scoreKey(body, prompt, context ?? ''))
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

const noSubscribe = () => () => {}
const zero = () => 0

/**
 * スレのレスの当たり具合を頼み、当たり具合が届いたら描き直す。enabled でなければ何もしない(購読もしない)。
 * 頼むのは見えているタブ(active)だけ。残してある隠れたタブのぶんまで頼むと、モデルがずっと動き続ける
 */
export function useAiNgScores(posts: Post[], prompts: string[], enabled: boolean, active = true, contexts: (string | undefined)[] = []): number {
  const v = useSyncExternalStore(enabled ? subscribe : noSubscribe, enabled ? () => version : zero)
  const st = useSyncExternalStore(enabled ? subscribe : noSubscribe, () => status)
  const sig = prompts.map((p, i) => `${p}|${contexts[i] ?? ''}`).join('\n')
  // 新しいレスから(下にあるほど新しく、いま読んでいる所に近い)
  const ordered = useMemo(() => [...posts].reverse(), [posts])
  useEffect(() => {
    if (!enabled || !active || st.kind !== 'ready') return
    requestScores(ordered, prompts, contexts)
    // prompts・contexts は sig で見る
  }, [enabled, active, st.kind, ordered, sig])
  return v
}
