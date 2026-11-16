import { describe, expect, it } from 'vitest'
import { chmateBoardUrl, looksLikeDat, parseChmate, parseIdx, splitDatName, splitThreadUrl, type ChmateRaw } from '../src/utils/chmate'

// 実物のバックアップ(2026-11)の形に合わせた小さな見本
const DAT = ['名無し<>sage<>2026/11/01(日) 09:50:14 ID:aaaa<> 1 つ目 <>てすとスレ', '名無し<><>2026/11/01(日) 09:51:42 ID:bbbb<> 2 つ目 <>', '名無し<><>2026/11/01(日) 09:52:00 ID:aaaa<> 3 つ目 <>'].join('\n') + '\n'
const raw = (over: Partial<ChmateRaw> = {}): ChmateRaw => ({
  texts: {
    'ng/_id.json': JSON.stringify([{ w: 'AZUzoED80', f: 18, ct: 1794819726000 }, { w: 'FoQ1g+Rp0', f: 21, ct: 1671540174339, b: 'news4vip' }]),
    'ng/_word.json': JSON.stringify([{ w: '>>1,2.\\d', f: 33, ct: 1727486203978, b: 'bbs.eddibb.cc%2Fliveedge' }, { w: '', f: 17, ct: 1 }]),
    'ng/_name.json': JSON.stringify([{ w: '(ワッチョイW 834c-nJL5)', f: 17, ct: 1645248890415, b: 'poverty' }]),
    'ng/_title.json': JSON.stringify([{ w: '^\\s*(.\\s+)+.\\s*$', f: 160, ct: 1699058651915, b: 'unknownboard' }]),
    'ng/_be.json': JSON.stringify([{ w: '701569894', f: 16, ct: 1767490160887, b: 'poverty' }]),
    'files/postDataList.json': JSON.stringify([
      { url: 'http://bbs.eddibb.cc/test/read.cgi/liveedge/1791503299/', name: '', mail: 'sage', body: 'そういや', updated: 1791504254597, posted: 1791504254856, confirmed: 'http://bbs.eddibb.cc/test/read.cgi/liveedge/1791503299/47', targetTitle: 'ワイ' },
      { url: 'http://bbs.eddibb.cc/test/read.cgi/liveedge/1791430787/', name: '', mail: '', body: '下書き', updated: 1791432547990, posted: 0, confirmed: null, targetTitle: '' },
    ]),
    'files/keyword_group_list.json': JSON.stringify({ items: [{ id: 1, flags: 16, keyword: '宮崎駿' }, { id: 2, flags: 17, keyword: ' 宮崎駿 ' }, { id: 3, flags: 16, keyword: '' }] }),
  },
  dats: [
    { name: 'bbs.eddibb.cc%2Fliveedge_1791503299.dat', text: DAT, idx: '1791504300000\tW/"x"\n2:1,3:1\n' },
    { name: 'livejupiter_1618048117.dat', text: DAT, idx: '0\tnull\n\n' },
    { name: 'mystery_1.dat', text: DAT, idx: null },
    { name: 'bbs.eddibb.cc%2Fliveedge_1752974175.dat', text: '\u0000'.repeat(64), idx: null },
    { name: 'bbs.p-hotair.com%2Fnews4vip_1171778428.dat', text: 'Code = 404\n', idx: null },
  ],
  bookmarks: [
    { name: 'livejupiter', created: 1618048117, title: '橋下', res_count: 3, read_count: 2, read_state: '{"o":69,"n":"26","r":2,"p":1.0}', access: 1785551620400, posted: 0, flag: 1 },
    { name: 'bbs.eddibb.cc%2Fliveedge', created: 1700000000, title: 'ログのないお気に入り', res_count: 10, read_count: 10, read_state: '{"r":10}', access: 5, posted: 0, flag: 3 },
    { name: 'bbs.eddibb.cc%2Fliveedge', created: 1700000001, title: '見ただけ(★なし)', res_count: 10, read_count: 10, read_state: '{"r":10}', access: 5, posted: 123, flag: 0 },
  ],
  boards: [
    { name: 'livejupiter', server: 'eagle.5ch.net', title: 'なんでも実況(ジュピター)', flag: 1 },
    { name: 'news4vip', server: 'mi.5ch.net', title: 'ニュー速VIP', flag: 5 },
    { name: 'poverty', server: 'greta.5ch.net', title: 'ニュー速(嫌儲)', flag: 2 },
    { name: 'bbs.eddibb.cc%2Fliveedge', server: 'bbs.eddibb.cc', title: 'エッヂ', flag: 1 },
  ],
  ...over,
})

