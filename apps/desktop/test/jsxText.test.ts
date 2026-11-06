// JSX の子の位置の // はコメントにならず、文字として画面に描かれる
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return name.endsWith('.tsx') ? [path] : []
  })
}

function commentLikeTexts(path: string): string[] {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  const found: string[] = []
  const walk = (node: ts.Node) => {
    if (ts.isJsxText(node) && /^\s*\/\//.test(node.text)) found.push(`${path}: ${node.text.trim()}`)
    ts.forEachChild(node, walk)
  }
  walk(file)
  return found
}

describe('JSX の文字', () => {
  it('// で始まる文字を子に置かない({/* */} を使う)', () => {
    expect(sources(join(__dirname, '../src')).flatMap(commentLikeTexts)).toEqual([])
  })
})
