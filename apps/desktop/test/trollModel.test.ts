import { describe, expect, it } from 'vitest'
import { LEARNED_THRESHOLD } from '../src/utils/autoNg'
import { axesOf, buildCorpus, examplesFrom, gibberishScore, predict, train } from '../src/utils/trollModel'

// 普通のレス(コーパス)。いろいろなスレに書かれたもの
const normal = [
  '今日の試合は投手がよく粘ったと思う',
  'それな、あの場面で代打を出すのは分かる',
  'ワイも明日行こうかな、土曜は混むけど',
  'このアニメの作画ほんまに良くなったよな',
  'パッチの更新を見てなかったから知らなかった',
  '修繕積立金が足りなくなるのは目に見えてる',
  '新しいバージョンは動画の保存ができるらしい',
  '昔は無料で早く入れたのに今はお金がかかる',
  '関係ない話をするならよそでやってくれ',
  '駅から近いのはいいけど家賃が高すぎる',
]
const rows = [
  ...normal.flatMap((body, i) => [0, 1, 2].map((k) => ({ thread: `t${(i + k) % 7}`, body }))),
  ...['草', 'ワロタ', 'はい'].flatMap((body) => [0, 1, 2, 3, 4, 5].map((k) => ({ thread: `t${k}`, body }))),
]
const gibberish = [
  '伝起翁チョン剤れ縛咲び感',
  'ぼ剛肢決留ョ窒ろげ統ご転厘暗槽',
  'んぜか官チ娯栓雌胎覇ぎチョン',
  'げば油ら縛咲び感を端健斗わそ詳鋭',
  'ぜ席へ討りぐ棄パね犠酔曇っ虞ち尼',
]

describe('判断軸', () => {
  const corpus = buildCorpus(rows)
  it('でたらめ度: ログに出てこない並びばかりの文は高く、ログにある普通の文は低い', () => {
    expect(gibberishScore(gibberish[0], corpus)).toBeGreaterThan(0.8)
    expect(gibberishScore(normal[0], corpus)).toBeLessThan(0.2)
  })
  it('ほかのスレにも書かれた短文はスラング、長文はコピペの軸に入る', () => {
    expect(axesOf('草', corpus).crossShort).toBeGreaterThan(0)
    expect(axesOf('草', corpus).crossLong).toBe(0)
    expect(axesOf(normal[0], corpus).crossShort).toBeGreaterThan(0) // 30 文字未満
  })
})

describe('印から学ぶ', () => {
  it('でたらめ文 3 件に印を付けると、印のないでたらめ文を当て、普通の文は当てない', () => {
    const corpus = buildCorpus(rows)
    const model = train(examplesFrom(gibberish.slice(0, 3).map((body) => ({ body, troll: true })), corpus), corpus)
    for (const g of gibberish.slice(3)) expect(predict(model, g, corpus).p).toBeGreaterThan(LEARNED_THRESHOLD)
    for (const n of normal) expect(predict(model, n, corpus).p).toBeLessThan(LEARNED_THRESHOLD)
    expect(predict(model, gibberish[4], corpus).axis).toBe('gibberish')
  })
})
