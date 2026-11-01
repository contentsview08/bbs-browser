// ID ごとの色(設定「ID ごとに色を付ける」)。スマホのアプリ(ui/Theme.kt の Palette.idColor)と同じ計算で、同じ ID は同じ色になる:
// ID の文字から色相を決め(Java の String.hashCode)、彩度と明るさは配色の明るさで固定する(どの色相でも地との差が同じくらいになるように)。
// 暖色の赤〜橙は「書き込みの多い ID」の色と紛れるので避ける(色相 40〜319)

/** Java の String.hashCode(UTF-16 の並びから。32 ビットで桁あふれさせる) */
function javaHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h
}

/** HSL(0〜360・0〜1・0〜1)→ sRGB(0〜1)。Compose の Color.hsl と同じ式 */
function hsl(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}

/** 相対輝度(Compose の Color.luminance と同じ) */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const hex = ([r, g, b]: [number, number, number]) => '#' + [r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')

const cache = new Map<string, string>()

/**
 * ID の色(#rrggbb)。dark は暗い配色か、sky は空色の地(LINE ライトの LINE 風)の上か
 */
export function idColorOf(id: string, dark: boolean, sky = false): string {
  const key = `${dark ? 1 : 0}${sky ? 1 : 0}${id}`
  const hit = cache.get(key)
  if (hit) return hit
  if (cache.size > 5000) cache.clear()
  // Kotlin の (hashCode.toLong() and 0xffffffff) % 280 + 40
  const h = ((javaHash(id) >>> 0) % 280) + 40
  let c: [number, number, number]
  if (sky) {
    // 空色の地の上では、白っぽい字と同じくらいの明るさの淡い色に
    // 明るさの足し引きは、アプリと同じく 32 ビットの小数で(境目で 1 段ずれないように)
    let l = Math.fround(0.8)
    c = hsl(h, 0.85, l)
    while (luminance(c) < 0.7 && l < Math.fround(0.97)) {
      l = Math.fround(l + Math.fround(0.02))
      c = hsl(h, 0.85, l)
    }
  } else {
    // 黄や緑は同じ明るさでも明るく見えるので、輝度が目安に入るまで明るさをずらす(明るい地で 3:1、暗い地で 3.5:1 を超える)
    let l = Math.fround(dark ? 0.62 : 0.42)
    c = hsl(h, 0.6, l)
    if (dark)
      while (luminance(c) < 0.28 && l < Math.fround(0.9)) {
        l = Math.fround(l + Math.fround(0.02))
        c = hsl(h, 0.6, l)
      }
    else
      while (luminance(c) > 0.15 && l > Math.fround(0.1)) {
        l = Math.fround(l - Math.fround(0.02))
        c = hsl(h, 0.6, l)
      }
  }
  const out = hex(c)
  cache.set(key, out)
  return out
}
