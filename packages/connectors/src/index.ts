import { twoChConnector } from './twoch/connector'
import { shitarabaConnector } from './shitaraba/connector'
import { futabaConnector } from './futaba/connector'
import type { Connector } from './types'

export * from './types'
export { htmlToText, decodeEntities } from './html'
export { encodeShiftJisForm } from './sjis'
export { twoChConnector, shitarabaConnector, futabaConnector }

/** 組み込みコネクタ。外部コネクタを読み込めるようにしたら、ここに足していく */
// URL から選ぶときは先に並べたものから見る。したらば・ふたばの URL を 2ch 互換が拾わないよう、先に置く
export const builtinConnectors: Connector[] = [shitarabaConnector, futabaConnector, twoChConnector]

export function findConnector(id: string): Connector | undefined {
  return builtinConnectors.find((c) => c.id === id)
}
