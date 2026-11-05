// 自動 NG(荒らしの判定)。モデルを使わない決まりと、ユーザーが付けた印(荒らし・荒らしじゃない)で決める。
// 決まりの境目は、手元のログから選んだ 340 件に手で印を付けて合わせた(荒らし 53 件中 46 件を拾い、誤判定 3 件。2026-10-18):
// - 同じスレで、同じ本文(アンカーの行と空白を除く)が 3 回以上。ただし 60 文字未満は除く
//   (実況の「エラーエラー…」「うおおお」は、別の人が同じ短い叫びを書くので荒らしではない)
// - 100 文字以上で、同じ文字の並びの繰り返しばかり(4 文字ずつ切った並びのうち、違うものが 25% 未満)
// 印はスレをまたいで効く(本文が同じなら、別のスレでも同じ扱い)。印は DB に貯め、あとで判定モデルを育てる材料にも使う

import type { Post } from '@bbs-browser/connectors'
import { AXIS_LABEL, type Judgement } from './trollModel'
import { aiHitLabel, type AiNgHit } from './aiNg'

export type AutoNgReason =
  /** 同じスレで同じ本文が count 回 */
  | { kind: 'dup'; count: number }
  /** 同じ文字の並びの繰り返し */
  | { kind: 'repeat' }
  /** ユーザーが「荒らし」の印を付けた本文 */
  | { kind: 'marked' }
  /** 印から学んだ判定(utils/trollModel.ts)。p は確からしさ */
  | { kind: 'learned'; p: number; axis?: Judgement['axis'] }
  /** AI NG */
  | { kind: 'ai'; hit: AiNgHit }

/** ユーザーが付けた印。どちらも本文の鍵(bodyKey)の集まり */
export interface TrollMarks {
  troll: Set<string>
  notTroll: Set<string>
}

export const EMPTY_MARKS: TrollMarks = { troll: new Set(), notTroll: new Set() }

/** 同じ本文の回数で荒らしとみなす回数と、短すぎて数えない長さ */
export const DUP_COUNT = 3
export const DUP_MIN_LENGTH = 60
/** 繰り返しで荒らしとみなす長さと、違う並びの割合 */
export const REPEAT_MIN_LENGTH = 100
export const REPEAT_RATIO = 0.25
/** 学んだ判定で荒らしとみなす確からしさ(手元の 340 件で、荒らしの印 20 件なら 93% を拾い、普通の誤判定 1% 弱) */
export const LEARNED_THRESHOLD = 0.7

/** 比べるための本文。アンカーだけの行(>>12 など)と空白を除く(同じ文を別のレスへ向けて貼るので) */
export function normalizeBody(body: string): string {
  return body
    .split('\n')
    .filter((line) => !/^\s*>>/.test(line))
    .join('')
    .replace(/\s+/g, '')
}

/** 本文の鍵(印を貯めるときの名前)。正規化した本文の 53 ビットのハッシュを 16 進で */
export function bodyKey(body: string): string {
  const s = normalizeBody(body)
  // cyrb53
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/** 4 文字ずつ切った並びのうち、違うものの割合(繰り返しばかりの文ほど小さい) */
export function distinctRatio(text: string): number {
  const chars = Array.from(text)
  if (chars.length < 4) return 1
  const seen = new Set<string>()
  for (let i = 0; i + 4 <= chars.length; i++) seen.add(chars.slice(i, i + 4).join(''))
  return seen.size / (chars.length - 3)
}

/** スレのレスを判定する。荒らしとみなしたレスの番号と理由 */
export function judgeAutoNg(posts: Post[], marks: TrollMarks, learned?: (body: string) => Judgement | undefined): Map<number, AutoNgReason> {
  const norms = posts.map((p) => normalizeBody(p.body))
  const counts = new Map<string, number>()
  for (const t of norms) if (Array.from(t).length >= DUP_MIN_LENGTH) counts.set(t, (counts.get(t) ?? 0) + 1)
  const result = new Map<number, AutoNgReason>()
  posts.forEach((p, i) => {
    const t = norms[i]
    if (t === '') return
    const key = marks.troll.size + marks.notTroll.size > 0 ? bodyKey(p.body) : ''
    if (marks.notTroll.has(key)) return
    if (marks.troll.has(key)) return void result.set(p.no, { kind: 'marked' })
    const count = counts.get(t) ?? 0
    if (count >= DUP_COUNT) return void result.set(p.no, { kind: 'dup', count })
    if (Array.from(t).length >= REPEAT_MIN_LENGTH && distinctRatio(t) < REPEAT_RATIO) return void result.set(p.no, { kind: 'repeat' })
    const j = learned?.(p.body)
    if (j && j.p >= LEARNED_THRESHOLD) result.set(p.no, { kind: 'learned', p: j.p, axis: j.axis })
  })
  return result
}

/** 理由を画面に出す言葉 */
export function reasonLabel(r: AutoNgReason): string {
  switch (r.kind) {
    case 'dup':
      return `同じ本文が ${r.count} 回`
    case 'repeat':
      return '同じ文字の繰り返し'
    case 'marked':
      return '荒らしの印を付けた本文'
    case 'learned':
      return `学んだ判定 ${Math.round(r.p * 100)}%(${r.axis ? AXIS_LABEL[r.axis] : '文字の並びの癖'})`
    case 'ai':
      return aiHitLabel(r.hit)
  }
}
