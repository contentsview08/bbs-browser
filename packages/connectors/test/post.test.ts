import { describe, expect, it } from 'vitest'
import { encodeShiftJisComponent, encodeShiftJisForm } from '../src/sjis'
import { parseBbsCgiResponse } from '../src/twoch/parse'
import { twoChConnector } from '../src/twoch/connector'
import type { ConnectorContext, HttpResponse, ThreadSummary } from '../src/types'

/** テスト側の復号: Shift_JIS の URL エンコードを戻す(eddist の shift_jis_url_encodeded_body_to_vec と同じ手順) */
function decodeForm(body: string): Record<string, string> {
  const dec = new TextDecoder('shift_jis')
  return Object.fromEntries(
    body.split('&').map((pair) => {
      const [k, v] = pair.split('=')
      const bytes: number[] = []
      for (let i = 0; i < v.length; i++) {
        if (v[i] === '%') {
          bytes.push(parseInt(v.slice(i + 1, i + 3), 16))
          i += 2
        } else bytes.push(v[i] === '+' ? 0x20 : v.charCodeAt(i))
      }
      return [k, dec.decode(new Uint8Array(bytes))]
    }),
  )
}

const sjisBytes = (s: string) => {
  // 応答の HTML は ASCII と、エンコーダーで作った Shift_JIS で組み立てる
  const enc = encodeShiftJisComponent(s)
  const out: number[] = []
  for (let i = 0; i < enc.length; i++) {
    if (enc[i] === '%') {
      out.push(parseInt(enc.slice(i + 1, i + 3), 16))
      i += 2
    } else out.push(enc[i] === '+' ? 0x20 : enc.charCodeAt(i))
  }
  return new Uint8Array(out)
}

// eddist-server/src の応答の文面をそのまま使う
const EDDIST_OK = `<html><!-- 2ch_X:true -->
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=x-sjis">
    <title>書きこみました</title>
</head>
<body>書きこみました</body>
</html>`
const eddistError = (e: string, code: string) => `<html><!-- 2ch_X:error -->
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=x-sjis">
    <meta name="error_code" content="E-${code}">
    <title>ＥＲＲＯＲ</title>
</head>
<body>
    エラー！<br>
    ${e}
</body>
</html>`
const EDDIST_AUTH = eddistError(
  "認証コード'123456'を用いて、以下のURLから認証を行ってください \n https://bbs.eddibb.cc/auth-code",
  'Unauthenticated',
)

describe('Shift_JIS のフォーム', () => {
  it('日本語・記号・空白・改行を往復できる', () => {
    const fields = { FROM: '名無し ◆tripkey', mail: 'sage', MESSAGE: 'テスト①～\n2行目 &<> 半角ｶﾅ 100%' }
    expect(decodeForm(encodeShiftJisForm(fields))).toEqual(fields)
  })

  it('Shift_JIS にない文字は &#数字; にする', () => {
    expect(decodeForm(encodeShiftJisForm({ MESSAGE: '絵文字😀と𠮷' })).MESSAGE).toBe('絵文字&#128512;と&#134071;')
  })
})

describe('bbs.cgi の応答', () => {
  it('eddist の成功', () => {
    expect(parseBbsCgiResponse(EDDIST_OK)).toEqual({ status: 'ok', message: '書きこみました' })
  })

  it('eddist の認証待ちから、URL とコードを取り出す', () => {
    expect(parseBbsCgiResponse(EDDIST_AUTH)).toMatchObject({
      status: 'auth',
      url: 'https://bbs.eddibb.cc/auth-code',
      code: '123456',
    })
  })

  it('eddist の連投規制は、理由をそのまま返す', () => {
    const r = parseBbsCgiResponse(eddistError('投稿間隔制限により書き込みができません (次の投稿まで12秒待つ必要があります)', 'ResCreationSpanRestriction'))
    expect(r.status).toBe('error')
    expect(r.message).toContain('次の投稿まで12秒')
  })

  it('5ch の書き込み確認', () => {
    expect(parseBbsCgiResponse('<html><!-- 2ch_X:cookie --><head><title>■ 書き込み確認 ■</title></head><body>確認</body></html>').status).toBe('confirm')
  })
})

describe('createPost', () => {
  const thread: ThreadSummary = {
    connectorId: '2ch-compat',
    boardUrl: 'https://bbs.eddibb.cc/liveedge/',
    key: '1792065954',
    title: '',
    postCount: 0,
    order: 0,
  }

  /** 送られたものを記録し、用意した応答を順に返す偽サーバー */
  function fake(responses: { html: string; headers?: Record<string, string> }[]) {
    const sent: { url: string; body: string; headers: Record<string, string> }[] = []
    const ctx: ConnectorContext = {
      decode: (b, e) => new TextDecoder(e).decode(b),
      http: {
        get: async () => {
          throw new Error('get は使わない')
        },
        async post(url, body, opts): Promise<HttpResponse> {
          sent.push({ url, body, headers: opts?.headers ?? {} })
          const r = responses[sent.length - 1]
          return { status: 200, headers: { 'content-type': 'text/html; charset=x-sjis', ...r.headers }, body: sjisBytes(r.html) }
        },
      },
    }
    return { ctx, sent }
  }

  it('bbs.cgi に板・スレ・名前・メール・本文を Shift_JIS で送り、レス番号を受け取る', async () => {
    const { ctx, sent } = fake([{ html: EDDIST_OK, headers: { 'x-resnum': '18' } }])
    const r = await twoChConnector.createPost!(thread, { name: '', mail: 'sage', body: 'うおおお！！！' }, ctx)
    expect(r).toEqual({ status: 'ok', message: '書きこみました', resNumber: 18 })
    expect(sent[0].url).toBe('https://bbs.eddibb.cc/test/bbs.cgi')
    expect(sent[0].headers.Referer).toBe('https://bbs.eddibb.cc/test/read.cgi/liveedge/1792065954/')
    expect(decodeForm(sent[0].body)).toMatchObject({
      bbs: 'liveedge',
      key: '1792065954',
      FROM: '',
      mail: 'sage',
      MESSAGE: 'うおおお！！！',
      submit: '書き込む',
    })
  })

  it('認証待ちはそのまま返す(勝手に送り直さない)', async () => {
    const { ctx, sent } = fake([{ html: EDDIST_AUTH }])
    const r = await twoChConnector.createPost!(thread, { name: '', mail: '', body: 'a' }, ctx)
    expect(r.status).toBe('auth')
    expect(sent).toHaveLength(1)
  })

  it('5ch の書き込み確認は 1 回だけ送り直す', async () => {
    const confirm = '<html><!-- 2ch_X:cookie --><head><title>確認</title></head><body>確認</body></html>'
    const { ctx, sent } = fake([{ html: confirm }, { html: EDDIST_OK }])
    expect((await twoChConnector.createPost!(thread, { name: '', mail: '', body: 'a' }, ctx)).status).toBe('ok')
    expect(sent).toHaveLength(2)
  })
})
