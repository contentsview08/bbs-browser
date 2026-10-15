import { twoChConnector } from './twoch/connector'
import type { Connector } from './types'

export * from './types'
export { htmlToText, decodeEntities } from './html'
export { encodeShiftJisForm } from './sjis'
export { twoChConnector }

/** 組み込みコネクタ。外部コネクタを読み込めるようにしたら、ここに足していく */
export const builtinConnectors: Connector[] = [twoChConnector]

export function findConnector(id: string): Connector | undefined {
  return builtinConnectors.find((c) => c.id === id)
}
