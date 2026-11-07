#!/usr/bin/env node
// 同期サーバーの管理 API の道具。秘密鍵は手元だけに置き、リポジトリの中には作らない
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { pathToFileURL } from 'node:url'
import { ADMIN_HEADER, formatHeader, signingString } from '../src/admin/canonical.mjs'

const USAGE = `使い方: node scripts/admin.mjs <命令> [--url https://...] [--key-file <秘密鍵>] [--key-id <鍵 ID>]

  keygen --out <ファイル> --key-id <鍵 ID>   鍵を作り、ADMIN_KEYS に入れる値を出す
  list [--limit N] [--sort last_access|created|used_bytes] [--cursor C]
  show <space_id>
  delete <space_id>
  delete-many <space_id>... --expected <件数>
  delete-all [--dry-run]                     環境と件数を出し、確認の文字の入力を求める
  job <job_id>
  capacity
  stats                                      領域の使われ方のまとめ(人が読む形)
  creation open|close
  signals
  block <作成元の値> [--days N]
  unblock <作成元の値>
  audit [--limit N] [--cursor C]

環境変数: OBB_ADMIN_URL・OBB_ADMIN_KEY_FILE・OBB_ADMIN_KEY_ID`

const b64url = (b) => Buffer.from(b).toString('base64url')

const DAY_MS = 86400000

/** 領域の一覧を、人が読むまとめにする */
export function summarize(spaces, capacity, now = Date.now()) {
  const active = (days) => spaces.filter((s) => s.last_access_at >= now - days * DAY_MS).length
  const bytes = spaces.reduce((n, s) => n + (s.used_bytes ?? 0), 0)
  const records = spaces.reduce((n, s) => n + (s.record_count ?? 0), 0)
  const count = (key) => {
    const m = new Map()
    for (const s of spaces) if (key(s)) m.set(key(s), (m.get(key(s)) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  }
  const short = (id) => String(id).slice(0, 12)
  const lines = [
    `領域: ${spaces.length} / ${capacity?.limit ?? '?'}(新規作成 ${capacity?.creation_open === false ? '停止中' : '受付中'})`,
    `使用中: 1 日 ${active(1)} / 7 日 ${active(7)} / 14 日 ${active(14)} / 30 日 ${active(30)}`,
    `中身なし: ${spaces.filter((s) => !s.record_count).length}`,
    `合計: ${(bytes / 1048576).toFixed(2)} MB、${records} レコード、直近の要求 ${spaces.reduce((n, s) => n + (s.req_recent ?? 0), 0)} 回`,
    '',
    '大きい順(上位 5):',
    ...[...spaces].sort((a, b) => (b.used_bytes ?? 0) - (a.used_bytes ?? 0)).slice(0, 5).map((s) => `  ${short(s.space_id)}  ${((s.used_bytes ?? 0) / 1024).toFixed(1)} KB  ${s.record_count ?? 0} 件`),
    '要求の多い順(上位 5):',
    ...[...spaces].sort((a, b) => (b.req_recent ?? 0) - (a.req_recent ?? 0)).slice(0, 5).map((s) => `  ${short(s.space_id)}  ${s.req_recent ?? 0} 回`),
    '作成の多い日(上位 5):',
    ...count((s) => (s.created_at ? new Date(s.created_at).toISOString().slice(0, 10) : '')).slice(0, 5).map(([d, n]) => `  ${d}  ${n} 件`),
    '同じ作成元の多い順(2 件以上):',
    ...count((s) => s.source_mac).filter(([, n]) => n >= 2).slice(0, 5).map(([m, n]) => `  ${short(m)}  ${n} 件`),
  ]
  return lines.join('\n')
}

export function parseArgs(argv) {
  const flags = {}
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') flags['dry-run'] = true
    else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i]
    else rest.push(a)
  }
  return { flags, rest }
}

function isInsideRepo(path) {
  let d = dirname(resolve(path))
  for (;;) {
    if (existsSync(resolve(d, '.git'))) return true
    const up = dirname(d)
    if (up === d) return false
    d = up
  }
}

/** Windows の権限は mode に出ないので確かめられない */
export function checkKeyFile(path, platform = process.platform) {
  if (platform === 'win32') return
  const mode = statSync(path).mode & 0o777
  if (mode & 0o077) throw new Error(`秘密鍵の権限が広すぎます(${mode.toString(8)})。chmod 600 ${path} をしてください`)
}

export function keygen(out, keyId) {
  if (!out || !keyId) throw new Error('--out と --key-id が要ります')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId)) throw new Error('鍵 ID に使えない文字があります')
  if (isInsideRepo(out)) throw new Error('秘密鍵をリポジトリの中に作りません。外の場所を指定してください')
  if (existsSync(out)) throw new Error('そのファイルはもうあります')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
  return { keyId, publicKey: b64url(raw) }
}

export function signRequest({ method, url, body, keyId, privateKey, now = Date.now(), nonce = b64url(randomBytes(16)) }) {
  const u = new URL(url)
  const timestamp = Math.floor(now / 1000)
  const text = signingString({ method, host: u.host, path: u.pathname, query: u.search, bodySha256: createHash('sha256').update(body ?? '').digest('hex'), timestamp, nonce, keyId })
  const signature = b64url(sign(null, Buffer.from(text), privateKey))
  return formatHeader({ keyId, timestamp, nonce, signature })
}

