// リンクの埋め込みのカード用に、ページを取ってきて OGP を読む。
// 取ったものは DB(ogp_cache 表)に残し、起動し直しても取りに行かない(7 日たったら取り直す)。
// web 版はサーバー側で取っていた(ブラウザからは別のサイトを読めないため)が、アプリは直接取りに行ける。
// - 同時に取りに行くのは MAX_PARALLEL 件まで(リンクの多いスレを開いたときに通信が詰まらないように)
// - ページは頭の部分(HEAD_BYTES まで、</head> が見えたらそこまで)だけ読む。OGP は <head> にあるため

import { fetch } from '@tauri-apps/plugin-http'
import type { LogStore } from '@bbs-browser/logstore'
import { charsetOfHtml, parseOgp, type Ogp } from '../utils/ogp'
import { isAutoLoadable } from '../utils/safeUrl'
import { fetchHttpsFirst } from '../utils/httpsFirst'

// 掲示板向けの Monazilla ではなく、ふつうのブラウザに近い名乗りにする(OGP を返さないサイトがあるため)
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) bbs-browser/0.1.0'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** 何も取れなかったページは、これだけたったら取り直す(一時的に落ちていただけかもしれないので短め) */
const EMPTY_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** これより古いものは起動したときに捨てる */
const PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_PARALLEL = 4
const HEAD_BYTES = 256 * 1024

let store: LogStore | undefined
/** DB を開いたら渡す(それまでは保存せずに取るだけ)。古いものもここで捨てる */
export function initOgp(s: LogStore) {
  store = s
  void s.pruneOgp(Date.now() - PRUNE_AGE_MS).catch(() => undefined)
}

/** アプリを閉じるまでの控え(同じページを何度も DB に問い合わせないように) */
const memory = new Map<string, Promise<Ogp | null>>()

// 同時に取りに行く数を絞る順番待ち
let running = 0
const waiting: (() => void)[] = []
async function limited<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    return await job()
  } finally {
    running--
    waiting.shift()?.()
  }
}

/** 応答の頭の部分だけを読む。</head> が見えるか HEAD_BYTES に達したら、残りは読まずに切る */
async function readHead(res: Response): Promise<Uint8Array> {
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array(await res.arrayBuffer()).subarray(0, HEAD_BYTES)
  const chunks: Uint8Array[] = []
  let size = 0
  const ascii = new TextDecoder('latin1')
  try {
    while (size < HEAD_BYTES) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      size += value.length
      if (/<\/head>/i.test(ascii.decode(value))) break
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
  const out = new Uint8Array(Math.min(size, HEAD_BYTES))
  let at = 0
  for (const c of chunks) {
    const part = c.subarray(0, out.length - at)
    out.set(part, at)
    at += part.length
    if (at >= out.length) break
  }
  return out
}

async function download(url: string): Promise<Ogp | null> {
  const res = await fetchHttpsFirst(url, (u) => fetch(u, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } }), (r) => r.ok)
  if (!res.ok) return null
  const type = res.headers.get('content-type') ?? ''
  if (!/html/i.test(type)) {
    void res.body?.cancel().catch(() => undefined)
    return null
  }
  const bytes = await readHead(res)
  // 文字コードは、応答のヘッダー → ページの <meta charset> → UTF-8 の順に決める
  const fromHeader = /charset=([\w-]+)/i.exec(type)?.[1].toLowerCase()
  const peek = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096))
  const charset = fromHeader ?? charsetOfHtml(peek) ?? 'utf-8'
  let html: string
  try {
    html = new TextDecoder(charset).decode(bytes)
  } catch {
    html = new TextDecoder('utf-8').decode(bytes)
  }
  const ogp = parseOgp(html, url)
  return ogp.title || ogp.description || ogp.image ? ogp : null
}

async function load(url: string): Promise<Ogp | null> {
  const saved = await store?.getOgp(url).catch(() => null)
  if (saved) {
    const age = Date.now() - saved.fetchedAt
    if (saved.data === null ? age < EMPTY_MAX_AGE_MS : age < MAX_AGE_MS) return saved.data === null ? null : (JSON.parse(saved.data) as Ogp)
  }
  let ogp: Ogp | null
  try {
    ogp = await limited(() => download(url))
  } catch {
    // 通信に失敗したときは、古いものがあればそれを使い、覚え直さない(一時的な失敗かもしれないので)
    return saved?.data ? (JSON.parse(saved.data) as Ogp) : null
  }
  void store?.setOgp(url, ogp ? JSON.stringify(ogp) : null).catch(() => undefined)
  return ogp
}

/** 取れなかったとき(HTML でない、何も書かれていない、通信に失敗した)は null */
export function fetchOgp(url: string): Promise<Ogp | null> {
  // 家の中のアドレスは読みに行かない(画面側でも止めているが、念のためここでも)
  if (!isAutoLoadable(url)) return Promise.resolve(null)
  let p = memory.get(url)
  if (!p) {
    p = load(url).catch(() => null)
    memory.set(url, p)
  }
  return p
}
