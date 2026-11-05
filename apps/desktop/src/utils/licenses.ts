// 使っている OSS の一覧(public/licenses.json。scripts/gen-licenses.mjs が作る)。大きいので、画面を開いたときだけ読む

export interface LicensePackage {
  name: string
  version: string
  license: string
  url: string
  kind: 'npm' | 'cargo' | 'gradle' | 'font' | 'library'
  /** 片方の OS にだけ入るもの */
  os?: 'windows' | 'linux'
  note?: string
  /** texts の番号で持つ全文(同じ文は 1 つにまとめてある) */
  texts: { file: string; text: number }[]
}

export interface LicensesFile {
  packages: LicensePackage[]
  texts: string[]
}

export async function loadLicenses(): Promise<LicensesFile> {
  const res = await fetch(`${import.meta.env.BASE_URL}licenses.json`)
  if (!res.ok) throw new Error(`一覧のファイルを読めませんでした(${res.status})`)
  return (await res.json()) as LicensesFile
}

/** 名前・版・ライセンスで絞る。空白で区切ると、すべてを含むものだけ残す */
export function filterLicenses(packages: LicensePackage[], query: string): LicensePackage[] {
  const words = query.toLowerCase().split(/[\s　]+/).filter(Boolean)
  if (words.length === 0) return packages
  return packages.filter((p) => {
    const hay = `${p.name} ${p.version} ${p.license}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

const SPDX_ID = /^(0BSD|Apache|Artistic|BSD|BSL|CC0|CDLA|GPL|ISC|LGPL|MIT|MPL|OFL|Unicode|Unlicense|Zlib|blessing)/

/** ライセンスの表記(MIT OR Apache-2.0 など)から、SPDX の標準文のページを作る。全文のファイルがないパッケージの案内に使う */
export function spdxLinks(license: string): { id: string; url: string }[] {
  const ids = license.split(/[\s()/]+/).filter((t) => SPDX_ID.test(t))
  return [...new Set(ids)].map((id) => ({ id, url: `https://spdx.org/licenses/${id}.html` }))
}

const KIND_LABEL: Record<LicensePackage['kind'], string> = { npm: 'npm', cargo: 'Rust', gradle: 'Android', font: 'フォント', library: 'ライブラリ' }

export const licenseKindLabel = (p: LicensePackage) => `${KIND_LABEL[p.kind]}${p.os ? `・${p.os === 'windows' ? 'Windows' : 'Linux'}` : ''}`
