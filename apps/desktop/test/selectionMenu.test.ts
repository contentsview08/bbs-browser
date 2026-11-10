import { describe, expect, it } from 'vitest'
import { quoteLines, selectionMenuItems, urlOfSelection, webSearchUrl } from '../src/utils/selectionMenu'

describe('選んだ文の引用', () => {
  it('各行に「>」を付ける(改行は \\n にそろえる)', () => {
    expect(quoteLines('あいう')).toBe('>あいう')
    expect(quoteLines('一行目\r\n二行目\n\n四行目')).toBe('>一行目\n>二行目\n>\n>四行目')
  })
})

describe('選んだ文が URL らしいか', () => {
  it('http(s)・2ch の ttp・www. で始まるもの', () => {
    expect(urlOfSelection('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(urlOfSelection('ttp://example.com/x')).toBe('http://example.com/x')
    expect(urlOfSelection('ttps://example.com/x')).toBe('https://example.com/x')
    expect(urlOfSelection(' www.example.co.jp/news ')).toBe('https://www.example.co.jp/news')
  })
  it('よく見るドメインだけのものも開く', () => {
    expect(urlOfSelection('5ch.net')).toBe('https://5ch.net')
    expect(urlOfSelection('youtube.com/watch?v=abc')).toBe('https://youtube.com/watch?v=abc')
  })
  it('空白を含む・ファイル名・数字・ただの文は URL にしない', () => {
    expect(urlOfSelection('https://example.com を見て')).toBeUndefined()
    expect(urlOfSelection('index.html')).toBeUndefined()
    expect(urlOfSelection('3.14')).toBeUndefined()
    expect(urlOfSelection('こんにちは')).toBeUndefined()
    expect(urlOfSelection('https://')).toBeUndefined()
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
    openUrl: () => {},
    searchThread: () => {},
    openExternal: () => {},
    ngDraft: () => {},
    postItems: [{ label: '返信', icon: 'reply' }],
  }
  const labels = (text: string, a: Parameters<typeof selectionMenuItems>[1]) => selectionMenuItems(text, a).map((x) => x.label)

  it('すべて使えるときの並び(URL でなければ「リンクを開く」は出さない)', () => {
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
  it('URL らしければ「リンクを開く」を出し、開くのは直した URL', () => {
    let opened = ''
    const items = selectionMenuItems('ttp://example.com', { ...all, openUrl: (u) => (opened = u) })
    items.find((x) => x.label === 'リンクを開く')!.onClick!()
    expect(opened).toBe('http://example.com')
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
