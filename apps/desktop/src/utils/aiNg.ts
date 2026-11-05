// AI NG: 利用者が書いた条件(「他人を煽っている」など)に、レスが当たるかを端末の中の小さな判定モデルで調べる。
// 判定(条件ごとの当たり具合 0〜1)と見せ方(隠す・畳む・印だけ)を分けて持つ。
// 手で付けた「当たる・当たらない」はモデルの判定より優先する。従来の NG(ワード・ID)とは別に持ち、どちらで消えたかを出す。
// モデルは多言語の zero-shot 分類(NLI)。レスを前提、条件の文をそのまま仮説にして「含意」の確からしさを当たり具合にする。
// モデルの選び方(2026-11-03、日本語の見本 28 件で、当たるべきものが当たらないものより高く出る割合 = AUC):
//   mDeBERTa-v3-base(条件の文だけを仮説に)煽り 0.97・宣伝 0.81・政治 0.88 ← これ
//   同じモデルで「この書き込みは〜」を付けると 0.69・0.88・1.00、MiniLM-L6 はどの形でも 0.3〜0.6、
//   小さい LLM に「はい・いいえ」で聞く形は Qwen2.5-0.5B で 0.86・0.56・0.75(1 組 0.5 秒と遅い)、Qwen3-0.6B は使えなかった。
// ただ、実際のスレ(なんJ 風の短い書き込み)では、当たらないはずのものも 50〜87% に出た。条件の文だけでは決めきれないので、
// 利用者の手の印(当たる・当たらない)を本文ごと覚え、条件ごとに 3 件ずつそろったら、印から学んだ判定(文字の並びの癖。
// 荒らしの判定 utils/trollModel.ts と同じ作り)とモデルの当たり具合を半々に混ぜる。既定の境目は高め(80%)、見本の条件は「印だけ」
// スマホのアプリは data/AiNg.kt(同じ項目・同じ JSON・同じ決め方)
import type { Post } from '@bbs-browser/connectors'
import { bodyKey } from './autoNg'

/** 使うモデル(Hugging Face の置き場の名前と、取る形)。int8 で約 339MB + 字の切り方の表 16MB */
export const AI_MODEL = {
  id: 'MoritzLaurer/mDeBERTa-v3-base-mnli-xnli',
  dtype: 'q8' as const,
  size: '約 355MB',
  license: 'MIT',
  page: 'https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-mnli-xnli',
}

/** 既定の境目 */
export const DEFAULT_THRESHOLD = 0.8

/** 見せ方: hide は何も出さない、fold は畳む(押せば見られる)、mark は印だけ(中身はそのまま) */
export type AiNgShow = 'hide' | 'fold' | 'mark'
export const AI_NG_SHOWS: { key: AiNgShow; name: string; note: string }[] = [
  { key: 'fold', name: '畳む', note: '「AI NG」と出して畳みます。押せば中身を見られます' },
  { key: 'mark', name: '印だけ', note: '中身はそのまま出し、頭に印を付けます' },
  { key: 'hide', name: '隠す', note: '何も出しません(透明あぼーん)' },
]

export interface AiNgRule {
  id: string
  /** 一覧に出す短い名前(「煽り」など) */
  name: string
  /** 条件の文(「他人を煽ったり見下したりしている」)。当てたい書き込みの様子を短い文で書く */
  prompt: string
  /** これ以上の当たり具合で当てる(0.5〜0.98。既定 DEFAULT_THRESHOLD) */
  threshold: number
  show: AiNgShow
  enabled: boolean
  /** この板だけ(なければすべての板) */
  boardUrl?: string
  boardName?: string
  /** スレの話題(スレタイと 1 レス目の頭)を添えて判定する(「スレの話題と関係ない」のような、文脈で決まる条件に) */
  withContext?: boolean
  /** 同じ ID がこのスレで 2 回以上当たったら、その ID の書き込みをすべて当てる(煽りを続けている人) */
  sameId?: boolean
}

/** スレの話題として判定に添える文(スレタイと 1 レス目の頭)。長すぎるとモデルが本文を読めなくなるので短く */
export function threadContextOf(title: string, firstBody: string | undefined): string {
  const head = firstBody ? aiTextOf(firstBody).slice(0, 120) : ''
  return `スレ「${title.slice(0, 60)}」${head ? `(${head})` : ''}`
}

/** モデルに渡す文: 文脈つきの条件なら、スレの話題を頭に添える */
export function aiInputOf(body: string, context: string | undefined): string {
  const text = aiTextOf(body)
  return context ? `${context}への書き込み: ${text}` : text
}

/** 手で付けた「当たる(hit)・当たらない(miss)」。本文の鍵(bodyKey)で持つ。examples は学ぶための本文(頭だけ) */
export interface AiNgOverride {
  hit: string[]
  miss: string[]
  examples?: { text: string; hit: boolean }[]
}

/** 学ぶための本文は、条件ごとにこの数まで(古いものから消す) */
export const EXAMPLE_MAX = 300
/** 印から学ぶのに要る数(当たる・当たらないのそれぞれ) */
export const MIN_EXAMPLES = 3

