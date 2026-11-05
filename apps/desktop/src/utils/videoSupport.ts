// この環境で動画を再生できるか。再生の部品がない環境(AppImage の WebKit など)で <video> を置くと、描画のプロセスごと落ちることがあるので、
// 置く前に確かめる。canPlayType は再生を始めないので、部品がなくても安全に呼べる
const cache = new Map<string, boolean>()

const typeOf = (url: string) => (/\.webm(?:[?#]|$)/i.test(url) ? 'video/webm; codecs="vp9"' : 'video/mp4; codecs="avc1.42E01E"')

export function canPlayVideo(url: string): boolean {
  const type = typeOf(url)
  let ok = cache.get(type)
  if (ok === undefined) {
    ok = typeof document !== 'undefined' && document.createElement('video').canPlayType(type) !== ''
    cache.set(type, ok)
  }
  return ok
}
