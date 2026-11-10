/**
 * 立てた人の ID の前の形を今の形に直す。前は subject.txt の「[123456789]」に「BE:」を付けて持っていたので、
 * 保存済みの NG・立てた人のキーワード・同期で来た値の「BE:123456789」も、今の「123456789」に当たるようにする
 * (スマホ版の TwoCh.kt の legacyAuthorId と同じ)
 */
export const legacyAuthorId = (id: string): string => /^BE:(\d{6,12})$/.exec(id)?.[1] ?? id
