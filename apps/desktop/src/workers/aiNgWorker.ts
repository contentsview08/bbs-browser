// AI NG(utils/aiNg.ts)の判定モデルを、画面とは別の処理の流れで動かす。
// モデルのファイルは、画面の側(hooks/useAiNg.ts)に取ってきてもらう(アプリは通信をすべて Rust の側に通すので、ここからは取りに行けない)。
// 一度取ったファイルは Cache Storage に入り、次からは通信しない。ONNX Runtime の wasm はアプリに入れてあるものを使う
import { env, pipeline, type ZeroShotClassificationPipeline } from '@huggingface/transformers'
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import { AI_MODEL } from '../utils/aiNg'

export type AiWorkerRequest =
  | { type: 'load' }
  /** 本文 1 つずつに、仮説(条件の文)をまとめて当てる */
  | { type: 'judge'; id: number; items: { key: string; text: string }[]; hypotheses: string[] }
  | { type: 'fetched'; reqId: number; ok: boolean; status: number; headers: [string, string][]; body?: ArrayBuffer; error?: string }

export type AiWorkerResponse =
  | { type: 'fetch'; reqId: number; url: string }
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready' }
  /** keys[i] の本文の、hypotheses[j] の当たり具合 = scores[i][j] */
  | { type: 'scores'; id: number; keys: string[]; scores: number[][] }
  | { type: 'error'; message: string }

const out = self as unknown as Worker
const send = (m: AiWorkerResponse, transfer: Transferable[] = []) => out.postMessage(m, transfer)

// 取りに行くのは画面の側。返事を待つ
let reqSeq = 0
const waiting = new Map<number, (m: Extract<AiWorkerRequest, { type: 'fetched' }>) => void>()
env.fetch = (input: string | URL) =>
  new Promise((resolve, reject) => {
    const reqId = ++reqSeq
    waiting.set(reqId, (m) => {
      if (m.error) return reject(new Error(m.error))
      resolve(new Response(m.body ?? null, { status: m.status, headers: m.headers }))
    })
    send({ type: 'fetch', reqId, url: String(input) })
  })
env.allowLocalModels = false
env.useBrowserCache = true
// wasm は blob の URL にせず、そのまま読む(アプリの CSP が blob: のスクリプトを許していない)
env.useWasmCache = false
const onnx = env.backends.onnx
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm }
  // 別のオリジンから切り離していない(SharedArrayBuffer が使えない)ので、1 本で回す
  onnx.wasm.numThreads = 1
}

let classifier: Promise<ZeroShotClassificationPipeline> | undefined
function open(device: 'webgpu' | 'wasm') {
  return pipeline('zero-shot-classification', AI_MODEL.id, {
    dtype: AI_MODEL.dtype,
    device,
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file) send({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 })
    },
  }) as Promise<ZeroShotClassificationPipeline>
}
/** GPU(WebGPU)が本当に使えるか(navigator.gpu があっても、GPU を貸してもらえないことがある) */
async function hasGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return !!(gpu && (await gpu.requestAdapter()))
  } catch {
    return false
  }
}
function load() {
  // GPU が使えればそちらで(何倍も速い)。使えなければ CPU(wasm)で
  classifier ??= hasGpu().then((gpu) => open(gpu ? 'webgpu' : 'wasm'))
  return classifier
}

self.onmessage = async (e: MessageEvent<AiWorkerRequest>) => {
  const m = e.data
  if (m.type === 'fetched') {
    waiting.get(m.reqId)?.(m)
    waiting.delete(m.reqId)
    return
  }
  try {
    if (m.type === 'load') {
      await load()
      send({ type: 'ready' })
    } else if (m.type === 'judge') {
      const c = await load()
      const keys: string[] = []
      const scores: number[][] = []
      for (const it of m.items) {
        // 仮説ごとに「含意」の確からしさを別々に出す(multi_label)。条件の文はそのまま仮説にする
        const r = (await c(it.text, m.hypotheses, { multi_label: true, hypothesis_template: '{}' })) as { labels: string[]; scores: number[] }
        keys.push(it.key)
        scores.push(m.hypotheses.map((h) => r.scores[r.labels.indexOf(h)] ?? 0))
      }
      send({ type: 'scores', id: m.id, keys, scores })
    }
  } catch (err) {
    classifier = undefined
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