function loadKey(flags, env) {
  const file = flags['key-file'] ?? env.OBB_ADMIN_KEY_FILE
  const keyId = flags['key-id'] ?? env.OBB_ADMIN_KEY_ID
  if (!file || !keyId) throw new Error('--key-file と --key-id が要ります')
  checkKeyFile(file)
  return { keyId, privateKey: createPrivateKey(readFileSync(file)) }
}

function query(flags, names) {
  const q = new URLSearchParams()
  for (const n of names) if (flags[n] !== undefined) q.set(n, flags[n])
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** deps は差し替え可能にする。fetch と画面の入出力をテストで渡すため */
export async function run(argv, deps = {}) {
  const env = deps.env ?? process.env
  const out = deps.out ?? ((s) => console.log(s))
  const doFetch = deps.fetch ?? fetch
  const ask = deps.ask ?? (async (q) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      return await rl.question(q)
    } finally {
      rl.close()
    }
  })
  const { flags, rest } = parseArgs(argv)
  const [cmd, ...args] = rest
  if (!cmd || cmd === 'help') {
    out(USAGE)
    return 0
  }
  if (cmd === 'keygen') {
    const k = keygen(flags.out, flags['key-id'])
    out(`公開鍵を ADMIN_KEYS に足してください: {"${k.keyId}":"${k.publicKey}"}`)
    return 0
  }
  const base = (flags.url ?? env.OBB_ADMIN_URL ?? '').replace(/\/+$/, '')
  if (!base) throw new Error('--url が要ります')
  const key = loadKey(flags, env)
  const call = async (method, path, value) => {
    const body = value === undefined ? undefined : JSON.stringify(value)
    const url = base + path
    const res = await doFetch(url, {
      method,
      redirect: 'manual',
      headers: { [ADMIN_HEADER]: signRequest({ method, url, body, ...key, now: deps.now?.() }), ...(body !== undefined && { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) }) },
      ...(body !== undefined && { body }),
    })
    const text = await res.text()
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      // 本文が JSON でなくても状態コードは出す
    }
    return { status: res.status, body: parsed, text }
  }
  const show = (r) => {
    out(JSON.stringify(r.body ?? r.text, null, 2))
    if (r.status === 404) out('404: 署名・鍵 ID・時刻・URL か、対象がありません(管理 API は理由を返しません)')
    return r.status >= 200 && r.status < 300 ? 0 : 1
  }
  switch (cmd) {
    case 'list':
      return show(await call('GET', `/admin/v1/spaces${query(flags, ['limit', 'sort', 'cursor'])}`))
    case 'show':
      return show(await call('GET', `/admin/v1/spaces/${args[0]}`))
    case 'delete':
      return show(await call('DELETE', `/admin/v1/spaces/${args[0]}`))
    case 'delete-many':
      if (flags.expected === undefined) throw new Error('--expected が要ります')
      return show(await call('POST', '/admin/v1/spaces/delete', { ids: args, expected_count: Number(flags.expected) }))
    case 'delete-all': {
      const cap = await call('GET', '/admin/v1/capacity')
      if (cap.status !== 200) return show(cap)
      const n = cap.body.active
      const confirm = `DELETE ALL ${n} SPACES`
      out(`対象の環境: ${base}`)
      out(`消える領域: ${n} 件(今あるものだけ。この後に作られた領域は消えません)`)
      if (flags['dry-run']) {
        out('--dry-run: 何も消していません')
        return 0
      }
      const typed = await ask(`続けるなら「${confirm}」と入力してください: `)
      if (typed.trim() !== confirm) {
        out('文字が違うのでやめました')
        return 1
      }
      return show(await call('POST', '/admin/v1/spaces/delete-all', { expected_count: n, confirm }))
    }
    case 'job':
      return show(await call('GET', `/admin/v1/jobs/${args[0]}`))
    case 'capacity':
      return show(await call('GET', '/admin/v1/capacity'))
    case 'creation':
      if (args[0] !== 'open' && args[0] !== 'close') throw new Error('open か close を指定してください')
      return show(await call('POST', '/admin/v1/creation', { open: args[0] === 'open' }))
    case 'signals':
      return show(await call('GET', '/admin/v1/signals'))
    case 'stats': {
      const spaces = []
      let cursor = null
      do {
        const r = await call('GET', `/admin/v1/spaces?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        if (r.status !== 200) return show(r)
        spaces.push(...r.body.spaces)
        cursor = r.body.next_cursor
      } while (cursor)
      const capacity = await call('GET', '/admin/v1/capacity')
      out(summarize(spaces, capacity.body, deps.now?.() ?? Date.now()))
      return 0
    }
    case 'block':
      return show(await call('POST', '/admin/v1/sources/block', { value: args[0], ...(flags.days !== undefined && { days: Number(flags.days) }) }))
    case 'unblock':
      return show(await call('DELETE', `/admin/v1/sources/block/${args[0]}`))
    case 'audit':
      return show(await call('GET', `/admin/v1/audit${query(flags, ['limit', 'cursor'])}`))
    default:
      out(USAGE)
      return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (e) => {
      console.error(e instanceof Error ? e.message : String(e))
      process.exitCode = 1
    },
  )
}
