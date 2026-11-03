// サイトのアカウント(5ch の BE など)。保存・ログイン・削除と、板ごとに書き込みで使うアカウントの選び方

import { useMemo, useState } from 'react'
import { findConnector, type LoginResult } from '@bbs-browser/connectors'
import type { AccountRecord, LogStore } from '@bbs-browser/logstore'
import type { PostAccountOption } from '../components/PostAccountMenu'
import { tauriContext as ctx } from '../host/tauriContext'

export function useAccounts(store: LogStore | undefined, postAccounts: Record<string, boolean>) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  /** ログインの結果(connectorId:accountId → 結果)。設定画面に出す */
  const [loginStatus, setLoginStatus] = useState(new Map<string, LoginResult>())

  const loginWith = async (a: AccountRecord): Promise<LoginResult> => {
    const connector = findConnector(a.connectorId)
    let r: LoginResult
    try {
      r = connector?.login
        ? await connector.login(a.accountId, { user: a.user, password: a.password }, ctx)
        : { ok: false, message: 'このサイトにはログインできません' }
    } catch (e) {
      r = { ok: false, message: `ログインできませんでした(${e instanceof Error ? e.message : String(e)})` }
    }
    setLoginStatus((m) => new Map(m).set(`${a.connectorId}:${a.accountId}`, r))
    return r
  }

  /** 起動したとき: 保存してあるアカウントを読み、自動ログインのものは裏でログインする(失敗したら onFail) */
  const loadAndAutoLogin = async (s: LogStore, onFail: (a: AccountRecord, r: LoginResult) => void) => {
    const list = await s.listAccounts()
    setAccounts(list)
    for (const a of list.filter((x) => x.autoLogin))
      void loginWith(a).then((r) => {
        if (!r.ok) onFail(a, r)
      })
  }

  /** 設定画面から: 保存してログインする */
  const saveAndLogin = async (a: AccountRecord): Promise<LoginResult> => {
    if (!store) return { ok: false, message: 'DB を開いていません' }
    await store.setAccount(a)
    setAccounts(await store.listAccounts())
    return loginWith(a)
  }

  /** 設定画面から: 保存だけする(ログインし直さない。「自動でログイン」を変えたとき) */
  const saveAccount = async (a: AccountRecord) => {
    if (!store) return
    await store.setAccount(a)
    setAccounts(await store.listAccounts())
  }

  const deleteAccount = async (connectorId: string, accountId: string) => {
    if (!store) return
    await store.deleteAccount(connectorId, accountId)
    setAccounts(await store.listAccounts())
    setLoginStatus((m) => {
      const next = new Map(m)
      next.delete(`${connectorId}:${accountId}`)
      return next
    })
  }

  /**
   * 板の URL → その板で使えるアカウント(書き込み欄の ︙ で選ぶもの)。
   * 同じ板には同じ配列を返す(タブのスレ表示を描き直さずに済むように)
   */
  const postAccountsOf = useMemo(() => {
    const cache = new Map<string, PostAccountOption[]>()
    return (connectorId: string, boardUrl: string): PostAccountOption[] => {
      const host = new URL(boardUrl).hostname
      const key = `${connectorId}\n${host}`
      let list = cache.get(key)
      if (!list) {
        list = (findConnector(connectorId)?.accounts ?? [])
          .filter((k) => k.hosts.some((h) => host === h || host.endsWith(`.${h}`)))
          .map((k) => ({
            id: k.id,
            name: k.name,
            registered: accounts.some((a) => a.connectorId === connectorId && a.accountId === k.id),
            on: postAccounts[k.id] !== false,
          }))
        cache.set(key, list)
      }
      return list
    }
  }, [accounts, postAccounts])

  /** この板への書き込みで使うアカウントの id */
  const postAccountIds = (connectorId: string, boardUrl: string) =>
    postAccountsOf(connectorId, boardUrl)
      .filter((o) => o.registered && o.on)
      .map((o) => o.id)

  /** 別のウィンドウで変えたアカウントを読み直す */
  const reloadAccounts = async () => {
    if (store) setAccounts(await store.listAccounts())
  }
  return { accounts, loginStatus, loadAndAutoLogin, saveAndLogin, saveAccount, deleteAccount, reloadAccounts, postAccountsOf, postAccountIds }
}
