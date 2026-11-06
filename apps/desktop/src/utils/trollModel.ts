// 印から育つ荒らしの判定。ユーザーが付けた印(荒らし・荒らしじゃない)から、小さなロジスティック回帰を学ぶ。
// 本文を丸ごと覚えるのではなく、次の判断軸と文字の並びの癖の重みを学ぶので、初めて見る荒らしにも当たる。
//
// 判断軸(どれも手元のログ = コーパスから計算する。モデルのダウンロードは要らない)
// - でたらめ度: 普通の日本語では隣り合わない 2 文字の並び(ほかのレスにほとんど出ない並び)の割合。
//   ランダムな漢字・かなを並べたスクリプトの荒らしで高い(普通のレスの真ん中は 0.08、でたらめ文は 0.7 以上)
// - スレをまたいだ重複: 同じ本文がいくつのスレに書かれているか。長い文で多ければコピペ・ステマ・宣伝、
//   短い文で多ければ「草」「ワロタ」のようなネットスラング(荒らしではない)。長さで 2 つの軸に分けて、どちらに効くかを学ばせる
// - 繰り返し: 同じ文字の並びの繰り返しばかりか(utils/autoNg.ts の distinctRatio)
// - URL の数(画像以外)と、本文の長さ
// - 文字の 1〜3 文字の並び(ハッシュで 2^16 個の重みにまとめる)
//
// 学び方: 「荒らし」の印は正例、「荒らしじゃない」の印は強い負例。印のないレスは大半が普通なので、
// コーパスから選んだレスを弱い負例として混ぜる(印は荒らしにしか付かないことが多く、負例が足りないため)。

import { REPEAT_MIN_LENGTH, REPEAT_RATIO, distinctRatio, normalizeBody } from './autoNg'
import { ngramFeatures, sigmoid } from './ngram'

const NGRAM_BITS = 16
const NGRAM_SIZE = 1 << NGRAM_BITS
/** 名前の付いた判断軸(n-gram の重みの後ろに並べる) */
const AXES = ['gibberish', 'crossLong', 'crossShort', 'repeat', 'urls', 'length'] as const
export type Axis = (typeof AXES)[number]
export const AXIS_LABEL: Record<Axis, string> = {
  gibberish: 'でたらめな文字の並び',
  crossLong: 'ほかのスレにも同じ長文',
  crossShort: 'ほかのスレにも同じ短文(スラング)',
  repeat: '同じ文字の繰り返し',
  urls: 'URL の貼り付け',
  length: '長さ',
}
const DIM = NGRAM_SIZE + AXES.length
/** 「長い文」とみなす長さ(スレをまたいだ重複を、コピペとスラングに分ける境目) */
const LONG_TEXT = 30
/** この数より印(荒らし)が少ないうちは、学んだ判定を使わない */
export const MIN_TROLL_MARKS = 3

const JA = /[぀-ヿ一-鿿]/

/** 手元のログから作る、判断軸のための数え上げ */
export interface Corpus {
  /** 2 文字の並び(かな・漢字どうし)が出てくるレスの数 */
  bigrams: Map<string, number>
  /** 正規化した本文が書かれているスレの数 */
  threads: Map<string, number>
  /** 弱い負例に使うレスの本文(印のないもの) */
  sample: string[]
}

function bigramsOf(t: string): Set<string> {
  const chars = Array.from(t)
  const out = new Set<string>()
  for (let i = 0; i + 1 < chars.length; i++) if (JA.test(chars[i]) && JA.test(chars[i + 1])) out.add(chars[i] + chars[i + 1])
  return out
}

/** ログのレス(スレの名前と本文)から数え上げる。sampleSize は弱い負例に取っておく数 */
export function buildCorpus(posts: { thread: string; body: string }[], sampleSize = 400): Corpus {
  const bigrams = new Map<string, number>()
  const threadSets = new Map<string, Set<string>>()
  for (const p of posts) {
    const t = normalizeBody(p.body)
    for (const g of bigramsOf(t)) bigrams.set(g, (bigrams.get(g) ?? 0) + 1)
    if (t === '') continue
    let set = threadSets.get(t)
    if (!set) threadSets.set(t, (set = new Set()))
    set.add(p.thread)
  }
  const threads = new Map<string, number>()
  for (const [t, set] of threadSets) if (set.size > 1) threads.set(t, set.size)
  // 弱い負例は、ログ全体から等間隔に選ぶ(並びの偏りを避け、同じ入力なら毎回同じになるように)
  const step = Math.max(1, Math.floor(posts.length / sampleSize))
  const sample: string[] = []
  for (let i = 0; i < posts.length && sample.length < sampleSize; i += step) sample.push(posts[i].body)
  return { bigrams, threads, sample }
}

/** でたらめ度: ほかのレスにほとんど出てこない 2 文字の並びの割合(並びが少なすぎる短文は 0) */
export function gibberishScore(t: string, corpus: Corpus): number {
  const bg = bigramsOf(t)
  if (bg.size < 4) return 0
  let rare = 0
  for (const g of bg) if ((corpus.bigrams.get(g) ?? 0) <= 2) rare++
  return rare / bg.size
}

