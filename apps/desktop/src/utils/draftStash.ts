// 書きかけの、すぐ書ける置き場(localStorage)。DB への保存は少し遅れて書くので、そのあいだに
// ページを離れる(web 版で Turnstile の確認へ行く)・画面を閉じると、書きかけが消えていた。
// ここには打つたびにその場で書き、開くときはまずここを見る。
// 空(書き込めて消した)も「空」として覚え、DB に残った古い書きかけを読み戻さないようにする

const KEY = 'bbs:drafts'
/** 覚えておく数(古いものから捨てる) */
const MAX = 200

type Stash = Record<string, { v: string; t: number }>

function read(): Stash {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Stash
  } catch {
    return {}
  }
}

function write(s: Stash) {
  try {
    const keys = Object.keys(s)
    if (keys.length > MAX) for (const k of keys.sort((a, b) => s[a].t - s[b].t).slice(0, keys.length - MAX)) delete s[k]
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // 置けなくても、DB の下書きは残る
  }
}

/** 覚えている書きかけ。覚えていなければ undefined(空で消したものは '') */
export function stashGet(key: string): string | undefined {
  return read()[key]?.v
}

export function stashSet(key: string, value: string) {
  const s = read()
  s[key] = { v: value, t: Date.now() }
  write(s)
}
