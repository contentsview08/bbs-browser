import { describe, expect, it } from 'vitest'
import { futabaConnector } from '../src/futaba/connector'
import { builtinConnectors } from '../src/index'
import type { ConnectorContext, HttpResponse, ThreadSummary } from '../src/types'

// 見本は作り物の中身(形は 2026-10-17 に may.2chan.net/b/ で確かめたものに合わせた)。
// 偽サーバーは文字を UTF-8 で返し、decode も UTF-8 で読む(Shift_JIS への変換はここでは確かめない)
const utf8 = (s: string) => new TextEncoder().encode(s)

function fake(routes: Record<string, { status?: number; body?: string }>, postReply?: string) {
  const got: { url: string; headers?: Record<string, string> }[] = []
  const posted: { url: string; body: string; headers?: Record<string, string>; sameCookiesAsGet?: boolean }[] = []
  const ctx: ConnectorContext = {
    decode: (b) => new TextDecoder('utf-8').decode(b),
    http: {
      async get(url, opts): Promise<HttpResponse> {
        got.push({ url, headers: opts?.headers })
        const r = routes[url]
        if (!r) return { status: 404, headers: {}, body: new Uint8Array() }
        return { status: r.status ?? 200, headers: {}, body: utf8(r.body ?? '') }
      },
      post: async (url, body, opts) => {
        if (postReply === undefined) throw new Error('書き込まない')
        posted.push({ url, body: typeof body === 'string' ? body : new TextDecoder().decode(body), headers: opts?.headers, sameCookiesAsGet: opts?.sameCookiesAsGet })
        return { status: 200, headers: {}, body: utf8(postReply) }
      },
    },
  }
  return { ctx, got, posted }
}

const BOARD = 'https://may.2chan.net/b/'
const board = { connectorId: 'futaba', url: BOARD, name: '二次元裏＠ふたば' }
const thread: ThreadSummary = { connectorId: 'futaba', boardUrl: BOARD, key: '1000', title: '', postCount: 0, order: 0 }

const CATALOG = `<html><body><table border=1 align=center id='cattable'><tr>
<td><a href='res/1000.htm' target='_blank'><img src='/b/cat/1792224836232s.jpg' border=0 width=50 height=40 alt=""></a><br><small>スレタイ&amp;その一</small><br><font size=2>12</font></td>
<td><a href='res/1002.htm' target='_blank'></a><br><small>画像のないスレ</small><br><font size=2>0</font></td>
</tr></table></body></html>`

const PAGE = `<html><body><div class="thre" data-res="1000">画像ファイル名：<a href="/b/src/1792224836232.jpg" target='_blank'>1792224836232.jpg</a>-(196364 B)<br><a href="/b/src/1792224836232.jpg" target='_blank'><img src='/b/thumb/1792224836232s.jpg'></a><span class="csb">無念</span>Name<span class="cnm">としあき</span><span class="cnw">26/10/17(土)17:13:56</span><span class="cno">No.1000</span><a href="javascript:void(0);" onclick="sd(1000);return(false);" class=sod id=sd1000>そうだねx3</a>
<blockquote>スレを立てた人の本文<br>二行目</blockquote>
<table border=0><tr><td class=rts>…</td><td class=rtd><span id="delcheck1003" class="rsc">1</span><span class="csb">無念</span>Name<span class="cnm"><a href="mailto:sage">としあき</a></span><span class="cnw">26/10/17(土)17:15:10 ID:abcd1234</span><span class="cno">No.1003</span><a href="javascript:void(0);" onclick="sd(1003);return(false);" class=sod id=sd1003>+</a><blockquote><font color="#789922">&gt;スレを立てた人の本文</font><br>そうだね</blockquote></td></tr></table>
<table border=0><tr><td class=rts>…</td><td class=rtd><span id="delcheck1007" class="rsc">2</span><span class="csb">無念</span>Name<span class="cnm">としあき</span><span class="cnw">26/10/17(土)17:17:30</span><span class="cno">No.1007</span><blockquote>&gt;1003<br>そうかな</blockquote></td></tr></table>
</div></body></html>`

const JSON_NEW = JSON.stringify({
  old: 0,
  sd: { '1000': '4', '1007': '1' },
  res: {
    '1007': { now: '26/10/17(土)17:17:30', name: 'としあき', email: '', com: '&gt;1003<br>そうかな', src: '', rsc: 2 },
    '1010': { now: '26/10/17(土)17:20:00', name: 'としあき', email: '', com: '新しい返信', src: '/b/src/1792225000000.png', rsc: 3 },
  },
})

