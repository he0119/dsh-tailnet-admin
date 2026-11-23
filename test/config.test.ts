/**
 * 配置契约：字段的样子、默认值与"改了就生效"的那一半。
 *
 * 这一份测的是**配置本身**，不是插件行为：字段是不是 volatile（设置页能不能看见它，全靠这一条）、
 * 默认值是不是符合约定（名单空表 = 不做事，见 AGENTS.md 硬约束 1）、名单是不是严格到"写错就拒绝加载"。
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

test('allowedUsers 是 volatile：这是它能出现在配置页上的唯一理由', () => {
  assert.equal(nodeOf('allowedUsers')?.meta?.volatile, true, 'allowedUsers 没标 .volatile()：设置服务会把它整个跳过')
})

test('默认值是空表：装上去不碰认证', () => {
  assert.deepEqual(nodeOf('allowedUsers')?.meta?.default, [], 'allowedUsers 默认必须是空表（不碰认证）')
  assert.deepEqual(Config({}).allowedUsers.get(), [])
})

test('缺省配置解析得出引用；显式给值就读得到', () => {
  const parsed = Config({ allowedUsers: ['alice@example.com'] })
  assert.deepEqual(parsed.allowedUsers.get(), ['alice@example.com'])
})

test('名单不是字符串数组就拒绝加载，而不是悄悄忽略', () => {
  for (const wrong of ['alice@example.com', [1], [true], {}, 1]) {
    assert.throws(
      () => Config({ allowedUsers: wrong as never }),
      `allowedUsers=${JSON.stringify(wrong)} 应当被 schema 拒绝：名单的形状不能靠猜`,
    )
  }

  // null 在 schemastery 里的意思是"这一项没给"，于是回落默认空表 —— 同样是 fail-closed。
  assert.deepEqual(Config({ allowedUsers: null }).allowedUsers.get(), [])
})

test('配置里还留着 pageHosts 时被忽略，不影响加载', () => {
  const parsed = Config({ pageHosts: ['.ts.net'], allowedUsers: ['alice@example.com'] } as never)
  assert.deepEqual(parsed.allowedUsers.get(), ['alice@example.com'])
})
