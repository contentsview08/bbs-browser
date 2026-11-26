// 書き込み・ログインの Cookie(Rust の post_http が持つ post-cookies.json)の一覧と削除。設定「掲示板ごとの設定」の Cookie の段
import { invoke } from '@tauri-apps/api/core'

export interface CookieDomainCount {
  domain: string
  count: number
}

export const listCookieDomains = () => invoke<CookieDomainCount[]>('post_cookie_domains')

/** domain を渡せばそのドメイン(サブドメインも)だけ、なければ全部。消した数を返す */
export const clearCookies = (domain?: string) => invoke<number>('clear_post_cookies', { domain: domain ?? null })
