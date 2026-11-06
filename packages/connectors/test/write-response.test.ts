// 書き込みの応答の読み分け。応答はどれも作り物で、本物の掲示板へは送らない
import { describe, expect, it } from 'vitest'
import { honoBbsConnector } from '../src/honobbs/connector'
import { machiConnector } from '../src/machi/connector'
import { parseMachiWrite } from '../src/machi/parse'
import { parseShitarabaWrite } from '../src/shitaraba/parse'
import { twoChConnector } from '../src/twoch/connector'
import { POST_FAILED, parseBbsCgiResponse, parseConfirmForm } from '../src/twoch/parse'
import type { ConnectorContext, HttpResponse, ThreadSummary } from '../src/types'

const enc = (s: string) => new TextEncoder().encode(s)

describe('parseBbsCgiResponse', () => {
  it('目印がなくても、題の「書きこみました」は成功。本文がなければ題を伝える', () => {
    expect(parseBbsCgiResponse('<html><head><title>書きこみました。</title></head><body></body></html>')).toEqual({ status: 'ok', message: '書きこみました。' })
  })

  it('タグの大文字・小文字を問わない', () => {
    expect(parseBbsCgiResponse('<HTML><HEAD><TITLE>書きこみました</TITLE></HEAD><BODY>完了</BODY></HTML>')).toEqual({ status: 'ok', message: '完了' })
  })

  it('エラーの目印があれば、題に「書きこみました」があっても成功にしない', () => {
    expect(parseBbsCgiResponse('<html><!-- 2ch_X:error --><title>書きこみました</title><body>規制中</body></html>')).toEqual({ status: 'error', message: '規制中' })
  })

  it('再認証コードも読む', () => {
    const r = parseBbsCgiResponse("<html><body>再認証コード'654321'を用いて https://bbs.example/auth-code から認証してください</body></html>")
    expect(r).toMatchObject({ status: 'auth', url: 'https://bbs.example/auth-code', code: '654321' })
  })

  it('認証の案内にコードがなければ、URL だけ返す', () => {
    const r = parseBbsCgiResponse('<html><body>ユーザー登録が必要です https://bbs.example/register</body></html>')
    expect(r).toMatchObject({ status: 'auth', url: 'https://bbs.example/register' })
    expect(r.status === 'auth' && r.code).toBeUndefined()
  })

  it('認証の言葉のない URL はエラーの理由のまま', () => {
    expect(parseBbsCgiResponse('<html><body>規制中です https://bbs.example/rule</body></html>')).toEqual({ status: 'error', message: '規制中です https://bbs.example/rule' })
  })

  it.each([
    ['空', ''],
    ['タグだけ', '<html><head></head><body></body></html>'],
  ])('%sの応答は「書き込めませんでした」', (_, html) => {
    expect(parseBbsCgiResponse(html)).toEqual({ status: 'error', message: POST_FAILED })
  })

  it('本文がなければ題を理由にする', () => {
    expect(parseBbsCgiResponse('<html><head><title>ＥＲＲＯＲ</title></head><body></body></html>')).toEqual({ status: 'error', message: 'ＥＲＲＯＲ' })
  })

  it('body のない断片でも文字を理由にする', () => {
    expect(parseBbsCgiResponse('Service Unavailable')).toEqual({ status: 'error', message: 'Service Unavailable' })
  })
})

