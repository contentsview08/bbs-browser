// CLI を本物のサーバー(Miniflare)へ通す。署名の文がサーバーと同じであること
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkKeyFile, keygen, run } from '../../scripts/admin.mjs'
import { ORIGIN, startServer, testOp, withLength } from './server'

const NOW = 1_800_000_000_000

describe('管理の CLI', () => {
  let mf: Miniflare
  let dir: string
  let keyFile: string
  let lines: string[]
  const fetcher = async (url: string, init: RequestInit) => {
    const res = await mf.dispatchFetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), 'X-Test-Now': String(NOW), 'CF-Connecting-IP': '203.0.113.1' } } as never)
    return res as unknown as Response
  }
  const cli = (args: string[], ask?: () => Promise<string>) => {
    lines = []
    return run([...args, '--url', ORIGIN, '--key-file', keyFile, '--key-id', 'ops'], { env: {}, out: (s) => lines.push(s), fetch: fetcher, now: () => NOW, ...(ask && { ask }) })
  }
  const createSpace = async (token: string) => {
    const common = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.2', 'X-Test-Now': String(NOW) }
    const ask = JSON.stringify({ turnstile: 'test-pass', space_id: createHash('sha256').update(Buffer.from(token.repeat(64), 'hex')).digest('hex') })
    const issued = await mf.dispatchFetch(`${ORIGIN}/tickets`, { method: 'POST', headers: withLength(ask, common), body: ask })
    const body = JSON.stringify({ ticket: ((await issued.json()) as { ticket: string }).ticket })
    const r = await mf.dispatchFetch(`${ORIGIN}/spaces`, { method: 'POST', headers: withLength(body, { ...common, Authorization: `Bearer ${token.repeat(64)}` }), body })
    expect(r.status).toBe(201)
    await r.text()
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'obb-admin-'))
    keyFile = join(dir, 'admin.pem')
    const k = keygen(keyFile, 'ops')
    mf = await startServer({ ADMIN_KEYS: JSON.stringify({ ops: k.publicKey }) })
    await mf.ready
    await testOp(mf, 'reset', { overrides: { POW_BITS: '0', SOURCE_LIMIT: '0', EMPTY_SPACE_DAYS: '0' } }, NOW)
  })
  afterAll(async () => {
    await mf.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('一覧・枠・作成の停止と再開', async () => {
    await createSpace('a')
    expect(await cli(['list'])).toBe(0)
    expect(JSON.parse(lines[0]).spaces.length).toBe(1)
    expect(await cli(['capacity'])).toBe(0)
    expect(JSON.parse(lines[0]).active).toBe(1)
    expect(await cli(['creation', 'close'])).toBe(0)
    expect(JSON.parse(lines[0]).creation_open).toBe(false)
    expect(await cli(['creation', 'open'])).toBe(0)
    expect(await cli(['audit', '--limit', '2'])).toBe(0)
    expect(JSON.parse(lines[0]).entries[0].key_id).toBe('ops')
  })
  it('全削除の --dry-run は何も消さず、違う文字ではやめる', async () => {
    let asked = 0
    expect(await cli(['delete-all', '--dry-run'], async () => (asked++, ''))).toBe(0)
    expect(asked).toBe(0)
    expect(lines.join('\n')).toContain(ORIGIN)
    expect(lines.join('\n')).toContain('1 件')
    expect(await cli(['delete-all'], async () => 'DELETE ALL 2 SPACES')).toBe(1)
    await cli(['capacity'])
    expect(JSON.parse(lines[0]).active).toBe(1)
    expect(await cli(['delete-all'], async () => 'DELETE ALL 1 SPACES')).toBe(0)
    await cli(['capacity'])
    expect(JSON.parse(lines[0]).active).toBe(0)
  })
  it('登録のない鍵は 404 で終わる', async () => {
    const other = join(dir, 'other.pem')
    keygen(other, 'other')
    lines = []
    const code = await run(['capacity', '--url', ORIGIN, '--key-file', other, '--key-id', 'other'], { env: {}, out: (s) => lines.push(s), fetch: fetcher, now: () => NOW })
    expect(code).toBe(1)
  })
  it('秘密鍵: リポジトリの中に作らない。権限 600 を確かめる。既存を上書きしない', () => {
    mkdirSync(join(dir, 'repo', '.git'), { recursive: true })
    expect(() => keygen(join(dir, 'repo', 'sub-admin.pem'), 'x')).toThrow('リポジトリ')
    expect(() => keygen(keyFile, 'x')).toThrow('もうあります')
    const loose = join(dir, 'loose.pem')
    writeFileSync(loose, 'x')
    chmodSync(loose, 0o644)
    // WSL の /mnt/c や Windows では mode が効かないので、効く環境でだけ確かめる
    if ((statSync(loose).mode & 0o077) !== 0) expect(() => checkKeyFile(loose, 'linux')).toThrow('権限')
    expect(() => checkKeyFile(loose, 'win32')).not.toThrow()
  })
})
