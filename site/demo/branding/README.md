# ブランディング画像の差し替え

このフォルダに決まった名前で画像(.png/.gif)を置くと、ビルド・デプロイなし
(=`packages/web`を再デプロイした後、次に読み込んだページから)で自動的に読み込まれます。
コード変更・管理画面での操作は不要です。詳細な解決ロジックは
[`src/utils/branding.ts`](../../src/utils/branding.ts) を参照してください。

## 命名規則

`<名前>-<インデックス>.<拡張子>`(インデックスは `0` から始まる連番、拡張子は`png`か`gif`)

| 用途 | 名前 |
|---|---|
| ホーム画面ヘッダーのアイコン | `header-icon-light` / `header-icon-dark` |
| メニューバーのアイコン(PC: MenuBar / スマホ: MobileNavDrawer) | `menubar-icon-light` / `menubar-icon-dark` |
| Welcomeページ(`/`)のアイコン | `welcome-icon-light` / `welcome-icon-dark` |
| Welcomeページの看板画像(複数可) | `welcome-banner-light` / `welcome-banner-dark` |

例:

```
public/branding/header-icon-dark-0.png
public/branding/welcome-banner-light-0.png
public/branding/welcome-banner-light-1.png
public/branding/welcome-banner-light-2.png
```

- `light`/`dark` は現在選択中のカラースキームに応じて自動で出し分けられます
  (indigo/amber-teal = dark、light/2ch-classic = light。`src/utils/theme.ts`参照)。
- インデックスは **`0`から連番で欠番なく**置いてください。`0`を置き忘れて`1`だけ
  置いても認識されません(`0`が見つからない時点でそこで探索を打ち切るため)。
- 同じインデックスに`.png`と`.gif`の両方を置いた場合は`.png`が優先されます。
- 複数枚(`-0`, `-1`, `-2`...)置いた場合は、閲覧時刻の秒数を枚数で割った余りで
  1枚を選びます(素朴なローテーション)。1枚だけなら常にそれが使われます。
- 何も置かれていない項目は、アプリ名の頭文字(ヘッダー/メニューバーのアイコン)や
  ASCII顔(Welcomeページの看板)といった、コード側の最終フォールバックが使われます。
  旧ビルド時設定(`VITE_APP_ICON`/`VITE_TOP_ICON`/`VITE_APP_BANNER`/
  `VITE_WELCOME_BANNER_IMAGE`)は廃止済みです。

板ごとのアイコンは、このフォルダではなく [`public/board-icons/`](../board-icons/README.md)
を参照してください。
