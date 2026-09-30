import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ENV_DISABLE_AUTH,
  ENV_PAGE_HOSTS,
  normalizePageHosts,
  parseDisableAuthEnv,
  parsePageHostsEnv,
  resolveOptions,
} from '../src/options.ts'

test('规整规则表：去空白、转小写、丢空项与重复项，顺序保留', () => {
  assert.deepEqual(normalizePageHosts([' .TS.net ', '', 'dsh.example.com', '.ts.net', '   ']), [
    '.ts.net',
    'dsh.example.com',
  ])
  assert.deepEqual(normalizePageHosts(undefined), [])
})

test('环境变量里的主机表按逗号切分；未设置 = 不覆盖', () => {
  assert.equal(parsePageHostsEnv(undefined), undefined)
  assert.deepEqual(parsePageHostsEnv('.ts.net, my.lan'), ['.ts.net', 'my.lan'])
  assert.deepEqual(parsePageHostsEnv(''), [], '显式给空串 = 显式清空')
})

test('布尔开关只认 TRUE_WORDS，写错的值一律按"没开"', () => {
  for (const value of ['1', 'true', 'TRUE', 'on', ' On ', 'yes']) {
    assert.equal(parseDisableAuthEnv(value), true, `${value} 应算开`)
  }
  for (const value of [undefined, '', '0', 'false', 'off', 'no', 'ture', 'enable']) {
    assert.equal(parseDisableAuthEnv(value), false, `${value} 应算没开`)
  }
})

test('合并：环境变量优先于配置', () => {
  const options = resolveOptions(
    { pageHosts: ['from-config.example'], disableBrowserAuth: false },
    { [ENV_PAGE_HOSTS]: 'from-env.example', [ENV_DISABLE_AUTH]: '1' },
  )
  assert.deepEqual(options.pageHosts, ['from-env.example'])
  assert.equal(options.disableBrowserAuth, true)
})

test('合并：没有环境变量时用配置；两边都没有则为空、且保留认证', () => {
  const fromConfig = resolveOptions({ pageHosts: ['.ts.net'], disableBrowserAuth: true }, {})
  assert.deepEqual(fromConfig.pageHosts, ['.ts.net'])
  assert.equal(fromConfig.disableBrowserAuth, true)

  const empty = resolveOptions(undefined, {})
  assert.deepEqual(empty.pageHosts, [])
  assert.equal(empty.disableBrowserAuth, false)
})
