import { describe, expect, it } from 'vitest'
import { quoteLines, selectionMenuItems, webSearchUrl } from '../src/utils/selectionMenu'

describe('選んだ文の引用', () => {
  it('各行に「>」を付ける(改行は \\n にそろえる)', () => {
    expect(quoteLines('あいう')).toBe('>あいう')
    expect(quoteLines('一行目\r\n二行目\n\n四行目')).toBe('>一行目\n>二行目\n>\n>四行目')
  })
})

describe('外部のブラウザでの検索', () => {
  it('Google の検索の URL。空白・改行は 1 つの空白に', () => {
    expect(webSearchUrl('猫 かわいい\n動画')).toBe(`https://www.google.com/search?q=${encodeURIComponent('猫 かわいい 動画')}`)
  })
})

describe('文字を選んだときの右クリックの項目', () => {
  const all = {
    copy: () => {},
    quoteReply: () => {},
    searchThread: () => {},
    openExternal: () => {},
    ngDraft: () => {},
    postItems: [{ label: '返信', icon: 'reply' }],
  }
  const labels = (text: string, a: Parameters<typeof selectionMenuItems>[1]) => selectionMenuItems(text, a).map((x) => x.label)

  it('すべて使えるときの並び', () => {
    expect(labels('猫', all)).toEqual([
      'コピー',
      '引用して返信',
      '引用をコピー',
      'このスレで検索',
      'Google で「猫」を検索',
      '選んだ文字を NG に(直して足す)',
      'このレスの操作',
    ])
  })
  it('書き込めない・NG の画面がない・レスの操作がないときは、その項目を出さない', () => {
    expect(labels('猫', { copy: () => {} })).toEqual(['コピー', '引用をコピー'])
  })
  it('引用をコピーは「>」付き、コピーはそのまま', () => {
    const copied: string[] = []
    const items = selectionMenuItems('a\nb', { copy: (t) => copied.push(t) })
    for (const x of items) x.onClick!()
    expect(copied).toEqual(['a\nb', '>a\n>b'])
  })
  it('長い文は検索の項目の名前で縮める', () => {
    expect(labels('あいうえおかきくけこさしすせそたちつてと', all)).toContain('Google で「あいうえおかきくけこさしすせそ…」を検索')
  })
})
