// 配布物に入る OSS の一覧とライセンス全文を apps/desktop/public/licenses.json に書き出す(設定 → このアプリについて → 使っているソフトウェア)。
// 依存を変えたら流し直してコミットする。cargo を使うので Windows の Node で動かす(npm run licenses:gen)。
//
// - npm: package-lock.json を apps/desktop の依存からたどる(dev は通らない)
// - Cargo: cargo tree で Windows と Linux の通常の依存をたどる(build-dependencies と手続きマクロは配布物に入らないので除く)
// - 手で書いた一覧: scripts/licenses-manual.json(依存の管理の外から入るフォントや、Linux の AppImage に入る部品)
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = join(root, 'apps/desktop/src-tauri/Cargo.toml')
const out = join(root, 'apps/desktop/public/licenses.json')

// transformers.js の node 向けの入口からだけ使われる。WebView の出力は web 向けの入口を読むので入らない
const NOT_BUNDLED = new Set(['sharp', 'onnxruntime-node'])
// 型の宣言だけのパッケージは出力に残らない
const isTypesOnly = (name) => name.startsWith('@types/') || name === 'undici-types'
// 配布する 2 つの OS。macOS・Android(Tauri)は配っていない
const TARGETS = { windows: 'x86_64-pc-windows-msvc', linux: 'x86_64-unknown-linux-gnu' }

const LICENSE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicense|third[-_. ]?party)/i
const LICENSE_DIR = /^licen[cs]es?$/i
const NOT_TEXT = /\.(js|cjs|mjs|ts|rs|json|html?|toml|ya?ml|py|sh|png|svg)$/i
const MAX_TEXT_BYTES = 256 * 1024

/** パッケージのフォルダから、ライセンスの文のファイルを集める */
function licenseFiles(dir) {
  if (!existsSync(dir)) return []
  const found = []
  const add = (path, label) => {
    if (NOT_TEXT.test(path) || statSync(path).size > MAX_TEXT_BYTES) return
    found.push({ file: label, text: readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim() })
  }
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.isFile() && LICENSE_FILE.test(e.name)) add(join(dir, e.name), e.name)
    if (e.isDirectory() && LICENSE_DIR.test(e.name)) {
      for (const f of readdirSync(join(dir, e.name), { withFileTypes: true })) if (f.isFile()) add(join(dir, e.name, f.name), `${e.name}/${f.name}`)
    }
  }
  return found.filter((f) => f.text)
}

/** package.json の repository などを、ブラウザで開ける URL にする */
function webUrl(u) {
  if (!u) return undefined
  const s = String(u)
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^github:/, 'https://github.com/')
    .replace(/\.git(#.*)?$/, '')
  if (/^https?:\/\//.test(s)) return s
  return /^[\w.-]+\/[\w.-]+$/.test(s) ? `https://github.com/${s}` : undefined
}

function npmLicense(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license?.type) return pkg.license.type
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ')
  return ''
}

function collectNpm() {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages
  /** node_modules の探し方と同じく、自分のフォルダから上へ探す */
  const locate = (from, name) => {
    for (let at = from; ; at = at.includes('/node_modules/') ? at.slice(0, at.lastIndexOf('/node_modules/')) : at.includes('/') && !at.startsWith('node_modules/') ? at.slice(0, at.lastIndexOf('/')) : '') {
      const key = `${at ? `${at}/` : ''}node_modules/${name}`
      if (lock[key]) return key
      if (!at) return undefined
    }
  }
  const seen = new Set()
  const pkgs = new Map()
  const walk = (key) => {
    if (seen.has(key)) return
    seen.add(key)
    let e = lock[key]
    let path = key
    if (e.link) {
      path = e.resolved
      e = lock[path]
    }
    const isWorkspace = !path.includes('node_modules/')
    if (!isWorkspace && e.dev) return
    if (!isWorkspace) {
      const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)
      const dir = join(root, path)
      // OS ごとの部品で、この PC に入っていないものは一覧に足せない(今の配布物には該当しない)
      if (!existsSync(dir)) {
        if (!e.optional) throw new Error(`入っていません: ${path}(npm install してから流す)`)
        return
      }
      const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      const id = `${name}@${pj.version}`
      if (!pkgs.has(id)) {
        pkgs.set(id, {
          name,
          version: pj.version,
          license: npmLicense(pj),
          url: webUrl(typeof pj.repository === 'string' ? pj.repository : pj.repository?.url) ?? webUrl(pj.homepage) ?? `https://www.npmjs.com/package/${name}`,
          kind: 'npm',
          files: licenseFiles(dir),
        })
      }
    }
    const optionalPeers = e.peerDependenciesMeta ?? {}
    const deps = [...Object.keys(e.dependencies ?? {}), ...Object.keys(e.optionalDependencies ?? {}), ...Object.keys(e.peerDependencies ?? {}).filter((d) => !optionalPeers[d]?.optional)]
    for (const d of deps) {
      if (NOT_BUNDLED.has(d) || isTypesOnly(d)) continue
      const hit = locate(path, d)
      if (hit) walk(hit)
    }
  }
  const start = lock['apps/desktop']
  for (const d of Object.keys(start.dependencies)) {
    if (NOT_BUNDLED.has(d)) continue
    walk(locate('apps/desktop', d))
  }
  return [...pkgs.values()]
}

