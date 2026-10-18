// 外付けのコネクタ(フォルダに置いた connector.js)を、外と切り離した囲いの中で動かす。
// 囲いは QuickJS(JavaScript の処理系)を WebAssembly で動かしたもの。中には window も fetch も Tauri の機能もなく、
// 外とつながるのは、ここで渡す関数(通信・文字コードの変換・URL の読み解き・ログ)だけ。
// 通信は manifest.json の hosts に書いた先にだけ通す(ほかの先へは、囲いの外のこの側で断る)。
// 1 回の処理が長すぎるとき(無限ループなど)は打ち切り、使えるメモリにも上限を付ける。
// Tauri に依存しないので、vitest でそのまま試せる(test/connectorSandbox.test.ts)
//
// コネクタの書き方: connector.js の中で defineConnector({ ... }) を 1 回呼ぶ。中身は組み込みのコネクタと同じ形
// (packages/connectors/src/types.ts の Connector)。ctx はアプリが渡す(引数の位置も組み込みと同じ)

import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSHandle, type QuickJSWASMModule } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-singlefile-browser-release-sync'
import type { Connector, ConnectorContext, Encoding, HttpRequestOptions, HttpResponse } from '@bbs-browser/connectors'

/** manifest.json の形 */
export interface ConnectorManifest {
  /** コネクタの名前(英小文字・数字・-。組み込みのコネクタと同じ名前は使えない) */
  id: string
  /** 画面に出す名前 */
  name: string
  version: string
  /** コネクタの決まりの版。いまは 1 */
  api: number
  /** 通信してよい先(「bbs.example.com」か「*.example.com」)。受け持つ URL もこの中だけ */
  hosts: string[]
  description?: string
  author?: string
}

/** いまのコネクタの決まりの版 */
export const CONNECTOR_API = 1
/** 組み込みのコネクタの名前(外付けには使わせない) */
const RESERVED_IDS = new Set(['2ch-compat', 'shitaraba', 'futaba', 'demo'])

/** manifest.json を読んで確かめる。おかしければ理由を付けて投げる */
export function parseManifest(text: string): ConnectorManifest {
  let m: Partial<ConnectorManifest>
  try {
    m = JSON.parse(text) as Partial<ConnectorManifest>
  } catch {
    throw new Error('manifest.json が JSON として読めません')
  }
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(m.id)) throw new Error('id は英小文字・数字・- で 2〜41 文字にしてください')
  if (RESERVED_IDS.has(m.id)) throw new Error(`id「${m.id}」は組み込みのコネクタが使っています`)
  if (typeof m.name !== 'string' || !m.name.trim()) throw new Error('name がありません')
  if (typeof m.version !== 'string') throw new Error('version がありません')
  if (m.api !== CONNECTOR_API) throw new Error(`api は ${CONNECTOR_API} にしてください(このアプリのコネクタの決まりの版)`)
  if (!Array.isArray(m.hosts) || m.hosts.length === 0 || !m.hosts.every((h) => typeof h === 'string' && /^(\*\.)?[a-z0-9.-]+\.[a-z0-9-]+$/i.test(h)))
    throw new Error('hosts には、通信する先のホスト名(bbs.example.com か *.example.com)を 1 つ以上書いてください')
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    api: m.api,
    hosts: m.hosts.map((h) => h.toLowerCase()),
    ...(typeof m.description === 'string' && { description: m.description }),
    ...(typeof m.author === 'string' && { author: m.author }),
  }
}

/** URL の行き先が hosts に入っているか(http・https だけ。*.example.com は example.com そのものも含む) */
export function hostAllowed(url: string, hosts: string[]): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  const host = u.hostname.toLowerCase()
  return hosts.some((h) => (h.startsWith('*.') ? host === h.slice(2) || host.endsWith(h.slice(1)) : host === h))
}

