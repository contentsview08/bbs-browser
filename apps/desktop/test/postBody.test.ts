import { describe, expect, it } from 'vitest'
import { splitBeIcon } from '../src/utils/postBody'

describe('splitBeIcon: BE のアイコン', () => {
  it('1 行目の sssp:// を https:// の画像にし、その行を本文から除く', () => {
    expect(splitBeIcon('sssp://img.5ch.io/ico/nida.gif\n本文です')).toEqual({ icon: 'https://img.5ch.io/ico/nida.gif', body: '本文です' })
  })

  it('アイコンだけのレス', () => {
    expect(splitBeIcon('sssp://img.5ch.net/ico/u_giko_ebi.gif')).toEqual({ icon: 'https://img.5ch.net/ico/u_giko_ebi.gif', body: '' })
  })

  it('1 行目でなければ、本文のまま', () => {
    expect(splitBeIcon('本文\nsssp://img.5ch.io/ico/nida.gif')).toEqual({ body: '本文\nsssp://img.5ch.io/ico/nida.gif' })
    expect(splitBeIcon('sssp://img.5ch.io/ico/nida.gif ほかの文字')).toEqual({ body: 'sssp://img.5ch.io/ico/nida.gif ほかの文字' })
  })
})
