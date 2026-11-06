// 設定の「このアプリについて」。

import { useEffect, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { OpenRow, Toggle } from '../SettingParts'
import { broadcast } from '../../host/crossWindow'
import { BTN_PRIMARY } from '../DialogParts'
import LicensesDialog from '../LicensesDialog'
import { getVersion } from '@tauri-apps/api/app'
import { getDataPaths, type DataPaths } from '../../host/logStore'
import { canCheckUpdate, compareVersions, fetchLatestRelease, installUpdate, type ReleaseInfo, canSelfUpdate } from '../../host/update'
import { VideoPlaybackHelp } from '../MediaFailed'
import { canPlayVideo } from '../../utils/videoSupport'
import { type SettingsProps, Section } from './common'

/** 運営要望板(この製品の掲示板)。要望・不具合はここか GitHub の Issues へ */
export const OPERATION_BOARD_URL = 'https://red-edge.net/boards/operation01/'

export function AboutTab({ settings: s, update }: Pick<SettingsProps, 'settings' | 'update'>) {
  // 版はインストーラーの版(apps/desktop/package.json。tauri.conf.json がそこを読む)
  const [version, setVersion] = useState<string>()
  const [selfUpdate, setSelfUpdate] = useState<boolean>()
  const [paths, setPaths] = useState<DataPaths>()
  const [licensesOpen, setLicensesOpen] = useState(false)
  useEffect(() => {
    void getVersion().then(setVersion, () => setVersion(undefined))
    void canSelfUpdate().then(setSelfUpdate, () => setSelfUpdate(false))
    void getDataPaths().then(setPaths, () => setPaths(undefined))
  }, [])
  return (
    <>
      <Section title={`OBB ${version ?? ''}`}>
        <p className="text-sm text-c-text-body leading-relaxed">
          掲示板を読む専用ブラウザです。組み込みのコネクタで 2ch 互換(5ch・eddibb・bbspink など)・したらば・まちBBS・ふたば・hono-bbs を読めます。
        </p>
      </Section>
      {canCheckUpdate && <UpdateSection version={version} selfUpdate={selfUpdate} autoUpdate={s.autoUpdate} onAutoUpdate={(v) => update('autoUpdate', v)} />}
      {canCheckUpdate && !canPlayVideo('video.mp4') && (
        <Section title="動画の再生">
          <VideoPlaybackHelp />
        </Section>
      )}
      <Section title="掲示板" note="要望や不具合は、運営要望板か GitHub の Issues へ">
        <OpenRow label="運営要望板を開く" value="red-edge.net" onOpen={() => void broadcast('open-in-app', OPERATION_BOARD_URL)} />
      </Section>
      <Section title="ライセンス" note="このアプリに入っているオープンソースのソフトウェアと、そのライセンスを見られます">
        <OpenRow label="使っているソフトウェア" onOpen={() => setLicensesOpen(true)} />
        {licensesOpen && <LicensesDialog onClose={() => setLicensesOpen(false)} />}
      </Section>
      <Section desktopOnly title="データの保存場所" note={paths?.portable ? 'ZIP 版: 展開したフォルダの data に置きます。フォルダごと消せばまっさらになり、別の場所に展開すれば別のデータになります' : undefined}>
        <p className="text-sm font-mono text-c-text-body break-all">{paths?.db ?? '%APPDATA%\\io.github.contentsview08.obb\\bbs-browser.db'}</p>
        <p className="text-xs text-c-text-muted mt-1">ログ・既読位置・設定はすべてこのファイルに入っています</p>
        <p className="text-sm font-mono text-c-text-body break-all mt-3">{paths?.backups ?? '%APPDATA%\\io.github.contentsview08.obb\\backups\\'}</p>
        <p className="text-xs text-c-text-muted mt-1">
          DB の形が変わる版に上げたとき、上げる前の DB の写しを自動で置きます(新しいものから 3 つ)。困ったときは、設定 → バックアップ の「バックアップから戻す」で、ここのファイルを選んで戻せます
        </p>
      </Section>
    </>
  )
}

/**
 * 更新(設定 → このアプリについて)。起動時に自動で入れ替えるかの設定と、手で確かめるボタン。
 * ボタンは GitHub の最新のリリースと版を比べ、新しければインストーラーを落として実行する。ZIP 版・.deb は自動更新の対象にならない
 */
function UpdateSection(props: { version?: string; selfUpdate?: boolean; autoUpdate: boolean; onAutoUpdate: (v: boolean) => void }) {
  const canInstall = props.selfUpdate !== false
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'checking' } | { kind: 'found'; release: ReleaseInfo } | { kind: 'latest'; release: ReleaseInfo; newer: boolean } | { kind: 'error'; message: string } | { kind: 'installing' } | { kind: 'installed'; path: string }>({ kind: 'idle' })
  const check = async () => {
    setState({ kind: 'checking' })
    try {
      const release = await fetchLatestRelease()
      const diff = props.version ? compareVersions(release.version, props.version) : 0
      setState(diff > 0 ? { kind: 'found', release } : { kind: 'latest', release, newer: diff < 0 })
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }
  const install = async (release: ReleaseInfo) => {
    // ZIP 版・.deb にインストーラーを入れると別の場所に入ってしまうので、ページを開いて選んでもらう
    if (!release.asset || !canInstall) return void openUrl(release.url)
    setState({ kind: 'installing' })
    try {
      setState({ kind: 'installed', path: await installUpdate(release.asset) })
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }
  const release = state.kind === 'found' || state.kind === 'latest' ? state.release : undefined
  return (
    <Section title="更新" note={canInstall ? 'GitHub の最新のリリースと比べます。新しい版があれば、インストーラーを落としてそのまま実行できます' : 'GitHub の最新のリリースと比べます。新しい版があれば、ダウンロードのページを開けます'}>
      {props.selfUpdate === false ? (
        <p className="mb-2 text-sm text-c-text-muted">この入れ方(ZIP 版・.deb)は自動で更新しません。新しい版があれば通知で知らせます</p>
      ) : (
        <Toggle
          checked={props.autoUpdate}
          onChange={props.onAutoUpdate}
          label="自動で更新する"
          note="起動時に新しい版があれば、入れ替えて起動し直します。オフのときは通知で知らせるだけです"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_PRIMARY} onClick={() => void check()} disabled={state.kind === 'checking' || state.kind === 'installing'}>
          {state.kind === 'checking' ? '確かめています…' : '更新を確かめる'}
        </button>
        {state.kind === 'found' && (
          <button type="button" className={BTN_PRIMARY} onClick={() => void install(state.release)}>
            {state.release.asset && canInstall ? `${state.release.version} に更新する` : 'ダウンロードのページを開く'}
          </button>
        )}
        {state.kind === 'latest' && <span className="text-sm text-c-text-muted">{state.newer ? `公開中の版(${state.release.version})より新しい版を使っています` : `いまが最新です(${state.release.version})`}</span>}
        {state.kind === 'installing' && <span className="text-sm text-c-text-muted">インストーラーを落としています…</span>}
        {state.kind === 'installed' && <span className="text-sm text-c-text-body">インストーラーを開きました。このアプリを閉じて進めてください</span>}
        {state.kind === 'error' && <span className="text-sm" style={{ color: 'var(--c-error)' }}>{state.message}</span>}
      </div>
      {release && (
        <div className="mt-3">
          <p className="text-sm text-c-text-body">
            公開中の最新: {release.version}
            <button type="button" className="ml-2 text-c-link hover:underline" onClick={() => void openUrl(release.url)}>
              リリースのページ
            </button>
          </p>
          {release.notes && <pre className="mt-1 p-3 text-xs text-c-text-body bg-c-surface2 rounded-[var(--card-radius)] whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">{release.notes}</pre>}
        </div>
      )}
    </Section>
  )
}
