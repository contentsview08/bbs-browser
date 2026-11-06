import { twoChConnector } from './twoch/connector'
import { shitarabaConnector } from './shitaraba/connector'
import { machiConnector } from './machi/connector'
import { futabaConnector } from './futaba/connector'
import { honoBbsConnector } from './honobbs/connector'
import { demoConnector } from './demo/connector'
import type { Connector } from './types'

export * from './types'
export { declaredCharset, detectEncoding, looksLikeUtf8 } from './encoding'
export { twoChConnector, shitarabaConnector, machiConnector, futabaConnector, honoBbsConnector, demoConnector }

/** 組み込みコネクタ。外部コネクタを読み込めるようにしたら、ここに足していく */
// URL から選ぶときは先に並べたものから見る。したらば・まちBBS・ふたばの URL を 2ch 互換が拾わないよう、先に置く
export const builtinConnectors: Connector[] = [shitarabaConnector, machiConnector, futabaConnector, honoBbsConnector, twoChConnector]

/** 組み込みに加えて使うコネクタ(お試しの掲示板・外付けのコネクタ)。アプリが起動時に足す */
const extraConnectors: Connector[] = []

/** コネクタを足す・置き換える(同じ id があれば置き換える)。URL から選ぶときは組み込みより後に見る */
export function registerConnector(c: Connector): void {
  const i = extraConnectors.findIndex((x) => x.id === c.id)
  if (i >= 0) extraConnectors[i] = c
  else extraConnectors.push(c)
}

/** 足したコネクタを外す */
export function unregisterConnector(id: string): void {
  const i = extraConnectors.findIndex((x) => x.id === id)
  if (i >= 0) extraConnectors.splice(i, 1)
}

/**
 * 使えるコネクタ全部。URL から選ぶときはこの順に見る。
 * 2ch 互換は「ホスト/板/」の形をなんでも拾うので、足したコネクタより後ろ(最後)に置く
 */
export function allConnectors(): Connector[] {
  return [...builtinConnectors.filter((c) => c !== twoChConnector), ...extraConnectors, twoChConnector]
}

export function findConnector(id: string): Connector | undefined {
  return allConnectors().find((c) => c.id === id)
}
