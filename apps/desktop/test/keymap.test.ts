import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYMAP, actionFor, installTextInputGuard, isImeKey, isTextEditKey, keyEventsOf, createKeyReader, keyString, leaveToTextInput, reservedKeyName, resolveKeymap, setActionKeys } from '../src/utils/keymap'

const k = (key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: false,
})

describe('setActionKeys', () => {
  it('既定に戻すキーがほかの操作に付いていれば、そちらから外す', () => {
    const moved = setActionKeys(DEFAULT_KEYMAP, 'favorite', ['S', 'R'])
    expect(moved.refresh).toEqual([])
    const back = setActionKeys(moved, 'refresh', DEFAULT_KEYMAP.refresh)
    expect(back.refresh).toEqual(['R'])
    expect(back.favorite).toEqual(['S'])
  })

  it('元の表は変えない', () => {
    setActionKeys(DEFAULT_KEYMAP, 'favorite', ['R'])
    expect(DEFAULT_KEYMAP.refresh).toEqual(['R'])
    expect(DEFAULT_KEYMAP.favorite).toEqual(['S'])
  })
})

describe('keyString', () => {
  it('英字は大文字にそろえ、Shift で区別する', () => {
    expect(keyString(k('j'))).toBe('J')
    expect(keyString(k('G', { shift: true }))).toBe('Shift+G')
    expect(keyString(k('f', { ctrl: true }))).toBe('Ctrl+F')
  })

  it('記号は Shift を付けずに文字で表す', () => {
    expect(keyString(k('/'))).toBe('/')
    expect(keyString(k('?', { shift: true }))).toBe('?')
  })

  it('スペースと名前のあるキー', () => {
    expect(keyString(k(' '))).toBe('Space')
    expect(keyString(k(' ', { shift: true }))).toBe('Shift+Space')
    expect(keyString(k('F5'))).toBe('F5')
    expect(keyString(k('End', { shift: true }))).toBe('Shift+End')
  })

  it('修飾キーだけなら何もしない', () => {
    expect(keyString(k('Shift', { shift: true }))).toBeUndefined()
  })
})

describe('actionFor', () => {
  it('既定の割り当て', () => {
    expect(actionFor(DEFAULT_KEYMAP, 'J')).toBe('nextPost')
    expect(actionFor(DEFAULT_KEYMAP, 'Shift+G')).toBe('bottom')
    expect(actionFor(DEFAULT_KEYMAP, 'R')).toBe('refresh')
    expect(actionFor(DEFAULT_KEYMAP, 'X')).toBe('closeTab')
    expect(actionFor(DEFAULT_KEYMAP, 'Shift+J')).toBe('nextTab')
    expect(actionFor(DEFAULT_KEYMAP, 'N')).toBe('unread')
    expect(actionFor(DEFAULT_KEYMAP, 'Q')).toBeUndefined()
  })

  it('既定の割り当てで、同じキーを 2 つの操作に使っていない', () => {
    const all = Object.values(DEFAULT_KEYMAP).flat()
    expect(new Set(all).size).toBe(all.length)
  })

  it('保存してある割り当てに、増えた操作の既定値を足す', () => {
    const km = resolveKeymap({ nextPost: ['Q'] })
    expect(actionFor(km, 'Q')).toBe('nextPost')
    expect(actionFor(km, 'J')).toBeUndefined()
    expect(actionFor(km, 'K')).toBe('prevPost')
  })
})

describe('createKeyReader: 2 つ続けて押すキー', () => {
  it('G を 2 回で先頭へ。1 回では何もしない。3 回目は組にしない', () => {
    const read = createKeyReader()
    expect(read(DEFAULT_KEYMAP, k('g'))).toBeUndefined()
    expect(read(DEFAULT_KEYMAP, k('g'))).toBe('top')
    expect(read(DEFAULT_KEYMAP, k('g'))).toBeUndefined()
    expect(read(DEFAULT_KEYMAP, k('G', { shift: true }))).toBe('bottom')
    expect(read(DEFAULT_KEYMAP, k('j'))).toBe('nextPost')
  })
})

describe('keyEventsOf: 割り当てたキーを、押したことにするキーにする', () => {
  it('keyString と行き来できる', () => {
    for (const k of ['J', 'Shift+G', 'Ctrl+F', 'Space', 'Shift+Space', '/', 'ArrowDown', 'Ctrl++', 'Ctrl+-']) {
      const [e] = keyEventsOf(k)
      expect(keyString(e)).toBe(k)
    }
    expect(keyEventsOf('G G').map((e) => e.key)).toEqual(['g', 'g'])
  })
})