/** 通信を hosts の先だけに絞った ctx */
export function restrictContext(ctx: ConnectorContext, hosts: string[]): ConnectorContext {
  const check = (url: string) => {
    if (!hostAllowed(url, hosts)) throw new Error(`通信できない先です: ${url}(manifest.json の hosts にありません)`)
  }
  return {
    decode: ctx.decode,
    http: {
      get: async (url, opts) => (check(url), ctx.http.get(url, opts)),
      post: async (url, body, opts) => (check(url), ctx.http.post(url, body, opts)),
    },
  }
}

// ── 囲いの中と外で、値を JSON にして受け渡す(バイト列は base64、Date は文字にして戻す) ──

const toB64 = (u8: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const replacer = (_k: string, v: unknown) => (v instanceof Uint8Array ? { __u8: toB64(v) } : v)
const reviver = (k: string, v: unknown) => {
  if (v && typeof v === 'object' && typeof (v as { __u8?: unknown }).__u8 === 'string') return fromB64((v as { __u8: string }).__u8)
  if (k === 'createdAt' && typeof v === 'string') return new Date(v)
  return v
}

/** 囲いの中で、コネクタのコードより先に動かすもの。外の関数(__host)を ctx の形にし、足りない標準の部品を足す */
const PRELUDE = String.raw`
'use strict';
(() => {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const fromB64 = (s) => {
    const t = s.replace(/=+$/, '');
    const out = new Uint8Array(Math.floor((t.length * 3) / 4));
    let o = 0, buf = 0, bits = 0;
    for (let i = 0; i < t.length; i++) {
      buf = (buf << 6) | B64.indexOf(t[i]);
      bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; }
    }
    return out;
  };
  const toB64 = (u8) => {
    let s = '', i = 0;
    for (; i + 2 < u8.length; i += 3) {
      const n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (i < u8.length) {
      const n = (u8[i] << 16) | ((i + 1 < u8.length ? u8[i + 1] : 0) << 8);
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : '=') + '=';
    }
    return s;
  };
  const revive = (k, v) => {
    if (v && typeof v === 'object' && typeof v.__u8 === 'string') return fromB64(v.__u8);
    if (k === 'createdAt' && typeof v === 'string') return new Date(v);
    return v;
  };
  const replace = (k, v) => (v instanceof Uint8Array ? { __u8: toB64(v) } : v);
  const host = globalThis.__host;
  delete globalThis.__host;
  const bytesOf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const toRes = (r) => Object.assign(JSON.parse(r[0]), { body: new Uint8Array(r[1]) });
  const ctx = Object.freeze({
    http: Object.freeze({
      get: (url, opts) => host.get(String(url), JSON.stringify(opts || {}, replace)).then(toRes),
      post: (url, body, opts) =>
        host.post(String(url), body instanceof Uint8Array ? bytesOf(body) : String(body), JSON.stringify(opts || {}, replace)).then(toRes),
    }),
    decode: (bytes, enc) => host.decode(bytesOf(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), String(enc)),
  });
  globalThis.TextDecoder = class TextDecoder {
    constructor(enc) { this.encoding = enc || 'utf-8'; }
    decode(b) { return b ? ctx.decode(b instanceof Uint8Array ? b : new Uint8Array(b), this.encoding) : ''; }
  };
  globalThis.TextEncoder = class TextEncoder {
    encode(s) { return new Uint8Array(host.encode(String(s === undefined ? '' : s))); }
  };
  class URLSearchParams {
    constructor(init) {
      this._l = [];
      if (typeof init === 'string') {
        const dec = (x) => decodeURIComponent(x.replace(/\+/g, ' '));
        for (const part of init.replace(/^\?/, '').split('&')) {
          if (!part) continue;
          const i = part.indexOf('=');
          this._l.push(i < 0 ? [dec(part), ''] : [dec(part.slice(0, i)), dec(part.slice(i + 1))]);
        }
      } else if (init) {
        for (const [k, v] of Array.isArray(init) ? init : Object.entries(init)) this._l.push([String(k), String(v)]);
      }
    }
    get(k) { const e = this._l.find((x) => x[0] === k); return e ? e[1] : null; }
    getAll(k) { return this._l.filter((x) => x[0] === k).map((x) => x[1]); }
    has(k) { return this._l.some((x) => x[0] === k); }
    set(k, v) { this.delete(k); this._l.push([String(k), String(v)]); }
    append(k, v) { this._l.push([String(k), String(v)]); }
    delete(k) { this._l = this._l.filter((x) => x[0] !== k); }
    entries() { return this._l[Symbol.iterator](); }
    [Symbol.iterator]() { return this._l[Symbol.iterator](); }
    toString() {
      const enc = (x) => encodeURIComponent(x).replace(/%20/g, '+');
      return this._l.map(([k, v]) => enc(k) + '=' + enc(v)).join('&');
    }
  }
  globalThis.URLSearchParams = URLSearchParams;
  globalThis.URL = class URL {
    constructor(url, base) {
      Object.assign(this, JSON.parse(host.url(String(url), base === undefined ? '' : String(base))));
      this.searchParams = new URLSearchParams(this.search);
    }
    toString() { return this.href; }
    toJSON() { return this.href; }
  };
  const log = (level) => (...a) => host.log(level, a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  globalThis.console = { log: log('log'), info: log('log'), debug: log('log'), warn: log('warn'), error: log('error') };
  let connector;
  globalThis.defineConnector = (c) => {
    if (connector) throw new Error('defineConnector は 1 回だけ呼んでください');
    connector = c;
  };
  const CTX = '__ctx__';
  globalThis.__describe = () => {
    if (!connector) throw new Error('connector.js の中で defineConnector({ ... }) を呼んでください');
    const keys = Object.keys(connector);
    return JSON.stringify(
      {
        props: Object.fromEntries(keys.filter((k) => typeof connector[k] !== 'function').map((k) => [k, connector[k]])),
        methods: keys.filter((k) => typeof connector[k] === 'function'),
      },
      replace,
    );
  };
  globalThis.__call = (name, argsJson) => {
    const f = connector[name];
    if (typeof f !== 'function') throw new Error('コネクタに ' + name + ' がありません');
    const args = JSON.parse(argsJson, revive).map((a) => (a === CTX ? ctx : a));
    const r = f.apply(connector, args);
    const out = (v) => JSON.stringify(v === undefined ? null : v, replace);
    return r && typeof r.then === 'function' ? Promise.resolve(r).then(out) : out(r);
  };
})();
`

/** 呼ぶときに ctx を差し込む位置(組み込みのコネクタと同じ引数の並び) */
const CTX_AT: Record<string, number> = {
  resolveUrl: 1,
  boardInfo: 1,
  listBoards: 1,
  listThreads: 1,
  fetchPosts: 2,
  createPost: 2,
  createThread: 2,
  submitConfirm: 1,
  deletePost: 3,
  react: 3,
  runPostAction: 3,
  login: 2,
}
/** その場で答える(Promise を返さない)もの */
const SYNC = new Set(['canHandle', 'isThreadUrl', 'threadWebUrl', 'splitPostIcon', 'postByteLength'])
/** なくてはならないもの */
const REQUIRED = ['canHandle', 'threadWebUrl', 'resolveUrl', 'listBoards', 'listThreads', 'fetchPosts']

let modulePromise: Promise<QuickJSWASMModule> | undefined
const quickjs = () => (modulePromise ??= newQuickJSWASMModuleFromVariant(variant))

export interface SandboxOptions {
  /** 通信と文字コードの変換。通信は restrictContext で絞ったものを渡す */
  ctx: ConnectorContext
  /** コネクタの console.log など */
  log?: (level: 'log' | 'warn' | 'error', message: string) => void
  /** 1 回の処理(待ち時間を除く)の上限(ミリ秒) */
  timeoutMs?: number
  /** 使えるメモリの上限(バイト) */
  memoryBytes?: number
}

export interface SandboxedConnector {
  connector: Connector
  /** 囲いを片付ける(読み込み直す・無効にするとき) */
  dispose(): void
}

/** connector.js を囲いの中で動かし、組み込みと同じ形のコネクタとして返す */
export async function loadSandboxedConnector(code: string, manifest: ConnectorManifest, opts: SandboxOptions): Promise<SandboxedConnector> {
  const mod = await quickjs()
  const rt = mod.newRuntime()
  rt.setMemoryLimit(opts.memoryBytes ?? 64 * 1024 * 1024)
  rt.setMaxStackSize(1024 * 1024)
  const vm = rt.newContext()
  let disposed = false
  const timeout = opts.timeoutMs ?? 5000
  const arm = () => rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeout))
  /** 囲いの中の、待っていた処理(Promise の続き)を進める */
  const pump = () => {
    if (disposed) return
    arm()
    rt.executePendingJobs().dispose()
  }
  const errorText = (h: QuickJSHandle) => {
    const e = vm.dump(h) as unknown
    if (e && typeof e === 'object' && 'message' in e) return `${(e as { name?: string }).name ?? 'Error'}: ${(e as { message: string }).message}`
    return String(e)
  }
  const copyBytes = (h: QuickJSHandle) => {
    const lifetime = vm.getArrayBuffer(h)
    const out = lifetime.value.slice()
    lifetime.dispose()
    return out
  }

  // ── 囲いの中から呼べる、外の関数 ──
  const host = vm.newObject()
  const fn = (name: string, impl: (...args: QuickJSHandle[]) => QuickJSHandle | void) => {
    const h = vm.newFunction(name, impl)
    vm.setProp(host, name, h)
    h.dispose()
  }
  /** 外の Promise(通信)を、囲いの中の Promise にする。返事は [ステータスとヘッダーの JSON, 本文のバイト列] */
  const reply = (p: Promise<HttpResponse>) => {
    const deferred = vm.newPromise()
    p.then(
      (res) => {
        if (disposed) return
        const arr = vm.newArray()
        const meta = vm.newString(JSON.stringify({ status: res.status, headers: res.headers }))
        const body = vm.newArrayBuffer(res.body.slice().buffer)
        vm.setProp(arr, 0, meta)
        vm.setProp(arr, 1, body)
        meta.dispose()
        body.dispose()
        deferred.resolve(arr)
        arr.dispose()
      },
      (e: unknown) => {
        if (disposed) return
        const err = vm.newError(e instanceof Error ? e.message : String(e))
        deferred.reject(err)
        err.dispose()
      },
    )
    void deferred.settled.then(() => {
      pump()
      if (!disposed && deferred.alive) deferred.dispose()
    })
    return deferred.handle
  }
  const optsOf = (h: QuickJSHandle) => JSON.parse(vm.getString(h), reviver) as HttpRequestOptions
  fn('get', (url, o) => reply(opts.ctx.http.get(vm.getString(url), optsOf(o))))
  fn('post', (url, body, o) =>
    reply(opts.ctx.http.post(vm.getString(url), vm.typeof(body) === 'string' ? vm.getString(body) : copyBytes(body), optsOf(o))),
  )
  fn('decode', (bytes, enc) => vm.newString(opts.ctx.decode(copyBytes(bytes), vm.getString(enc) as Encoding)))
  fn('encode', (s) => vm.newArrayBuffer(new TextEncoder().encode(vm.getString(s)).buffer))
  fn('url', (url, base) => {
    const b = vm.getString(base)
    const u = new URL(vm.getString(url), b || undefined)
    const { href, origin, protocol, host: h, hostname, port, pathname, search, hash } = u
    return vm.newString(JSON.stringify({ href, origin, protocol, host: h, hostname, port, pathname, search, hash }))
  })
  fn('log', (level, message) => {
    const l = vm.getString(level)
    opts.log?.(l === 'warn' || l === 'error' ? l : 'log', vm.getString(message))
  })
  vm.setProp(vm.global, '__host', host)
  host.dispose()

  const dispose = () => {
    if (disposed) return
    disposed = true
    vm.dispose()
    rt.dispose()
  }
  const run = (src: string, file: string) => {
    arm()
    const r = vm.evalCode(src, file)
    if (r.error) {
      const msg = errorText(r.error)
      r.error.dispose()
      throw new Error(`${file}: ${msg}`)
    }
    r.value.dispose()
  }
  /** 囲いの中の __call(名前, 引数の JSON) を呼ぶ。返事は JSON の文字か、それを返す Promise */
  const call = (name: string, args: unknown[]): QuickJSHandle => {
    if (disposed) throw new Error(`コネクタ ${manifest.id} はもう使えません(読み込み直してください)`)
    const f = vm.getProp(vm.global, '__call')
    const n = vm.newString(name)
    const a = vm.newString(JSON.stringify(args, replacer))
    arm()
    const r = vm.callFunction(f, vm.undefined, n, a)
    f.dispose()
    n.dispose()
    a.dispose()
    if (r.error) {
      const msg = errorText(r.error)
      r.error.dispose()
      pump()
      throw new Error(`${manifest.id}.${name}: ${msg}`)
    }
    return r.value
  }
  const callSync = (name: string, args: unknown[]): unknown => {
    const v = call(name, args)
    if (vm.typeof(v) !== 'string') {
      v.dispose()
      throw new Error(`${manifest.id}.${name} は Promise を返さずに、その場で答えてください`)
    }
    const s = vm.getString(v)
    v.dispose()
    pump()
    return JSON.parse(s, reviver)
  }
  const callAsync = async (name: string, args: unknown[]): Promise<unknown> => {
    const v = call(name, args)
    if (vm.typeof(v) === 'string') {
      const s = vm.getString(v)
      v.dispose()
      return JSON.parse(s, reviver)
    }
    const settled = vm.resolvePromise(v)
    v.dispose()
    pump()
    const r = await settled
    if (disposed) throw new Error(`コネクタ ${manifest.id} はもう使えません(読み込み直してください)`)
    if (r.error) {
      const msg = errorText(r.error)
      r.error.dispose()
      throw new Error(`${manifest.id}.${name}: ${msg}`)
    }
    const s = vm.getString(r.value)
    r.value.dispose()
    return JSON.parse(s, reviver)
  }

  try {
    run(PRELUDE, 'prelude.js')
    run(code, 'connector.js')
    pump()
    const f = vm.getProp(vm.global, '__describe')
    arm()
    const r = vm.callFunction(f, vm.undefined)
    f.dispose()
    if (r.error) {
      const msg = errorText(r.error)
      r.error.dispose()
      throw new Error(msg)
    }
    const { props, methods } = JSON.parse(vm.getString(r.value), reviver) as { props: Record<string, unknown>; methods: string[] }
    r.value.dispose()
    const missing = REQUIRED.filter((m) => !methods.includes(m))
    if (missing.length > 0) throw new Error(`コネクタに ${missing.join('・')} がありません`)

    const c: Record<string, unknown> = {
      ...props,
      // 名前と受け持つ範囲は manifest.json のものを使う(コードの中の値で、ほかのコネクタになりすませないように)
      id: manifest.id,
      name: manifest.name,
      capabilities: props.capabilities ?? { post: methods.includes('createPost'), images: false, incremental: true },
    }
    for (const m of methods) {
      if (SYNC.has(m)) c[m] = (...a: unknown[]) => callSync(m, a)
      else if (m in CTX_AT)
        c[m] = (...a: unknown[]) => {
          const args = [...a]
          args[CTX_AT[m]] = '__ctx__' // アプリの ctx の代わりに、囲いの中の ctx(通信を絞ったもの)を使わせる
          return callAsync(m, args)
        }
    }
    // ほかの掲示板の URL を横取りしないよう、受け持つのは hosts の中の URL だけ
    const inner = c.canHandle as (url: string) => unknown
    c.canHandle = (url: string) => hostAllowed(url, manifest.hosts) && !!inner(url)
    if (c.isThreadUrl) {
      const isThread = c.isThreadUrl as (url: string) => unknown
      c.isThreadUrl = (url: string) => hostAllowed(url, manifest.hosts) && !!isThread(url)
    }
    return { connector: c as unknown as Connector, dispose }
  } catch (e) {
    dispose()
    throw e
  }
}
