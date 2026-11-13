import { describe, expect, it } from 'vitest'
import type { Board } from '@bbs-browser/connectors'
import { favoriteChange, favoriteKey, isFavoriteIn } from '../src/utils/favoriteBoards'

const vipIo: Board = { connectorId: '2ch-compat', url: 'https://hayabusa9.5ch.io/news4vip/', name: 'ニュー速VIP', category: '雑談系2' }
const vipNet: Board = { connectorId: '2ch-compat', url: 'https://hayabusa9.5ch.net/news4vip', name: 'ニュー速VIP' }

/** DB の代わり: 変え方をそのまま当てる */
const apply = (favs: Board[], c: { add?: Board; remove: string[] }) => [...favs.filter((f) => !c.remove.includes(f.url)), ...(c.add ? [c.add] : [])]

describe('favoriteKey / isFavoriteIn: お気に入りにあるか', () => {
  it('書き方が違っても同じ板ならある', () => {
    expect(isFavoriteIn([vipNet], vipIo.url)).toBe(true)
    expect(isFavoriteIn([vipIo], 'http://HAYABUSA9.5ch.net/news4vip/')).toBe(true)
    expect(favoriteKey('https://example.com:443/test/')).toBe('example.com/test/')
  })
  it('板の名前の大文字小文字は別の板', () => expect(isFavoriteIn([vipIo], 'https://hayabusa9.5ch.io/NEWS4VIP/')).toBe(false))
  it('板の URL でないものは文字のまま比べる', () => {
    expect(isFavoriteIn([{ ...vipIo, url: 'x' }], 'x')).toBe(true)
    expect(isFavoriteIn([{ ...vipIo, url: 'x' }], 'y')).toBe(false)
  })
})

describe('favoriteChange: ☆ を押したときの変え方', () => {
  it('押すと入って、二度目で外れる', () => {
    let favs: Board[] = []
    favs = apply(favs, favoriteChange(favs, vipIo, !isFavoriteIn(favs, vipIo.url)))
    expect(favs).toEqual([{ connectorId: '2ch-compat', url: vipIo.url, name: vipIo.name }])
    favs = apply(favs, favoriteChange(favs, vipIo, !isFavoriteIn(favs, vipIo.url)))
    expect(favs).toEqual([])
  })
  it('外すときは書き方の違う行も消す', () => {
    const other: Board = { connectorId: '2ch-compat', url: 'https://greta.5ch.io/poverty/', name: '嫌儲' }
    const c = favoriteChange([vipNet, other], vipIo, false)
    expect(c.remove).toEqual([vipNet.url])
    expect(apply([vipNet, other], c)).toEqual([other])
  })
  it('入っている板に入れても二重にしない・同じ状態へは何度送っても同じ', () => {
    expect(favoriteChange([vipNet], vipIo, true).add).toBeUndefined()
    let favs: Board[] = []
    for (let i = 0; i < 2; i++) favs = apply(favs, favoriteChange(favs, vipIo, true))
    expect(favs).toHaveLength(1)
    for (let i = 0; i < 2; i++) favs = apply(favs, favoriteChange(favs, vipIo, false))
    expect(favs).toEqual([])
  })
})
