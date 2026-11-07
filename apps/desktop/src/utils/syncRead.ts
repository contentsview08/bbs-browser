// 同期で届いた既読を画面へ写す決まり。読んでいる最中の画面を動かさない

/** 開いているタブの既読。上がるときだけ追う。下がる(未読に戻った)ときは閉じて開き直すまでそのまま */
export function syncedTabReadNo(tabReadNo: number, dbReadNo: number | undefined): number {
  return dbReadNo === undefined ? tabReadNo : Math.max(tabReadNo, dbReadNo)
}

/** 履歴の一覧は並びを勝手に変えない。今の順のまま値を更新し、消えた行を外し、増えた行を後ろに足す */
export function mergeSyncedHistory<T extends { thread: { boardUrl: string; key: string } }>(current: T[], fresh: T[]): T[] {
  const id = (x: T) => `${x.thread.boardUrl}\t${x.thread.key}`
  const byId = new Map(fresh.map((x) => [id(x), x]))
  const seen = new Set(current.map(id))
  return [...current.flatMap((x) => byId.get(id(x)) ?? []), ...fresh.filter((x) => !seen.has(id(x)))]
}
