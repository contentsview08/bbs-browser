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

/** 板の一覧の既読。DB の値を元に、スレごとに大きい方を取る(画面が先に進めて DB の書き込みがまだのものを戻さない) */
export function mergeSyncedStates<T extends { readNo: number }>(current: ReadonlyMap<string, T>, fromDb: ReadonlyMap<string, T>): Map<string, T> {
  const out = new Map(fromDb)
  for (const [key, row] of fromDb) {
    const cur = current.get(key)
    if (cur && cur.readNo > row.readNo) out.set(key, { ...row, readNo: cur.readNo })
  }
  return out
}

/** 板の URL の書き方の揺れ(http・https、5ch.net・5ch.io)をそろえて比べる */
const boardKey = (url: string) => url.replace(/^https?:\/\//i, '').replace(/(^|\.)5ch\.net(?=[:/])/i, '$15ch.io').toLowerCase()

/** 他の端末のログの削除で手元の行が消えたスレに当たるタブ。行がないだけ(取得中・取得の失敗)のタブは閉じない */
export function droppedTabIds<T extends { id: string; thread: { boardUrl: string; key: string } }>(tabs: readonly T[], dropped: readonly { board_url: string; key: string }[]): string[] {
  const gone = new Set(dropped.map((d) => `${boardKey(d.board_url)}\t${d.key}`))
  return tabs.filter((x) => gone.has(`${boardKey(x.thread.boardUrl)}\t${x.thread.key}`)).map((x) => x.id)
}
