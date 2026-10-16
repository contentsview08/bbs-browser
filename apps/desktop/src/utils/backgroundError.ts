// 裏で行う処理(既読の保存・下書きの保存・設定の保存など)の失敗を拾う。
// 待たずに流している処理は、失敗しても誰も気づかないので、記録して、同じ種類は 1 回だけ画面に知らせる

type Listener = (what: string, error: unknown) => void

let listener: Listener | undefined
const told = new Set<string>()

/** 画面に知らせる方法を決める(App が通知を出す) */
export function onBackgroundError(l: Listener) {
  listener = l
}

/** promise.catch(backgroundError('既読の保存')) のように使う */
export function backgroundError(what: string): (error: unknown) => void {
  return (error) => {
    console.error(`${what}に失敗しました`, error)
    if (told.has(what)) return
    told.add(what)
    listener?.(what, error)
  }
}
