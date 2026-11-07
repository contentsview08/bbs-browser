// 同期の PC の部品。通信・鍵・窓は Rust の命令(sync_http・sync_key・sync_start)。呼べるのは main の窓だけ
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { allConnectors } from '@bbs-browser/connectors'
import { settingsNgStore, type SqlDb } from '@bbs-browser/logstore'
import {
  fromBase64Url,
  SyncResponseTooLarge,
  toBase64Url,
  type BoardResolver,
  type NgHost,
  type SiteResolver,
  type SyncKeyMaterial,
  type SyncKeyStore,
  type SyncTransport,
} from '@bbs-browser/sync'
import serverUrl from '@bbs-browser/sync/server-url.json'
import { applyRemoteSettings } from '../ui/settings'
import { ngPatternSyncable, todayDateString, type NgRule } from '../utils/ng'

/** 既定のサーバーは packages/sync/server-url.json。ビルドのときに VITE_OBB_SYNC_SERVER_URL で差し替えられる */
export const DEFAULT_SYNC_SERVER: string = import.meta.env.VITE_OBB_SYNC_SERVER_URL || serverUrl.default

export const syncTransport: SyncTransport = {
  async send(req) {
    try {
      return await invoke<{ status: number; body: string }>('sync_http', {
        req: { method: req.method, url: req.url, headers: req.headers, body: req.body ?? null, max_bytes: req.maxBytes, timeout_ms: req.timeoutMs },
      })
    } catch (e) {
      if (e === 'too_large') throw new SyncResponseTooLarge()
      throw new Error('network')
    }
  },
}

export function encodeKeyMaterial(v: SyncKeyMaterial): string {
  return JSON.stringify({ k: toBase64Url(v.k), device_id: v.deviceId, ticket: v.ticket })
}

/** 読めない値は鍵がないものとして扱う(DB だけ残った状態と同じ流れになる) */
export function decodeKeyMaterial(raw: string): SyncKeyMaterial | null {
  try {
    const o = JSON.parse(raw) as { k?: unknown; device_id?: unknown; ticket?: unknown }
    if (typeof o.k !== 'string' || typeof o.device_id !== 'string' || !(typeof o.ticket === 'string' || o.ticket === null)) return null
    return { k: fromBase64Url(o.k), deviceId: o.device_id, ticket: o.ticket }
  } catch {
    return null
  }
}

const KEY_HINT = 'obb-sync-key-hint'

function setKeyHint(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY_HINT, '1')
    else localStorage.removeItem(KEY_HINT)
  } catch {
    // 控えがなくても、DB に印があれば動く
  }
}

/** 使ったことのない人の鍵保管を起動のたびに開かないための控え。鍵そのものは置かない */
export function syncKeyHint(): boolean {
  try {
    return localStorage.getItem(KEY_HINT) === '1'
  } catch {
    return false
  }
}

export const syncKeyStore: SyncKeyStore = {
  async load() {
    const raw = await invoke<string | null>('sync_key_load')
    return raw === null ? null : decodeKeyMaterial(raw)
  },
  async save(v) {
    await invoke('sync_key_save', { value: encodeKeyMaterial(v) })
    setKeyHint(true)
  },
  async clear() {
    await invoke('sync_key_clear')
    setKeyHint(false)
  },
}

/** 窓の移動を Rust が止めて、許可証を main へ渡す。閉じたら null */
export function openSyncStartWindow(url: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const offs: Promise<() => void>[] = []
    const done = (v: string | null) => {
      offs.forEach((o) => void o.then((f) => f()))
      void invoke('close_sync_start').catch(() => undefined)
      resolve(v)
    }
    offs.push(listen<string>('sync-start-ticket', (e) => done(e.payload)))
    offs.push(listen('sync-start-closed', () => done(null)))
    void Promise.all(offs)
      .then(() => invoke('open_sync_start', { url }))
      .catch((e) => {
        offs.forEach((o) => void o.then((f) => f()))
        reject(e instanceof Error ? e : new Error(String(e)))
      })
  })
}

/** この端末で扱える板か。今の正しい URL とコネクタはコネクタが決める */
/** サイトの入口を受け持つコネクタ。なければ 2 ちゃんねる互換(App の addSite と同じ) */
export const resolveSyncSite: SiteResolver = (menuUrl) => allConnectors().find((c) => c.handlesSite?.(menuUrl))?.id ?? '2ch-compat'

/** PC の NG は settings 表。適用したら全部の窓の設定へ写す */
export function syncNgHost(db: SqlDb): NgHost {
  const store = settingsNgStore(db)
  return {
    read: store.read,
    async apply(changes) {
      applyRemoteSettings({ ngRules: (await store.apply(changes)) as NgRule[] })
    },
    patternOk: ngPatternSyncable,
    today: (nowMs) => todayDateString(new Date(nowMs)),
  }
}

export const resolveSyncBoard: BoardResolver = (boardUrl) => {
  const c = allConnectors().find((x) => x.canHandle(boardUrl))
  return c ? { boardUrl: c.canonicalBoardUrl?.(boardUrl) ?? boardUrl, connectorId: c.id } : null
}