describe('ChMate のバックアップの読み替え', () => {
  it('板の名前 → URL(外部の板はそのまま、5ch の板は boards 表のサーバー)', () => {
    const servers = new Map([['livejupiter', 'eagle.5ch.net']])
    expect(chmateBoardUrl('bbs.eddibb.cc%2Fliveedge', servers)).toBe('https://bbs.eddibb.cc/liveedge/')
    expect(chmateBoardUrl('jbbs.livedoor.jp%2Fsports%2F40235', servers)).toBe('https://jbbs.livedoor.jp/sports/40235/')
    expect(chmateBoardUrl('livejupiter', servers)).toBe('https://eagle.5ch.io/livejupiter/')
    expect(chmateBoardUrl('poverty', servers)).toBeUndefined()
  })
  it('dat の名前と idx と書き込みの URL', () => {
    expect(splitDatName('bbs.eddibb.cc%2Fliveedge_1791503299.dat')).toEqual({ board: 'bbs.eddibb.cc%2Fliveedge', key: '1791503299' })
    expect(splitDatName('livejupiter_1618048117.idx')).toEqual({ board: 'livejupiter', key: '1618048117' })
    expect(parseIdx('1766689441000\t\n7:1,15:1,7:2\n')).toEqual({ lastModified: 1766689441000, ownNos: [7, 15] })
    expect(parseIdx('0\tnull\n482:1\n')).toEqual({ lastModified: 0, ownNos: [482] })
    expect(parseIdx(null)).toEqual({ lastModified: 0, ownNos: [] })
    expect(splitThreadUrl('http://bbs.eddibb.cc/test/read.cgi/liveedge/1791503299/')).toEqual({ boardUrl: 'https://bbs.eddibb.cc/liveedge/', key: '1791503299' })
  })
  it('スレのログ: 既読・自分の印・お気に入り・見た時刻', () => {
    const r = parseChmate(raw(), 1000)
    const edge = r.threads.find((t) => t.key === '1791503299')!
    expect(edge.boardUrl).toBe('https://bbs.eddibb.cc/liveedge/')
    expect(edge.title).toBe('てすとスレ')
    expect(edge.posts.length).toBe(3)
    expect(edge.readNo).toBe(3) // お気に入りでなければ全部読んだことにする
    expect(edge.ownNos).toEqual([2, 3])
    expect(edge.favorite).toBe(false)
    expect(edge.viewedAt).toBe(1791504300000)
    const jup = r.threads.find((t) => t.key === '1618048117')!
    expect(jup.boardUrl).toBe('https://eagle.5ch.io/livejupiter/')
    expect(jup.favorite).toBe(true)
    expect(jup.readNo).toBe(3) // ChMate の読んだ位置(r=2)は使わず、全部読んだことにする
    expect(jup.viewedAt).toBe(1785551620400) // idx の最終更新が 0 なら access
    // ログのないお気に入りも、お気に入りとしては入る
    const noLog = r.threads.find((t) => t.key === '1700000000')!
    expect(noLog.favorite).toBe(true)
    expect(noLog.posts.length).toBe(0)
    expect(noLog.title).toBe('ログのないお気に入り')
    // ★ のない行(見ただけ・書き込んだだけ)は、ログがなければ入れない。ログがあっても favorite にしない
    expect(r.threads.some((t) => t.key === '1700000001')).toBe(false)
  })
  it('お気に入りの板は boards 表の flag の 1 のビット', () => {
    expect(parseChmate(raw()).favoriteBoards).toEqual([
      { url: 'https://eagle.5ch.io/livejupiter/', name: 'なんでも実況(ジュピター)' },
      { url: 'https://mi.5ch.io/news4vip/', name: 'ニュー速VIP' },
      { url: 'https://bbs.eddibb.cc/liveedge/', name: 'エッヂ' },
    ])
  })
  it('サーバーの分からない板は読まず、理由に出す', () => {
    const r = parseChmate(raw())
    expect(r.threads.some((t) => t.key === '1')).toBe(false)
    expect(r.notes.some((n) => n.includes('mystery'))).toBe(true)
  })
  it('NG: 種類・正規表現の旗・板の範囲。BE は取り込まない', () => {
    const r = parseChmate(raw())
    expect(r.ngRules.map((n) => [n.target, n.pattern, n.isRegex, n.boardUrl])).toEqual([
      ['posterId', 'AZUzoED80', false, undefined],
      ['posterId', 'FoQ1g+Rp0', false, 'https://mi.5ch.io/news4vip/'],
      ['content', '>>1,2.\\d', true, 'https://bbs.eddibb.cc/liveedge/'],
      ['posterName', '(ワッチョイW 834c-nJL5)', false, 'https://greta.5ch.io/poverty/'],
      ['threadTitle', '^\\s*(.\\s+)+.\\s*$', true, undefined],
    ])
    expect(r.ngRules.every((n) => n.enabled && n.note === 'ChMate から')).toBe(true)
    expect(r.notes.some((n) => n.includes('BE の NG 1 件'))).toBe(true)
  })
  it('書き込みの履歴: 送れたものだけ、確かめた URL からレス番号', () => {
    const r = parseChmate(raw())
    expect(r.posts).toEqual([{ boardUrl: 'https://bbs.eddibb.cc/liveedge/', key: '1791503299', title: 'ワイ', no: 47, name: '', mail: 'sage', body: 'そういや', at: 1791504254856 }])
  })
  it('キーワードは空を除いて重ねない', () => {
    expect(parseChmate(raw()).keywords).toEqual(['宮崎駿'])
  })
  it('壊れた dat(全部 NUL・404 の返事)はスレにしない', () => {
    expect(looksLikeDat(DAT)).toBe(true)
    expect(looksLikeDat('\u0000\u0000')).toBe(false)
    expect(looksLikeDat('Code = 404\n')).toBe(false)
    expect(looksLikeDat('')).toBe(false)
    const r = parseChmate(raw())
    expect(r.threads.some((t) => t.key === '1752974175' || t.key === '1171778428')).toBe(false)
    expect(r.notes.some((n) => n.includes('壊れていて') && n.includes('2 本'))).toBe(true)
  })
  it('書き込みの履歴のスレタイが空なら、ログのスレタイで埋める', () => {
    const r = parseChmate(raw({ texts: { ...raw().texts, 'files/postDataList.json': JSON.stringify([{ url: 'http://bbs.eddibb.cc/test/read.cgi/liveedge/1791503299/', name: '', mail: '', body: 'x', posted: 5, confirmed: null, targetTitle: '' }]) } }))
    expect(r.posts[0].title).toBe('てすとスレ')
  })
  it('ファイルが欠けていても落ちない', () => {
    const r = parseChmate({ texts: {}, dats: [], bookmarks: [], boards: [], skipped: ['x'] })
    expect(r.threads).toEqual([])
    expect(r.ngRules).toEqual([])
    expect(r.notes).toEqual(['x'])
  })
})
