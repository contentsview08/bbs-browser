import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { SyncResponseTooLarge } from '@bbs-browser/sync'
import { DEFAULT_SETTINGS } from '../src/ui/settings'
import { settingsFile } from '../src/utils/backup'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }))

const { decodeKeyMaterial, encodeKeyMaterial, syncTransport, resolveSyncBoard, DEFAULT_SYNC_SERVER } = await import('../src/host/sync')

const REQ = { method: 'POST' as const, url: 'https://sync.test/records', headers: { Authorization: 'Bearer t' }, body: '{}', maxBytes: 10, timeoutMs: 10_000 }

describe('同期の PC の部品', () => {
  it('鍵の値を読み戻せ、壊れた値は鍵なしとして扱う', () => {
    const v = { k: new Uint8Array(32).fill(1), deviceId: 'dev', ticket: 'v1.a' }
    expect(decodeKeyMaterial(encodeKeyMaterial(v))).toEqual(v)
    expect(decodeKeyMaterial(encodeKeyMaterial({ ...v, ticket: null }))?.ticket).toBeNull()
    for (const bad of ['', '{', '{"k":1}', '{"k":"***","device_id":"d","ticket":null}']) expect(decodeKeyMaterial(bad)).toBeNull()
  })

  it('Rust の命令へ渡し、失敗の中身を外へ出さない', async () => {
    invoke.mockResolvedValueOnce({ status: 200, body: '{}' })
    expect(await syncTransport.send(REQ)).toEqual({ status: 200, body: '{}' })
    expect(invoke.mock.calls[0][0]).toBe('sync_http')
    expect(invoke.mock.calls[0][1].req).toMatchObject({ url: REQ.url, body: '{}', max_bytes: 10, timeout_ms: 10_000 })
    invoke.mockRejectedValueOnce('network')
    await expect(syncTransport.send(REQ)).rejects.toThrow('network')
    invoke.mockRejectedValueOnce('too_large')
    await expect(syncTransport.send(REQ)).rejects.toBeInstanceOf(SyncResponseTooLarge)
  })

  it('扱えない板は手元に入れない', () => {
    expect(resolveSyncBoard('https://a.5ch.net/x/')?.connectorId).toBeTruthy()
    expect(resolveSyncBoard('https://example.test/')).toBeNull()
  })

  it('既定のサーバーは https', () => {
    expect(DEFAULT_SYNC_SERVER).toMatch(/^https:\/\//)
  })

  it('設定の書き出しに同期の項目が入らない', () => {
    const text = JSON.stringify(settingsFile(DEFAULT_SETTINGS))
    expect(text).not.toMatch(/sync|master_key|ticket/i)
  })

  it('開いた窓は権限の対象に入らない', () => {
    const caps = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'))
    expect(caps.windows).toEqual(['main', 'settings', 'ng'])
    expect(caps.remote).toBeUndefined()
  })

})

describe('端末を足す QR', () => {
  it('共通テストと同じ点になる。スマホの SyncHostTest が同じ点を読む', async () => {
    const { encode } = await import('uqr')
    const f = JSON.parse(readFileSync(new URL('../../../packages/conformance/sync-qr.json', import.meta.url), 'utf8'))
    const q = encode(f.text, { ecc: f.ecc, border: f.border })
    expect(q.data.map((r) => r.map((x) => (x ? '1' : '0')).join(''))).toEqual(f.rows)
  })
})
