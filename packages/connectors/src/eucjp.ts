// 書き込みフォームを EUC-JP で URL エンコードする(したらば)。補助漢字(3 バイト)は使わない

import { formBody, formByteLength, tableEncoder } from './formEncode'

const encodeChar = tableEncoder('euc-jp', (add) => {
  for (let b = 0xa1; b <= 0xdf; b++) add([0x8e, b]) // 半角カナ
  for (let lead = 0xa1; lead <= 0xfe; lead++) for (let trail = 0xa1; trail <= 0xfe; trail++) add([lead, trail])
})

export const encodeEucJpForm = (fields: Record<string, string>) => formBody(fields, encodeChar)

/** EUC-JP で送ったときのバイト数(目安) */
export const eucJpByteLength = (text: string) => formByteLength(text, encodeChar)
