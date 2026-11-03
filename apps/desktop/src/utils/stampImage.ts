// 上げる前に、画像の隅(左下か右下)に文字(スレタイと URL など)を描き込む。
// JPEG・PNG・WebP だけ(GIF は描き直すとアニメが崩れるので、そのまま)。描いた画像は同じ種類で書き出す

export type StampCorner = 'left' | 'right'

const STAMPABLE = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** 描き込める画像か */
export const canStamp = (file: File) => STAMPABLE.has(file.type)

/**
 * lines を隅に描き込んだ新しい File を返す。描き込めない種類・読めない画像はそのまま返す。
 * 文字の大きさは画像の幅に合わせる(幅の 2.2%、12px から)。読みやすいように、半透明の黒い帯の上に白い字で描く
 */
export async function stampImage(file: File, lines: string[], corner: StampCorner): Promise<File> {
  const texts = lines.map((l) => l.trim()).filter(Boolean)
  if (!canStamp(file) || texts.length === 0) return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  const { width: w, height: h } = bitmap
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const size = Math.max(12, Math.round(w * 0.022))
  const pad = Math.round(size * 0.6)
  const lineH = Math.round(size * 1.35)
  ctx.font = `${size}px 'BIZ UDPGothic', 'Yu Gothic UI', 'Meiryo UI', 'Noto Sans JP', sans-serif`
  ctx.textBaseline = 'alphabetic'
  // 長い行(URL)は画像の幅に収まるように、後ろを「…」で省く
  const maxW = w - pad * 4
  const fit = (t: string) => {
    if (ctx.measureText(t).width <= maxW) return t
    let s = t
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1)
    return s + '…'
  }
  const shown = texts.map(fit)
  const boxW = Math.max(...shown.map((t) => ctx.measureText(t).width)) + pad * 2
  const boxH = lineH * shown.length + pad * 2 - (lineH - size)
  const x = corner === 'left' ? pad : w - pad - boxW
  const y = h - pad - boxH
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(x, y, boxW, boxH)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = corner === 'left' ? 'left' : 'right'
  const tx = corner === 'left' ? x + pad : x + boxW - pad
  shown.forEach((t, i) => ctx.fillText(t, tx, y + pad + size + lineH * i))
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, file.type, 0.92))
  if (!blob) return file
  return new File([blob], file.name, { type: file.type, lastModified: Date.now() })
}
