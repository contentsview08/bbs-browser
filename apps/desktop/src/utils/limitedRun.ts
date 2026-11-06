// 同時に動かす数を、全体と同じ相手(ホスト)ごとに抑えて順に処理する

export const SAVE_LIMITS = { total: 3, perHost: 1 }
/** キャッシュから写すのは通信しないので、ディスクを詰まらせない範囲で進める */
export const COPY_LIMITS = { total: 8, perHost: 8 }

export function hostKey(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** signal が止まったら新しく始めない。動いているものの後始末は呼び出し側で行う */
export function runLimited<T>(
  items: T[],
  opts: { limits: { total: number; perHost: number }; keyOf: (item: T) => string; work: (item: T) => Promise<void>; signal?: AbortSignal },
): Promise<void> {
  const waiting = [...items]
  const running = new Map<string, number>()
  let active = 0
  return new Promise((resolve) => {
    const next = () => {
      if (!opts.signal?.aborted) {
        for (let i = 0; i < waiting.length && active < opts.limits.total; ) {
          const key = opts.keyOf(waiting[i])
          const inHost = running.get(key) ?? 0
          if (inHost >= opts.limits.perHost) {
            i++
            continue
          }
          const [item] = waiting.splice(i, 1)
          running.set(key, inHost + 1)
          active++
          void opts
            .work(item)
            .catch(() => undefined)
            .finally(() => {
              running.set(key, (running.get(key) ?? 1) - 1)
              active--
              next()
            })
        }
      }
      if (active === 0 && (waiting.length === 0 || opts.signal?.aborted)) resolve()
    }
    next()
  })
}
