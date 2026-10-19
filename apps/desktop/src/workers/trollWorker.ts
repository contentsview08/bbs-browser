// 印から育つ判定(utils/trollModel.ts)の、時間のかかる部分(ログの数え上げと学習)を、画面とは別の処理の流れで動かす。
// 画面の側(hooks/useTrollModel.ts)から、ログの行と印を受け取り、数え上げた結果(コーパス)と学んだ重みを返す。
// 判定そのもの(1 レスごと)は軽いので、画面の側で行う
import { buildCorpus, examplesFrom, train, type Corpus } from '../utils/trollModel'

export type TrollWorkerRequest =
  | { type: 'corpus'; rows: { thread: string; body: string }[] }
  | { type: 'train'; id: number; marks: { body: string; troll: boolean }[] }

export type TrollWorkerResponse =
  | { type: 'corpus'; corpus: Corpus }
  | { type: 'model'; id: number; w: Float32Array; b: number; trollMarks: number }
  | { type: 'error'; message: string }

let corpus: Corpus | undefined
/** この処理の流れの外への出口(型は DOM の Window ではなく、Worker の側の postMessage) */
const out = self as unknown as Worker

self.onmessage = (e: MessageEvent<TrollWorkerRequest>) => {
  const m = e.data
  try {
    if (m.type === 'corpus') {
      corpus = buildCorpus(m.rows)
      const res: TrollWorkerResponse = { type: 'corpus', corpus }
      out.postMessage(res)
    } else if (m.type === 'train' && corpus) {
      const model = train(examplesFrom(m.marks, corpus), corpus)
      const res: TrollWorkerResponse = { type: 'model', id: m.id, w: model.w, b: model.b, trollMarks: model.trollMarks }
      // 重みは 25 万バイトほどあるので、写さずに渡す
      out.postMessage(res, [model.w.buffer])
    }
  } catch (err) {
    const res: TrollWorkerResponse = { type: 'error', message: err instanceof Error ? err.message : String(err) }
    out.postMessage(res)
  }
}
