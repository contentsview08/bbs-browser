import { describe, expect, it } from 'vitest'
import type { ConnectorContext, HttpResponse } from '../src/types'
import { splitBeIcon, twoChConnector } from '../src/twoch/connector'

// be.5ch.io のログイン画面のフォーム(2026-10 に取ったものから、フォームの部分だけ写した)
const LOGIN_FORM = `<form class="form-signin" method="post" action="/log">
<input type="email" id="inputEmail" class="form-control" name="mail" placeholder="メールアドレス" required autofocus>
<input type="password" id="inputPassword" class="form-control" name="pass" placeholder="パスワード" required>
<button class="btn btn-lg btn-default be3full" type="submit" name="login">ログイン</button></form>`

function fake(status: number, html: string) {
  const sent: { url: string; body: string; headers: Record<string, string> }[] = []
  const ctx: ConnectorContext = {
    decode: (b, e) => new TextDecoder(e).decode(b),
    http: {
      get: async () => {
        throw new Error('get は使わない')
      },
      async post(url, body, opts): Promise<HttpResponse> {
        sent.push({ url, body: typeof body === 'string' ? body : new TextDecoder().decode(body), headers: opts?.headers ?? {} })
        return { status, headers: { 'content-type': 'text/html; charset=utf-8' }, body: new TextEncoder().encode(html) }
      },
    },
  }
  return { ctx, sent }
}

describe('BE のログイン', () => {
  it('be.5ch.io/log に mail・pass・login を送り、ログイン画面が出なければ成功', async () => {
    const { ctx, sent } = fake(200, '<html><body>ようこそ</body></html>')
    const r = await twoChConnector.login!('be', { user: 'a+b@example.com', password: 'p&ss word' }, ctx)
    expect(r.ok).toBe(true)
    expect(sent[0].url).toBe('https://be.5ch.io/log')
    expect(Object.fromEntries(new URLSearchParams(sent[0].body))).toEqual({ mail: 'a+b@example.com', pass: 'p&ss word', login: '' })
  })

  it('ログイン画面がまた出たら失敗', async () => {
    const { ctx } = fake(200, `<html><body>${LOGIN_FORM}</body></html>`)
    expect(await twoChConnector.login!('be', { user: 'x', password: 'y' }, ctx)).toMatchObject({ ok: false })
  })

  it('サーバーが落ちていたら失敗', async () => {
    const { ctx } = fake(503, '')
    expect(await twoChConnector.login!('be', { user: 'x', password: 'y' }, ctx)).toMatchObject({ ok: false })
  })

  it('BE のほかは扱わない', async () => {
    const { ctx, sent } = fake(200, '')
    expect(await twoChConnector.login!('uplift', { user: 'x', password: 'y' }, ctx)).toMatchObject({ ok: false })
    expect(sent).toHaveLength(0)
  })
})

describe('書き込みで BE を使うか', () => {
  const thread = {
    connectorId: '2ch-compat',
    boardUrl: 'https://mi.5ch.io/news4vip/',
    key: '1792148654',
    title: '',
    postCount: 0,
    order: 0,
  }
  function recorder(html: string) {
    const sent: { url: string; exclude: string[] }[] = []
    const ctx: ConnectorContext = {
      decode: (b) => new TextDecoder('utf-8').decode(b),
      http: {
        get: async () => {
          throw new Error('get は使わない')
        },
        async post(url, _body, opts): Promise<HttpResponse> {
          sent.push({ url, exclude: opts?.excludeCookies ?? [] })
          return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: new TextEncoder().encode(html) }
        },
      },
    }
    return { ctx, sent }
  }

  it('BE を使うと言わなければ、BE の Cookie を外して送る', async () => {
    const { ctx, sent } = recorder('<title>書きこみました</title>')
    await twoChConnector.createPost!(thread, { name: '', mail: '', body: 'a' }, ctx)
    expect(sent[0].exclude).toEqual(['DMDM', 'MDMD'])
  })

  it('BE を使うなら外さない', async () => {
    const { ctx, sent } = recorder('<title>書きこみました</title>')
    await twoChConnector.createPost!(thread, { name: '', mail: '', body: 'a', accounts: ['be'] }, ctx)
    expect(sent[0].exclude).toEqual([])
  })

  it('書き込み確認を承諾して送り直すときも、元の書き込みと同じ Cookie にする', async () => {
    const { ctx, sent } = recorder('<title>書きこみました</title>')
    await twoChConnector.submitConfirm!({ url: 'https://mi.5ch.io/test/bbs.cgi', fields: {}, referer: '', excludeCookies: ['DMDM', 'MDMD'] }, ctx)
    expect(sent[0].exclude).toEqual(['DMDM', 'MDMD'])
  })
})

describe('splitBeIcon: BE のアイコン', () => {
  it('1 行目の sssp:// を https:// の画像にし、その行を本文から除く', () => {
    expect(splitBeIcon('sssp://img.5ch.io/ico/nida.gif\n本文です')).toEqual({ icon: 'https://img.5ch.io/ico/nida.gif', body: '本文です' })
  })

  it('アイコンだけのレス', () => {
    expect(splitBeIcon('sssp://img.5ch.net/ico/u_giko_ebi.gif')).toEqual({ icon: 'https://img.5ch.net/ico/u_giko_ebi.gif', body: '' })
  })

  it('1 行目でなければ、本文のまま', () => {
    expect(splitBeIcon('本文\nsssp://img.5ch.io/ico/nida.gif')).toEqual({ body: '本文\nsssp://img.5ch.io/ico/nida.gif' })
    expect(splitBeIcon('sssp://img.5ch.io/ico/nida.gif ほかの文字')).toEqual({ body: 'sssp://img.5ch.io/ico/nida.gif ほかの文字' })
  })
})
