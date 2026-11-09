// Google ドライブの置き場の PC の部品(docs/sync-drive.md 5.2)。ログインとトークンは Rust(google_auth.rs)が持ち、画面にはトークンを渡さない。
// Drive への要求には目印だけを付け、sync_http が Drive の API の先にだけ本物のアクセストークンを付ける
import { invoke } from '@tauri-apps/api/core'
import { driveRemote, SyncApiError, SyncHostError, type DriveAuth } from '@bbs-browser/sync'
import { syncTransport } from './sync'

/** Rust の TOKEN_SLOT と同じ(drive.ts が「Bearer 」を前に付ける) */
export const GOOGLE_TOKEN_SLOT = 'obb-google-access-token'

/** Rust の失敗はコードだけ。画面の文は syncMessage が決める */
const hostError = (e: unknown) => new SyncHostError(typeof e === 'string' ? e : 'google_login_failed')

/** 取り直しの失敗をエンジンの分け方へ写す。ログインし直すしかないものだけを止める理由(google_auth_failed)にする */
export async function googleAccessToken(fresh: boolean): Promise<string> {
  try {
    await invoke('google_access_token', { fresh })
  } catch (e) {
    if (e === 'google_auth_failed') throw new SyncApiError('http', 401, 'google_auth_failed')
    if (e === 'network') throw new SyncApiError('network')
    throw new SyncApiError('http', 503)
  }
  return GOOGLE_TOKEN_SLOT
}

let available: Promise<boolean> | null = null

export const googleDrive: DriveAuth = {
  async unavailable() {
    available ??= invoke<boolean>('google_available').catch(() => false)
    return (await available) ? null : 'google_unavailable'
  },
  async login(expect) {
    try {
      return await invoke<{ account: string; email: string }>('google_login', { expect })
    } catch (e) {
      throw hostError(e)
    }
  },
  account: () => invoke<{ account: string; email: string } | null>('google_account'),
  async forget() {
    try {
      await invoke('google_forget')
    } catch (e) {
      throw hostError(e)
    }
  },
  async revoke() {
    try {
      await invoke('google_revoke')
    } catch (e) {
      throw hostError(e)
    }
  },
  async pairingToken() {
    try {
      return await invoke<string>('google_pairing_token')
    } catch (e) {
      throw hostError(e)
    }
  },
  async adopt(refreshToken, expect) {
    try {
      return await invoke<{ account: string; email: string }>('google_adopt', { refreshToken, expect })
    } catch (e) {
      throw hostError(e)
    }
  },
  remote: driveRemote({ transport: syncTransport, accessToken: googleAccessToken }),
}

/** ブラウザでのログインを待つのをやめる */
export const cancelGoogleLogin = (): Promise<void> => invoke('google_login_cancel')