describe('parseConfirmForm', () => {
  it('値の中の > で切れない(本文のアンカーが消えないように)', () => {
    const { hidden } = parseConfirmForm(`<form action="/test/bbs.cgi"><input type=hidden name=MESSAGE value=">>1 a=b"><input type=hidden name=x value='c>d'></form>`)
    expect(hidden).toEqual({ MESSAGE: '>>1 a=b', x: 'c>d' })
  })

  it('属性の値の実体参照を戻し、クォートなし・シングルクォートも読む', () => {
    const { action, hidden } = parseConfirmForm(`<FORM ACTION='../test/bbs.cgi?a=1&amp;b=2'><INPUT TYPE=HIDDEN NAME=a VALUE="&gt;&gt;1"><input type='hidden' name='b' value=c></FORM>`)
    expect(action).toBe('../test/bbs.cgi?a=1&b=2')
    expect(hidden).toEqual({ a: '>>1', b: 'c' })
  })

  it('隠し項目と名前つきの送信ボタンだけを拾う', () => {
    const { hidden } = parseConfirmForm(`<form><input type=text name=FROM value=x><input type=submit value=無名><input type=hidden value=noname><input type=hidden name=empty><input type=submit name=submit value=押す></form>`)
    expect(hidden).toEqual({ empty: '', submit: '押す' })
  })

  it('フォームがなければ空', () => {
    expect(parseConfirmForm('<html>書き込み確認</html>')).toEqual({ action: undefined, hidden: {} })
    expect(parseConfirmForm('<form action=""></form>').action).toBeUndefined()
  })
})

