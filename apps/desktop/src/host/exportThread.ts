// スレを保存する(保存先を選んで書き出す)。中身は utils/exportThread.ts

import { invoke } from '@tauri-apps/api/core'
import { pickSavePath } from './dialog'
import { exportFileName, threadToHtml, threadToText, type ExportSource } from '../utils/exportThread'

/** 保存先を選んで書き出す。拡張子が .txt ならテキスト、ほかは HTML。選ばなかったら undefined、書いたらそのパス */
export async function saveThread(src: ExportSource): Promise<string | undefined> {
  const path = await pickSavePath(exportFileName(src.title, 'html'), 'HTML・テキスト', ['html', 'txt'])
  if (!path) return undefined
  const contents = /\.txt$/i.test(path) ? threadToText(src) : threadToHtml(src)
  await invoke('write_text_file', { path, contents })
  return path
}
