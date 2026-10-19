// 本番用(release)に組み立てた APK を、USB でつないだスマホに入れて起動する。
//   npm run android:release            … スマホ(arm64)向けに組み立てて入れる
//   npm run android:release -- --skip-build  … 組み立てずに、前に作った APK を入れ直す
// 署名は gen/android/app/build.gradle.kts(keystore.properties がなければ開発用の鍵。android:dev のアプリの上に入れ直せる)
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const APP_ID = 'io.github.yumekui8.bbs_browser'
const root = join(import.meta.dirname, '..')
const apkDir = join(root, 'apps/desktop/src-tauri/gen/android/app/build/outputs/apk')
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(homedir(), 'AppData/Local/Android/Sdk')
const adb = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')

// npm は Windows ではバッチファイル(npm.cmd)なので、シェルを通して動かす
const run = (cmd, args, shell = false) => {
  const r = spawnSync(shell ? [cmd, ...args].join(' ') : cmd, shell ? [] : args, { stdio: 'inherit', cwd: root, shell })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (!process.argv.includes('--skip-build')) run('npm', ['run', 'tauri', '-w', '@bbs-browser/desktop', '--', 'android', 'build', '--apk', '--target', 'aarch64'], true)

// できた APK のうち、いちばん新しい release のもの
const apks = []
const walk = (dir) => {
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (name.endsWith('-release.apk')) apks.push(p)
  }
}
walk(apkDir)
const apk = apks.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
if (!apk) {
  console.error('release の APK が見つかりません: ' + apkDir)
  process.exit(1)
}

// つないでいる端末。エミュレーターよりスマホを選ぶ(ANDROID_SERIAL で決めることもできる)
const devices = execFileSync(adb, ['devices'], { encoding: 'utf8' })
  .split('\n')
  .slice(1)
  .map((l) => l.trim().split(/\s+/))
  .filter(([, state]) => state === 'device')
  .map(([serial]) => serial)
const serial = process.env.ANDROID_SERIAL ?? devices.find((d) => !d.startsWith('emulator-')) ?? devices[0]
if (!serial) {
  console.error('つないでいる端末がありません(USB デバッグを オン にして、USB でつなぐ)')
  process.exit(1)
}
console.log(`\n${apk}\nを ${serial} に入れます`)
run(adb, ['-s', serial, 'install', '-r', apk])
run(adb, ['-s', serial, 'shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LAUNCHER', '1'])
