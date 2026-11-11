// 画像の保存先の書き方(例 {site}/{board}/{filename})の、設定の画面に出す変数の説明と例。
// 置き換えは Rust の src-tauri/src/save_name.rs(スマホ版は data/SaveName.kt。言葉もそちらの SAVE_NAME_VARS とそろえる)

export const SAVE_NAME_VARS: readonly { name: string; label: string }[] = [
  { name: '{filename}', label: '元のファイル名(名前 + 拡張子)' },
  { name: '{name}', label: '元のファイル名の、拡張子を除いた名前' },
  { name: '{ext}', label: '拡張子(画像の中身の形式。jpg・png など)' },
  { name: '{site}', label: '掲示板の名前(BBS メニューの名前。なければホスト名)' },
  { name: '{host}', label: '板のホスト名(bbs.eddibb.cc など)' },
  { name: '{board}', label: '板の名前' },
  { name: '{boardKey}', label: '板のキー(URL の最後。liveedge など)' },
  { name: '{thread}', label: 'スレタイ' },
  { name: '{threadKey}', label: 'スレのキー(dat 番号など)' },
  { name: '{no}', label: 'レス番号' },
  { name: '{yyyy} {mm} {dd}', label: '保存した年・月・日' },
  { name: '{HH} {MM} {SS}', label: '保存した時・分・秒' },
  { name: '{unix}', label: '保存した時刻(1970 年からの秒数)' },
]

export const SAVE_NAME_EXAMPLES: readonly string[] = ['{filename}', '{site}/{board}/{filename}', '{yyyy}-{mm}/{threadKey}_{no}_{name}']

export const SAVE_NAME_NOTE =
  '最後の / の後ろがファイル名、その前がフォルダです。拡張子は画像の形式に合わせていつも付きます。スレの外の画像など、分からない値は「不明」に、フォルダ名・ファイル名に使えない文字は _ になります。同じ名前のファイルがあれば「名前 (1).jpg」のように番号を付けます'

/** 見本に使う画像とスレ */
export const SAVE_NAME_SAMPLE = {
  url: 'https://i.imgur.com/abc123.jpg',
  ext: 'jpg',
  vars: { boardUrl: 'https://bbs.eddibb.cc/liveedge/', site: 'エッヂ', board: 'なんでも実況E', thread: '見本のスレ', threadKey: '1731300000', no: 12 },
}
