// 実況モードのライブの段で、更新で届いたレスをいつ出すかの決まり(bbs-suite の docs/autoscroll.md)。
// ここは日時の読み取りと出す時刻の計算だけ。タイマーと画面は hooks/useAutoScroll.ts。スマホ版も同じ式で出す。

/** 1 件ずつ出すときの、いちばん短い間(ms)。これより詰めると 1 件ずつに見えない */
export const LIVE_MIN_GAP_MS = 100
/** 出す予定が、更新の間隔のこの倍より先まで溜まったら、待たずに全部出す */
export const LIVE_FLUSH_INTERVALS = 3

/** 時差の書いていない日時は日本時間として読む(5ch・したらば・まちBBS・ふたばはどれも日本時間) */
const JST_OFFSET_MS = 9 * 3600_000

/**
 * レスの日時の文字から、書き込みの時刻(ms)を読む。秒まで書いていなければ null(秒がないと 1 分の中の順が分からない)。
 * 読める形:
 * - 5ch・hono-bbs(アプリの形): `2026/11/09(月) 00:01:43.12`(ID などが後ろに続いてもよい)
 * - したらば・まちBBS: `2026/11/09(月) 00:01:43`
 * - ふたば: `26/11/09(月)00:01:43`(年が 2 桁)
 * - ISO: `2026-11-09T00:01:43.120Z`・`2026-11-09T09:01:43+09:00`
 * - 日本語: `2026年11月09日 00時01分43秒`
 */
export function postTimeMs(date: string): number | null {
  const m =
    /(\d{4}|\d{2})[/\-年.](\d{1,2})[/\-月.](\d{1,2})日?\s*(?:[(（][^)）]{0,8}[)）])?\s*T?\s*(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(date) ??
    /(\d{4})年(\d{1,2})月(\d{1,2})日[^0-9]{0,10}?(\d{1,2})時(\d{1,2})分(\d{1,2})秒()()/.exec(date)
  if (!m) return null
  const year = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1])
  const [month, day, hour, min, sec] = [m[2], m[3], m[4], m[5], m[6]].map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || min > 59 || sec > 59) return null
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0
  let offset = JST_OFFSET_MS
  if (m[8] === 'Z') offset = 0
  else if (m[8]) {
    const z = m[8].replace(':', '')
    offset = (z[0] === '-' ? -1 : 1) * (Number(z.slice(1, 3)) * 3600_000 + Number(z.slice(3, 5)) * 60_000)
  }
  const t = Date.UTC(year, month - 1, day, hour, min, sec, ms) - offset
  return Number.isFinite(t) ? t : null
}

/**
 * 更新で届いたレスを、更新から何 ms 後に出すか(届いた順に、1 件ずつ)。
 * - postTimesMs: 届いたレスの書き込みの時刻(postTimeMs。読めなければ null)
 * - baseTimeMs: 前の更新で最後に出したレスの書き込みの時刻(読めなければ null)
 * - intervalMs: 更新の間隔 T
 * 時刻が全部読めて、基準から順に並んでいれば、基準からの差だけ遅らせる(差が T を超えるなら、比を保ったまま T の中に縮める)。
 * そうでなければ T ÷ N ごとの等間隔。どちらも 1 件あたり LIVE_MIN_GAP_MS より詰めず、詰めきれない分は T を超えて続ける
 */
export function liveRevealSchedule(postTimesMs: (number | null)[], baseTimeMs: number | null, intervalMs: number): number[] {
  const n = postTimesMs.length
  if (n === 0) return []
  const T = Math.max(0, intervalMs)
  let delays: number[]
  if (baseTimeMs !== null && inOrder(postTimesMs, baseTimeMs)) {
    const times = postTimesMs as number[]
    // 基準から T より長く静かだったときは、その空白を数えない(届いた分が T の終わりにまとまって出ないように)
    const base = times[0] - baseTimeMs > T ? Math.min(times[0], times[n - 1] - T) : baseTimeMs
    const diffs = times.map((t) => t - base)
    const span = diffs[n - 1]
    delays = span > T ? diffs.map((d) => (d * T) / span) : diffs
  } else {
    const gap = Math.max(T / n, LIVE_MIN_GAP_MS)
    delays = postTimesMs.map((_, i) => gap * (i + 1))
  }
  for (let i = 1; i < n; i++) delays[i] = Math.max(delays[i], delays[i - 1] + LIVE_MIN_GAP_MS)
  return delays.map((d) => Math.round(d))
}

/** 時刻が全部読めて、基準から後ろへ順に並んでいるか */
function inOrder(times: (number | null)[], base: number): times is number[] {
  let prev = base
  for (const t of times) {
    if (t === null || t < prev) return false
    prev = t
  }
  return true
}

/**
 * 出す予定(liveRevealSchedule の遅れ)を、時刻(ms)の列にする。
 * まだ出していない前の分があれば(lastQueuedAtMs)、その後ろに LIVE_MIN_GAP_MS ずつ空けて続ける。
 * 最後が更新の間隔の LIVE_FLUSH_INTERVALS 倍より先になるほど溜まったら flush(待たずに全部出して一番下へ)
 */
export function liveQueueTimes(nowMs: number, delaysMs: number[], lastQueuedAtMs: number | undefined, intervalMs: number): { at: number[]; flush: boolean } {
  let prev = lastQueuedAtMs ?? -Infinity
  const at = delaysMs.map((d) => {
    const t = Math.max(nowMs + d, prev + LIVE_MIN_GAP_MS)
    prev = t
    return t
  })
  const last = at.at(-1)
  return { at, flush: last !== undefined && last - nowMs > Math.max(0, intervalMs) * LIVE_FLUSH_INTERVALS }
}
