import { describe, expect, it } from 'vitest'

describe('スマホの名前からキーの案内を外す', () => {
  it('括弧の中にキーの名前があれば外し、ほかの括弧は残す', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Linux; Android 14)' }, configurable: true })
    const { uiLabel } = await import('../src/utils/platform')
    expect(uiLabel('ログを削除して閉じる (Shift+Delete)')).toBe('ログを削除して閉じる')
    expect(uiLabel('絞り込みを外す(5 キー・Esc)')).toBe('絞り込みを外す')
    expect(uiLabel('スレを保存(HTML・テキスト)')).toBe('スレを保存(HTML・テキスト)')
  })
})
