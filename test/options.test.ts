/**
 * 配置合并与规整：配置引用 → 当前生效的取值。
 *
 * 环境变量那条路删掉之后，这一层只剩两件事：把引用读成值（每次都读当前值），以及把用户名单规整成
 * 身份判断与日志用的形状。为什么删掉环境变量，见
 * `.agents/notes/implemented/architecture/2026-10-09-config-page-is-the-only-source.md`。
 *
 * @module dsh-tailnet-admin/test/options
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeAllowedUsers, readVolatile, resolveOptions } from '../src/options.ts'
import { asPluginConfig, createConfig } from './helpers.ts'

test('规整用户名单：去空白、转小写、丢空项与重复项，顺序保留', () => {
  assert.deepEqual(normalizeAllowedUsers([' Alice@Example.com ', '', 'alice@example.com', ' bob@example.com ']), [
    'alice@example.com',
    'bob@example.com',
  ])
  assert.deepEqual(normalizeAllowedUsers(undefined), [])
})

test('读引用：值、默认值，以及"这次读到的是当前值"', () => {
  const config = createConfig({ allowedUsers: ['alice@example.com'] })
  assert.deepEqual(resolveOptions(asPluginConfig(config)).allowedUsers, ['alice@example.com'])

  // Loader 就地提交新值之后，下一次读就是新值——插件靠这一点做到"改配置不重启"。
  config.allowedUsers.set(['bob@example.com'])
  assert.deepEqual(resolveOptions(asPluginConfig(config)).allowedUsers, ['bob@example.com'])
})

test('缺省配置：认证名单是空表', () => {
  assert.deepEqual(resolveOptions(undefined).allowedUsers, [])
  assert.deepEqual(resolveOptions({}).allowedUsers, [])
})

test('裸值不算数：字段得是引用，形状不对时一律按"没配置"', () => {
  // 这是刻意的 fail-closed：真送到 `apply` 的永远是 Loader 解析出来的引用；万一有人手搓一个裸数组，
  // 也不该被当成"名单就是这个"。
  const bogus = { allowedUsers: ['alice@example.com'] }
  assert.equal(readVolatile(bogus.allowedUsers as never), undefined)
  assert.deepEqual(resolveOptions(bogus as never).allowedUsers, [])
})
