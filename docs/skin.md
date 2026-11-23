# スキンの JSON

OBB(PC 版・Android 版)の見た目(配色・レスの見た目・細かい表示・文字と余白)をまとめたものを**スキン**と呼び、1 つの JSON で受け渡せます。
設定 → 表示(PC)/ スキンと配色(Android)の「スキン」で、保存したスキンをドロップダウンから選んで当てたり、いまの見た目に名前を付けて
スキンとして保存したりできます。詳細設定を出すと「JSON を貼り付けて当てる」「いまのスキンを JSON でコピー」(PC はファイルの書き出し・読み込みも)が出ます。
貼り付けた・読み込んだスキンは保存され、次からドロップダウンに出ます。Android のファイルの書き出し・読み込みは設定 → バックアップ の「スキン」から。
最初はスキンは 1 つも入っていません(配色・レスの見た目はこれまでどおり設定で選びます)。

**入っている項目だけを上書きします。** 一部の項目だけの JSON でも読めるので、配ってもらったスキンを当ててから、気に入らない所だけ設定で直せます。
自分の配色だけの JSON(`docs/color-scheme.md`)も、同じ所から読めます。

配布しているスキン: `docs/skins/chmate-dark.json`・`docs/skins/chmate-light.json`(ChMate 風。カードのレス、人気のレスは本文の色で紫 → 桃 → 赤、自分のレス・自分への返信は左の帯)。JSON をコピーして「JSON を貼り付けて当てる」で入ります。

```json
{
  "format": "obb-theme",
  "version": 1,
  "name": "わたしのスキン",
  "note": "説明(任意)",
  "scheme": { "from": "gray", "base": "#313131", "surface": "#313131", "text": "#F4F4F4", "accent": "#8E6BC8", "unread": "#8E6BC8", "own": "#FF8FA3", "colors": { "bar": "#575757" } },
  "accent": "",
  "settings": { "postStyle": "classic", "dateStyle": "full", "showMinimap": true },
  "android": { "styleOptions": { "classic": { "tree": false } } },
  "pc": { "styleOptions": { "classic": { "tree": false } } }
}
```

## 自分の配色との関係

`scheme` の中身は、設定 → 自分の配色 の「JSON をコピー」で取れる JSON(`docs/color-scheme.md`)そのものです。
つまりスキン = 自分の配色の JSON + 見た目の項目。自分の配色だけの JSON を「スキンの JSON を貼り付けて当てる」に貼っても読め、配色だけが変わります。
逆に、スキンの `scheme` だけを取り出せば自分の配色として使えます。

## 項目

| キー | 何か |
|---|---|
| `format` | `obb-theme`(スキンだと分かるように。`settings`・`android`・`pc` のどれかがあればスキンとして読みます) |
| `name`・`note` | 名前と説明(任意)。当てたときの知らせに名前が出ます |
| `scheme` | 自分の配色(`docs/color-scheme.md` の形)。あれば自分の配色として入れ、配色をそれにします(`settings.scheme` があればそちら) |
| `accent` | 差し色のキー(`indigo`・`blue`・`teal`・`green`・`orange`・`red`・`pink`・`purple`)。空は「テーマの色」 |
| `settings` | PC 版と Android 版で名前も意味も同じ項目(下の表) |
| `android` / `pc` | その版だけの項目。相手の版は読み飛ばします |

知らないキー・読めない値は読み飛ばします(新しい版で足した項目が古い版に来ても落ちません)。

## `settings` の項目(両方で同じ)

| まとまり | キー | 値 |
|---|---|---|
| 配色 | `followOsTheme` | OS のダーク・ライトに合わせる(true/false) |
| | `scheme` | 配色のキー(`indigo`・`amber-teal`・`soft-dark`・`discord-dark`・`line-light`・`gray`・`light-gray`・`nord`・`contrast`・`line-dark`・`x-dim`・`mono`・`oled`・`custom`) |
| | `darkScheme`・`lightScheme` | OS に合わせるときの暗い・明るい配色 |
| | `accent` | 差し色のキー |
| レスの見た目 | `postStyle` | `card`・`classic`(専ブラ風)・`matome`・`discord`・`line` |
| | `idStyle` | `none`・`color`(ID ごとに色) |
| | `idShort`・`watchoiShort` | ID・ワッチョイを短く(true/false) |
| | `idPosition` | `header`(日時の後ろ)・`topRight`・`bottomRight` |
| | `dateStyle` | `md_w_hms`・`md_hm`・`full` |
| | `heatStyle` | 人気のレスの示し方: `left`・`right`・`text` |
| | `highlightOp`・`nameSubtle`・`omitNoname`・`iconFromWatchoi` | 主の印・名前欄を目立たなくする・名無しを省く・アイコンをワッチョイから(true/false) |
| | `urlShorten`・`tidyBlankLines`・`showMinimap`・`showLinkPreview`・`openLinksInApp` | URL を短く・空行を整える・ミニマップ・リンクのカード・リンクをアプリの中で(true/false) |
| | `ngMode`・`groupNg` | NG の見せ方(`aborn`・`hide`・`dim`〈Android だけ〉)、続いたあぼーんをまとめる |
| スレ一覧 | `threadSort` | `subject`・`momentum`・`newest`・`count` |
| | `unreadFirst`・`keywordBands` | 未読を上に・キーワードの帯(true/false) |
| | `listShape` | `normal`・`compact` |
| 開いたとき | `openPosition`・`showNextCandidatesAtEnd`・`showNextUnreadAtEnd` | 開く位置(`unread`・`top`・`bottom`)、スレの最後の案内 |
| 画像 | `blurGross`・`postThumbSize`・`thumbLoad` | グロ注意をぼかす・サムネイルの大きさ(px)・サムネイルを読み込む条件 |
| 文字と余白 | `mobileFontPx`・`listFontPx`・`postBodyPx`・`postHeadPx`・`listPadPx`・`postPadPx`・`postLineHeight`・`headerPx`・`footerPx` | px の数(0 や -1 は既定) |
| そのほか | `reduceMotion`・`pastTabsPosition`・`hideBarsOnScroll` | 動きを減らす・履歴のタブの位置(`footer`・`header`)・なぞると帯を隠す |

## 版だけの項目

- `android`: `fontFamily`(字のキー)、`styleOptions`(見た目ごとの設定。`{ "classic": { "tree": false, "treeDepth": 3, "quote": "line", "group": true } }`)
- `pc`: `fontFamily`、`styleOptions`(`{ "classic": { "tree": false, "treeDepth": 6, "quote": "line", "groupRuns": true } }`)、`fontPx`・`contentBasePx`・`replyFontPx`・`barFontPx`、`panelOpacity`・`backgroundOpacity`・`listThumbScale`、`anchorPopup`

## 作り方

1. 設定で見た目を好みに整え、「いまの見た目をスキンとして保存」で名前を付ける。
2. 詳細設定の「いまのスキンを JSON でコピー」で全部の項目が入った JSON が取れる。
3. 配るときは、変えてほしい項目だけ残して削ると、受け取った人の好みを壊しにくい(残した項目だけが上書きされる)。
