// 起動を軽くするため、たまにしか開かない画面(設定・ダイアログ・リーダーなど)を、開いたときに読み込む。
// 読み込みのあいだは何も出さない(すぐ終わる)。呼ぶ側は、ふつうの部品と同じように使える
import { Suspense, lazy, type ComponentProps, type ComponentType } from 'react'

export function lazyComponent<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  const Lazy = lazy(load)
  return function LazyComponent(props: ComponentProps<T>) {
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    )
  }
}
