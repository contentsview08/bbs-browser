# スマホ版(Android・iOS)

PC 版と同じソース(Tauri v2)から作る。画面と操作だけを、スマホのときに変える(`src/utils/platform.ts` の `isMobile`)。

## スマホのときに変わるところ

| | PC | スマホ |
|---|---|---|
| 画面の分け方 | 2 画面・1 画面・自動 | いつも 1 画面(スレ一覧の上にスレ表示が重なる) |
| サイドバー | 左に帯で出す | ふだんは隠し、左上のメニューか、左の端から右へなぞると引き出しで出る。何か開いたら閉じる |
| 上の帯 | 戻る・進む・URL 欄・ウィンドウのボタン | メニュー・戻る・進む・URL 欄(ウィンドウのボタンはない) |
| アンカーのポップアップ | 乗せる・押す(設定) | いつも押して出す |
| 操作 | キー(vim 風) | スワイプ(下) |
| 画面の端 | — | 切り欠き・時刻の帯・ジェスチャーの帯の分だけ内側に寄せる |

### スワイプ

なぞった向きの並びに、キー操作と同じ操作を割り当てる(設定 → キー操作 の「スワイプ(スマホ)」で変えられる。感度も)。

| 向き | 既定の操作 |
|---|---|
| → | 戻る(左の端から始めるとサイドバー) |
| ← | 進む |
| → ↑ | 先頭へ |
| → ↓ | 更新 |
| ← ↑ | 書き込み欄へ |
| ← ↓ | 一番下へ |

スレ表示・スレ一覧の操作は、割り当てたキーを押したことにして渡す(`utils/keymap.ts` の `keyEventsOf`)。
なので、キー操作で使える操作は、どれでもスワイプに割り当てられる。

## Android で動かす(Windows で)

一度だけ:

1. Android Studio を入れる。SDK Manager で、Android SDK Platform(最新)・Android SDK Platform-Tools・NDK (Side by side)・Android SDK Command-line Tools を入れる
2. 環境変数を設定する(PowerShell。値は自分の環境に合わせる)
   ```powershell
   [Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\Program Files\Android\Android Studio\jbr', 'User')
   [Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
   [Environment]::SetEnvironmentVariable('NDK_HOME', "$env:LOCALAPPDATA\Android\Sdk\ndk\<版>", 'User')
   ```
3. Rust に Android 向けの出力先を足す
   ```powershell
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```
4. Android の工程を作る(`apps/desktop/src-tauri/gen/android/` ができる。これはコミットする)
   ```powershell
   npm run android:init
   ```

動かす:

```powershell
npm run android:dev      # USB でつないだ端末か、エミュレーターで動かす(画面を書き換えると反映される)
npm run android:build    # apk を作る(gen/android/app/build/outputs/apk/ の下)
```

## iPhone(iOS)

同じソースで動く(Tauri v2 は iOS にも対応している)が、ビルドには Mac(Xcode)が要る。実機に入れたり配ったりするには Apple の開発者の登録も要る。
Mac を用意できたら `npm run tauri -w @bbs-browser/desktop -- ios init` → `ios dev` で動かせる。