describe('createPost(2ch 互換)', () => {
  const thread = (host: string): ThreadSummary => ({ connectorId: '2ch-compat', boardUrl: `https://${host}/b/`, key: '1792065954', title: '', postCount: 0, order: 0 })
  const OK = '<html><!-- 2ch_X:true --><title>書きこみました</title><body>書きこみました</body></html>'

  function fake(res: { html: string; status?: number; headers?: Record<string, string> }, get: () => Promise<HttpResponse> = async () => ({ status: 404, headers: {}, body: new Uint8Array() })) {
    const calls = { get: 0, sent: [] as string[] }
    const ctx: ConnectorContext = {
      decode: (b, e) => new TextDecoder(e).decode(b),
      http: {
        get: async () => {
          calls.get++
          return get()
        },
        async post(url): Promise<HttpResponse> {
          calls.sent.push(url)
          return { status: res.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8', ...res.headers }, body: enc(res.html) }
        },
      },
    }
    return { ctx, calls }
  }
  const input = { name: '', mail: '', body: 'a' }

  it.each(['', 'abc', '0', '-1', '1.5'])('x-resnum が %j ならレス番号を付けない', async (v) => {
    const { ctx } = fake({ html: OK, headers: { 'x-resnum': v } })
    const r = await twoChConnector.createPost!(thread('resnum.example'), input, ctx)
    expect(r.status).toBe('ok')
    expect('resNumber' in r).toBe(false)
  })

  it('認証待ちは HTTP エラーの番号でも認証待ちのまま', async () => {
    const { ctx } = fake({ status: 401, html: "<html><body>認証コード'1'を用いて https://bbs.example/auth-code</body></html>" })
    expect(await twoChConnector.createPost!(thread('auth.example'), input, ctx)).toMatchObject({ status: 'auth', code: '1' })
  })

  it('書き込み確認にフォームがなければ、同じ送り先と元の項目で承諾を待つ', async () => {
    const { ctx } = fake({ html: '<html><!-- 2ch_X:cookie --><title>確認</title><body>確認</body></html>' })
    const r = await twoChConnector.createPost!(thread('noform.example'), { name: '名前', mail: 'sage', body: '本文' }, ctx)
    expect(r.status === 'confirm' && r.confirm.url).toBe('https://noform.example/test/bbs.cgi')
    expect(r.status === 'confirm' && r.confirm.fields).toMatchObject({ FROM: '名前', mail: 'sage', MESSAGE: '本文' })
  })

  it('確認の隠し項目が、元の項目より優先される', async () => {
    const { ctx } = fake({ html: '<html><!-- 2ch_X:cookie --><form><input type=hidden name=time value=1></form></html>' })
    const r = await twoChConnector.createPost!(thread('hidden.example'), input, ctx)
    expect(r.status === 'confirm' && r.confirm.fields.time).toBe('1')
  })

  it('送る通信が失敗したら投げる(成功や空の結果にしない)', async () => {
    const { ctx } = fake({ html: OK })
    ctx.http.post = async () => {
      throw new Error('届かない')
    }
    await expect(twoChConnector.createPost!(thread('down.example'), input, ctx)).rejects.toThrow('届かない')
  })

  it('板の文字コードが分からなくても書き込みは止めず、SETTING.TXT を見るのは 1 度だけ', async () => {
    const { ctx, calls } = fake({ html: OK }, async () => {
      throw new Error('読めない')
    })
    const t = thread('once.example')
    expect((await twoChConnector.createPost!(t, input, ctx)).status).toBe('ok')
    expect((await twoChConnector.createPost!(t, input, ctx)).status).toBe('ok')
    expect(calls.get).toBe(1)
    expect(calls.sent).toHaveLength(2)
  })
})

describe('hono-bbs の書き込みの応答', () => {
  const WEB = 'https://write.example.com'
  const API = 'https://api.write.example.com/api/v1'
  const T = '6aefe762-1722-4b73-80f5-59db564142c7'
  const board = { connectorId: 'honobbs', url: `${WEB}/boards/b/`, name: 'b' }
  const thread: ThreadSummary = { connectorId: 'honobbs', boardUrl: board.url, key: T, title: '', postCount: 0, order: 0 }
  const POSTS = `${API}/boards/b/threads/${T}/posts`
  const PAIR = `${API}/auth/turnstile/pair`
  const input = { name: '', mail: '', body: 'a' }

  function fake(posts: Record<string, { status?: number; body: string } | Error>) {
    const ctx: ConnectorContext = {
      decode: (b) => new TextDecoder().decode(b),
      http: {
        get: async (): Promise<HttpResponse> => ({ status: 200, headers: {}, body: enc(`<meta name="bbs-api" content="${API}">`) }),
        async post(url): Promise<HttpResponse> {
          const r = posts[url]
          if (r instanceof Error) throw r
          if (!r) throw new Error(`知らない送り先: ${url}`)
          return { status: r.status ?? 200, headers: {}, body: enc(r.body) }
        },
      },
    }
    return ctx
  }

  it.each([
    ['JSON でない', '<html>ok</html>'],
    ['null', 'null'],
    ['番号なし', '{"data":{}}'],
    ['空', ''],
  ])('2xx の本文が%sでも書けたことにする(送り直して二重にならないように)', async (_, body) => {
    const r = await honoBbsConnector.createPost!(thread, input, fake({ [POSTS]: { status: 201, body } }))
    expect(r).toEqual({ status: 'ok', message: '書き込みました' })
  })

  it('エラーの理由を伝える', async () => {
    const r = await honoBbsConnector.createPost!(thread, input, fake({ [POSTS]: { status: 429, body: '{"error":"RATE_LIMITED","message":"待ってください"}' } }))
    expect(r).toMatchObject({ status: 'error', message: 'RATE_LIMITED: 待ってください' })
  })

  it('エラーの名前がなければ「エラー」、理由がなければ番号', async () => {
    expect(await honoBbsConnector.createPost!(thread, input, fake({ [POSTS]: { status: 400, body: '{"message":"だめ"}' } }))).toMatchObject({ message: 'エラー: だめ' })
    expect(await honoBbsConnector.createPost!(thread, input, fake({ [POSTS]: { status: 400, body: '{"error":"X"}' } }))).toMatchObject({ message: '書き込めませんでした(HTTP 400)' })
  })

  it.each(['<html>Blocked</html>', 'null'])('エラーの本文が %s でも番号を伝え、中身を見られるようにする', async (body) => {
    const r = await honoBbsConnector.createPost!(thread, input, fake({ [POSTS]: { status: 403, body } }))
    expect(r).toEqual({ status: 'error', message: '書き込めませんでした(HTTP 403)', html: body })
  })

  it.each([
    ['投げる', new Error('届かない')],
    ['JSON でない', { body: '<html></html>' }],
    ['data がない', { body: '{}' }],
  ])('Turnstile のつなぎのコードの取得が%sときは、認証ページだけ案内する', async (_, pair) => {
    const r = await honoBbsConnector.createPost!(thread, input, fake({ [POSTS]: { status: 400, body: '{"error":"TURNSTILE_INVALID"}' }, [PAIR]: pair }))
    expect(r).toMatchObject({ status: 'auth', url: `${API}/auth/turnstile` })
    expect(r.status === 'auth' && r.code).toBeUndefined()
  })

  it('スレ立ても同じ読み分け', async () => {
    const ctx = fake({ [`${API}/boards/b/threads`]: { status: 400, body: '{"error":"TITLE","message":"題が長い"}' } })
    expect(await honoBbsConnector.createThread!(board, { title: 't', name: '', mail: '', body: 'a' }, ctx)).toMatchObject({ status: 'error', message: 'TITLE: 題が長い' })
  })
})

describe('まちBBS の書き込みの応答', () => {
  const FORM = '<form name="posting" method=POST action="/bbs/write.cgi"></form>'

  it('スレタイに「エラー」や ERROR があっても、スレのページが返れば成功', () => {
    for (const title of ['アプリのエラー報告スレ', 'ERRORが出る人のスレ', 'エラー総合'])
      expect(parseMachiWrite(`<html><head><title>${title}</title></head><body><dl><dt>1 名前</dt></dl>${FORM}</body></html>`).status).toBe('ok')
  })

  it('ERROR の題なら、フォームや「書きこみました」の文字があっても失敗', () => {
    expect(parseMachiWrite(`<html><head><title>ＥＲＲＯＲ！</title></head><body>本文がありません${FORM}</body></html>`).status).toBe('error')
    expect(parseMachiWrite('<html><head><title>ERROR</title></head><body>入力: 書きこみました</body></html>').status).toBe('error')
  })

  it('スレのフォームのない題の「エラー」は失敗', () => {
    expect(parseMachiWrite('<html><head><title>エラー</title></head><body><a href="/bbs/read.cgi/a/1/">戻る</a></body></html>').status).toBe('error')
  })

  it('空の応答は失敗で、理由の言葉を付ける', () => {
    expect(parseMachiWrite('')).toEqual({ status: 'error', message: POST_FAILED })
  })

  it('スクリプトの中身は理由に混ぜない', () => {
    const r = parseMachiWrite('<html><head><title>ERROR</title></head><body><script>var a="x"</script>本文がありません</body></html>')
    expect(r.message).toBe('本文がありません')
  })

  it('HTTP エラーは本文を読まずに番号を伝え、ページを添える', async () => {
    const html = '<html><title>書きこみました</title></html>'
    const ctx: ConnectorContext = {
      decode: (b) => new TextDecoder().decode(b),
      http: {
        get: async () => {
          throw new Error('get は使わない')
        },
        post: async (): Promise<HttpResponse> => ({ status: 503, headers: { 'content-type': 'text/html; charset=utf-8' }, body: enc(html) }),
      },
    }
    const thread: ThreadSummary = { connectorId: 'machi', boardUrl: 'https://machi.to/kanto/', key: '1600000000', title: '', postCount: 0, order: 0 }
    expect(await machiConnector.createPost!(thread, { name: '', mail: '', body: 'a' }, ctx)).toEqual({ status: 'error', message: 'HTTP 503', html })
  })
})

describe('したらばの書き込みの応答', () => {
  it('ERROR の題なら、本文に書き込んだ文字が返ってきても失敗(「書きこみました」を書いたレスでも)', () => {
    const r = parseShitarabaWrite('<html><head><title>ERROR</title></head><body>ERROR: 連続投稿です。入力: 書きこみました</body></html>')
    expect(r.status).toBe('error')
    expect(r.message).toContain('連続投稿')
  })

  it('本文の「書きこみました」だけでも成功', () => {
    expect(parseShitarabaWrite('<html><head><title>掲示板</title></head><body>書きこみました。</body></html>').status).toBe('ok')
  })

  it('理由がなければ題、題もなければ決まりの言葉', () => {
    expect(parseShitarabaWrite('<html><head><title>だめ</title></head><body></body></html>').message).toBe('だめ')
    expect(parseShitarabaWrite('')).toEqual({ status: 'error', message: POST_FAILED })
  })
})
