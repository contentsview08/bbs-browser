/** バイト列を Base64 にする(大きいものは、引数の数の上限に当たらないよう区切って文字にする) */
export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
