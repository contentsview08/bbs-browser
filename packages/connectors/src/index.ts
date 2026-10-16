import { twoChConnector } from './twoch/connector'
import { shitarabaConnector } from './shitaraba/connector'
import type { Connector } from './types'

export * from './types'
export { htmlToText, decodeEntities } from './html'
export { encodeShiftJisForm } from './sjis'
export { twoChConnector, shitarabaConnector }

/** 組み込みコネクタ。外部コネクタを読み込めるようにしたら、ここに足していく */
// URL から選ぶときは先に並べたものから見る。したらばの URL を 2ch 互換が拾わないよう、したらばを先に置く
export const builtinConnectors: Connector[] = [shitarabaConnector, twoChConnector]

export function findConnector(id: string): Connector | undefined {
  return builtinConnectors.find((c) => c.id === id)
}
