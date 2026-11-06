// 時計と設定の差し替え口。テストだけが書き換える。どの HTTP の経路からも届かない
export const runtime = {
  now: (): number => Date.now(),
  overrides: null as Record<string, string> | null,
  fetch: (input: string, init: RequestInit): Promise<Response> => fetch(input, init),
}
