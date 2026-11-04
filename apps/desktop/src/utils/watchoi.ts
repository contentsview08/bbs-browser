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
