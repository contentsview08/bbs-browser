// アプリの版を変える: npm run version:set -- 0.2.0
// 版は apps/desktop/package.json に持ち、Tauri(tauri.conf.json の version)はそこを読む。
// Rust の Cargo.toml の版も同じにそろえる(インストーラーの版は tauri.conf.json、Rust 側の表示は Cargo.toml を使うため)
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version ?? '')) {
  console.error('使い方: npm run version:set -- 0.2.0(数字.数字.数字)')
  process.exit(1)
}
const pkgPath = new URL('../apps/desktop/package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const before = pkg.version
pkg.version = version
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

const cargoPath = new URL('../apps/desktop/src-tauri/Cargo.toml', import.meta.url)
const cargo = readFileSync(cargoPath, 'utf8')
// [package] の version(最初に出てくるもの)だけを書き換える
const next = cargo.replace(/^version = "[^"]*"/m, `version = "${version}"`)
if (next === cargo && !cargo.includes(`version = "${version}"`)) {
  console.error('Cargo.toml の version が見つかりませんでした')
  process.exit(1)
}
writeFileSync(cargoPath, next)
console.log(`版を ${before} → ${version} にしました(apps/desktop/package.json・Cargo.toml)。CHANGELOG.md も書き足してください`)
