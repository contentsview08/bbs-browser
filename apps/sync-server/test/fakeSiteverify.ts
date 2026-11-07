// Turnstile の検証サービスの代わり。トークンの値で結果を決める。偽サーバー(TS・Kotlin)の /tickets と同じ
export async function fakeSiteverify(_input: string, init: RequestInit): Promise<Response> {
  const token = new URLSearchParams(init.body as string).get('response')
  if (token === 'test-down') throw new Error('down')
  if (token === 'test-pass') return Response.json({ success: true, hostname: 'sync.test', action: 'create-space' })
  return Response.json({ success: false, 'error-codes': [token === 'test-spent' ? 'timeout-or-duplicate' : 'invalid-input-response'] })
}