/** 手で付けた印は、条件ごとにこの数まで(古いものから消す) */
export const OVERRIDE_MAX = 2000

/** はじめに入れておく条件の見本(どれも切ってある) */
export const AI_NG_SAMPLES: Omit<AiNgRule, 'id'>[] = [
  // スレの話題を添えて判定する(話題そのもの(政治の板で政治の話 など)は当てない。話題から外れた書き込みだけ)
  { name: 'スレ違い', prompt: 'スレの話題と関係のない話をしている', threshold: DEFAULT_THRESHOLD, show: 'mark', enabled: false, withContext: true },
  // 同じ ID が続けて煽っていたら、その ID の書き込みをまとめて当てる
  { name: '煽り', prompt: '特定の相手を繰り返し煽ったり、見下したりしている', threshold: DEFAULT_THRESHOLD, show: 'mark', enabled: false, withContext: true, sameId: true },
  { name: '宣伝', prompt: '商品やサイトの宣伝・勧誘をしている', threshold: DEFAULT_THRESHOLD, show: 'mark', enabled: false },
]

/** 仮説の形: 条件の文をそのまま(「この書き込みは〜」を付けると、日本語の見本では外れが増えた) */
export function hypothesisOf(prompt: string): string {
  return `${prompt.trim().replace(/[。.]+$/, '')}。`
}

/** 判定に渡す本文: アンカーだけの行・URL を除き、長すぎるものは頭だけ(モデルが読める長さに) */
export function aiTextOf(body: string): string {
  return body
    .split('\n')
    .filter((l) => !/^\s*>>\d/.test(l))
    .join('\n')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

/** 当たり具合を覚えておく鍵(本文と条件の文の組。文脈を添えた判定は、文脈ごとに別) */
export function scoreKey(body: string, prompt: string, context = ''): string {
  return `${bodyKey(body)}|${bodyKey(hypothesisOf(prompt))}${context ? `|${bodyKey(context)}` : ''}`
}

/** 1 レスの判定の結果。p は当たり具合(手で付けたときはない)。sameId は同じ ID の続きとして当てたもの */
export interface AiNgHit {
  rule: AiNgRule
  sameId?: boolean
  /** 数えるときに使う(判定の中だけ) */
  no?: number
  id?: string
  p?: number
  manual: boolean
}

/** 見せ方の強さ(当たった条件が複数あれば、強いものを使う) */
const STRENGTH: Record<AiNgShow, number> = { hide: 3, fold: 2, mark: 1 }

/** いま効いている条件(有効で、この板に効くもの) */
export function activeRules(rules: AiNgRule[], boardUrl: string | undefined): AiNgRule[] {
  return rules.filter((r) => r.enabled && r.prompt.trim() !== '' && (!r.boardUrl || r.boardUrl === boardUrl))
}

/**
 * スレのレスを判定する。scoreOf はモデルの当たり具合(まだ出ていなければ undefined)。
 * 手で付けた「当たらない」はその条件を外し、「当たる」はモデルより先に当てる
 */
export function judgeAiNg(
  posts: Post[],
  rules: AiNgRule[],
  scoreOf: (body: string, prompt: string, context?: string) => number | undefined,
  overrides: Record<string, AiNgOverride>,
  learned: Map<string, RuleModel> = new Map(),
  /** スレの話題(withContext の条件に添える) */
  context = '',
): Map<number, AiNgHit> {
  const out = new Map<number, AiNgHit>()
  if (rules.length === 0) return out
  const sets = new Map(rules.map((r) => [r.id, { hit: new Set(overrides[r.id]?.hit ?? []), miss: new Set(overrides[r.id]?.miss ?? []) }]))
  /** 条件ごとの、当たったレス(sameId のために数える) */
  const hitsByRule = new Map<string, AiNgHit[]>()
  const hitOf = new Map<number, AiNgHit[]>()
  for (const p of posts) {
    if (aiTextOf(p.body) === '') continue
    const key = bodyKey(p.body)
    for (const r of rules) {
      const o = sets.get(r.id)!
      if (o.miss.has(key)) continue
      let hit: AiNgHit | undefined
      if (o.hit.has(key)) hit = { rule: r, manual: true }
      else {
        const m = scoreOf(p.body, r.prompt, r.withContext ? context : undefined)
        // 印から学んでいれば、モデルの当たり具合と半々に混ぜる
        const lm = learned.get(r.id)
        const s = m === undefined ? undefined : lm ? (m + predictRule(lm, p.body)) / 2 : m
        if (s !== undefined && s >= r.threshold) hit = { rule: r, p: s, manual: false }
      }
      if (!hit) continue
      hitOf.set(p.no, [...(hitOf.get(p.no) ?? []), hit])
      hitsByRule.set(r.id, [...(hitsByRule.get(r.id) ?? []), { ...hit, no: p.no, id: p.id }])
    }
  }
  // 同じ ID が 2 回以上当たった条件は、その ID の書き込みをすべて当てる(手で「当たらない」を付けたものは除く)
  for (const r of rules) {
    if (!r.sameId) continue
    const ids = new Map<string, number>()
    for (const h of hitsByRule.get(r.id) ?? []) if (h.id) ids.set(h.id, (ids.get(h.id) ?? 0) + 1)
    for (const p of posts) {
      if (!p.id || (ids.get(p.id) ?? 0) < 2 || hitOf.get(p.no)?.some((h) => h.rule.id === r.id)) continue
      if (sets.get(r.id)!.miss.has(bodyKey(p.body))) continue
      hitOf.set(p.no, [...(hitOf.get(p.no) ?? []), { rule: r, manual: false, sameId: true }])
    }
  }
  for (const [no, hits] of hitOf) {
    let best = hits[0]
    for (const h of hits) if (STRENGTH[h.rule.show] > STRENGTH[best.rule.show]) best = h
    out.set(no, best)
  }
  return out
}

/** 手の印を付ける・外す。mark が null なら外す */
export function setOverride(
  overrides: Record<string, AiNgOverride>,
  ruleId: string,
  body: string,
  mark: 'hit' | 'miss' | null,
): Record<string, AiNgOverride> {
  const key = bodyKey(body)
  const cur = overrides[ruleId] ?? { hit: [], miss: [] }
  const hit = cur.hit.filter((k) => k !== key)
  const miss = cur.miss.filter((k) => k !== key)
  const text = aiTextOf(body)
  const examples = (cur.examples ?? []).filter((e) => e.text !== text)
  if (mark === 'hit') hit.push(key)
  if (mark === 'miss') miss.push(key)
  if (mark && text) examples.push({ text, hit: mark === 'hit' })
  return { ...overrides, [ruleId]: { hit: hit.slice(-OVERRIDE_MAX), miss: miss.slice(-OVERRIDE_MAX), examples: examples.slice(-EXAMPLE_MAX) } }
}

/** 画面に出す理由(「AI NG・煽り 87%」) */
export function aiHitLabel(h: AiNgHit): string {
  return `AI NG・${h.rule.name || h.rule.prompt}${h.manual ? '(手で)' : h.sameId ? '(同じ ID の続き)' : h.p !== undefined ? ` ${Math.round(h.p * 100)}%` : ''}`
}

// ── 印から学ぶ判定(条件ごと)。文字の 1〜3 文字の並びを数え、ロジスティック回帰で学ぶ(utils/trollModel.ts と同じ作り) ──

const DIM = 1 << 14

function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) & (DIM - 1)
}

