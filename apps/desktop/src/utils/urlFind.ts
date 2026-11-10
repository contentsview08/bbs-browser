// 本文から URL を見つける決まり。スマホ版の bbs/UrlFind.kt と Web の写し(hono-bbs の utils/urlFind.ts)も同じ決まりで、
// 正は bbs-browser の packages/conformance の link.json(ケース)と tld.json(ドメインとみなす TLD)。
// \s・\w の意味は JavaScript と JVM で違うことがあるので、文字の種類は明示する

/**
 * ドメインとみなす TLD。スキームのない「example.com」や崩れたスキームのものは、これで終わるときだけリンクにする。
 * 実在しても、ファイルの拡張子や英語の略と重なるものは入れない(py・sh・md・pl・rs・zip・mov・is・in・at・so・fm など。理由は tld.json)。
 * co.jp・ne.jp・or.jp・co.uk などは jp・uk で拾える
 */
export const TLDS = [
  // よく使う gTLD
  'com', 'net', 'org', 'info', 'biz', 'edu', 'gov', 'mobi', 'asia',
  // 日本と、よく見る国の ccTLD
  'jp', 'us', 'uk', 'de', 'fr', 'eu', 'ru', 'cn', 'kr', 'tw', 'hk', 'au', 'ca', 'ph',
  // 短縮 URL・サービスでよく使う ccTLD(t.co・bit.ly・goo.gl・youtu.be・amzn.to・nico.ms・redd.it など)
  'io', 'tv', 'me', 'cc', 'to', 'ly', 'gl', 'be', 'gg', 'tk', 'ws', 'co', 'ai', 'ms', 'it',
  // 新しい gTLD のうち、よく見るもの
  'xyz', 'dev', 'app', 'site', 'online', 'top', 'club', 'shop', 'blog', 'news', 'page', 'live', 'link', 'fun', 'moe', 'tech', 'wiki', 'art', 'cloud', 'store',
]

/** 大文字・小文字のどちらでも合う形(JavaScript の (?i:…) は古い環境で使えないため) */
const ci = (s: string) => s.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`)

const TLD = `(?:${[...TLDS].sort((a, b) => b.length - a.length).map(ci).join('|')})`
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?'
/** 後ろにラベルが続くもの(example.com.au)や英数字が続くもの(example.community)はドメインの終わりとしない */
const HOST_END = String.raw`(?![A-Za-z0-9-]|\.[A-Za-z0-9])`
const DOMAIN = String.raw`(?:${LABEL}\.)+${TLD}${HOST_END}`
const IPV4 = String.raw`(?:[0-9]{1,3}\.){3}[0-9]{1,3}${HOST_END}`
const PORT = '(?::[0-9]{1,5})?'
/** スキームが正しいときのホスト(localhost・IP・ポート・ユーザー名も)。日本語が来たらそこで終わる */
const HOST_LOOSE = String.raw`[A-Za-z0-9\[][A-Za-z0-9\-._~%!$&'*+,;=:@\[\]]*`
/** 道・クエリ。空白・見えない文字(ゼロ幅スペース・ワードジョイナーなど)・日本語の句読点と閉じかっこで切る。日本語の道(wiki/東京)は残す */
const PATH = String.raw`(?:[/?#][^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff<>"、。「」）』】\u200b-\u200f\u2060-\u2064]*)?`
/** スキームのないものの道は ASCII だけ(「example.com/です」の「です」まで取らない) */
const PATH_ASCII = String.raw`(?:[/?#][!#-;=?-~]*)?`

const H = '[hH]'
const T = '[tT]'
const P = '[pP]'
const S = '[sS]'
/** 正しい・h が抜けた書き方(http://・https://・ttp://・ttps://・tp://・tps://)。大文字も。英字の後ろでも拾う(abchttp://) */
const HEAD_FULL = String.raw`${H}?${T}${T}${P}${S}?:\/\/|(?<![A-Za-z0-9_])${T}${P}${S}?:\/\/`
/** コロン・スラッシュが欠けたもの(https//・https:/・http:)。後ろが TLD で終わるドメインのときだけ */
const HEAD_BROKEN_SEP = String.raw`(?<![A-Za-z0-9_])${H}?${T}{1,2}${P}${S}?(?::\/?|\/\/?)`
/** 頭が欠けたもの(ht://・htt://・ps://・s://・://)と、// から始まるもの。後ろが TLD で終わるドメインのときだけ */
const HEAD_PARTIAL = String.raw`(?<![A-Za-z0-9_])${H}?${T}{0,2}${P}?${S}?:\/\/|(?<![A-Za-z0-9_/:])\/\/`
/** スキームのないドメイン。前が英数字・.・@(メールアドレス)・/・:・-・全角の英数字のときは拾わない */
const HEAD_NONE = '(?<![A-Za-z0-9_.@/:\\-＠Ａ-Ｚａ-ｚ０-９])'

/** URL の候補の正規表現の中身(捕まえる組は持たない)。末尾の句読点・閉じかっこは trimUrlEnd で落とす */
export const URL_PATTERN =
  `(?:(?:${HEAD_FULL})${HOST_LOOSE}${PATH}` +
  `|(?:${HEAD_BROKEN_SEP}|${HEAD_PARTIAL})(?:${DOMAIN}|${IPV4})${PORT}${PATH}` +
  `|${HEAD_NONE}${DOMAIN}${PORT}${PATH_ASCII})`

/** URL の終わりに来ても URL に含めない文字(文の句読点・引用符) */
const TRAIL = `.,;:!?'"*！？，．：；・…`
const CLOSE: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

const count = (s: string, c: string) => s.split(c).length - 1

/**
 * 末尾の句読点と、対応のない閉じかっこを落とす。「(https://a.com/x)」の ) は落とし、「https://a.com/(x)」の ) は残す
 */
export function trimUrlEnd(raw: string): string {
  let s = raw
  for (;;) {
    const c = s.at(-1)
    if (c === undefined) return s
    const open = CLOSE[c]
    if (open !== undefined) {
      if (count(s, open) >= count(s, c)) return s
    } else if (!TRAIL.includes(c)) return s
    s = s.slice(0, -1)
  }
}

/**
 * 崩した書き方の URL を、開ける形に直す。http と書いてあるものだけ http で、ほかは https を補う
 * (ttp://・tp:// も、h が抜けた分 http と書いてあるとは言えないので https)
 */
export function normalizeUrl(raw: string): string {
  const m = /^([A-Za-z]*)(:?\/*)/.exec(raw)!
  // 区切り(: か /)がなければスキームのないドメイン(http.example.com のように頭が英字でも)
  if (!m[2]) return `https://${raw}`
  return `${m[1].toLowerCase() === 'http' ? 'http' : 'https'}://${raw.slice(m[0].length)}`
}
