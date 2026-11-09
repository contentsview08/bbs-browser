import { describe, expect, it } from 'vitest'
import { LIVE_MIN_GAP_MS, liveQueueTimes, liveRevealSchedule, postTimeMs } from '../src/utils/liveReveal'

const T = 5000

describe('日時の文字から書き込みの時刻を読む', () => {
  const at = (iso: string) => Date.parse(iso)

  it('5ch(秒の下 2 桁まで)', () => {
    expect(postTimeMs('2026/11/09(月) 00:01:43.12')).toBe(at('2026-11-09T00:01:43.120+09:00'))
  })

  it('後ろに ID などが続いてもよい', () => {
    expect(postTimeMs('2026/11/09(月) 00:01:43.12 ID:abcd1234')).toBe(at('2026-11-09T00:01:43.120+09:00'))
  })

  it('hono-bbs(アプリの形は秒の下 3 桁・API は ISO)', () => {
    expect(postTimeMs('2026/11/09(月) 00:01:43.120')).toBe(at('2026-11-09T00:01:43.120+09:00'))
    expect(postTimeMs('2026-11-08T15:01:43.120Z')).toBe(at('2026-11-09T00:01:43.120+09:00'))
    expect(postTimeMs('2026-11-09T00:01:43+09:00')).toBe(at('2026-11-09T00:01:43+09:00'))
  })

  it('したらば・まちBBS(秒まで)', () => {
    expect(postTimeMs('2026/10/17(金) 10:00:05')).toBe(at('2026-10-17T10:00:05+09:00'))
  })

  it('ふたば(年が 2 桁・曜日と時刻の間に空白なし)', () => {
    expect(postTimeMs('26/11/09(月)00:01:43')).toBe(at('2026-11-09T00:01:43+09:00'))
  })

  it('日本語の年月日時分秒', () => {
    expect(postTimeMs('2026年11月09日(月) 00時01分43秒')).toBe(at('2026-11-09T00:01:43+09:00'))
  })

  it('秒がない・読めないものは null', () => {
    expect(postTimeMs('2026/11/09(月) 00:01')).toBeNull()
    expect(postTimeMs('2026-11-09 00:01')).toBeNull()
    expect(postTimeMs('あぼーん')).toBeNull()
    expect(postTimeMs('')).toBeNull()
    expect(postTimeMs('2026/13/09(月) 00:01:43')).toBeNull()
  })

  it('同じ日の中の差は、そのまま ms の差になる', () => {
    expect(postTimeMs('2026/11/09(月) 00:01:44.50')! - postTimeMs('2026/11/09(月) 00:01:43.12')!).toBe(1380)
  })
})

describe('ライブの段で出す時刻', () => {
  const base = 1_000_000

  it('秒まで分かる: 基準からの差だけ遅らせる(1 秒後と 4 秒後に書かれたら、更新から 1 秒後と 4 秒後)', () => {
    expect(liveRevealSchedule([base + 1000, base + 4000], base, T)).toEqual([1000, 4000])
  })

  it('秒まで分かる: 差が T を超えるなら、比を保ったまま T の中に縮める', () => {
    expect(liveRevealSchedule([base + 2000, base + 10_000], base, T)).toEqual([1000, 5000])
    // 静かだった後の 1 件は、T のところ
    expect(liveRevealSchedule([base + 60_000], base, T)).toEqual([5000])
    // 長く静かだった後は、その空白を除いて時刻の差どおりに出す
    expect(liveRevealSchedule([base + 60_500, base + 62_500, base + 64_500], base, T)).toEqual([1000, 3000, 5000])
    expect(liveRevealSchedule([base + 60_000, base + 70_000], base, T)).toEqual([0, 5000])
  })

  it('同じ時刻に書かれたレスも、1 件ずつ(0.1 秒は空ける)', () => {
    expect(liveRevealSchedule([base + 1000, base + 1000, base + 1000], base, T)).toEqual([1000, 1100, 1200])
  })

  it('秒が分からない(どれか 1 件でも読めない)なら、T ÷ N の等間隔', () => {
    expect(liveRevealSchedule([null, null], base, T)).toEqual([2500, 5000])
    expect(liveRevealSchedule([base + 1000, null, base + 3000, base + 4000], base, T)).toEqual([1250, 2500, 3750, 5000])
  })

  it('基準の時刻が分からないなら、等間隔', () => {
    expect(liveRevealSchedule([base + 1000, base + 4000], null, T)).toEqual([2500, 5000])
  })

  it('順番が前後する(後のレスの方が古い・基準より古い)なら、等間隔', () => {
    expect(liveRevealSchedule([base + 3000, base + 1000], base, T)).toEqual([2500, 5000])
    expect(liveRevealSchedule([base - 1000, base + 1000], base, T)).toEqual([2500, 5000])
  })

  it('多すぎて 1 件あたり 0.1 秒を切るなら、0.1 秒ごと(T を超えた分も続ける)', () => {
    const d = liveRevealSchedule(Array(80).fill(null), base, T)
    expect(d[0]).toBe(LIVE_MIN_GAP_MS)
    expect(d[1] - d[0]).toBe(LIVE_MIN_GAP_MS)
    expect(d.at(-1)).toBe(8000)
    // 時刻が分かっても、詰まりすぎたら 0.1 秒ごと
    const times = Array.from({ length: 80 }, (_, i) => base + i * 10)
    const e = liveRevealSchedule(times, base, T)
    expect(e[0]).toBe(0)
    expect(e.at(-1)).toBe(7900)
  })

  it('届いていなければ空', () => {
    expect(liveRevealSchedule([], base, T)).toEqual([])
  })
})

describe('出す予定を時刻にする', () => {
  it('前の分が残っていなければ、更新の時刻 + 遅れ', () => {
    expect(liveQueueTimes(10_000, [1000, 4000], undefined, T)).toEqual({ at: [11_000, 14_000], flush: false })
  })

  it('前の分が残っていれば、その後ろに続ける', () => {
    expect(liveQueueTimes(10_000, [0, 100], 10_500, T)).toEqual({ at: [10_600, 10_700], flush: false })
  })

  it('T の 3 倍より先まで溜まったら、全部出す', () => {
    expect(liveQueueTimes(10_000, [1000], 24_850, T).flush).toBe(false)
    expect(liveQueueTimes(10_000, [1000], 25_000, T).flush).toBe(true)
  })
})
