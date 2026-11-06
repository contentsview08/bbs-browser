// 印から学ぶ判定(utils/aiNg.ts・utils/trollModel.ts)に共通の、文字の並びの特徴量。
// ハッシュの値を変えると、学び直しの結果が変わる

function hash(s: string, dim: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) & (dim - 1)
}

/** 文字の 1〜3 文字の並びを数え、長さ 1 にそろえた疎なベクトル(添字 → 値)。dim は 2 の冪 */
export function ngramFeatures(chars: string[], dim: number): Map<number, number> {
  const f = new Map<number, number>()
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= chars.length; i++) {
      const k = hash(chars.slice(i, i + n).join(''), dim)
      f.set(k, (f.get(k) ?? 0) + 1)
    }
  }
  let norm = 0
  for (const v of f.values()) norm += v * v
  norm = Math.sqrt(norm) || 1
  for (const [k, v] of f) f.set(k, v / norm)
  return f
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))
