# スキンの JSON

OBB(PC 版・Android 版)の見た目(配色・レスの見た目・細かい表示・文字と余白)をまとめたものを**スキン**と呼び、1 つの JSON で受け渡せます。

使う人から見た入口は 設定 → 表示(PC)/ スキンと配色(Android)の「スキンを選ぶ…」で開く**スキンの窓**(パネル)です。
同梱の配色・入れたスキン・「もっと探す」(配っているスキンの一覧)が大きな見本の札で並び、押すとその場で切り替わります。
一覧のスキンは「入れる」で入り、配る側が新しくすると自動で入れ替わります(起動時と、窓を開いたときに見ます)。
いまの見た目に名前を付けて保存すれば自分のスキンになり、「ファイルに書き出す」「ファイルから入れる」で受け渡せます。
JSON という言葉は詳しい設定の中(文字で貼り付け・コピー)だけに出します。

配っているスキンの置き場は GitHub の `contentsview08/obb-skins`(GitHub Pages の `index.json` を読む。形は下の「一覧」)。
ChMate 風(灰・黒・ライト)はそこにあります(このリポジトリの `docs/skins` は廃止)。

**入っている項目だけを上書きします。** 一部の項目だけの JSON でも読めるので、配ってもらったスキンを当ててから、気に入らない所だけ設定で直せます。
自分の配色だけの JSON(`docs/color-scheme.md`)も、同じ所から読めます。

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

## 一覧(カタログ)の形

配り場の `index.json`。`obb-skins` の `tools/build_index.py` がスキンの JSON から作ります(手で書かない)。
アプリは `format` が `obb-skins` のものだけ読み、`url` は `index.json` からの相対でよいです。`scheme`・`settings`(`postStyle`・`scheme`)は札を描くための写しです。

```json
{
  "format": "obb-skins",
  "version": 1,
  "skins": [
    { "id": "chmate-dark", "name": "ChMate 風(灰)", "note": "一言", "revision": 1, "url": "chmate-dark.json",
      "scheme": { "from": "gray", "base": "#313131", "...": "..." }, "settings": { "postStyle": "card" } }
  ]
}
```

- `id` はファイル名(英数字と `-`)。名前が変わっても同じ id なら同じスキンとして入れ替えます
- `revision` を上げると、入れている人のアプリが次に見たときに取り直して入れ替えます(使っていれば当て直す)
- 入れたスキンはアプリの中で `source: { id, url, revision }` を持ちます(書き出す JSON には出しません)
- 置き場は PC `ui/skinCatalog.ts`(`SKIN_CATALOG_URL`)・Android `data/SkinCatalog.kt`(`URL`)
