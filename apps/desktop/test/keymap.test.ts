import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYMAP, actionFor, createKeyReader, keyString, resolveKeymap } from '../src/utils/keymap'

const k = (key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: false,
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
