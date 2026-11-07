// 同期を始める画面。Turnstile を通して許可証を受け取り、端末へ渡す。理由は docs/sync-design.md の「許可証の受け渡し」
import type { Config } from './config'
import { fail, htmlText } from './http'
import { sha256, utf8 } from './encoding'

/** 端末の窓が移動を止めて受け取る先。.invalid は名前解決されないので、止め損ねても外へ出ない */
export const TICKET_RETURN_URL = 'https://obb-sync.invalid/ticket'

const TURNSTILE_API = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'
const SITEKEY = /^[A-Za-z0-9_-]{1,64}$/
const ACTION = /^[A-Za-z0-9_-]{1,32}$/

const SCRIPT = `(function () {
  var spaceId = new URLSearchParams(location.search).get('space_id')
  var msg = document.getElementById('msg')
  var say = function (t) { msg.textContent = t }
  window.obbToken = function (token) {
    say('確かめています')
    fetch('/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstile: token, space_id: spaceId }),
      credentials: 'omit',
      cache: 'no-store',
    }).then(function (res) {
      return res.json().then(function (v) {
        if (res.ok && typeof v.ticket === 'string') {
          say('アプリへ戻ります')
          location.replace('${TICKET_RETURN_URL}?ticket=' + encodeURIComponent(v.ticket))
          return
        }
        throw new Error(v.error)
      })
    }).catch(function () {
      say('確認できませんでした。もう一度お試しください。')
      if (window.turnstile) window.turnstile.reset()
    })
  }
  window.obbError = function () { say('確認の画面を読み込めませんでした。通信を確かめて、開き直してください。') }
  window.obbExpired = function () { say('時間が経ちました。もう一度お試しください。') }
})()`

const STYLE = `body{margin:0;padding:32px 16px;font:16px/1.6 system-ui,sans-serif;background:#fff;color:#222;text-align:center}
@media (prefers-color-scheme:dark){body{background:#181818;color:#eee}}
h1{font-size:20px;margin:0 0 8px}
p{margin:0 0 16px}
.cf-turnstile{display:flex;justify-content:center;min-height:65px}`

const hash = async (s: string): Promise<string> => `'sha256-${btoa(String.fromCharCode(...(await sha256(utf8(s)))))}'`

/** インラインは内容のハッシュだけを通す。style-src は Turnstile の部品が要るものを文書が定めていないので緩める。ここに秘密はない */
async function policy(): Promise<string> {
  return [
    "default-src 'none'",
    `script-src ${await hash(SCRIPT)} ${TURNSTILE_ORIGIN}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    `connect-src 'self' ${TURNSTILE_ORIGIN}`,
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** 問い合わせの値はページへ書かない。形だけを確かめ、ページのスクリプトが読む */
export function checkStartQuery(search: string): boolean {
  const q = new URLSearchParams(search)
  if ([...q.keys()].sort().join() !== 'return,space_id') return false
  return /^[0-9a-f]{64}$/.test(q.get('space_id') as string) && q.get('return') === 'app'
}

export async function startPage(search: string, cfg: Config): Promise<Response> {
  if (!checkStartQuery(search)) return fail(400, 'bad_request')
  if (!SITEKEY.test(cfg.turnstileSitekey) || !ACTION.test(cfg.turnstileAction)) return fail(503, 'unavailable')
  const body = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>同期を始める</title>
<style>${STYLE}</style>
</head>
<body>
<h1>同期を始める</h1>
<p id="msg">確認が終わると、アプリへ戻ります。</p>
<div class="cf-turnstile" data-sitekey="${cfg.turnstileSitekey}" data-action="${cfg.turnstileAction}" data-callback="obbToken" data-error-callback="obbError" data-expired-callback="obbExpired"></div>
<script>${SCRIPT}</script>
<script src="${TURNSTILE_API}" async defer></script>
</body>
</html>
`
  return htmlText(body, await policy())
}
