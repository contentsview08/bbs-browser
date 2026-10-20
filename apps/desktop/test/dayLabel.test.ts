import { describe, expect, it } from 'vitest'
import { dayLabel } from '../src/utils/thread'

describe('日ごとの見出し(書き込み履歴・アップロード履歴)', () => {
  it('今日・昨日、それより前は月/日(曜日)、去年より前は年も付ける', () => {
    const now = new Date(2026, 9, 20, 9, 0).getTime()
    expect(dayLabel(new Date(2026, 9, 20, 0, 5).getTime(), now)).toBe('今日')
    expect(dayLabel(new Date(2026, 9, 19, 23, 59).getTime(), now)).toBe('昨日')
    expect(dayLabel(new Date(2026, 9, 18, 12, 0).getTime(), now)).toBe('10/18(日)')
    expect(dayLabel(new Date(2025, 11, 31, 12, 0).getTime(), now)).toBe('2025/12/31(水)')
  })
})
