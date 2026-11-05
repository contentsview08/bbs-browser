// 画像の置き場の、ふつうのアップロードの画面(API を使わない)。開いて利用者が手で上げ、画面に出た共有リンクを拾って本文に入れる。
// pattern は、上げたあとに出るリンク(直接の画像の URL)の形。スマホのアプリの data/WebUpload.kt と同じ表
export interface WebUploadSite {
  key: string
  name: string
  /** アップロードの画面 */
  url: string
  /** 拾うリンクの形(JavaScript の正規表現) */
  pattern: string
  note: string
}

export const WEB_UPLOAD_SITES: WebUploadSite[] = [
  { key: 'imgur', name: 'imgur', url: 'https://imgur.com/upload', pattern: String.raw`https://i\.imgur\.com/[A-Za-z0-9]{5,}\.(?:jpe?g|png|gif|webp|mp4)`, note: '消えない。ログインしなくても上げられます' },
  { key: 'imgbox', name: 'imgbox', url: 'https://imgbox.com/', pattern: String.raw`https://images\d*\.imgbox\.com/[a-f0-9]{2}/[a-f0-9]{2}/[A-Za-z0-9]+_o\.(?:jpe?g|png|gif|webp)`, note: '消えない。ログインしなくても上げられます' },
  { key: 'imgbb', name: 'imgbb', url: 'https://imgbb.com/', pattern: String.raw`https://i\.ibb\.co/[A-Za-z0-9]+/[^\s"'<>]+\.(?:jpe?g|png|gif|webp)`, note: '消えない。ログインしなくても上げられます' },
]

