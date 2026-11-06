# 公式サイトの画像と動画

| ファイル | 中身 |
|---|---|
| `icon.png` | アプリのアイコン(apps/desktop/src-tauri/icons/128x128@2x.png) |
| `pc-card.png` / `pc-discord.png` / `pc-line.png` / `pc-classic.png` | PC 版: レスの見た目ごとの画面写真 |
| `pc-light.png` | PC 版: ライトの配色 |
| `demo.mp4` | 1 分ほどの動画(12 MB) |

「さわってみる」は hono-bbs の web を静的な JSON で動かしたもの。`site/demo` と `site/404.html` は生成物で、hono-bbs `packages/web` の `npm run build:demo` と `scripts/demo-deploy.sh` で作る。