describe('決め打ちのキー', () => {
  it('既定の割り当てに、決め打ちのキーは入っていない', () => {
    for (const keys of Object.values(DEFAULT_KEYMAP)) for (const key of keys) expect(reservedKeyName(key), key).toBeUndefined()
  })
  it('Esc・Ctrl+Enter・数字は割り当てられない(Ctrl+W は「タブを閉じる」の割り当てで変えられる)', () => {
    expect(reservedKeyName('Escape')).toBeDefined()
    expect(reservedKeyName('Ctrl+Enter')).toBe('書き込む')
    expect(reservedKeyName(keyString(k('w', { ctrl: true }))!)).toBeUndefined()
    expect(reservedKeyName('3')).toBeDefined()
    expect(reservedKeyName('J')).toBeUndefined()
  })
})

describe('IME・入力欄に任せるキー', () => {
  const field = { tagName: 'TEXTAREA', isContentEditable: false } as unknown as EventTarget
  const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget
  const body = { tagName: 'BODY', isContentEditable: false } as unknown as EventTarget
  const ev = (key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}, extra: { keyCode?: number; isComposing?: boolean; target?: EventTarget } = {}) => ({
    ...k(key, mods),
    keyCode: extra.keyCode ?? 0,
    isComposing: extra.isComposing ?? false,
    target: 'target' in extra ? (extra.target as EventTarget) : field,
  })

  it('変換中のキーは、どこでも・どのキーでも割り当てに回さない', () => {
    expect(isImeKey(ev('t', { ctrl: true }, { isComposing: true }))).toBe(true)
    expect(isImeKey(ev('Process', { ctrl: true }, { keyCode: 229 }))).toBe(true)
    // 変換を確定する Enter(Safari などは isComposing を立てずに 229 で送る)
    expect(isImeKey(ev('Enter', {}, { keyCode: 229 }))).toBe(true)
    expect(leaveToTextInput(ev('j', {}, { isComposing: true, target: body }))).toBe(true)
    expect(leaveToTextInput(ev('F5', {}, { isComposing: true }))).toBe(true)
    expect(isImeKey(ev('t', { ctrl: true }))).toBe(false)
  })

  it('欄の中の Ctrl+T・F6〜F10・Ctrl+U/I/O/P・Ctrl+A/Z などは取らない', () => {
    for (const key of ['t', 'u', 'i', 'o', 'p', 'a', 'c', 'v', 'x', 'z', 'y', 'Backspace', 'ArrowLeft', 'Home', ' ']) {
      expect(leaveToTextInput(ev(key, { ctrl: true })), `Ctrl+${key}`).toBe(true)
    }
    expect(leaveToTextInput(ev('Z', { ctrl: true, shift: true }))).toBe(true)
    for (const key of ['F6', 'F7', 'F8', 'F9', 'F10']) expect(leaveToTextInput(ev(key)), key).toBe(true)
    expect(leaveToTextInput(ev('F10', { shift: true }))).toBe(true)
    expect(leaveToTextInput(ev('t', { ctrl: true }, { target: editable }))).toBe(true)
  })

  it('欄の中でも、Ctrl+W・Ctrl+Tab・Alt+←・F5 などアプリ全体のキーは今までどおり', () => {
    for (const e of [ev('w', { ctrl: true }), ev('Tab', { ctrl: true }), ev('ArrowLeft', { alt: true }), ev('F5'), ev('l', { ctrl: true }), ev('k', { ctrl: true }), ev('f', { ctrl: true })]) {
      expect(leaveToTextInput(e), keyString(e)).toBe(false)
    }
  })

  it('欄の外では、編集のキーも割り当てに回す', () => {
    expect(isTextEditKey(ev('t', { ctrl: true }))).toBe(true)
    expect(leaveToTextInput(ev('t', { ctrl: true }, { target: body }))).toBe(false)
    expect(leaveToTextInput(ev('F10', {}, { target: body }))).toBe(false)
    expect(leaveToTextInput(ev('a', { ctrl: true }, { target: null as unknown as EventTarget }))).toBe(false)
  })

  it('止めたキーは、あとから付けたキー操作に届かない(既定の動きは止めない)', () => {
    const listeners: ((e: Event) => void)[] = []
    const win = { addEventListener: (_: string, f: (e: Event) => void) => listeners.push(f) } as unknown as Window
    installTextInputGuard(win)
    const fire = (e: ReturnType<typeof ev>) => {
      let stopped = false
      let prevented = false
      const event = { ...e, stopImmediatePropagation: () => (stopped = true), preventDefault: () => (prevented = true) }
      listeners[0](event as unknown as Event)
      return { stopped, prevented }
    }
    // Ctrl+T を割り当てに使っていても(設定で付けられる)、欄の中なら届かない
    expect(actionFor(setActionKeys(DEFAULT_KEYMAP, 'reopenTab', ['Ctrl+T']), 'Ctrl+T')).toBe('reopenTab')
    expect(fire(ev('t', { ctrl: true }))).toEqual({ stopped: true, prevented: false })
    expect(fire(ev('Process', {}, { keyCode: 229, target: body }))).toEqual({ stopped: true, prevented: false })
    expect(fire(ev('w', { ctrl: true }))).toEqual({ stopped: false, prevented: false })
  })
})