describe('ふたばのコネクタ', () => {
  it('ふたばの URL はふたばのコネクタが受け持ち、2ch 互換は受け持たない', () => {
    const url = 'https://may.2chan.net/b/res/1000.htm'
    expect(builtinConnectors.find((c) => c.canHandle(url))?.id).toBe('futaba')
    expect(futabaConnector.isThreadUrl?.(url)).toBe(true)
    expect(futabaConnector.isThreadUrl?.(BOARD)).toBe(false)
    expect(futabaConnector.threadWebUrl(thread)).toBe(url)
  })

  it('カタログを、スレタイ 40 文字・200 スレの Cookie を付けて読む。返信の数にスレを立てた人の分を足す', async () => {
    const { ctx, got } = fake({ [`${BOARD}futaba.php?mode=cat`]: { body: CATALOG } })
    const threads = await futabaConnector.listThreads(board, ctx)
    expect(got[0].headers?.Cookie).toBe('cxyl=20x10x40x0x0')
    expect(threads.map((t) => [t.key, t.title, t.postCount])).toEqual([
      ['1000', 'スレタイ&その一', 13],
      ['1002', '画像のないスレ', 1],
    ])
    expect(threads[0].thumb).toBe('https://may.2chan.net/b/cat/1792224836232s.jpg')
    expect(threads[0].createdAt?.getTime()).toBe(1792224836232)
    expect(threads[1].thumb).toBeUndefined()
  })

  it('最初はスレのページで全部を読む。スレを立てた人が 1 番、通し番号は ref、画像は本文の頭に URL で', async () => {
    const { ctx } = fake({ [`${BOARD}res/1000.htm`]: { body: PAGE } })
    const r = await futabaConnector.fetchPosts(thread, null, ctx)
    expect(r.status).toBe('updated')
    expect(r.title).toBe('スレを立てた人の本文')
    expect(r.posts.map((p) => [p.no, p.ref])).toEqual([
      [1, 1000],
      [2, 1003],
      [3, 1007],
    ])
    expect(r.posts[0].body).toBe('https://may.2chan.net/b/src/1792224836232.jpg\nスレを立てた人の本文\n二行目')
    expect(r.posts[1]).toMatchObject({ name: 'としあき', mail: 'sage', id: 'abcd1234', date: '26/10/17(土)17:15:10', body: '>スレを立てた人の本文\nそうだね' })
    expect(r.cursor).toEqual({ lastRef: 1007, lastNo: 3 })
    // そうだね(まだないレスは入れない)
    expect(r.votes).toEqual({ '1000': 3 })
  })

  it('そのあとは JSON で、最後の番号より新しい返信だけ', async () => {
    const url = `${BOARD}futaba.php?mode=json&res=1000&start=1007`
    const { ctx } = fake({ [url]: { body: JSON_NEW } })
    const r = await futabaConnector.fetchPosts(thread, { lastRef: 1007, lastNo: 3 }, ctx)
    expect(r.status).toBe('updated')
    expect(r.posts.map((p) => [p.no, p.ref, p.body])).toEqual([[4, 1010, 'https://may.2chan.net/b/src/1792225000000.png\n新しい返信']])
    expect(r.cursor).toEqual({ lastRef: 1010, lastNo: 4 })
    expect(r.votes).toEqual({ '1000': 4, '1007': 1 })
  })

  it('新しい返信がなければ notModified、スレが消えていたら archived', async () => {
    const same = JSON.stringify({ res: { '1007': { rsc: 2, com: 'x' } } })
    const { ctx } = fake({ [`${BOARD}futaba.php?mode=json&res=1000&start=1007`]: { body: same } })
    expect((await futabaConnector.fetchPosts(thread, { lastRef: 1007, lastNo: 3 }, ctx)).status).toBe('notModified')
    const gone = fake({})
    expect((await futabaConnector.fetchPosts(thread, null, gone.ctx)).status).toBe('archived')
    expect((await futabaConnector.fetchPosts(thread, { lastRef: 1007, lastNo: 3 }, gone.ctx)).status).toBe('archived')
  })

  it('アンカーは板の通し番号を指し、レスの上限はない', () => {
    expect(futabaConnector.anchorTarget).toBe('ref')
    expect(futabaConnector.maxPosts).toBeUndefined()
  })

  // 本番では試し書きしないので、フォームの写し方と応答の読み方だけを確かめる
  const FORM_PAGE = `${PAGE}<form action="/b/futaba.php?guid=on" method="POST" enctype="multipart/form-data" id="fm"><input type=hidden name=mode value="regist"><input type=hidden id="hash" name="hash" value="1792226540784444-abc"><input type=hidden id="ptua" name="ptua" value="656869215056"><input type=hidden name=resto value="1000"><input type=text name=name></form>`
  it('書き込む直前にページを取り直し、隠し欄(hash など)を写して、文字だけを送る', async () => {
    const { ctx, posted } = fake(
      { [`${BOARD}res/1000.htm`]: { body: FORM_PAGE }, 'https://may.2chan.net/bin/cachemt7.php': { body: 'function caco(){return "1792228311081";}' } },
      'ok',
    )
    const r = await futabaConnector.createPost!(thread, { name: '', mail: 'sage', body: 'abc' }, ctx)
    expect(r.status).toBe('ok')
    expect(posted[0].url).toBe('https://may.2chan.net/b/futaba.php?guid=on')
    // multipart/form-data の欄を読む
    const boundary = /boundary=(\S+)/.exec(posted[0].headers?.['Content-Type'] ?? '')?.[1]
    expect(boundary).toBeTruthy()
    const field = (name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)\\r\\n`).exec(posted[0].body)?.[1]
    expect(field('hash')).toBe('1792226540784444-abc')
    expect(field('resto')).toBe('1000')
    expect(field('mode')).toBe('regist')
    expect(field('textonly')).toBe('on')
    expect(field('email')).toBe('sage')
    expect(field('com')).toBe('abc')
    expect(field('chrenc')).toBe('文字')
    // 書き込みボタンの JavaScript が入れる値。初めての書き込みでは pthb は空
    expect(field('pthc')).toBe('1792228311081')
    expect(field('pthb')).toBe('')
    expect(field('js')).toBe('on')
    expect(field('responsemode')).toBe('ajax')
    expect(field('ptua')).toBe('1341647872')
    expect(posted[0].body).toContain('name="upfile"; filename=""')
    expect(posted[0].body.endsWith(`--${boundary}--\r\n`)).toBe(true)
    expect(posted[0].headers?.Referer).toBe(`${BOARD}res/1000.htm`)
    expect(posted[0].sameCookiesAsGet).toBe(true)
  })

  it('ファイルを付けると、upfile にファイルの中身を入れ、「画像なし」を付けない', async () => {
    const { ctx, posted } = fake(
      { [`${BOARD}res/1000.htm`]: { body: FORM_PAGE }, 'https://may.2chan.net/bin/cachemt7.php': { body: 'function caco(){return "1";}' } },
      'ok',
    )
    const data = new TextEncoder().encode('PNGDATA')
    const r = await futabaConnector.createPost!(thread, { name: '', mail: '', body: '画像', files: [{ name: 'a.png', type: 'image/png', data }] }, ctx)
    expect(r.status).toBe('ok')
    expect(posted[0].body).toContain('name="upfile"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nPNGDATA\r\n')
    expect(posted[0].body).not.toContain('name="textonly"')
  })

  it('スレ立ては、板の入口のページのフォームから、題名を sub に入れて resto なしで送る', async () => {
    const BOARD_FORM = FORM_PAGE.replace('<input type=hidden name=resto value="1000">', '')
    const { ctx, posted, got } = fake({ [`${BOARD}futaba.htm`]: { body: BOARD_FORM } }, '{"status":"ok","jumpto":1100}')
    const r = await futabaConnector.createThread!(board, { title: '新しいスレ', name: '', mail: '', body: '本文' }, ctx)
    expect(r.status).toBe('ok')
    expect(got[0].url).toBe(`${BOARD}futaba.htm`)
    expect(posted[0].body).toContain('name="sub"\r\n\r\n新しいスレ\r\n')
    expect(posted[0].body).not.toContain('name="resto"')
    expect(posted[0].headers?.Referer).toBe(`${BOARD}futaba.htm`)
  })

  it('そうだね: /sd.php?板名.番号 を呼んで、新しい数を返す', async () => {
    const { ctx, got } = fake({ 'https://may.2chan.net/sd.php?b.1003': { body: '5' } })
    const n = await futabaConnector.vote!(thread, { no: 2, ref: 1003, name: '', mail: '', date: '', body: '' }, ctx)
    expect(n).toBe(5)
    expect(got[0].url).toBe('https://may.2chan.net/sd.php?b.1003')
  })

  it('添付の決まり: 1 つまで、8000KB まで、画像と動画', () => {
    expect(futabaConnector.attachments).toMatchObject({ maxFiles: 1, maxBytes: 8_192_000 })
    expect(futabaConnector.attachments?.types).toContain('video/mp4')
  })

  it('断られたら、返ってきたページの文字を知らせる', async () => {
    const { ctx } = fake({ [`${BOARD}res/1000.htm`]: { body: FORM_PAGE } }, '<html><head><title>本文がありません</title></head><body>…</body></html>')
    const r = await futabaConnector.createPost!(thread, { name: '', mail: '', body: '' }, ctx)
    expect(r).toMatchObject({ status: 'error', message: '本文がありません' })
    // 前の読み方(refresh があれば書けた)だと、エラーのページも「書けた」にしてしまっていた
    const html = fake({ [`${BOARD}res/1000.htm`]: { body: FORM_PAGE } }, '<html><head><META HTTP-EQUIV="refresh" content="1"></head><body>書き込みが多すぎます</body></html>')
    expect((await futabaConnector.createPost!(thread, { name: '', mail: '', body: 'x' }, html.ctx)).status).toBe('error')
  })
})
