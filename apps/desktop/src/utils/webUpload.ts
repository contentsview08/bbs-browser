// 画像の置き場の、ふつうのアップロードの画面(API を使わない)。開いて本人が手で上げ、画面に出た共有リンクを拾って本文に入れる。
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
  { key: 'catbox', name: 'catbox.moe', url: 'https://catbox.moe/', pattern: String.raw`https://files\.catbox\.moe/[a-z0-9]{6}\.[a-z0-9]+`, note: '消えない' },
  { key: 'litterbox', name: 'litterbox(catbox)', url: 'https://litterbox.catbox.moe/', pattern: String.raw`https://litter\.catbox\.moe/[a-z0-9]+\.[a-z0-9]+`, note: '1 時間〜3 日で消える' },
  { key: 'uguu', name: 'uguu.se', url: 'https://uguu.se/', pattern: String.raw`https://[a-z0-9.]*uguu\.se/[A-Za-z0-9_-]+\.[a-z0-9]+`, note: '3 時間で消える' },
]
