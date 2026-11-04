// ワッチョイ(名前の後ろの「(ワッチョイ 1a2b-3c4d)」。種類の言葉 + 4 桁-4 桁。後ろに [IP] が付くことも。スップ・アウアウ・オッペケ なども同じ形)
const WATCHOI = /[(（]([^\s()（）]{1,12})\s+([0-9A-Za-z]{4})-([0-9A-Za-z]{4})(?:\s+\[[^\]]*\])?[)）]/

/** 名前からワッチョイの「1a2b-3c4d」を取り出す。なければ undefined(アイコンの種・同じ人の判定に) */
export function watchoiOf(name: string): string | undefined {
  const m = WATCHOI.exec(name)
  return m ? `${m[2]}-${m[3]}` : undefined
}

/** ワッチョイを短く「(1a2b-3c4d)」にする(種類の言葉と IP を省く)。なければそのまま */
export function shortWatchoi(name: string): string {
  return name.replace(WATCHOI, (_m, _kind: string, a: string, b: string) => `(${a}-${b})`)
}

/** アイコンの種と数字の数え方の鍵: 設定でワッチョイを使うなら、あればワッチョイ、なければ ID */
export function iconKeyOf(post: { id?: string; name: string }, fromWatchoi: boolean | undefined): string | undefined {
  return (fromWatchoi ? watchoiOf(post.name) : undefined) ?? post.id
}

/** 鍵ごとの書き込み数(アイコンの右下の数字) */
export function countIconKeys(posts: { id?: string; name: string }[], fromWatchoi: boolean | undefined): Map<string, number> {
  const counts = new Map<string, number>()
  for (const p of posts) {
    const k = iconKeyOf(p, fromWatchoi)
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
}