function cargo(...args) {
  return execFileSync('cargo', [...args], { cwd: join(root, 'apps/desktop/src-tauri'), encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'inherit'] })
}

function collectCargo() {
  cargo('fetch', '--locked', '--manifest-path', manifest)
  const meta = JSON.parse(cargo('metadata', '--format-version', '1', '--locked', '--manifest-path', manifest))
  const byId = new Map(meta.packages.map((p) => [`${p.name} v${p.version}`, p]))
  const workspace = new Set(meta.workspace_members)
  const pkgs = new Map()
  for (const [os, target] of Object.entries(TARGETS)) {
    const tree = cargo('tree', '--locked', '--manifest-path', manifest, '--target', target, '-e', 'normal,no-proc-macro', '--prefix', 'none', '--no-dedupe', '-f', '{p}')
    for (const line of new Set(tree.split('\n'))) {
      const m = /^(\S+ v\S+)/.exec(line)
      if (!m) continue
      const p = byId.get(m[1])
      if (!p) throw new Error(`cargo metadata にありません: ${m[1]}`)
      if (workspace.has(p.id)) continue
      const id = `${p.name}@${p.version}`
      const cur = pkgs.get(id)
      if (cur) {
        cur.oses.add(os)
        continue
      }
      pkgs.set(id, {
        name: p.name,
        version: p.version,
        license: p.license ?? (p.license_file ? `SEE ${p.license_file}` : ''),
        url: p.repository ?? p.homepage ?? `https://crates.io/crates/${p.name}`,
        kind: 'cargo',
        oses: new Set([os]),
        files: licenseFiles(dirname(p.manifest_path)),
      })
    }
  }
  return [...pkgs.values()].map(({ oses, ...p }) => (oses.size === 1 ? { ...p, os: [...oses][0] } : p))
}

function collectManual() {
  const manual = JSON.parse(readFileSync(join(root, 'scripts/licenses-manual.json'), 'utf8'))
  return manual.filter((p) => !p.apps || p.apps.includes('desktop')).map(({ textFile, apps: _apps, ...p }) => ({
    ...p,
    files: textFile ? [{ file: textFile.split('/').pop(), text: readFileSync(join(root, textFile), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim() }] : [],
  }))
}

/** 同じ文を 1 つにまとめる(空白の違いは同じと見る)。多くのパッケージが同じ Apache-2.0 の文を持っている */
function dedupe(all) {
  const texts = []
  const index = new Map()
  const packages = all.map(({ files, ...p }) => {
    const refs = files.map((f) => {
      const key = f.text.replace(/\s+/g, ' ')
      if (!index.has(key)) {
        index.set(key, texts.length)
        texts.push(f.text)
      }
      return { file: f.file, text: index.get(key) }
    })
    return { ...p, texts: refs }
  })
  return { packages, texts }
}

const compare = (a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en', { numeric: true })
const { packages, texts } = dedupe([...collectManual(), ...collectNpm(), ...collectCargo()].sort(compare))

// 差分が見やすいよう、パッケージと文を 1 行ずつにする
const json = `{"packages":[\n${packages.map((p) => JSON.stringify(p)).join(',\n')}\n],"texts":[\n${texts.map((t) => JSON.stringify(t)).join(',\n')}\n]}\n`
writeFileSync(out, json)

const count = (kind) => packages.filter((p) => p.kind === kind).length
console.log(`${packages.length} 件(npm ${count('npm')}・Cargo ${count('cargo')}・手書き ${packages.length - count('npm') - count('cargo')})、文 ${texts.length} 種類、${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`)
const CONDITIONAL = /GPL|MPL|EPL|CDDL|CC-BY-SA|OSL|EUPL|SSPL|BUSL/i
const conditional = packages.filter((p) => CONDITIONAL.test(p.license))
console.log(`\n条件のあるライセンス(${conditional.length} 件):`)
for (const p of conditional) console.log(`  ${p.name} ${p.version}: ${p.license}${p.os ? ` [${p.os}]` : ''}`)
const unknown = packages.filter((p) => !p.license || /^(SEE|UNLICENSED$|不明)/i.test(p.license))
console.log(`\nライセンスの表記がないもの(${unknown.length} 件):`)
for (const p of unknown) console.log(`  ${p.name} ${p.version}: ${p.license || '(なし)'}`)
const noText = packages.filter((p) => p.texts.length === 0)
console.log(`\n全文のファイルがないもの(${noText.length} 件):`)
for (const p of noText) console.log(`  ${p.name} ${p.version}: ${p.license}`)
