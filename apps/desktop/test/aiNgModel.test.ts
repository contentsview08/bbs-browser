// モデルを動かす所(hooks/useAiNg.ts)の流れ。Worker と通信とウィンドウ間のやりとりは偽物に差し替える
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cross = vi.hoisted(() => ({
  toolKind: undefined as 'settings' | undefined,
  broadcast: vi.fn(async (_event: string, _payload: unknown) => {}),
  callMain: vi.fn(async (_kind: string, _payload?: unknown): Promise<unknown> => undefined),
  listeners: new Map<string, (payload: unknown) => void>(),
}))
vi.mock('../src/host/crossWindow', () => ({
  toolKindOfThisWindow: () => cross.toolKind,
  broadcast: cross.broadcast,
  callMain: cross.callMain,
  onBroadcast: async (event: string, cb: (payload: unknown) => void) => {
    cross.listeners.set(event, cb)
    return () => {}
  },
}))
const net = vi.hoisted(() => ({ fetchModelFile: vi.fn() }))
vi.mock('../src/host/modelFetch', () => ({ fetchModelFile: net.fetchModelFile }))

type Msg = { type: string; id?: number; items?: { key: string }[]; hypotheses?: string[] }
class FakeWorker {
  static all: FakeWorker[] = []
  onmessage?: (e: { data: unknown }) => void
  sent: Msg[] = []
  terminated = false
  /** judge が来たらすぐ返すか */
  answer = true
  constructor() {
    FakeWorker.all.push(this)
  }
  postMessage(m: Msg) {
    this.sent.push(m)
    if (m.type === 'judge' && this.answer) {
      const keys = m.items!.map((i) => i.key)
      this.onmessage?.({ data: { type: 'scores', id: m.id, keys, scores: keys.map(() => m.hypotheses!.map(() => 0.75)) } })
    }
  }
  terminate() {
    this.terminated = true
  }
}

async function load() {
  vi.resetModules()
  return import('../src/hooks/useAiNg')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('Worker', FakeWorker)
  FakeWorker.all = []
  cross.toolKind = undefined
  cross.broadcast.mockClear()
  cross.callMain.mockReset()
  cross.listeners.clear()
  net.fetchModelFile.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const ready = () => FakeWorker.all.at(-1)!.onmessage!({ data: { type: 'ready' } })

describe('試す(testScore)', () => {
  it('文脈なしで頼んでも判定され、答えが返る', async () => {
    const ai = await load()
    ai.startAiModel()
    ready()
    const p = ai.testScore('試しの文', '他人を煽っている')
    await vi.advanceTimersByTimeAsync(300)
    await expect(p).resolves.toBe(0.75)
  })
  it('アンカーと URL だけの文は、待たせずに断る', async () => {
    const ai = await load()
    ai.startAiModel()
    ready()
    await expect(ai.testScore('>>1\nhttps://example.com/a', '他人を煽っている')).rejects.toThrow('判定できる文')
    expect(FakeWorker.all[0].sent.some((m) => m.type === 'judge')).toBe(false)
  })
  it('待っている間にモデルを止めたら、断る', async () => {
    const ai = await load()
    ai.startAiModel()
    ready()
    FakeWorker.all[0].answer = false
    const p = ai.testScore('試しの文', '他人を煽っている')
    ai.stopAiModel()
    await expect(p).rejects.toThrow('止まりました')
  })
})

describe('取っている途中で止める', () => {
  it('取るのを取り消し、遅れて来た進み具合で loading に戻らず、また始められる', async () => {
    let onProgress: (loaded: number, total: number) => void = () => {}
    let signal: AbortSignal | undefined
    net.fetchModelFile.mockImplementation((_url: string, cb: typeof onProgress, s: AbortSignal) => {
      onProgress = cb
      signal = s
      return new Promise(() => {})
    })
    const ai = await load()
    ai.startAiModel()
    const first = FakeWorker.all[0]
    void first.onmessage!({ data: { type: 'fetch', reqId: 1, url: 'https://example.com/model' } })
    ai.stopAiModel()
    expect(signal?.aborted).toBe(true)

    vi.advanceTimersByTime(1000)
    onProgress(10, 100)
    expect(ai.aiModelStatus()).toEqual({ kind: 'off' })

    ai.startAiModel()
    expect(FakeWorker.all).toHaveLength(2)
    expect(FakeWorker.all[1].sent).toEqual([{ type: 'load' }])
    expect(ai.aiModelStatus().kind).toBe('loading')
  })
})

describe('設定ウィンドウ', () => {
  it('メインは状態を知らせる', async () => {
    const ai = await load()
    ai.startAiModel()
    expect(cross.broadcast).toHaveBeenCalledWith('ai-model-status', { kind: 'loading', loaded: 0, total: 0 })
  })
  it('開いた時点の状態をもらい、その後の知らせも写す', async () => {
    cross.toolKind = 'settings'
    cross.callMain.mockResolvedValue({ kind: 'ready' })
    const ai = await load()
    await ai.mirrorAiModelStatus()
    await vi.advanceTimersByTimeAsync(0)
    expect(cross.callMain).toHaveBeenCalledWith('aiModelStatus')
    expect(ai.aiModelStatus()).toEqual({ kind: 'ready' })
    cross.listeners.get('ai-model-status')!({ kind: 'off' })
    expect(ai.aiModelStatus()).toEqual({ kind: 'off' })
    expect(cross.broadcast).not.toHaveBeenCalled()
  })
  it('試す・消すはメインに頼み、自分でモデルを動かさない', async () => {
    cross.toolKind = 'settings'
    cross.callMain.mockResolvedValue(0.5)
    const ai = await load()
    await expect(ai.testScore('文', '条件')).resolves.toBe(0.5)
    expect(cross.callMain).toHaveBeenCalledWith('aiTestScore', { text: '文', prompt: '条件' })
    await ai.deleteAiModelFiles()
    expect(cross.callMain).toHaveBeenCalledWith('aiDeleteModel')
    expect(FakeWorker.all).toHaveLength(0)
  })
})
