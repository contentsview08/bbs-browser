import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, accentKeyOf, type AppSettings } from '../../ui/settings'
import { BTN_PRIMARY } from '../DialogParts'
import { describeExtras, importableSettings, mergeNgRules, ngFile, parseBackup, settingsFile } from '../../utils/backup'
import { factoryReset, openJson, saveJson } from '../../host/backup'
import { onBroadcast } from '../../host/crossWindow'
import { customToJson, parseCustom } from '../../ui/customScheme'
import { type SettingsProps, Section } from './common'

/** 設定・NG の書き出しと読み込み、DB 全体のバックアップと復元 */
export function BackupTab({
  settings: s,
  update,
  onBackupDb,
  onRestoreDb,
  onExportExtras,
  onImportExtras,
  onImportChmate,
}: Pick<SettingsProps, 'settings' | 'update' | 'onBackupDb' | 'onRestoreDb' | 'onExportExtras' | 'onImportExtras' | 'onImportChmate'>) {
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()
  const [busy, setBusy] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  /** ChMate の取り込みの進み具合(メインが知らせる。stage が空なら終わり) */
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number }>()
  useEffect(() => {
    const off = onBroadcast<{ stage: string; done: number; total: number }>('chmate-progress', (p) => setProgress(p.stage ? p : undefined))
    return () => void off.then((f) => f())
  }, [])

  const act = async (fn: () => Promise<string | undefined>) => {
    setBusy(true)
    setMessage(undefined)
    try {
      const text = await fn()
      if (text) setMessage({ ok: true, text })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  /** 選んだファイルを、設定か NG か配色かを見分けて読み込む */
  const importFile = (expect: 'settings' | 'ng' | 'scheme') =>
    act(async () => {
      const text = await openJson()
      if (text === undefined) return undefined
      // 自分の配色(「JSON をコピー」・配色の書き出しと同じ形)は、どの「読み込む」で選んでも取り込んで使う
      const scheme = parseCustom(text.trim())
      if (scheme) {
        update('customScheme', customToJson(scheme))
        update('followOsTheme', false)
        update('scheme', 'custom')
        // 一緒に書き出した差し色も戻す(なければテーマの色。差し色が残ると、読み込んだ「強調」の色が隠れる)
        update('accent', accentKeyOf(scheme.accentPick))
        return '自分の配色を読み込んで、使うようにしました'
      }
      if (expect === 'scheme') throw new Error('配色のファイルではありません')
      const parsed = parseBackup(text)
      if (parsed.kind === 'error') throw new Error(parsed.error)
      if (parsed.kind !== expect) throw new Error(expect === 'settings' ? '設定のファイルではありません(NG のファイルです)' : 'NG のファイルではありません(設定のファイルです)')
      if (parsed.kind === 'settings') {
        const values = importableSettings(parsed, DEFAULT_SETTINGS)
        for (const [k, v] of Object.entries(values)) update(k as keyof AppSettings, v as never)
        // お気に入り板・スレ・サイト・画像の履歴は今あるものに足す(Android 版のバックアップにも入っている)
        const added = describeExtras(parsed) && onImportExtras ? await onImportExtras(parsed) : ''
        return `設定を読み込みました(${Object.keys(values).length} 項目${added ? `。${added}` : ''})`
      }
      const { rules, added } = mergeNgRules(s.ngRules, parsed.rules, () => crypto.randomUUID())
      update('ngRules', rules, s.ngRules)
      return `NG を ${added} 件足しました(同じものは足していません)`
    })

  return (
    <>
      {message && (
        <p className={`mb-4 text-sm ${message.ok ? 'text-c-accent' : 'text-c-heat-very-hot'}`}>
          <span className="material-symbols-outlined text-base align-[-3px] mr-1">{message.ok ? 'check_circle' : 'error'}</span>
          {message.text}
        </p>
      )}
      <Section
        title="設定"
        note="表示・スレ一覧・キー操作などの設定と、お気に入り板・お気に入りのスレ・サイト・上げた画像の履歴を JSON に書き出します。catbox のアカウント、開いていたタブ、背景画像、画像の保存先は入れません。読み込むと設定は置き換え、お気に入りなどは今あるものに足します。Android 版のバックアップも読めます"
      >
        <div className="flex gap-2">
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => act(async () => ((await saveJson('settings', settingsFile(s, await onExportExtras?.()))) ? '書き出しました' : undefined))}>
            書き出す
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => importFile('settings')}>
            読み込む
          </button>
        </div>
      </Section>
      <Section title="NG" note={`NG(いま ${s.ngRules.length} 件)を JSON に書き出します。読み込むと、いまの NG に足します(同じものは重ねません)`}>
        <div className="flex gap-2">
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => act(async () => ((await saveJson('ng', ngFile(s.ngRules))) ? '書き出しました' : undefined))}>
            書き出す
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => importFile('ng')}>
            読み込む
          </button>
        </div>
      </Section>
      <Section title="自分の配色" note="表示 → 自分の配色で作った 6 色と、選んでいる差し色を JSON に書き出します。読み込むと、その配色に切り替えます(Android 版で書き出したものも読めます)">
        <div className="flex gap-2">
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy || !parseCustom(s.customScheme)}
            title={parseCustom(s.customScheme) ? undefined : 'まだ自分の配色を作っていません'}
            onClick={() => act(async () => ((await saveJson('scheme', JSON.parse(customToJson(parseCustom(s.customScheme)!, s.accent)))) ? '書き出しました' : undefined))}
          >
            書き出す
          </button>
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => importFile('scheme')}>
            読み込む
          </button>
        </div>
      </Section>
      {onImportChmate && (
        <Section
          title="ほかのアプリから取り込む"
          note="ChMate(Android の専ブラ)の「バックアップ」で書き出した ZIP から、スレのログと既読・自分の書き込みの印・お気に入りのスレ・NG・書き込みの履歴・スレタイのキーワードを取り込みます。今あるものに足し、同じものは重ねません。見た目などの設定は取り込みません。板のサーバーが分からないスレや、OBB が対応していない掲示板のスレは読みません"
        >
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => act(onImportChmate)}>
              ChMate のバックアップ(ZIP)を読み込む
            </button>
          </div>
          {progress && (
            <div className="mt-2">
              <p className="text-xs text-c-text-body mb-1">
                {progress.stage}
                {progress.total > 0 && ` ${progress.done} / ${progress.total}(${Math.round((progress.done / progress.total) * 100)}%)`}
              </p>
              <div className="h-1.5 rounded-full bg-c-surface2 overflow-hidden">
                <div
                  className={`h-full bg-c-accent transition-[width] duration-300 ${progress.total > 0 ? '' : 'animate-pulse'}`}
                  style={{ width: progress.total > 0 ? `${Math.round((progress.done / progress.total) * 100)}%` : '100%' }}
                />
              </div>
            </div>
          )}
        </Section>
      )}
      <Section
        title="まるごとバックアップ"
        note="ログ・既読・お気に入り・書き込み履歴・設定・NG を含む DB 全体を 1 つのファイルに書き出します。使っている最中でもそのまま書き出せます。アカウントのパスワードも入るので、ファイルの置き場所に気をつけてください"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => act(async () => ((await onBackupDb()) ? 'バックアップを書き出しました' : undefined))}>
            バックアップを書き出す
          </button>
          {!confirmRestore ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmRestore(true)}
              className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border border-c-border text-c-text-body hover:border-c-border-strong"
            >
              バックアップから戻す…
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-sm text-c-text-body">
              いまの状態をバックアップの時点に戻し、アプリを起動し直します。いまの DB は消さずに別の名前で残します。
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const chosen = await onRestoreDb()
                    if (!chosen) setConfirmRestore(false)
                    return undefined
                  })
                }
                className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] bg-c-heat-very-hot text-white hover:opacity-90"
              >
                ファイルを選んで戻す
              </button>
              <button type="button" onClick={() => setConfirmRestore(false)} className="text-xs text-c-text-muted hover:text-c-text-strong underline">
                やめる
              </button>
            </span>
          )}
        </div>
      </Section>
      <Section title="はじめの状態に戻す" note="ログ・既読・お気に入り・書き込み履歴・設定・NG・アカウント・画像のキャッシュをすべて消し、入れたばかりの状態でアプリを起動し直します。いまの DB は消さずに「bbs-browser.before-reset-時刻.db」として設定のフォルダに残すので、まるごとバックアップの「バックアップから戻す」で戻せます">
        <div className="flex flex-wrap items-center gap-2">
          {!confirmReset ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmReset(true)}
              className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border border-c-border text-c-text-body hover:border-c-border-strong"
            >
              はじめの状態に戻す…
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-sm text-c-text-body">
              本当に戻しますか。開いているタブも閉じ、同期の設定も消えます。
              <button type="button" disabled={busy} onClick={() => act(async () => (await factoryReset(), undefined))} className={`${BTN_PRIMARY} !bg-c-heat-very-hot !text-white`}>
                戻して起動し直す
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmReset(false)} className="px-3 py-1.5 text-sm rounded-[var(--btn-radius)] border border-c-border text-c-text-body">
                やめる
              </button>
            </span>
          )}
        </div>
      </Section>
    </>
  )
}