function featuresOf(text: string): Map<number, number> {
  const f = new Map<number, number>()
  const chars = Array.from(text.replace(/\s+/g, '')).slice(0, 300)
  for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= chars.length; i++) {
    const k = hash(chars.slice(i, i + n).join(''))
    f.set(k, (f.get(k) ?? 0) + 1)
  }
  let norm = 0
  for (const v of f.values()) norm += v * v
  norm = Math.sqrt(norm) || 1
  for (const [k, v] of f) f.set(k, v / norm)
  return f
}

export interface RuleModel {
  w: Float32Array
  b: number
}

/** 手の印から学ぶ。当たる・当たらないが MIN_EXAMPLES 件ずつなければ undefined。同じ印なら同じ結果になる */
export function trainRule(examples: { text: string; hit: boolean }[]): RuleModel | undefined {
  const pos = examples.filter((e) => e.hit).length
  const neg = examples.length - pos
  if (pos < MIN_EXAMPLES || neg < MIN_EXAMPLES) return undefined
  const data = examples.map((e) => ({ f: featuresOf(e.text), y: e.hit ? 1 : 0 }))
  const w = new Float32Array(DIM)
  let b = 0
  // 少ない側を重くして、当たる・当たらないの重みをそろえる
  const wPos = examples.length / (2 * pos)
  const wNeg = examples.length / (2 * neg)
  for (let epoch = 0; epoch < 60; epoch++) {
    for (let i = 0; i < data.length; i++) {
      const d = data[(i * 7919 + epoch) % data.length]
      let z = b
      for (const [k, v] of d.f) z += w[k] * v
      const g = (1 / (1 + Math.exp(-z)) - d.y) * (d.y ? wPos : wNeg)
      for (const [k, v] of d.f) w[k] -= 0.3 * (g * v + 1e-4 * w[k])
      b -= 0.3 * g
    }
  }
  return { w, b }
}

export function predictRule(m: RuleModel, body: string): number {
  let z = m.b
  for (const [k, v] of featuresOf(aiTextOf(body))) z += m.w[k] * v
  return 1 / (1 + Math.exp(-z))
}

/** 条件ごとの、印から学んだ判定(学べるだけの印がある条件だけ) */
export function trainRules(rules: AiNgRule[], overrides: Record<string, AiNgOverride>): Map<string, RuleModel> {
  const out = new Map<string, RuleModel>()
  for (const r of rules) {
    const m = trainRule(overrides[r.id]?.examples ?? [])
    if (m) out.set(r.id, m)
  }
  return out
}
