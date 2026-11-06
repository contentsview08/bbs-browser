// 書き込みフォームを Shift_JIS で URL エンコードする。
// TextEncoder は UTF-8 しか作れないので、TextDecoder('shift_jis') から逆引き表を作る

import { formBody, formByteLength, formComponent, tableEncoder } from './formEncode'

const encodeChar = tableEncoder('shift_jis', (add) => {
  for (let b = 0xa1; b <= 0xdf; b++) add([b]) // 半角カナ
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead > 0x9f && lead < 0xe0) continue
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail !== 0x7f) add([lead, trail])
    }
  }
})

/** Shift_JIS で送ったときのバイト数。表にない文字(絵文字など)は &#数字; の長さで数える */
export const shiftJisByteLength = (text: string) => formByteLength(text, encodeChar)

export const encodeShiftJisComponent = (value: string) => formComponent(value, encodeChar)

export const encodeShiftJisForm = (fields: Record<string, string>) => formBody(fields, encodeChar)
