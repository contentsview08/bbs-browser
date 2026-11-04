// 自動更新が読む latest.json を作る。npm run build(署名の鍵を渡したもの)のあとに実行する。
// Linux の AppImage の署名があれば Linux も載せる(release.yml は両方の成果物を集めてから実行する)。
// 中身は版・インストーラーの URL・署名。リリースに置くと、インストール済みのアプリが
// releases/latest/download/latest.json から読む(tauri.conf.json の plugins.updater)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'))

// 版とタグが違うと、更新が入らない URL を配ってしまう
const ref = process.env.GITHUB_REF_NAME
if (process.env.GITHUB_REF_TYPE === 'tag' && ref !== `v${version}`) {
  throw new Error(`タグ ${ref} と apps/desktop/package.json の版 ${version} が違います`)
}

const bundle = join(root, 'apps/desktop/src-tauri/target/release/bundle')
const installer = `OBB_${version}_x64-setup.exe`
const base = `https://github.com/contentsview08/bbs-browser/releases/download/v${version}`
const signatureOf = (path) => readFileSync(`${path}.sig`, 'utf8').trim()
const latest = {
  version,
  notes: `OBB v${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': { signature: signatureOf(join(bundle, 'nsis', installer)), url: `${base}/${installer}` },
  },
}
const appImage = `OBB_${version}_amd64.AppImage`
if (existsSync(join(bundle, 'appimage', `${appImage}.sig`))) {
  latest.platforms['linux-x86_64'] = { signature: signatureOf(join(bundle, 'appimage', appImage)), url: `${base}/${appImage}` }
}
writeFileSync(join(bundle, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`)
console.log(`作りました: ${join(bundle, 'latest.json')}`)
