// 家の中のネットワーク・自分の PC のアドレスで、自動では読み込まなかったことを示す印(サムネイルの代わり)。
// 押せば開ける(押したときだけ読みに行く)。utils/safeUrl.ts 参照

export default function LocalAddressMark() {
  return (
    <span className="w-full h-full flex flex-col items-center justify-center gap-0.5 text-c-text-muted" title="家の中のネットワークのアドレスなので、自動では読み込みません(押すと開きます)">
      <span className="material-symbols-outlined text-xl leading-none">lan</span>
      <span className="text-[9px] leading-none">家の中</span>
    </span>
  )
}
