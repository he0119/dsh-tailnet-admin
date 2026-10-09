/**
 * 配置契约：两个开关的样子、默认值与"改了就生效"的那一半。
 *
 * 这一份测的是**配置本身**，不是插件行为：字段是不是 volatile（设置页能不能看见它们，全靠这一条）、
 * 默认值是不是都关着（安全边界的第一道，见 AGENTS.md 硬约束 1）、布尔量的类型是不是严格到"写错就
 * 拒绝加载"（以前那条"只认 1/true/on/yes"的环境变量规则由它接手）。
 *
 * @module dsh-tailnet-admin/test/config
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config } from '../src/config.ts'

interface SchemaNode {
  readonly type?: string
  readonly meta?: { readonly default?: unknown; readonly volatile?: boolean }
}

/** 序列化后的 schema 是一张图：根节点（`uid`）给出 `字段名 → 节点 id`，节点本体都在 `refs` 里。 */
interface SchemaGraph {
  readonly uid?: number
  readonly refs?: Record<string, SchemaNode>
}

/** 字段名对应的 schema 节点；设置服务投影表单时读的就是这一份序列化结果。 */
function nodeOf(field: string): SchemaNode | undefined {
  const root = Config.toJSON() as unknown as SchemaGraph
  const refs = root.refs ?? {}
  const rootNode = refs[String(root.uid)] as (SchemaNode & { dict?: Record<string, number> }) | undefined
  const id = rootNode?.dict?.[field]
  return id === undefined ? undefined : refs[String(id)]
}

test('两个字段都是 volatile：这是它们能出现在配置页上的唯一理由', () => {
  for (const field of ['pageHosts', 'disableBrowserAuth']) {
    assert.equal(nodeOf(field)?.meta?.volatile, true, `${field} 没标 .volatile()：设置服务会把它整个跳过`)
  }
})

test('默认值都是"什么都不做"：空表 + 保留认证', () => {
  assert.deepEqual(nodeOf('pageHosts')?.meta?.default, [], 'pageHosts 默认必须是空表')
  assert.equal(nodeOf('disableBrowserAuth')?.meta?.default, false, 'disableBrowserAuth 默认必须是 false')

  const parsed = Config({})
  assert.deepEqual(parsed.pageHosts.get(), [])
  assert.equal(parsed.disableBrowserAuth.get(), false)
})

test('缺省配置解析得出引用；显式给值就读得到', () => {
  const parsed = Config({ pageHosts: ['.ts.net'], disableBrowserAuth: true })
  assert.deepEqual(parsed.pageHosts.get(), ['.ts.net'])
  assert.equal(parsed.disableBrowserAuth.get(), true)
})

test('布尔量不是真的布尔就拒绝加载，而不是当成"开了"', () => {
  for (const wrong of ['true', '1', 'on', 'yes', 1, {}]) {
    assert.throws(
      () => Config({ disableBrowserAuth: wrong as never }),
      `disableBrowserAuth=${JSON.stringify(wrong)} 应当被 schema 拒绝：一个手滑不该变成"关掉认证"`,
    )
  }

  // null 在 schemastery 里的意思是"这一项没给"，于是回落默认值 false —— 同样是 fail-closed。
  assert.equal(Config({ disableBrowserAuth: null }).disableBrowserAuth.get(), false)
})
