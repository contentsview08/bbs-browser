import { describe, expect, it } from 'vitest'
import type { ConnectorContext, HttpResponse } from '../src/types'
import { twoChConnector } from '../src/twoch/connector'

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
        sent.push({ url, body, headers: opts?.headers ?? {} })
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
