// 印から育つ判定(utils/trollModel.ts)を、画面とは別の処理の流れで動かす。
// 画面の側(hooks/useTrollModel.ts)から、ログの行・印・判定したい本文を受け取る。
// ログの数え上げ(コーパス)も学んだ重みもこの中だけに持ち、画面には返さない(数十万項目の Map を写すと重い)。
// 判定(1 レスごと)もここで行い、本文ごとの結果だけを返す
import { buildCorpus, examplesFrom, predict, train, type Corpus, type Judgement, type TrollModel } from '../utils/trollModel'

export type TrollWorkerRequest =
  | { type: 'corpus'; rows: { thread: string; body: string }[] }
  | { type: 'train'; id: number; marks: { body: string; troll: boolean }[] }
  | { type: 'predict'; id: number; bodies: string[] }

export type TrollWorkerResponse =
  | { type: 'corpus' }
  | { type: 'model'; id: number; trollMarks: number }
  | { type: 'predictions'; id: number; bodies: string[]; results: Judgement[] }
  | { type: 'error'; message: string }

let corpus: Corpus | undefined
let model: TrollModel | undefined
/** この処理の流れの外への出口(型は DOM の Window ではなく、Worker の側の postMessage) */
const out = self as unknown as Worker

self.onmessage = (e: MessageEvent<TrollWorkerRequest>) => {
  const m = e.data
  try {
    if (m.type === 'corpus') {
      corpus = buildCorpus(m.rows)
      out.postMessage({ type: 'corpus' } satisfies TrollWorkerResponse)
    } else if (m.type === 'train' && corpus) {
      model = train(examplesFrom(m.marks, corpus), corpus)
      out.postMessage({ type: 'model', id: m.id, trollMarks: model.trollMarks } satisfies TrollWorkerResponse)
    } else if (m.type === 'predict') {
      if (!model || !corpus) return
      const results = m.bodies.map((b) => predict(model!, b, corpus!))
      out.postMessage({ type: 'predictions', id: m.id, bodies: m.bodies, results } satisfies TrollWorkerResponse)
    }
  } catch (err) {
    out.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies TrollWorkerResponse)
  }
}