/** 疎なベクトル(添字 → 値) */
type Features = Map<number, number>

/** 判断軸の値(0〜1 くらいにそろえる) */
export function axesOf(body: string, corpus: Corpus): Record<Axis, number> {
  const t = normalizeBody(body)
  const len = Array.from(t).length
  const cross = Math.log2(corpus.threads.get(t) ?? 1) / 4 // 1 スレだけなら 0、16 スレで 1
  const urls = (body.match(/https?:\/\/\S+/g) ?? []).filter((u) => !/\.(jpe?g|png|gif|webp)(\?|$)|imgur\.com/i.test(u)).length
  return {
    gibberish: gibberishScore(t, corpus),
    crossLong: len >= LONG_TEXT ? Math.min(1, cross) : 0,
    crossShort: len < LONG_TEXT ? Math.min(1, cross) : 0,
    repeat: len >= 40 ? 1 - distinctRatio(t) : 0,
    urls: Math.min(1, urls / 3),
    length: Math.min(1, len / 500),
  }
}

function featuresOf(body: string, corpus: Corpus): Features {
  const f: Features = ngramFeatures(Array.from(normalizeBody(body)).slice(0, 600), NGRAM_SIZE)
  const axes = axesOf(body, corpus)
  AXES.forEach((a, i) => {
    if (axes[a] !== 0) f.set(NGRAM_SIZE + i, axes[a])
  })
  return f
}

export interface TrollModel {
  w: Float32Array
  b: number
  /** 学んだ印(荒らし)の数 */
  trollMarks: number
}

export interface Example {
  body: string
  troll: boolean
  /** 重み(印は 1 か 3、弱い負例は小さく) */
  weight: number
}

function dot(w: Float32Array, f: Features): number {
  let s = 0
  for (const [k, v] of f) s += w[k] * v
  return s
}

/** 例から学ぶ(確率的勾配降下・L2 正則化)。例の並びは固定して回すので、同じ入力なら同じ結果になる */
export function train(examples: Example[], corpus: Corpus, epochs = 40): TrollModel {
  const w = new Float32Array(DIM)
  let b = 0
  const data = examples.map((e) => ({ f: featuresOf(e.body, corpus), y: e.troll ? 1 : 0, weight: e.weight }))
  // 正例と負例の重みの合計をそろえる(荒らしの印は少ないので)
  const pos = data.filter((d) => d.y === 1).reduce((s, d) => s + d.weight, 0)
  const neg = data.filter((d) => d.y === 0).reduce((s, d) => s + d.weight, 0)
  const balance = pos > 0 && neg > 0 ? neg / pos : 1
  const lr = 0.3
  const l2 = 1e-4
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = 0; i < data.length; i++) {
      // 正例と負例が交互に近くなるよう、決まった飛び方で回す
      const d = data[(i * 7919 + epoch) % data.length]
      const p = sigmoid(dot(w, d.f) + b)
      const g = (p - d.y) * d.weight * (d.y === 1 ? balance : 1)
      for (const [k, v] of d.f) w[k] -= lr * (g * v + l2 * w[k])
      b -= lr * g
    }
  }
  return { w, b, trollMarks: examples.filter((e) => e.troll && e.weight >= 1).length }
}

export interface Judgement {
  /** 荒らしである確からしさ(0〜1) */
  p: number
  /** 一番効いた判断軸(n-gram だけなら undefined = 文字の並びの癖) */
  axis?: Axis
}

export function predict(model: TrollModel, body: string, corpus: Corpus): Judgement {
  const f = featuresOf(body, corpus)
  const p = sigmoid(dot(model.w, f) + model.b)
  let best: Axis | undefined
  let bestValue = 0.5 // これより小さい寄与なら「文字の並びの癖」とする
  AXES.forEach((a, i) => {
    const c = model.w[NGRAM_SIZE + i] * (f.get(NGRAM_SIZE + i) ?? 0)
    if (c > bestValue) {
      bestValue = c
      best = a
    }
  })
  return { p, axis: best }
}

/** 印と、ログから選んだ弱い負例から、学ぶ例を作る */
export function examplesFrom(marks: { body: string; troll: boolean }[], corpus: Corpus): Example[] {
  const marked = new Set(marks.map((m) => normalizeBody(m.body)))
  return [
    ...marks.map((m) => ({ body: m.body, troll: m.troll, weight: m.troll ? 1 : 3 })),
    // 弱い負例からは、決まりで荒らしとわかるもの(繰り返しばかり・長文がたくさんのスレに)を除く
    ...corpus.sample
      .filter((body) => {
        const t = normalizeBody(body)
        if (marked.has(t)) return false
        const len = Array.from(t).length
        if (len >= REPEAT_MIN_LENGTH && distinctRatio(t) < REPEAT_RATIO) return false
        return !(len >= LONG_TEXT && (corpus.threads.get(t) ?? 1) >= 3)
      })
      .map((body) => ({ body, troll: false, weight: 0.2 })),
  ]
}
