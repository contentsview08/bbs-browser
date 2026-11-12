// 使っているソフトウェアの一覧(設定 → このアプリについて)。検索でき、押すとその場にライセンスの全文を開く
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { filterLicenses, licenseKindLabel, loadLicenses, spdxLinks, type LicensePackage, type LicensesFile } from '../utils/licenses'
import LoadFailed from './LoadFailed'
import LoadingCenter from './LoadingCenter'
import { ManagerDialog } from './SettingParts'
import { SearchInput } from './ClearButton'

const INPUT = 'w-full bg-c-surface2 border-c-border rounded-[var(--btn-radius)] text-sm text-c-text-body placeholder-c-text-muted py-1.5 focus:ring-c-accent focus:border-c-accent'
const LINK = 'text-c-link hover:underline break-all text-left'

function LicenseBody(props: { pkg: LicensePackage; texts: string[] }) {
  const { pkg } = props
  const links = pkg.texts.length === 0 ? spdxLinks(pkg.license) : []
  return (
    <div className="px-3 pb-3 text-sm">
      {pkg.note && <p className="text-c-text-body mb-2">{pkg.note}</p>}
      {pkg.url && (
        <p className="mb-2">
          <button type="button" className={LINK} onClick={() => void openUrl(pkg.url)}>
            {pkg.url}
          </button>
        </p>
      )}
      {pkg.texts.map((t) => (
        <div key={t.file} className="mt-2">
          <p className="text-xs text-c-text-muted mb-1">{t.file}</p>
          <pre className="p-3 text-xs text-c-text-body bg-c-surface2 rounded-[var(--card-radius)] whitespace-pre-wrap break-words">{props.texts[t.text]}</pre>
        </div>
      ))}
      {pkg.texts.length === 0 && (
        <p className="text-xs text-c-text-muted">
          全文のファイルは入っていません。{links.length > 0 && 'ライセンスの標準文: '}
          {links.map((l) => (
            <button key={l.id} type="button" className={`${LINK} mr-2`} onClick={() => void openUrl(l.url)}>
              {l.id}
            </button>
          ))}
        </p>
      )}
    </div>
  )
}

export default function LicensesDialog(props: { onClose: () => void }) {
  const [data, setData] = useState<LicensesFile>()
  const [error, setError] = useState<string>()
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<string>()
  const deferredQuery = useDeferredValue(query)
  useEffect(() => {
    loadLicenses().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  const shown = useMemo(() => filterLicenses(data?.packages ?? [], deferredQuery), [data, deferredQuery])
  return (
    <ManagerDialog title="使っているソフトウェア" onClose={props.onClose} wide>
      {error ? (
        <LoadFailed message={error} />
      ) : !data ? (
        <LoadingCenter />
      ) : (
        <>
          <SearchInput type="search" value={query} onValue={setQuery} placeholder="名前・版・ライセンスで探す" className={`${INPUT} w-full`} />
          <p className="mt-2 mb-2 text-xs text-c-text-muted">
            {shown.length} 件。押すとライセンスの全文を開きます
          </p>
          <ul className="border border-c-border rounded-[var(--card-radius)] divide-y divide-c-border">
            {shown.map((p) => {
              const id = `${p.name}@${p.version}`
              const open = opened === id
              return (
                <li key={id}>
                  <button type="button" aria-expanded={open} onClick={() => setOpened(open ? undefined : id)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-c-surface2">
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-c-text-strong break-words">
                        {p.name}
                        {p.version && <span className="ml-2 text-xs text-c-text-muted tabular-nums">{p.version}</span>}
                      </span>
                      <span className="block text-xs text-c-text-muted mt-0.5 break-words">
                        {p.license} ・ {licenseKindLabel(p)}
                      </span>
                    </span>
                    <span className="material-symbols-outlined text-lg text-c-text-muted">{open ? 'expand_less' : 'expand_more'}</span>
                  </button>
                  {open && <LicenseBody pkg={p} texts={data.texts} />}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </ManagerDialog>
  )
}
