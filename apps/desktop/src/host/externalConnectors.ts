// 外付けのコネクタを、アプリのデータフォルダの connectors/ から読み込む(MOD のように、フォルダに置いて設定で有効にする)。
// フォルダごとに manifest.json(名前・版・通信する先)と connector.js(本体)を置く。
// 有効にするときに、通信する先(hosts)をユーザーに確かめてもらい、確かめた先を設定に覚える。
// あとで manifest.json の hosts が変わったら、確かめ直すまで読み込まない。
// 本体は外と切り離した囲い(connectorSandbox.ts)の中で動かす

import { invoke } from '@tauri-apps/api/core'
import { registerConnector, unregisterConnector, type ConnectorContext } from '@bbs-browser/connectors'
import type { ConnectorManifest, SandboxedConnector } from './connectorSandbox'

/** 設定に覚えておく、コネクタごとの許可(有効か・確かめた通信の先) */
export interface ConnectorApproval {
  enabled: boolean
  hosts: string[]
}

export interface ExternalConnectorInfo {
  /** フォルダの名前 */
  dir: string
  manifest?: ConnectorManifest
  /** loaded: 使える / disabled: 無効 / needsApproval: 通信の先が変わったので確かめ直す / error: 読み込めない */
  status: 'loaded' | 'disabled' | 'needsApproval' | 'error'
  error?: string
}

interface ConnectorFiles {
  dir: string
  manifest: string | null
  code: string | null
  error: string | null
}

/** 読み込んでいる囲い(読み込み直すときに片付ける) */
const loaded = new Map<string, SandboxedConnector>()

const sameHosts = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

/** connectors/ のコネクタを読み込み直す。有効で、通信の先を確かめてあるものだけをアプリに足す */
export async function loadExternalConnectors(ctx: ConnectorContext, approvals: Record<string, ConnectorApproval>): Promise<ExternalConnectorInfo[]> {
  for (const [id, s] of loaded) {
    unregisterConnector(id)
    s.dispose()
  }
  loaded.clear()
  const files = await invoke<ConnectorFiles[]>('list_connector_files')
  if (files.length === 0) return []
  // 囲い(QuickJS)は大きいので、コネクタが置いてあるときだけ読み込む(起動を軽くする)
  const { loadSandboxedConnector, parseManifest, restrictContext } = await import('./connectorSandbox')
  const seen = new Set<string>()
  const out: ExternalConnectorInfo[] = []
  for (const f of files) {
    const fail = (error: string, manifest?: ConnectorManifest) => out.push({ dir: f.dir, status: 'error', error, ...(manifest && { manifest }) })
    if (f.error) {
      fail(f.error)
      continue
    }
    if (!f.manifest) {
      fail('manifest.json がありません')
      continue
    }
    let m: ConnectorManifest
    try {
      m = parseManifest(f.manifest)
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
      continue
    }
    if (seen.has(m.id)) {
      fail(`id「${m.id}」がほかのフォルダのコネクタと同じです`, m)
      continue
    }
    seen.add(m.id)
    if (!f.code) {
      fail('connector.js がありません', m)
      continue
    }
    const a = approvals[m.id]
    if (!a?.enabled) {
      out.push({ dir: f.dir, manifest: m, status: 'disabled' })
      continue
    }
    if (!sameHosts(a.hosts, m.hosts)) {
      out.push({ dir: f.dir, manifest: m, status: 'needsApproval' })
      continue
    }
    try {
      const s = await loadSandboxedConnector(f.code, m, {
        ctx: restrictContext(ctx, m.hosts),
        log: (level, message) => console[level](`[コネクタ ${m.id}] ${message}`),
      })
      registerConnector(s.connector)
      loaded.set(m.id, s)
      out.push({ dir: f.dir, manifest: m, status: 'loaded' })
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e), m)
    }
  }
  return out
}

/** connectors/ のフォルダの場所(なければ作る) */
export const connectorsDir = () => invoke<string>('connectors_dir')
