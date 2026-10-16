// 書き込む前に、板の上限(SETTING.TXT)を超えていないか確かめる。
// バイト数はコネクタの数え方(Shift_JIS など)で数える。サーバーの厳密な数え方とは少し違うことがあるので目安

import type { PostLimits } from '@bbs-browser/connectors'

export interface PostMeasure {
  messageBytes: number
  lines: number
  /** 超えているものの説明(なければ空) */
  over: string[]
}

export function measurePost(
  input: { body: string; name?: string; mail?: string; subject?: string },
  limits: PostLimits | undefined,
  byteLength: (text: string) => number,
): PostMeasure {
  const messageBytes = byteLength(input.body)
  const lines = input.body === '' ? 0 : input.body.split('\n').length
  const over: string[] = []
  if (limits?.messageBytes !== undefined && messageBytes > limits.messageBytes)
    over.push(`本文が長すぎます(${messageBytes} / ${limits.messageBytes} バイト)`)
  if (limits?.lines !== undefined && lines > limits.lines) over.push(`本文の行が多すぎます(${lines} / ${limits.lines} 行)`)
  const check = (label: string, text: string | undefined, max: number | undefined) => {
    if (text === undefined || max === undefined) return
    const n = byteLength(text)
    if (n > max) over.push(`${label}が長すぎます(${n} / ${max} バイト)`)
  }
  check('名前', input.name, limits?.nameBytes)
  check('メール', input.mail, limits?.mailBytes)
  check('スレタイ', input.subject, limits?.subjectBytes)
  return { messageBytes, lines, over }
}
